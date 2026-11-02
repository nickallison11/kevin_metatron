import {
  Body,
  Column,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Row,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";

export interface MonthStats {
  new_matches: number;
  intros: number;
  intros_accepted: number;
  /** Founder: views of their deck. Investor: decks they viewed. */
  deck_views: number;
}

export interface MonthlyMatchCard {
  id: string;
  name: string | null;
  fit_score: number;
  angel_score: number | null;
  reason: string | null;
  deep_link: string;
}

export interface MonthlyReportProps {
  audience: "founder" | "investor";
  monthName: string;
  tier: "free" | "basic" | "pro";
  stats: MonthStats;
  matches: MonthlyMatchCard[];
  /** Paid plans can be bought; the upgrade box is hidden until then. */
  paymentsEnabled: boolean;
  unsubscribeUrl: string;
  platformUrl: string;
}

/** The one-line summary used for the inbox preview. */
export function monthlyReportPreview(audience: MonthlyReportProps["audience"], s: MonthStats): string {
  const views = audience === "founder" ? "deck views" : "decks viewed";
  return `${s.new_matches} new matches · ${s.intros} intros · ${s.deck_views} ${views}`;
}

export default function MonthlyReport({
  audience = "founder",
  monthName = "October 2026",
  tier = "basic",
  stats = { new_matches: 12, intros: 3, intros_accepted: 1, deck_views: 27 },
  matches = [],
  paymentsEnabled = false,
  unsubscribeUrl = "#",
  platformUrl = "https://platform.metatron.id",
}: MonthlyReportProps) {
  const founder = audience === "founder";
  const showUpgrade = tier === "free" && paymentsEnabled;
  const numbers: [number, string][] = [
    [stats.new_matches, "New matches"],
    [stats.intros, "Intros"],
    [stats.intros_accepted, "Accepted"],
    [stats.deck_views, founder ? "Deck views" : "Decks viewed"],
  ];

  return (
    <Html>
      <Head />
      <Preview>{monthlyReportPreview(audience, stats)}</Preview>
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

          <Heading style={heading}>Your month on metatron</Heading>
          <Text style={subheading}>{monthName}</Text>

          <Section style={statsCard}>
            <Row>
              {numbers.map(([value, label]) => (
                <Column key={label} style={statCell}>
                  <Text style={statValue}>{value}</Text>
                  <Text style={statLabel}>{label}</Text>
                </Column>
              ))}
            </Row>
          </Section>

          {matches.length > 0 && (
            <Text style={sectionTitle}>
              {founder ? "Your top investor matches" : "Your top founder matches"}
            </Text>
          )}

          {matches.map((m) => (
            <Section key={m.id} style={card}>
              <Text style={nameText}>{m.name || (founder ? "Investor" : "Founder")}</Text>
              <Text style={scoreText}>
                {m.fit_score}% fit
                {!founder && m.angel_score != null && m.angel_score > 0 && ` · Angel Score ${m.angel_score}`}
              </Text>
              {m.reason && <Text style={reasonText}>{m.reason}</Text>}
              <Link href={`${platformUrl}${m.deep_link}`} style={matchButton}>
                {founder ? "View match" : "View pitch"}
              </Link>
            </Section>
          ))}

          {showUpgrade && (
            <Section style={upgradeSection}>
              <Text style={upgradeText}>
                Upgrade to Basic for 10 {founder ? "investor" : "founder"} matches a week.
              </Text>
              <Link
                href={`${platformUrl}/${founder ? "startup" : "investor"}/settings/subscription`}
                style={upgradeButton}
              >
                Upgrade
              </Link>
            </Section>
          )}

          <Hr style={divider} />

          <Text style={footer}>
            You are receiving this because you get match emails from metatron.
            <br />
            <Link href={unsubscribeUrl} style={unsubLink}>
              Unsubscribe
            </Link>
            {" · "}— The metatron team
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
  margin: "0 0 24px",
};

const statsCard: React.CSSProperties = {
  backgroundColor: "#16161f",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: "12px",
  padding: "16px 8px",
  marginBottom: "28px",
};

const statCell: React.CSSProperties = {
  textAlign: "center" as const,
  width: "25%",
};

const statValue: React.CSSProperties = {
  color: "#e8e8ed",
  fontSize: "24px",
  fontWeight: 600,
  margin: "0",
};

const statLabel: React.CSSProperties = {
  color: "#8888a0",
  fontSize: "11px",
  fontFamily: "'JetBrains Mono', monospace",
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em",
  margin: "4px 0 0",
};

const sectionTitle: React.CSSProperties = {
  color: "#8888a0",
  fontSize: "12px",
  fontFamily: "'JetBrains Mono', monospace",
  textTransform: "uppercase" as const,
  letterSpacing: "0.1em",
  margin: "0 0 12px",
};

const card: React.CSSProperties = {
  backgroundColor: "#16161f",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: "12px",
  padding: "20px 24px",
  marginBottom: "12px",
};

const nameText: React.CSSProperties = {
  color: "#e8e8ed",
  fontSize: "16px",
  fontWeight: 600,
  margin: "0 0 4px",
};

const scoreText: React.CSSProperties = {
  color: "#6c5ce7",
  fontSize: "13px",
  margin: "0 0 10px",
  fontFamily: "'JetBrains Mono', monospace",
  fontWeight: 600,
};

const reasonText: React.CSSProperties = {
  color: "#c0c0d0",
  fontSize: "14px",
  lineHeight: "1.5",
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
