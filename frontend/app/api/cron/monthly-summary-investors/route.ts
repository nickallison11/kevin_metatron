import { NextRequest, NextResponse } from "next/server";
import { render } from "@react-email/render";
import React from "react";
import InvestorMonthlySummary from "../../../../emails/investor-monthly-summary";
import type { InvestorMonthlySummaryMatchCard } from "../../../../emails/investor-monthly-summary";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "https://platform.metatron.id";
const CRON_SECRET = process.env.CRON_SECRET ?? "";
const RESEND_API_KEY = process.env.RESEND_API_KEY ?? "";
const PLATFORM_URL =
  process.env.NEXT_PUBLIC_PLATFORM_URL ?? "https://platform.metatron.id";

interface EligibleInvestor {
  user_id: string;
  email: string;
  is_basic: boolean;
  unsubscribe_token: string;
}

interface InvestorMonthlySummaryResponse {
  tier: "free" | "basic";
  eligible: boolean;
  month_name: string;
  total_this_month: number;
  matches: InvestorMonthlySummaryMatchCard[];
  snapshot_id: string | null;
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const summary = { sent: 0, skipped: 0, errors: [] as string[] };

  let investors: EligibleInvestor[];
  try {
    const resp = await fetch(
      `${API_BASE}/api/founders/eligible-for-monthly-summary-investors`,
      { headers: { "x-cron-secret": CRON_SECRET } },
    );
    if (!resp.ok) {
      return NextResponse.json(
        { error: `eligible endpoint: ${resp.status}` },
        { status: 502 },
      );
    }
    investors = await resp.json();
  } catch (e) {
    return NextResponse.json(
      { error: `eligible fetch: ${e}` },
      { status: 502 },
    );
  }

  for (const inv of investors) {
    let summaryData: InvestorMonthlySummaryResponse;
    try {
      const resp = await fetch(
        `${API_BASE}/api/founders/${inv.user_id}/monthly-summary-investor`,
        { headers: { "x-cron-secret": CRON_SECRET } },
      );
      if (!resp.ok) {
        summary.errors.push(`${inv.user_id}: summary endpoint ${resp.status}`);
        continue;
      }
      summaryData = await resp.json();
    } catch (e) {
      summary.errors.push(`${inv.user_id}: summary fetch ${e}`);
      continue;
    }

    if (!summaryData.eligible || summaryData.matches.length === 0) {
      summary.skipped++;
      continue;
    }

    const unsubscribeUrl = `${API_BASE}/unsubscribe?token=${encodeURIComponent(inv.unsubscribe_token)}`;

    let html: string;
    try {
      html = await render(
        React.createElement(InvestorMonthlySummary, {
          monthName: summaryData.month_name,
          totalThisMonth: summaryData.total_this_month,
          tier: summaryData.tier,
          matches: summaryData.matches,
          unsubscribeUrl,
          platformUrl: PLATFORM_URL,
        }),
      );
    } catch (e) {
      summary.errors.push(`${inv.user_id}: render ${e}`);
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
          from: "Kevin <kevin@metatron.id>",
          to: [inv.email],
          subject: `Your top founder matches for ${summaryData.month_name}`,
          html,
          headers: {
            "List-Unsubscribe": `<mailto:unsubscribe@metatron.id>, <${unsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        }),
      });
      if (!resendResp.ok) {
        const body = await resendResp.text();
        summary.errors.push(
          `${inv.user_id}: resend ${resendResp.status} ${body.slice(0, 200)}`,
        );
        continue;
      }
      const resendData = await resendResp.json();

      await fetch(`${API_BASE}/api/founders/email-log`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-cron-secret": CRON_SECRET,
        },
        body: JSON.stringify({
          user_id: inv.user_id,
          email_type: "monthly_summary_investor",
          resend_message_id: resendData.id ?? null,
          match_snapshot_id: summaryData.snapshot_id,
        }),
      }).catch(() => {});

      summary.sent++;
    } catch (e) {
      summary.errors.push(`${inv.user_id}: send ${e}`);
    }
  }

  return NextResponse.json(summary);
}
