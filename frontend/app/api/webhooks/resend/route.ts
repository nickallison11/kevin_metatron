import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "https://platform.metatron.id";
const RESEND_WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET ?? "";
const CRON_SECRET = process.env.CRON_SECRET ?? "";

interface ResendEvent {
  type: string;
  data: {
    email_id?: string;
    [key: string]: unknown;
  };
}

const EVENT_TO_COLUMN: Record<string, string> = {
  "email.opened": "opened_at",
  "email.clicked": "clicked_at",
  "email.bounced": "bounced_at",
  "email.complained": "unsubscribed_at",
  "email.unsubscribed": "unsubscribed_at",
};

function verifySignature(
  payload: string,
  signature: string | null,
): boolean {
  if (!RESEND_WEBHOOK_SECRET || !signature) return false;
  const expected = crypto
    .createHmac("sha256", RESEND_WEBHOOK_SECRET)
    .update(payload)
    .digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(signature, "hex"),
  );
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  const svixSignature = req.headers.get("svix-signature");
  if (RESEND_WEBHOOK_SECRET && svixSignature) {
    const svixId = req.headers.get("svix-id") ?? "";
    const svixTimestamp = req.headers.get("svix-timestamp") ?? "";
    const toSign = `${svixId}.${svixTimestamp}.${rawBody}`;
    const secret = RESEND_WEBHOOK_SECRET.startsWith("whsec_")
      ? RESEND_WEBHOOK_SECRET.slice(6)
      : RESEND_WEBHOOK_SECRET;

    let secretBytes: Buffer;
    try {
      secretBytes = Buffer.from(secret, "base64");
    } catch {
      return NextResponse.json({ error: "bad secret format" }, { status: 500 });
    }

    const sig = crypto
      .createHmac("sha256", secretBytes)
      .update(toSign)
      .digest("base64");

    const providedSigs = (svixSignature ?? "").split(" ");
    const valid = providedSigs.some((s) => {
      const v = s.startsWith("v1,") ? s.slice(3) : s;
      try {
        return crypto.timingSafeEqual(
          Buffer.from(sig, "base64"),
          Buffer.from(v, "base64"),
        );
      } catch {
        return false;
      }
    });

    if (!valid) {
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }
  }

  let event: ResendEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const column = EVENT_TO_COLUMN[event.type];
  if (!column || !event.data?.email_id) {
    return NextResponse.json({ status: "ignored" });
  }

  try {
    await fetch(`${API_BASE}/api/founders/webhook-event`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cron-secret": CRON_SECRET,
      },
      body: JSON.stringify({
        resend_message_id: event.data.email_id,
        column,
      }),
    });
  } catch (e) {
    console.error("webhook forward error:", e);
  }

  return NextResponse.json({ status: "ok" });
}
