import { NextRequest, NextResponse } from "next/server";
import { render } from "@react-email/render";
import React from "react";
import MonthlyReport, { type MonthlyMatchCard, type MonthStats } from "../emails/monthly-report";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "https://platform.metatron.id";
const CRON_SECRET = process.env.CRON_SECRET ?? "";
const RESEND_API_KEY = process.env.RESEND_API_KEY ?? "";
const PLATFORM_URL =
  process.env.NEXT_PUBLIC_PLATFORM_URL ?? "https://platform.metatron.id";

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

/** Sends last month's report ("Your month on metatron") to every eligible founder or investor. */
export async function runMonthlyReports(
  req: NextRequest,
  audience: "founder" | "investor",
) {
  const auth = req.headers.get("authorization") ?? "";
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const paths = PATHS[audience];
  const summary = { sent: 0, skipped: 0, errors: [] as string[] };

  let people: Eligible[];
  try {
    const resp = await fetch(`${API_BASE}${paths.eligible}`, {
      headers: { "x-cron-secret": CRON_SECRET },
    });
    if (!resp.ok) {
      return NextResponse.json({ error: `eligible endpoint: ${resp.status}` }, { status: 502 });
    }
    people = await resp.json();
  } catch (e) {
    return NextResponse.json({ error: `eligible fetch: ${e}` }, { status: 502 });
  }

  for (const p of people) {
    let report: MonthlyReportResponse;
    try {
      const resp = await fetch(`${API_BASE}${paths.report(p.user_id)}`, {
        headers: { "x-cron-secret": CRON_SECRET },
      });
      if (!resp.ok) {
        summary.errors.push(`${p.user_id}: report endpoint ${resp.status}`);
        continue;
      }
      report = await resp.json();
    } catch (e) {
      summary.errors.push(`${p.user_id}: report fetch ${e}`);
      continue;
    }

    if (!report.eligible) {
      summary.skipped++;
      continue;
    }

    const unsubscribeUrl = `${API_BASE}/unsubscribe?token=${encodeURIComponent(p.unsubscribe_token)}`;

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
          platformUrl: PLATFORM_URL,
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
          Authorization: `Bearer ${RESEND_API_KEY}`,
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

      await fetch(`${API_BASE}/api/founders/email-log`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-cron-secret": CRON_SECRET },
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

  return NextResponse.json(summary);
}
