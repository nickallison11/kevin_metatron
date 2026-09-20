// Public site origin, for building shareable absolute links (e.g. a
// founder's public /startups/[id] profile). Matches the convention already
// used ad hoc in the weekly-matches cron routes.
export const PUBLIC_URL =
  process.env.NEXT_PUBLIC_PLATFORM_URL ?? "https://platform.metatron.id";
