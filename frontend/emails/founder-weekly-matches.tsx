import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";

export interface MatchCard {
  id: string;
  firm_name: string | null;
  angel_score: number | null;
  sector_overlap: boolean;
  stage_overlap: boolean;
  why_blurb: string | null;
  deep_link: string;
}

interface FounderWeeklyMatchesProps {
  weekDate: string;
  tier: "free" | "basic";
  matches: MatchCard[];
  unsubscribeUrl: string;
  platformUrl: string;
}

export default function FounderWeeklyMatches({
  weekDate = "11 May 2026",
  tier = "basic",
  matches = [],
  unsubscribeUrl = "#",
  platformUrl = "https://platform.metatron.id",
}: FounderWeeklyMatchesProps) {
  const isFree = tier === "free";

  return (
    <Html>
      <Head />
      <Preview>Your weekly investor matches for {weekDate}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={header}>
            <Img
              src="https://metatron.id/metatron-logo.png"
              alt="metatron"
              height={42}
              style={{ margin: "0 auto" }}
            />
          </Section>

          <Heading style={heading}>Your weekly matches</Heading>
          <Text style={subheading}>Week of {weekDate}</Text>

          {matches.map((m) => (
              <Section key={m.id} style={card}>
                <Text style={firmName}>
                  {m.firm_name || "Investor"}
                </Text>
                <Text style={scoreText}>
                  Angel Score:{" "}
                  {m.angel_score ?? "N/A"}
                </Text>
                {m.why_blurb && (
                  <Text style={blurbText}>
                    {m.why_blurb}
                  </Text>
                )}
                {!isFree && (m.sector_overlap || m.stage_overlap) && (
                  <Text style={signalsText}>
                    {m.sector_overlap && "✓ Sector match"}
                    {m.sector_overlap && m.stage_overlap && "  ·  "}
                    {m.stage_overlap && "✓ Stage match"}
                  </Text>
                )}
                <Link
                  href={`${platformUrl}${m.deep_link}`}
                  style={matchButton}
                >
                  View match
                </Link>
              </Section>
            ))}

          {isFree && (
            <Section style={upgradeSection}>
              <Text style={upgradeText}>
                Upgrade to get up to 5 matches per week with sector and stage
                overlap signals.
              </Text>
              <Link
                href={`${platformUrl}/startup/settings/subscription`}
                style={upgradeButton}
              >
                Upgrade Plan to see all matches
              </Link>
            </Section>
          )}

          <Hr style={divider} />

          <Text style={footer}>
            You are receiving this because you signed up on metatron and opted
            in to weekly match emails.
            <br />
            <Link href={unsubscribeUrl} style={unsubLink}>
              Unsubscribe
            </Link>
            {" · "}
            — The metatron team
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

const body: React.CSSProperties = {
  backgroundColor: "#0a0a0f",
  fontFamily: "'DM Sans', system-ui, sans-serif",
  margin: 0,
  padding: 0,
};

const container: React.CSSProperties = {
  maxWidth: "560px",
  margin: "0 auto",
  padding: "40px 20px",
};

const header: React.CSSProperties = {
  textAlign: "center" as const,
  marginBottom: "32px",
};

const heading: React.CSSProperties = {
  color: "#e8e8ed",
  fontSize: "24px",
  fontWeight: 600,
  textAlign: "center" as const,
  margin: "0 0 4px",
};

const subheading: React.CSSProperties = {
  color: "#8888a0",
  fontSize: "14px",
  textAlign: "center" as const,
  margin: "0 0 28px",
};

const card: React.CSSProperties = {
  backgroundColor: "#16161f",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: "12px",
  padding: "20px 24px",
  marginBottom: "12px",
};

const firmName: React.CSSProperties = {
  color: "#e8e8ed",
  fontSize: "16px",
  fontWeight: 600,
  margin: "0 0 6px",
};

const scoreText: React.CSSProperties = {
  color: "#8888a0",
  fontSize: "13px",
  margin: "0 0 8px",
  fontFamily: "'JetBrains Mono', monospace",
};

const blurbText: React.CSSProperties = {
  color: "#c0c0d0",
  fontSize: "14px",
  lineHeight: "1.5",
  margin: "0 0 14px",
};

const signalsText: React.CSSProperties = {
  color: "#6c5ce7",
  fontSize: "12px",
  fontFamily: "'JetBrains Mono', monospace",
  margin: "0 0 14px",
};

const matchButton: React.CSSProperties = {
  display: "inline-block",
  backgroundColor: "#6c5ce7",
  color: "#ffffff",
  borderRadius: "8px",
  padding: "10px 20px",
  fontSize: "14px",
  fontWeight: 600,
  textDecoration: "none",
};

const upgradeSection: React.CSSProperties = {
  textAlign: "center" as const,
  padding: "24px 0",
};

const upgradeText: React.CSSProperties = {
  color: "#8888a0",
  fontSize: "14px",
  marginBottom: "16px",
};

const upgradeButton: React.CSSProperties = {
  display: "inline-block",
  backgroundColor: "#6c5ce7",
  color: "#ffffff",
  borderRadius: "12px",
  padding: "14px 28px",
  fontSize: "16px",
  fontWeight: 600,
  textDecoration: "none",
};

const divider: React.CSSProperties = {
  borderColor: "rgba(255,255,255,0.06)",
  margin: "28px 0",
};

const footer: React.CSSProperties = {
  color: "#8888a0",
  fontSize: "12px",
  lineHeight: "1.6",
  textAlign: "center" as const,
};

const unsubLink: React.CSSProperties = {
  color: "#6c5ce7",
  textDecoration: "underline",
};
