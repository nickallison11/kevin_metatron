import type { ReactNode } from "react";

/** One rounded panel of rows, split by dividers. */
export const listCard =
  "flex flex-col divide-y divide-[var(--border)] rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] shadow-[var(--card-shadow)]";
export const sectionTitle = "text-lg font-semibold";
export const rowBtn =
  "inline-flex min-h-11 min-w-[104px] shrink-0 items-center justify-center rounded-xl border border-[var(--overlay-12)] px-4 text-sm text-[var(--text)] hover:bg-[var(--overlay-4)] disabled:opacity-50";
export const rowBtnPrimary =
  "inline-flex min-h-11 min-w-[104px] shrink-0 items-center justify-center rounded-xl bg-metatron-accent px-4 text-sm font-semibold text-white hover:bg-metatron-accent-hover disabled:opacity-50";

export function LogoTile({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[var(--overlay-6)] text-lg font-bold text-[var(--text)] [&_svg]:h-[22px] [&_svg]:w-[22px]"
    >
      {children}
    </span>
  );
}

/** Logo, name with one status line, and one action: the same shape on every screen size. */
export function ConnectRow({
  logo,
  name,
  status,
  good,
  action,
}: {
  logo: ReactNode;
  name: string;
  status?: string;
  good?: boolean;
  action: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3.5 px-4 py-3.5 sm:px-5">
      <LogoTile>{logo}</LogoTile>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] font-semibold sm:text-base">{name}</span>
        {status && (
          <span className={`truncate text-[13px] ${good ? "text-[var(--good)]" : "text-[var(--text-muted)]"}`}>{status}</span>
        )}
      </div>
      {action}
    </div>
  );
}

/** Extra content that opens under a row (connect steps, switch confirm, forms). */
export function RowPanel({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-3 px-4 pb-4 sm:px-5 sm:pl-[74px]">{children}</div>;
}
