import { render } from "@react-email/render";
import React from "react";
import MonthlyReport, { type MonthlyMatchCard, type MonthStats } from "../emails/monthly-report";

export interface MonthlyReportConfig {
  apiBase: string;
  platformUrl: string;
  cronSecret: string;
  resendApiKey: string;
  audience: "founder" | "investor";
  /** Send only to this user (for test runs); they must still be eligible. */
  onlyUserId?: string;
}

interface Eligible {
  user_id: string;
  email: string;
  unsubscribe_token: string;
}

interface MonthlyReportResponse {
  tier: "free" | "basic" | "pro";
  eligible: boolean;
  month_name: string;
  payments_enabled: boolean;
  stats: MonthStats;
  matches: MonthlyMatchCard[];
  snapshot_id: string | null;
}

const PATHS = {
  founder: {
    eligible: "/api/founders/eligible-for-monthly-summary",
    report: (id: string) => `/api/founders/${id}/monthly-summary`,
    emailType: "monthly_summary_founder",
  },
  investor: {
    eligible: "/api/founders/eligible-for-monthly-summary-investors",
    report: (id: string) => `/api/founders/${id}/monthly-summary-investor`,
    emailType: "monthly_summary_investor",
  },
} as const;

/**
 * Sends last month's report ("Your month on metatron") to every eligible
 * founder or investor. Run on the 1st by scripts/fire_monthly_reports.mjs
 * on KVM2, for dev and prod.
 */
export async function sendMonthlyReports(cfg: MonthlyReportConfig) {
  const { apiBase, cronSecret, audience } = cfg;
  const paths = PATHS[audience];
  const cronHeaders = { "x-cron-secret": cronSecret };
  const summary = { sent: 0, skipped: 0, errors: [] as string[] };

  const resp = await fetch(`${apiBase}${paths.eligible}`, { headers: cronHeaders });
  if (!resp.ok) {
    throw new Error(`eligible endpoint: ${resp.status} ${await resp.text()}`);
  }
  let people: Eligible[] = await resp.json();
  if (cfg.onlyUserId) people = people.filter((p) => p.user_id === cfg.onlyUserId);

  for (const p of people) {
    let report: MonthlyReportResponse;
    try {
      const r = await fetch(`${apiBase}${paths.report(p.user_id)}`, { headers: cronHeaders });
      if (!r.ok) {
        summary.errors.push(`${p.user_id}: report endpoint ${r.status}`);
        continue;
      }
      report = await r.json();
    } catch (e) {
      summary.errors.push(`${p.user_id}: report fetch ${e}`);
      continue;
    }

    if (!report.eligible) {
      summary.skipped++;
      continue;
    }

    const unsubscribeUrl = `${apiBase}/unsubscribe?token=${encodeURIComponent(p.unsubscribe_token)}`;

    let html: string;
    try {
      html = await render(
        React.createElement(MonthlyReport, {
          audience,
          monthName: report.month_name,
          tier: report.tier,
          stats: report.stats,
          matches: report.matches,
          paymentsEnabled: report.payments_enabled,
          unsubscribeUrl,
          platformUrl: cfg.platformUrl,
        }),
      );
    } catch (e) {
      summary.errors.push(`${p.user_id}: render ${e}`);
      continue;
    }

    try {
      const resendResp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Kevin AI <kevin@metatron.id>",
          to: [p.email],
          subject: `Your month on metatron: ${report.month_name}`,
          html,
          headers: {
            "List-Unsubscribe": `<${unsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        }),
      });
      if (!resendResp.ok) {
        const body = await resendResp.text();
        summary.errors.push(`${p.user_id}: resend ${resendResp.status} ${body.slice(0, 200)}`);
        continue;
      }
      const resendData = await resendResp.json();

      await fetch(`${apiBase}/api/founders/email-log`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...cronHeaders },
        body: JSON.stringify({
          user_id: p.user_id,
          email_type: paths.emailType,
          resend_message_id: resendData.id ?? null,
          match_snapshot_id: report.snapshot_id,
        }),
      }).catch(() => {});

      summary.sent++;
    } catch (e) {
      summary.errors.push(`${p.user_id}: send ${e}`);
    }
  }

  return summary;
}
