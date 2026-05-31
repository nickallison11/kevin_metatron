import Link from "next/link";

export const metadata = {
  title: "Terms of Service — metatron",
};

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[var(--bg)] px-5 py-16">
      <div className="mx-auto max-w-2xl space-y-8 text-[var(--text)]">
        <div>
          <Link href="/" className="text-sm text-[var(--text-muted)] hover:text-[var(--text)]">
            ← metatron.id
          </Link>
          <h1 className="mt-4 text-3xl font-semibold">Terms of Service</h1>
          <p className="mt-2 text-sm text-[var(--text-muted)]">Last updated: June 2026</p>
        </div>

        <Section title="1. About metatron">
          <p>
            metatron (metatron.id) is an AI-powered network that connects founders, investors, and ecosystem partners globally.
            By creating an account you agree to these Terms of Service (&ldquo;Terms&rdquo;) and our Privacy Policy.
            If you do not agree, do not use the platform.
          </p>
        </Section>

        <Section title="2. Eligibility and accounts">
          <p>
            You must be at least 18 years old to use metatron. Accounts are currently created by invitation only.
            You are responsible for keeping your login credentials secure and for all activity under your account.
          </p>
        </Section>

        <Section title="3. Data you share — pitch decks and company information">
          <p>
            To use metatron you must share your pitch deck and company information with us. By uploading or linking
            your pitch deck, pitch data, or any other company materials you grant metatron a non-exclusive,
            worldwide, royalty-free licence to:
          </p>
          <ul>
            <li>Store and process your data to power Kevin AI and the matching engine.</li>
            <li>Use aggregated, anonymised data to improve our services.</li>
            <li>Share your pitch information with matched investors and connectors on the platform as part of the intro and deal-flow process.</li>
            <li>Reference and market your project (company name, sector, stage, one-liner) to promote metatron and its network.</li>
          </ul>
          <p>
            <strong>You retain ownership of your data.</strong> metatron will not sell your raw pitch materials to third parties.
            You may request deletion of your data at any time by contacting us at nick.allison@metatrondao.io.
          </p>
        </Section>

        <Section title="4. Conversations and AI processing">
          <p>
            Your conversations with Kevin (via platform, Telegram, WhatsApp, or email) are processed by AI models
            including Google Gemini, Anthropic Claude, and OpenAI GPT to generate responses.
            Conversation data is stored to provide session history and to improve Kevin&apos;s ability to help you.
            By using Kevin you consent to this processing.
          </p>
        </Section>

        <Section title="5. Messaging channels">
          <p>
            metatron communicates with users via Telegram, WhatsApp, and email. By connecting a messaging channel
            you agree to receive messages from Kevin including match notifications, intro requests, and platform updates.
            You can disconnect a channel at any time from your profile settings.
          </p>
        </Section>

        <Section title="6. Acceptable use">
          <p>You agree not to:</p>
          <ul>
            <li>Provide false or misleading company or investor information.</li>
            <li>Use the platform to spam, solicit, or harass other users.</li>
            <li>Attempt to reverse-engineer, scrape, or copy any part of the platform or its data.</li>
            <li>Use Kevin AI to generate fraudulent investment materials.</li>
          </ul>
          <p>
            metatron reserves the right to suspend or terminate any account that violates these Terms.
          </p>
        </Section>

        <Section title="7. Introductions and deal flow">
          <p>
            metatron facilitates introductions between founders, investors, and connectors. We are not a broker-dealer,
            investment adviser, or financial institution. Any investment decision is solely between the parties involved.
            metatron accepts no liability for the outcome of any introduction or transaction.
          </p>
        </Section>

        <Section title="8. Subscriptions and payments">
          <p>
            Paid tiers (Founder Basic, Founder Pro) are billed monthly via Paystack. Subscriptions renew automatically.
            You may cancel at any time; cancellation takes effect at the end of the current billing period.
            Refunds are not provided for partial periods.
          </p>
        </Section>

        <Section title="9. Intellectual property">
          <p>
            metatron and its logo, design, and underlying software are owned by metatron and protected by applicable
            intellectual property law. Nothing in these Terms transfers any IP rights to you.
          </p>
        </Section>

        <Section title="10. Limitation of liability">
          <p>
            To the maximum extent permitted by law, metatron is not liable for any indirect, incidental, or consequential
            damages arising from your use of the platform. Our total liability to you shall not exceed the amounts you
            have paid to metatron in the preceding three months.
          </p>
        </Section>

        <Section title="11. Changes to these terms">
          <p>
            We may update these Terms from time to time. We will notify you by email or in-platform notice.
            Continued use of metatron after an update constitutes acceptance of the revised Terms.
          </p>
        </Section>

        <Section title="12. Contact">
          <p>
            For questions about these Terms, contact us at{" "}
            <a href="mailto:nick.allison@metatrondao.io" className="text-metatron-accent hover:underline">
              nick.allison@metatrondao.io
            </a>
            .
          </p>
        </Section>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold text-[var(--text)]">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-[var(--text-muted)] [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_strong]:text-[var(--text)]">
        {children}
      </div>
    </section>
  );
}
