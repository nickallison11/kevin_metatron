"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { API_BASE, authJsonHeaders } from "@/lib/api";

type InvoiceDetail = {
  id: string;
  amount: number;
  currency: string;
  payment_method: string;
  tier: string;
  period_start: string;
  period_end: string;
  reference: string | null;
  created_at: string;
  email: string;
};

function formatInvoiceDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatMonthRange(startIso: string, endIso: string) {
  const s = new Date(startIso);
  const e = new Date(endIso);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return "—";
  const opts: Intl.DateTimeFormatOptions = { month: "short", year: "numeric" };
  return `${s.toLocaleDateString(undefined, opts)} – ${e.toLocaleDateString(undefined, opts)}`;
}

function paymentMethodLabel(m: string) {
  const x = m.toLowerCase();
  if (x === "card") return "Card";
  if (x === "usdc") return "USDC";
  if (x === "usdt") return "USDT";
  return m;
}

function tierLabel(tier: string) {
  const t = tier.toLowerCase();
  if (t === "annual") return "Annual";
  return "Monthly";
}

function planLabel(settingsHref: string) {
  if (settingsHref.includes("/startup/")) return "Founder Basic Subscription";
  if (settingsHref.includes("/investor/")) return "Investor Basic Subscription";
  if (settingsHref.includes("/connector/")) return "Connector Basic Subscription";
  return "metatron Subscription";
}

export default function SubscriptionInvoiceView({
  token,
  invoiceId,
  settingsHref,
}: {
  token: string;
  invoiceId: string;
  settingsHref: string;
}) {
  const [inv, setInv] = useState<InvoiceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!invoiceId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/subscriptions/invoices/${invoiceId}`, {
          headers: authJsonHeaders(token),
        });
        if (res.status === 404) {
          if (!cancelled) setError("Invoice not found.");
          return;
        }
        if (!res.ok) {
          if (!cancelled) setError("Could not load invoice.");
          return;
        }
        const data = (await res.json()) as InvoiceDetail;
        if (!cancelled) setInv(data);
      } catch {
        if (!cancelled) setError("Could not load invoice.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, invoiceId]);

  if (error) {
    return (
      <div className="mx-auto max-w-lg px-5 py-10">
        <p className="text-sm text-[var(--text-muted)]">{error}</p>
        <Link href={settingsHref} className="mt-4 inline-block text-sm text-metatron-accent hover:underline">
          Back to subscription
        </Link>
      </div>
    );
  }

  if (!inv) {
    return (
      <div className="mx-auto max-w-lg px-5 py-10">
        <p className="text-sm text-[var(--text-muted)]">Loading…</p>
      </div>
    );
  }

  const invShort = inv.id.slice(-8);
  const amountLine = `${inv.currency} ${inv.amount.toFixed(2)}`;
  const tierLine = tierLabel(inv.tier);
  const periodLine = formatMonthRange(inv.period_start, inv.period_end);
  const refDisplay = inv.reference?.trim() ? inv.reference : "—";

  return (
    <>
      <style>{`@media print { body * { visibility: hidden; } #invoice, #invoice * { visibility: visible; } #invoice { position: absolute; left: 0; top: 0; width: 100%; } }`}</style>

      <div className="mx-auto max-w-2xl px-5 py-6 print:hidden">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Link href={settingsHref} className="text-sm text-metatron-accent hover:underline">
            ← Subscription
          </Link>
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-[12px] bg-metatron-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-metatron-accent-hover print:hidden"
          >
            Print / Save as PDF
          </button>
        </div>
      </div>

      <div
        id="invoice"
        className="mx-auto max-w-2xl px-5 pb-10 text-[var(--text)]"
        style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }}
      >
        <div className="mb-6">
          <img
            src="/metatron-logo.png"
            alt="metatron"
            className="h-[42px] w-auto"
          />
        </div>
        <p className="font-sans text-[11px] uppercase tracking-[0.2em] text-[var(--text-muted)]">
          INVOICE
        </p>
        <div className="my-4 border-t border-[var(--border)]" />
        <div className="space-y-1 text-sm">
          <p>
            <span className="text-[var(--text-muted)]">Invoice #:</span> {invShort}
          </p>
          <p>
            <span className="text-[var(--text-muted)]">Date:</span>{" "}
            {formatInvoiceDate(inv.created_at)}
          </p>
          <p>
            <span className="text-[var(--text-muted)]">Billed to:</span> {inv.email}
          </p>
        </div>
        <div className="my-4 border-t border-[var(--border)]" />
        <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
          <span className="text-[var(--text-muted)]">Description</span>
          <span className="text-right text-[var(--text-muted)]">Amount</span>
        </div>
        <div className="my-2 border-t border-[var(--border)]" />
        <div className="grid grid-cols-[1fr_auto] gap-x-4 text-sm">
          <div>
            <p className="font-medium">{planLabel(settingsHref)}</p>
            <p className="text-xs text-[var(--text-muted)]">
              ({tierLine} · {periodLine})
            </p>
          </div>
          <p className="text-right tabular-nums">{amountLine}</p>
        </div>
        <div className="my-4 border-t border-[var(--border)]" />
        <div className="grid grid-cols-[1fr_auto] gap-x-4 text-sm font-semibold">
          <span>Total</span>
          <span className="tabular-nums">{amountLine}</span>
        </div>
        <div className="my-4 border-t border-[var(--border)]" />
        <div className="space-y-1 text-sm text-[var(--text-muted)]">
          <p>
            Payment method:{" "}
            <span className="text-[var(--text)]">{paymentMethodLabel(inv.payment_method)}</span>
          </p>
          <p>
            Reference: <span className="text-[var(--text)] font-sans text-xs">{refDisplay}</span>
          </p>
        </div>
        <div className="my-6 border-t border-[var(--border)]" />
        <p className="text-center text-xs text-[var(--text-muted)]">
          metatron · platform.metatron.id
        </p>
        <p className="mt-1 text-center text-xs text-[var(--text-muted)]">Metatron DAO (Pty) Ltd</p>
      </div>
    </>
  );
}
