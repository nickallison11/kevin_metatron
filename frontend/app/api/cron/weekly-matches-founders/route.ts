import { NextRequest, NextResponse } from "next/server";
import { render } from "@react-email/render";
import React from "react";
import FounderWeeklyMatches from "../../../../emails/founder-weekly-matches";
import type { MatchCard } from "../../../../emails/founder-weekly-matches";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "https://platform.metatron.id";
const CRON_SECRET = process.env.CRON_SECRET ?? "";
const RESEND_API_KEY = process.env.RESEND_API_KEY ?? "";
const PLATFORM_URL =
  process.env.NEXT_PUBLIC_PLATFORM_URL ?? "https://platform.metatron.id";

interface EligibleFounder {
  user_id: string;
  email: string;
  timezone: string | null;
  is_basic: boolean;
  unsubscribe_token: string;
}

interface WeeklyMatchesResponse {
  tier: "free" | "basic";
  eligible: boolean;
  matches: MatchCard[];
  snapshot_id: string | null;
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const summary = { sent: 0, skipped: 0, errors: [] as string[] };

  let founders: EligibleFounder[];
  try {
    const resp = await fetch(
      `${API_BASE}/api/founders/eligible-for-weekly-matches`,
      {
        headers: { "x-cron-secret": CRON_SECRET },
      },
    );
    if (!resp.ok) {
      return NextResponse.json(
        { error: `eligible endpoint: ${resp.status}` },
        { status: 502 },
      );
    }
    founders = await resp.json();
  } catch (e) {
    return NextResponse.json(
      { error: `eligible fetch: ${e}` },
      { status: 502 },
    );
  }

  for (const f of founders) {
    let matchData: WeeklyMatchesResponse;
    try {
      const resp = await fetch(
        `${API_BASE}/api/founders/${f.user_id}/weekly-matches`,
        { headers: { "x-cron-secret": CRON_SECRET } },
      );
      if (!resp.ok) {
        summary.errors.push(`${f.user_id}: match endpoint ${resp.status}`);
        continue;
      }
      matchData = await resp.json();
    } catch (e) {
      summary.errors.push(`${f.user_id}: match fetch ${e}`);
      continue;
    }

    if (!matchData.eligible || matchData.matches.length === 0) {
      summary.skipped++;
      continue;
    }

    const weekDate = new Date().toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    const unsubscribeUrl = `${API_BASE}/unsubscribe?token=${encodeURIComponent(f.unsubscribe_token)}`;

    let html: string;
    try {
      html = await render(
        React.createElement(FounderWeeklyMatches, {
          weekDate,
          tier: matchData.tier,
          matches: matchData.matches,
          unsubscribeUrl,
          platformUrl: PLATFORM_URL,
        }),
      );
    } catch (e) {
      summary.errors.push(`${f.user_id}: render ${e}`);
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
          to: [f.email],
          subject: `Your weekly investor matches — ${weekDate}`,
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
          `${f.user_id}: resend ${resendResp.status} ${body.slice(0, 200)}`,
        );
        continue;
      }
      const resendData = await resendResp.json();
      const messageId = resendData.id ?? null;

      await fetch(`${API_BASE}/api/founders/email-log`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-cron-secret": CRON_SECRET,
        },
        body: JSON.stringify({
          user_id: f.user_id,
          email_type: "weekly_matches_founder",
          resend_message_id: messageId,
          match_snapshot_id: matchData.snapshot_id,
        }),
      }).catch(() => {});

      summary.sent++;
    } catch (e) {
      summary.errors.push(`${f.user_id}: send ${e}`);
    }
  }

  return NextResponse.json(summary);
}
