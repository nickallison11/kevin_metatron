#!/usr/bin/env -S node --experimental-vm-modules
// Fires the weekly-matches cron logic by hand, against whichever backend
// API_BASE points to. Vercel Cron Jobs only ever invoke the Production
// deployment (documented Vercel platform behavior, not something we
// configured) -- there is no separate Vercel cron for dev.metatron.id, so
// this script is dev's substitute: run on a schedule via crontab on KVM2
// instead of Vercel's scheduler. Mirrors
// frontend/app/api/cron/weekly-matches-{founders,investors}/route.ts
// exactly; keep the two in sync if the route logic changes.
//
// Usage: bun fire_weekly_matches.mjs <founders|investors>
// Required env: API_BASE, PLATFORM_URL, CRON_SECRET, RESEND_API_KEY
// Must be run with bun (not plain node) since the imported .tsx email
// templates need bun's built-in JSX/TS transpilation. The import paths
// below are relative to this file's own location, not the process cwd --
// ES module imports always resolve that way -- so they point at
// ../frontend/emails/ regardless of where the script is invoked from.
// react/react-dom/@react-email/render resolve from frontend/node_modules
// because each imported module's own dependencies resolve relative to
// where THAT module lives, i.e. inside frontend/.

import { render } from "@react-email/render";
import React from "react";
import FounderWeeklyMatches from "../frontend/emails/founder-weekly-matches.tsx";
import InvestorWeeklyMatches from "../frontend/emails/investor-weekly-matches.tsx";

const API_BASE = process.env.API_BASE;
const PLATFORM_URL = process.env.PLATFORM_URL;
const CRON_SECRET = process.env.CRON_SECRET;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

if (!API_BASE || !PLATFORM_URL || !CRON_SECRET || !RESEND_API_KEY) {
  console.error(
    "API_BASE, PLATFORM_URL, CRON_SECRET, and RESEND_API_KEY must all be set in the environment",
  );
  process.exit(1);
}

const kind = process.argv[2]; // "founders" | "investors"
if (kind !== "founders" && kind !== "investors") {
  console.error("usage: node fire_weekly_matches.mjs <founders|investors>");
  process.exit(1);
}

const summary = { sent: 0, skipped: 0, errors: [] };

const eligiblePath =
  kind === "founders"
    ? "/api/founders/eligible-for-weekly-matches"
    : "/api/founders/eligible-for-weekly-matches-investors";

const resp = await fetch(`${API_BASE}${eligiblePath}`, {
  headers: { "x-cron-secret": CRON_SECRET },
});
if (!resp.ok) {
  console.error(`eligible endpoint: ${resp.status} ${await resp.text()}`);
  process.exit(1);
}
const eligible = await resp.json();
console.log(`eligible ${kind}: ${eligible.length}`);

for (const person of eligible) {
  await fetch(`${API_BASE}/api/founders/${person.user_id}/refresh-matches`, {
    method: "POST",
    headers: { "x-cron-secret": CRON_SECRET },
  }).catch(() => {});

  const matchPath =
    kind === "founders"
      ? `/api/founders/${person.user_id}/weekly-matches`
      : `/api/founders/${person.user_id}/weekly-matches-investor`;

  let matchData;
  try {
    const r = await fetch(`${API_BASE}${matchPath}`, {
      headers: { "x-cron-secret": CRON_SECRET },
    });
    if (!r.ok) {
      summary.errors.push(`${person.user_id}: match endpoint ${r.status}`);
      continue;
    }
    matchData = await r.json();
  } catch (e) {
    summary.errors.push(`${person.user_id}: match fetch ${e}`);
    continue;
  }

  if (!matchData.eligible || matchData.matches.length === 0) {
    summary.skipped++;
    console.log(
      `  skip ${person.email}: eligible=${matchData.eligible} matches=${matchData.matches?.length ?? 0}`,
    );
    continue;
  }

  const weekDate = new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const unsubscribeUrl = `${API_BASE}/unsubscribe?token=${encodeURIComponent(person.unsubscribe_token)}`;

  let html;
  try {
    if (kind === "founders") {
      html = await render(
        React.createElement(FounderWeeklyMatches, {
          weekDate,
          tier: matchData.tier,
          matches: matchData.matches,
          unsubscribeUrl,
          platformUrl: PLATFORM_URL,
        }),
      );
    } else {
      html = await render(
        React.createElement(InvestorWeeklyMatches, {
          weekDate,
          tier: matchData.tier,
          matches: matchData.matches,
          unsubscribeUrl,
          platformUrl: PLATFORM_URL,
        }),
      );
    }
  } catch (e) {
    summary.errors.push(`${person.user_id}: render ${e}`);
    continue;
  }

  const subject =
    kind === "founders"
      ? `Your weekly investor matches — ${weekDate}`
      : `Your weekly founder matches — ${weekDate}`;
  const emailType =
    kind === "founders" ? "weekly_matches_founder" : "weekly_matches_investor";

  try {
    const resendResp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Kevin <kevin@metatron.id>",
        to: [person.email],
        subject,
        html,
        headers: {
          "List-Unsubscribe": `<mailto:unsubscribe@metatron.id>, <${unsubscribeUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      }),
    });
    if (!resendResp.ok) {
      summary.errors.push(
        `${person.user_id}: resend ${resendResp.status} ${(await resendResp.text()).slice(0, 200)}`,
      );
      continue;
    }
    const resendData = await resendResp.json();

    await fetch(`${API_BASE}/api/founders/email-log`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cron-secret": CRON_SECRET },
      body: JSON.stringify({
        user_id: person.user_id,
        email_type: emailType,
        resend_message_id: resendData.id ?? null,
        match_snapshot_id: matchData.snapshot_id,
      }),
    }).catch(() => {});

    summary.sent++;
    console.log(`  sent -> ${person.email}`);
  } catch (e) {
    summary.errors.push(`${person.user_id}: send ${e}`);
  }
}

console.log(JSON.stringify(summary, null, 2));
if (summary.errors.length > 0) process.exitCode = 1;
