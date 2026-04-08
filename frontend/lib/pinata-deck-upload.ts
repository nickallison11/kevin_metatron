import { API_BASE, authHeaders, authJsonHeaders } from "@/lib/api";

export type PitchDeckFinalizeResponse = {
  url: string;
  visibility: string;
  cid: string | null;
  deck_expires_at: string;
  extracted: unknown;
  pitch: unknown;
  extraction_error?: string;
};

type PinataJwtResponse = {
  upload_url: string;
  network: string;
  expires_in: number;
};

function parsePinataFileData(pinataUploadJson: unknown): {
  cid?: string;
  fileId?: string;
} {
  const root =
    pinataUploadJson &&
    typeof pinataUploadJson === "object" &&
    pinataUploadJson !== null &&
    "data" in pinataUploadJson
      ? (pinataUploadJson as { data: unknown }).data
      : pinataUploadJson;

  if (!root || typeof root !== "object") {
    return {};
  }
  const d = root as Record<string, unknown>;
  const cid = typeof d.cid === "string" ? d.cid : undefined;
  const fileId = typeof d.id === "string" ? d.id : undefined;
  return { cid, fileId };
}

/**
 * After the browser uploads to Pinata's signed URL, register the file with the backend
 * (profile update, Gemini extraction, pitch row).
 */
export async function finalizePitchDeckAfterPinataUpload(
  token: string,
  file: File,
  pinataUploadJson: unknown,
  network: "public" | "private",
): Promise<
  | { ok: true; data: PitchDeckFinalizeResponse }
  | { ok: false; status: number; error: string }
> {
  const { cid, fileId } = parsePinataFileData(pinataUploadJson);

  const body: Record<string, unknown> = { filename: file.name };
  if (network === "public") {
    body.cid = cid ?? null;
  } else {
    body.file_id = fileId ?? null;
  }

  const res = await fetch(`${API_BASE}/uploads/pitch-deck-cid`, {
    method: "POST",
    headers: authJsonHeaders(token),
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err =
      typeof data.error === "string" ? data.error : "Finalize failed";
    return { ok: false, status: res.status, error: err };
  }
  return { ok: true, data: data as unknown as PitchDeckFinalizeResponse };
}

/**
 * Direct browser → Pinata upload using a short-lived signed URL from the backend, then finalize.
 */
export async function uploadPitchDeckViaPinata(
  token: string,
  file: File,
): Promise<
  | { ok: true; data: PitchDeckFinalizeResponse }
  | { ok: false; status: number; error: string }
> {
  const jwtRes = await fetch(
    `${API_BASE}/uploads/pinata-jwt?filename=${encodeURIComponent(file.name)}`,
    { headers: authHeaders(token) },
  );
  const jwtText = await jwtRes.text();
  let jwtJson: PinataJwtResponse | null = null;
  try {
    jwtJson = JSON.parse(jwtText) as PinataJwtResponse;
  } catch {
    /* ignore */
  }
  if (!jwtRes.ok) {
    let err = "Could not get upload URL";
    try {
      const j = JSON.parse(jwtText) as { error?: string };
      if (j.error) err = j.error;
    } catch {
      /* ignore */
    }
    return { ok: false, status: jwtRes.status, error: err };
  }
  if (!jwtJson?.upload_url || !jwtJson?.network) {
    return { ok: false, status: 500, error: "Invalid upload URL response" };
  }

  const network = jwtJson.network === "private" ? "private" : "public";

  const fd = new FormData();
  fd.append("file", file);
  fd.append("network", network);

  const up = await fetch(jwtJson.upload_url, {
    method: "POST",
    body: fd,
  });
  const upText = await up.text();
  let pinataJson: unknown;
  try {
    pinataJson = JSON.parse(upText);
  } catch {
    return {
      ok: false,
      status: up.status,
      error: upText.slice(0, 200) || "Pinata upload failed",
    };
  }
  if (!up.ok) {
    const p = pinataJson as { error?: { message?: string }; message?: string };
    const msg =
      (typeof p?.error === "object" && p?.error?.message) ||
      (typeof p?.message === "string" && p.message) ||
      "Pinata upload failed";
    return { ok: false, status: up.status, error: String(msg) };
  }

  return finalizePitchDeckAfterPinataUpload(token, file, pinataJson, network);
}
