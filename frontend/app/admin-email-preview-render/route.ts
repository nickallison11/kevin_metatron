import { NextRequest, NextResponse } from "next/server";
import { render } from "@react-email/render";
import React from "react";
import FounderWeeklyMatches from "../../emails/founder-weekly-matches";
import InvestorWeeklyMatches from "../../emails/investor-weekly-matches";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
const CRON_SECRET = process.env.CRON_SECRET ?? "";
const PLATFORM_URL =
  process.env.NEXT_PUBLIC_PLATFORM_URL ?? "https://platform.metatron.id";

export async function POST(req: NextRequest) {
  const { template, userId } = await req.json();

  if (template === "investor-weekly-matches" && userId) {
    const resp = await fetch(
      `${API_BASE}/api/founders/${userId}/weekly-matches-investor`,
      { headers: { "x-cron-secret": CRON_SECRET } },
    );
    if (!resp.ok) {
      return new NextResponse(`backend error: ${resp.status}`, { status: 502 });
    }
    const data = await resp.json();
    const weekDate = new Date().toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    const html = await render(
      React.createElement(InvestorWeeklyMatches, {
        weekDate,
        tier: data.tier,
        matches:
          data.matches.length > 0
            ? data.matches
            : [
                {
                  id: "mock-1",
                  company_name: "Sample Startup",
                  sector: "FinTech",
                  stage: "Seed",
                  fit_score: 82,
                  angel_score: 74,
                  reason:
                    "They are a Seed-stage FinTech in your focus region, raising $500K within your ticket range.",
                  deep_link: "/investor/deal-flow?focus=mock-1",
                  repeat: false,
                },
              ],
        unsubscribeUrl: "#",
        platformUrl: PLATFORM_URL,
      }),
    );
    return new NextResponse(html, {
      headers: { "Content-Type": "text/html" },
    });
  }

  if (template === "founder-weekly-matches" && userId) {
    const resp = await fetch(
      `${API_BASE}/api/founders/${userId}/weekly-matches`,
      { headers: { "x-cron-secret": CRON_SECRET } },
    );

    if (!resp.ok) {
      return new NextResponse(`backend error: ${resp.status}`, { status: 502 });
    }

    const data = await resp.json();

    const weekDate = new Date().toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    const html = await render(
      React.createElement(FounderWeeklyMatches, {
        weekDate,
        tier: data.tier,
        matches:
          data.matches.length > 0
            ? data.matches
            : [
                {
                  id: "mock-1",
                  firm_name: "Sample VC Fund",
                  fit_score: 87,
                  reason:
                    "They invest in FinTech at your stage and in your region, and your $1M round fits their ticket range.",
                  deep_link: "/startup/matches?focus=mock-1",
                  repeat: false,
                },
              ],
        unsubscribeUrl: "#",
        platformUrl: PLATFORM_URL,
      }),
    );

    return new NextResponse(html, {
      headers: { "Content-Type": "text/html" },
    });
  }

  return new NextResponse("invalid params", { status: 400 });
}
