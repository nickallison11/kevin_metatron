/** The pitch sections shown on Startup Profile, and how complete a pitch is. */

export type Member = { name: string; role: string; linkedin: string };

export type Pitch = {
  id: string;
  title: string;
  description?: string | null;
  problem?: string | null;
  solution?: string | null;
  market_size?: string | null;
  business_model?: string | null;
  traction?: string | null;
  funding_ask?: string | null;
  use_of_funds?: string | null;
  team_size?: number | null;
  incorporation_country?: string | null;
  team_members?: unknown;
};

export type PitchField =
  | "description"
  | "problem"
  | "solution"
  | "market_size"
  | "business_model"
  | "traction"
  | "funding_ask"
  | "incorporation_country"
  | "use_of_funds";

export type Section = {
  k: string;
  label: string;
  fields?: { f: PitchField; label: string; short?: boolean }[];
  team?: true;
};

export const SECTIONS: Section[] = [
  { k: "overview", label: "Overview", fields: [{ f: "description", label: "What does the company do?" }] },
  {
    k: "problem",
    label: "Problem & solution",
    fields: [
      { f: "problem", label: "The problem" },
      { f: "solution", label: "Our solution" },
    ],
  },
  {
    k: "market",
    label: "Market & model",
    fields: [
      { f: "market_size", label: "Market size" },
      { f: "business_model", label: "Business model" },
    ],
  },
  { k: "traction", label: "Traction", fields: [{ f: "traction", label: "What have you achieved so far?" }] },
  {
    k: "raise",
    label: "The raise",
    fields: [
      { f: "funding_ask", label: "Raising", short: true },
      { f: "incorporation_country", label: "Incorporated in", short: true },
    ],
  },
  { k: "funds", label: "Use of funds", fields: [{ f: "use_of_funds", label: "Where will the money go?" }] },
  { k: "team", label: "Team", team: true },
];

export function membersFrom(raw: unknown): Member[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const o = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      return { name: String(o.name ?? ""), role: String(o.role ?? ""), linkedin: String(o.linkedin ?? "") };
    })
    .filter((m) => m.name.trim());
}

export function sectionComplete(pitch: Pitch | null, s: Section): boolean {
  if (s.team) return membersFrom(pitch?.team_members).length > 0;
  return (s.fields ?? []).every((x) => String((pitch?.[x.f] as string | null | undefined) ?? "").trim());
}

/** Which sections are done and which are missing, in page order. */
export function pitchProgress(pitch: Pitch | null): { done: Section[]; missing: Section[] } {
  const done: Section[] = [];
  const missing: Section[] = [];
  for (const s of SECTIONS) (sectionComplete(pitch, s) ? done : missing).push(s);
  return { done, missing };
}
