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
  fit_score: number;
  reason: string | null;
  deep_link: string;
  /** Shown in an earlier digest. */
  repeat: boolean;
}

interface FounderWeeklyMatchesProps {
  weekDate: string;
  tier: "free" | "basic" | "pro";
  matches: MatchCard[];
  unsubscribeUrl: string;
  platformUrl: string;
  /** Paid plans can be bought; the upgrade box is hidden until then. */
  paymentsEnabled?: boolean;
}

export default function FounderWeeklyMatches({
  weekDate = "11 May 2026",
  tier = "basic",
  matches = [],
  unsubscribeUrl = "#",
  platformUrl = "https://platform.metatron.id",
  paymentsEnabled = false,
}: FounderWeeklyMatchesProps) {
  const showUpgrade = tier === "free" && paymentsEnabled;
  const matchCard = (m: MatchCard) => (
    <Section key={m.id} style={card}>
      <Text style={firmName}>{m.firm_name || "Investor"}</Text>
      <Text style={scoreText}>{m.fit_score}% fit</Text>
      {m.reason && <Text style={blurbText}>{m.reason}</Text>}
      <Link href={`${platformUrl}${m.deep_link}`} style={matchButton}>
        View match
      </Link>
    </Section>
  );

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

          {matches.filter((m) => !m.repeat).map(matchCard)}

          {matches.some((m) => m.repeat) && (
            <Text style={sectionTitle}>Still worth a look</Text>
          )}
          {matches.filter((m) => m.repeat).map(matchCard)}

          {showUpgrade && (
            <Section style={upgradeSection}>
              <Text style={upgradeText}>
                Upgrade to Basic for 10 investor matches a week.
              </Text>
              <Link
                href={`${platformUrl}/startup/settings/subscription`}
                style={upgradeButton}
              >
                Upgrade
              </Link>
            </Section>
          )}

          <Section style={directorySection}>
            <Text style={directoryText}>
              Your deck is public on metatron — see how it looks to investors
              and share it directly.
            </Text>
            <Link href={`${platformUrl}/startups`} style={matchButton}>
              Browse the public directory
            </Link>
          </Section>

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

const directorySection: React.CSSProperties = {
  textAlign: "center" as const,
  padding: "12px 0 24px",
};

const directoryText: React.CSSProperties = {
  color: "#8888a0",
  fontSize: "13px",
  marginBottom: "12px",
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

const sectionTitle: React.CSSProperties = {
  color: "#8888a0",
  fontSize: "12px",
  fontFamily: "'JetBrains Mono', monospace",
  textTransform: "uppercase" as const,
  letterSpacing: "0.1em",
  margin: "24px 0 12px",
};
