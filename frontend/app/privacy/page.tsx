import Link from "next/link";

export const metadata = {
  title: "Privacy & Cookie Policy — metatron",
};

// Same policy as https://metatron.id/privacy; keep the two in sync.
export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[var(--bg)] px-5 py-16">
      <div className="mx-auto max-w-2xl space-y-8 text-[var(--text)]">
        <div>
          <Link href="/" className="text-sm text-[var(--text-muted)] hover:text-[var(--text)]">
            ← metatron.id
          </Link>
          <h1 className="mt-4 text-3xl font-semibold">Privacy &amp; Cookie Policy</h1>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            This policy describes how we use cookies and similar technologies on https://metatron.id and how you can
            control them. For broader terms governing use of the site, see our{" "}
            <Link href="/terms" className="text-[var(--accent-fg)] hover:underline">
              Terms and Conditions
            </Link>
            .
          </p>
        </div>

        <h2 className="text-xl font-semibold">Cookie Policy</h2>

        <Section title="Use of cookies">
          <p>
            Cookies are small files that a site or its service provider transfers to your computer&apos;s hard drive
            through your web browser (if you allow) that enables the sites or service providers&apos; systems to
            recognize your browser and capture and remember certain information.
          </p>
          <p>
            We use cookies to improve how our website performs and ensure that it functions correctly, grants access to
            restricted content, and also to understand and save your preferences for future visits.
          </p>
          <p>
            Cookies which are set by us can be restricted or blocked through your browser settings. Doing so may impact
            on the functionality of our website. If you do not restrict or block any cookies, you agree to accept the use
            of all cookies.
          </p>
          <p>We use the following types of cookies:</p>
          <ul>
            <li>
              <strong>Strictly necessary cookies (analytics)</strong>
              <br />
              These cookies are essential to enable you to browse around our websites and use their features. Without
              these cookies, services like logging in to secure sections of our website and restricting access based on
              who logged in cannot be provided.
            </li>
            <li>
              <strong>Performance cookies (performance)</strong>
              <br />
              These cookies collect analytical information about how you use and move around our website – for instance,
              which pages you go to most. This data may be used to help optimize your browsing experience and make it
              easier for you to navigate or monitor if the website is starting to degrade in performance. These cookies
              don&apos;t collect information that identifies you. All information these cookies collect is aggregated
              and therefore anonymous.
            </li>
            <li>
              <strong>Functionality cookies (functional and advertisement)</strong>
              <br />
              These cookies allow our websites to remember choices you make while browsing. For instance, we may store
              your geographic location in a cookie to track which region visitors are coming from and what their interest
              is. The information these cookies collect will not personally identify you, and they cannot track your
              browsing activity on third party websites.
            </li>
          </ul>
        </Section>

        <h2 className="text-xl font-semibold">Privacy notice (GDPR)</h2>

        <Section title="Who is responsible">
          <p>
            The controller for your personal data is Andrew Nicholas Allison, trading as metatron AI Labs, Obermayrstraße
            5/4, 4240 Freistadt, Austria (<Mail />). See the{" "}
            <a href="https://metatron.id/impressum" className="text-[var(--accent-fg)] hover:underline">
              Impressum
            </a>
            .
          </p>
        </Section>

        <Section title="What we collect and why">
          <ul>
            <li>
              Account data (name, email, password hash, role) to create and run your account: performance of our contract
              with you (Art. 6(1)(b) GDPR).
            </li>
            <li>
              Profile and deck data (company, thesis, pitch deck and what Kevin extracts from it) to match founders with
              investors and make introductions: contract.
            </li>
            <li>
              Messages with Kevin on the web, WhatsApp, Telegram and email, including your phone number or Telegram ID if
              you use those channels: contract.
            </li>
            <li>
              Billing data (plan, invoices; card details are handled by Stripe, not stored by us): contract and legal
              obligations (Art. 6(1)(b) and (c)).
            </li>
            <li>
              Emails we send, such as weekly matches, which you can switch off at any time: our legitimate interest (Art.
              6(1)(f)) or your consent.
            </li>
          </ul>
        </Section>

        <Section title="Who processes data for us">
          <p>
            We use these providers, bound by data processing terms: Hostinger (servers), Vercel and Cloudflare (website
            hosting and network), Resend (email), Stripe (payments), Anthropic, OpenAI and Google (AI models that power
            Kevin), Pinata (deck file storage), Meta (WhatsApp) and Telegram (messaging). Some are outside the EU;
            transfers rely on the EU–US Data Privacy Framework or the European Commission&apos;s standard contractual
            clauses.
          </p>
        </Section>

        <Section title="How long we keep it">
          <p>
            While your account exists. When you delete your account we delete or anonymise your data, except invoices
            and records we must keep by law (in Austria, generally seven years).
          </p>
        </Section>

        <Section title="Your rights">
          <p>
            You can ask for access to, correction or deletion of your data, restriction of or objection to its
            processing, and a copy in a portable format. Write to <Mail />. You can also complain to the Austrian data
            protection authority (Datenschutzbehörde,{" "}
            <a href="https://www.dsb.gv.at" className="text-[var(--accent-fg)] hover:underline">
              dsb.gv.at
            </a>
            ).
          </p>
        </Section>

        <Section title="Contact">
          <p>
            For questions about this policy or your data, contact us at <Mail />.
          </p>
        </Section>
      </div>
    </main>
  );
}

function Mail() {
  return (
    <a href="mailto:contact@metatron.id" className="text-[var(--accent-fg)] hover:underline">
      contact@metatron.id
    </a>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold text-[var(--text)]">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-[var(--text-muted)] [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-2 [&_strong]:text-[var(--text)]">
        {children}
      </div>
    </section>
  );
}
