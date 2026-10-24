"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { IconArrowUpRight, IconDots, IconLock, IconPlugConnected, IconSparkles, IconTrash, IconUpload, IconX } from "@tabler/icons-react";

export type DeckStatus = "none" | "unread" | "reading" | "read" | "failed";

const CHIP: Record<Exclude<DeckStatus, "none">, { label: string; cls: string }> = {
  unread: { label: "Not read by Kevin", cls: "bg-[var(--overlay-6)] text-[var(--text-muted)]" },
  reading: { label: "Kevin is reading…", cls: "bg-metatron-accent/15 text-[var(--accent-fg)]" },
  read: { label: "Read by Kevin", cls: "bg-metatron-accent/15 text-[var(--accent-fg)]" },
  failed: { label: "Couldn't read it", cls: "bg-[var(--warn-bg)] text-[var(--warn)]" },
};

const btn =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--overlay-12)] px-4 text-sm font-semibold text-[var(--text)] hover:bg-[var(--overlay-4)] disabled:opacity-50";
const btnPrimary =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-metatron-accent px-4 text-sm font-semibold text-white hover:bg-metatron-accent-hover disabled:opacity-50";

/**
 * The founder's pitch deck: open it, import it with Kevin (Basic/Pro), or
 * replace/remove it from the ⋯ menu. Anyone can upload a deck.
 */
