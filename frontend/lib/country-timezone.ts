import ct from "countries-and-timezones";

// countries-and-timezones lists every IANA zone a country touches, but for
// multi-timezone countries the list isn't ordered by population -- e.g. US
// starts with "America/Adak" (a few hundred people on an Alaskan island),
// not New York. For weekly-matches send timing we only need ONE
// representative "is it Monday 8am in this country" answer per country, so
// for the handful of genuinely multi-timezone countries we pin the
// capital/most-populous zone explicitly. Every other country in
// COUNTRIES (lib/countries.ts) has exactly one IANA zone and needs no
// override.
const PRIMARY_TIMEZONE_OVERRIDES: Record<string, string> = {
  AR: "America/Argentina/Buenos_Aires",
  AU: "Australia/Sydney",
  BR: "America/Sao_Paulo",
  CA: "America/Toronto",
  CL: "America/Santiago",
  CN: "Asia/Shanghai",
  CY: "Asia/Nicosia",
  EC: "America/Guayaquil",
  DE: "Europe/Berlin",
  ID: "Asia/Jakarta",
  KZ: "Asia/Almaty",
  KI: "Pacific/Tarawa",
  MY: "Asia/Kuala_Lumpur",
  MH: "Pacific/Majuro",
  MX: "America/Mexico_City",
  FM: "Pacific/Pohnpei",
  MN: "Asia/Ulaanbaatar",
  NZ: "Pacific/Auckland",
  PG: "Pacific/Port_Moresby",
  PT: "Europe/Lisbon",
  ES: "Europe/Madrid",
  UA: "Europe/Kyiv",
  US: "America/New_York",
  UZ: "Asia/Tashkent",
  VN: "Asia/Ho_Chi_Minh",
};

/**
 * Resolves an ISO-2 country code to a single representative IANA timezone.
 * Falls back to UTC for null/unset/unrecognized codes -- per product
 * decision, users with no country on their profile keep getting weekly
 * matches at the old fixed 8am UTC rather than never receiving one.
 */
export function getPrimaryTimezone(
  countryCode: string | null | undefined,
): string {
  if (!countryCode) return "UTC";
  const code = countryCode.toUpperCase();
  if (PRIMARY_TIMEZONE_OVERRIDES[code]) return PRIMARY_TIMEZONE_OVERRIDES[code];
  const country = ct.getCountry(code);
  return country?.timezones[0] ?? "UTC";
}

/**
 * True when it is currently between 8:00 and 8:59 local time on a Monday,
 * in the country's representative timezone. Callers should run on an
 * hourly tick (not a single fixed weekly time) and gate the actual send on
 * this per-user check -- a user whose local Monday-8am hasn't arrived yet
 * this run simply isn't sent to yet and gets re-checked next hour, with no
 * side effects (their 5-day not-already-emailed eligibility window is
 * untouched until they actually receive one).
 */
export function isLocalMonday8amWindow(
  countryCode: string | null | undefined,
  now: Date = new Date(),
): boolean {
  const timezone = getPrimaryTimezone(countryCode);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "numeric",
    hour12: false,
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value;
  const hourStr = parts.find((p) => p.type === "hour")?.value;
  const hour = hourStr ? parseInt(hourStr, 10) : NaN;
  // Intl's 24h "hour" can format midnight as "24" depending on locale/ICU
  // version; normalize so the comparison below is exact either way.
  const normalizedHour = hour === 24 ? 0 : hour;
  return weekday === "Mon" && normalizedHour === 8;
}
