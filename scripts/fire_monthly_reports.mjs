// Sends last month's "Your month on metatron" report, against whichever
// backend API_BASE points to. Runs from crontab on KVM2 on the 1st of each
// month, once for dev and once for prod (Vercel crons only run on the
// production site, so this replaces them for both).
//
// Usage: bun fire_monthly_reports.mjs <founders|investors> [--only <user_id>]
// Required env: API_BASE, PLATFORM_URL, CRON_SECRET, RESEND_API_KEY
// Run with bun: the imported .tsx/.ts files need its TS/JSX transpilation,
// and their dependencies resolve from frontend/node_modules.
// The backend skips anyone who already got this month's report (20 days),
// so a repeated run doesn't send twice.

import { sendMonthlyReports } from "../frontend/lib/monthly-report-cron.ts";

const { API_BASE, PLATFORM_URL, CRON_SECRET, RESEND_API_KEY } = process.env;
if (!API_BASE || !PLATFORM_URL || !CRON_SECRET || !RESEND_API_KEY) {
  console.error("API_BASE, PLATFORM_URL, CRON_SECRET and RESEND_API_KEY must all be set");
  process.exit(1);
}

const kind = process.argv[2];
const onlyIdx = process.argv.indexOf("--only");
const onlyUserId = onlyIdx > 0 ? process.argv[onlyIdx + 1] : undefined;
if ((kind !== "founders" && kind !== "investors") || (onlyIdx > 0 && !onlyUserId)) {
  console.error("usage: bun fire_monthly_reports.mjs <founders|investors> [--only <user_id>]");
  process.exit(1);
}

const summary = await sendMonthlyReports({
  apiBase: API_BASE,
  platformUrl: PLATFORM_URL,
  cronSecret: CRON_SECRET,
  resendApiKey: RESEND_API_KEY,
  audience: kind === "founders" ? "founder" : "investor",
  onlyUserId,
});
console.log(`${new Date().toISOString()} monthly ${kind}:`, JSON.stringify(summary));
