import Link from "next/link";

export default function ConnectorUpgradeGate({ feature }: { feature: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center py-32 text-center px-6">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--bg-card)]">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-[var(--text-muted)]"
        >
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </div>
      <h2 className="text-lg font-semibold text-[var(--text)]">{feature} requires Connector Basic</h2>
      <p className="mt-2 max-w-xs text-sm text-[var(--text-muted)]">
        Upgrade to unlock this feature and grow your network impact.
      </p>
      <Link
        href="/connector/settings/subscription"
        className="mt-6 inline-flex rounded-[12px] bg-metatron-accent px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-metatron-accent-hover"
      >
        Upgrade to Connector Basic →
      </Link>
    </div>
  );
}