export default function DeckCard({
  url,
  status,
  paid,
  onUpload,
  onImport,
  onRemove,
}: {
  url: string | null;
  status: DeckStatus;
  paid: boolean;
  onUpload: (file: File) => void;
  onImport: () => void;
  onRemove: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) {
        setMenu(false);
        setConfirmRemove(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSheet(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet]);

  const fileInput = (
    <input
      ref={input}
      type="file"
      accept="application/pdf,.pdf"
      className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (f) onUpload(f);
      }}
    />
  );

  const dropProps = {
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      setDragging(true);
    },
    onDragLeave: () => setDragging(false),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer.files?.[0];
      if (f) onUpload(f);
    },
  };

  if (status === "none" || !url) {
    return (
      <section aria-label="Pitch deck" {...dropProps}>
        <button
          type="button"
          onClick={() => input.current?.click()}
          className={`flex w-full items-center gap-4 rounded-[16px] border-[1.5px] border-dashed p-4 text-left sm:p-5 ${
            dragging ? "border-metatron-accent bg-metatron-accent/10" : "border-metatron-accent/45 bg-metatron-accent/[0.06] hover:bg-metatron-accent/10"
          }`}
        >
          <span className="flex h-14 w-11 shrink-0 items-center justify-center rounded-lg border-[1.5px] border-dashed border-[var(--overlay-12)] text-[var(--accent-fg)]">
            <IconUpload size={20} stroke={1.8} />
          </span>
          <span className="flex flex-col gap-0.5">
            <span className="text-base font-semibold">Upload pitch deck</span>
            <span className="text-[13px] text-[var(--text-muted)]">PDF</span>
          </span>
        </button>
        {fileInput}
      </section>
    );
  }

  const chip = CHIP[status];
  const read = status === "read";

  return (
    <section
      aria-label="Pitch deck"
      {...dropProps}
      className={`relative flex flex-col gap-3.5 rounded-[16px] border p-4 sm:p-5 ${dragging ? "border-metatron-accent bg-metatron-accent/10" : "border-[var(--overlay-12)] bg-[var(--bg-card)]"}`}
    >
      <div className="flex flex-wrap items-center gap-3 sm:gap-4">
        <div className="flex min-w-0 flex-[999_1_240px] items-center gap-3.5">
          <span className="flex h-14 w-11 shrink-0 items-center justify-center rounded-lg border border-[var(--overlay-12)] bg-gradient-to-br from-[var(--overlay-6)] to-transparent font-mono text-[10px] text-[var(--accent-fg)]">
            PDF
          </span>
          <span className="flex min-w-0 flex-col gap-1.5">
            <span className="text-base font-semibold">Pitch deck</span>
            <span className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${chip.cls}`}>
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
              {chip.label}
            </span>
          </span>
        </div>

        <div className="flex w-full items-center gap-2 sm:w-auto">
          <a href={url} target="_blank" rel="noreferrer" aria-label="Open pitch deck in a new tab" className={btn}>
            Open <IconArrowUpRight size={15} stroke={2} />
          </a>
          {paid ? (
            <button
              type="button"
              disabled={status === "reading"}
              onClick={() => setSheet(true)}
              className={`${read ? btn : btnPrimary} flex-1 sm:flex-none`}
            >
              {read ? "Import again" : "Import Pitch Deck"}
            </button>
          ) : (
            <Link href="/startup/settings/subscription?return=/startup/profile" className={`${btnPrimary} flex-1 sm:flex-none`}>
              Upgrade to Import Deck
            </Link>
          )}
          <div ref={menuRef} className="relative">
            <button
              type="button"
              aria-label="More deck actions"
              aria-haspopup="menu"
              aria-expanded={menu}
              onClick={() => {
                setMenu((v) => !v);
                setConfirmRemove(false);
              }}
              className={`${btn} w-11 px-0`}
            >
              <IconDots size={18} />
            </button>
            {menu && (
              <div role="menu" className="absolute right-0 top-[52px] z-20 flex w-52 flex-col rounded-[14px] border border-[var(--overlay-12)] bg-[var(--bg-card)] p-1.5 shadow-[0_16px_40px_rgba(0,0,0,0.45)]">
                {confirmRemove ? (
                  <>
                    <span className="px-3 py-2 text-sm text-[var(--text-muted)]">Remove this deck?</span>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenu(false);
                        setConfirmRemove(false);
                        onRemove();
                      }}
                      className="flex min-h-11 items-center gap-2.5 rounded-[10px] px-3 text-left text-sm font-semibold text-[#f08a8a] hover:bg-[var(--overlay-4)]"
                    >
                      <IconTrash size={16} stroke={1.8} /> Remove
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenu(false);
                        input.current?.click();
                      }}
                      className="flex min-h-11 items-center gap-2.5 rounded-[10px] px-3 text-left text-sm text-[var(--text)] hover:bg-[var(--overlay-4)]"
                    >
                      <IconUpload size={16} stroke={1.8} /> Replace deck
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => setConfirmRemove(true)}
                      className="flex min-h-11 items-center gap-2.5 rounded-[10px] px-3 text-left text-sm text-[#f08a8a] hover:bg-[var(--overlay-4)]"
                    >
                      <IconTrash size={16} stroke={1.8} /> Remove
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {status === "reading" && (
        <div aria-hidden className="h-1 overflow-hidden rounded-full bg-[var(--overlay-8)]">
          <div className="h-full w-2/5 animate-pulse rounded-full bg-metatron-accent" />
        </div>
      )}

      {fileInput}

      {sheet && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-black/60 sm:items-center sm:justify-center sm:p-6">
          <button type="button" aria-label="Close" onClick={() => setSheet(false)} className="flex-1 cursor-default sm:absolute sm:inset-0" />
          <div
            role="dialog"
            aria-label="Import Pitch Deck"
            className="relative flex flex-col gap-2.5 rounded-t-[22px] border-t border-[var(--overlay-12)] bg-[var(--bg-card)] px-4 pb-[max(24px,env(safe-area-inset-bottom))] pt-2.5 sm:w-full sm:max-w-[440px] sm:rounded-[20px] sm:border sm:p-6"
          >
            <span aria-hidden className="mx-auto mb-1.5 h-1 w-10 rounded-full bg-[var(--overlay-12)] sm:hidden" />
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-xl font-semibold">Import Pitch Deck</h2>
              <button type="button" aria-label="Close" onClick={() => setSheet(false)} className="-mr-2 hidden h-10 w-10 items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)] sm:flex">
                <IconX size={18} />
              </button>
            </div>

            <button
              type="button"
              aria-disabled={!paid}
              onClick={() => {
                if (!paid) return;
                setSheet(false);
                onImport();
              }}
              className={`flex min-h-[60px] items-center gap-3 rounded-[14px] border px-3.5 py-3 text-left ${
                paid ? "border-metatron-accent/45 bg-metatron-accent/[0.08] hover:bg-metatron-accent/[0.14]" : "cursor-default border-[var(--overlay-8)] opacity-70"
              }`}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-metatron-accent/15 text-[var(--accent-fg)]">
                <IconSparkles size={18} stroke={1.8} />
              </span>
              <span className="flex-1 text-[15px] font-medium">Kevin reads your deck</span>
              <span className={`flex items-center gap-1 whitespace-nowrap text-xs ${paid ? "text-[var(--accent-fg)]" : "text-[var(--text-muted)]"}`}>
                {!paid && <IconLock size={12} stroke={2} />}
                {paid ? "Included" : "Basic · Pro"}
              </span>
            </button>

            <div aria-disabled className="flex min-h-[60px] items-center gap-3 rounded-[14px] border border-[var(--overlay-8)] px-3.5 py-3 opacity-70">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-metatron-accent/15 text-[var(--accent-fg)]">
                <IconPlugConnected size={18} stroke={1.8} />
              </span>
              <span className="flex-1 text-[15px] font-medium">Connect your AI</span>
              <span className="flex items-center gap-1 whitespace-nowrap text-xs text-[var(--text-muted)]">
                <IconLock size={12} stroke={2} />
                Claude · ChatGPT · Soon
              </span>
            </div>

            {!paid && (
              <Link href="/startup/settings/subscription?return=/startup/profile" className={`${btnPrimary} mt-1.5 min-h-12 text-[15px]`}>
                See plans
              </Link>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
