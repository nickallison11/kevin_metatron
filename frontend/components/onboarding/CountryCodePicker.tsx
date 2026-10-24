"use client";

import "flag-icons/css/flag-icons.min.css";
import { getCountryCallingCode, isSupportedCountry, type CountryCode } from "libphonenumber-js";
import { useEffect, useMemo, useRef, useState } from "react";
import { COUNTRIES } from "@/lib/countries";

export type DialCountry = { code: CountryCode; name: string; dial: string };

/** Every country in lib/countries.ts that has a phone calling code, A–Z. */
export const DIAL_COUNTRIES: DialCountry[] = COUNTRIES.filter((c) => isSupportedCountry(c.code))
  .map((c) => ({ code: c.code as CountryCode, name: c.name, dial: `+${getCountryCallingCode(c.code as CountryCode)}` }))
  .sort((a, b) => a.name.localeCompare(b.name));

export function Flag({ code, className = "" }: { code: string; className?: string }) {
  // flag-icons draws an SVG flag as the element's background; emoji flags
  // don't render on Windows.
  return (
    <span
      aria-hidden
      className={`fi fi-${code.toLowerCase()} shrink-0 rounded-[3px] ${className}`}
      style={{ width: 24, height: 18, backgroundSize: "cover" }}
    />
  );
}

/**
 * Country calling-code picker: a button showing the flag and code, opening a
 * searchable list. On a phone the list slides up from the bottom; on wider
 * screens it opens as a small centred dialog.
 */
export function CountryCodePicker({ value, onChange }: { value: CountryCode; onChange: (c: CountryCode) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const current = DIAL_COUNTRIES.find((c) => c.code === value) ?? DIAL_COUNTRIES[0]!;

  const list = useMemo(() => {
    const s = q.trim().toLowerCase().replace(/^\+/, "");
    if (!s) return DIAL_COUNTRIES;
    return DIAL_COUNTRIES.filter(
      (c) => c.name.toLowerCase().includes(s) || c.code.toLowerCase() === s || c.dial.slice(1).startsWith(s),
    );
  }, [q]);

  useEffect(() => {
    if (!open) return;
    setQ("");
    // Phones get the keyboard only when they tap the search box.
    if (window.matchMedia("(min-width: 640px)").matches) searchRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  return (
    <>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Country code: ${current.name} ${current.dial}`}
        onClick={() => setOpen(true)}
        className="flex min-h-[52px] w-[116px] shrink-0 items-center gap-2 rounded-xl border border-[var(--overlay-12)] bg-[var(--bg)] pl-3 pr-2.5 text-base text-[var(--text)] outline-none focus:border-metatron-accent"
      >
        <Flag code={current.code} />
        <span className="flex-1 text-left font-medium">{current.dial}</span>
        <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--text-muted)]">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="fixed inset-0 z-[70] flex flex-col bg-black/60 sm:items-center sm:justify-center sm:p-6">
          <button type="button" aria-label="Close country list" className="flex-1 cursor-default sm:absolute sm:inset-0" onClick={() => setOpen(false)} />
          <div
            role="dialog"
            aria-label="Choose your country"
            className="relative flex max-h-[75vh] flex-col rounded-t-[20px] border-t border-[var(--overlay-12)] bg-[var(--bg-card)] pb-[max(16px,env(safe-area-inset-bottom))] sm:max-h-[480px] sm:w-full sm:max-w-sm sm:rounded-2xl sm:border sm:pb-2"
          >
            <span aria-hidden className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-[var(--overlay-12)] sm:hidden" />
            <div className="p-3">
              <input
                ref={searchRef}
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search country or code"
                aria-label="Search country or code"
                className="min-h-12 w-full rounded-xl border border-[var(--overlay-12)] bg-[var(--bg)] px-3.5 text-base text-[var(--text)] outline-none placeholder:text-[var(--text-muted)] focus:border-metatron-accent"
              />
            </div>
            <ul role="listbox" aria-label="Countries" className="flex-1 overflow-y-auto overscroll-contain px-2">
              {list.map((c) => {
                const on = c.code === current.code;
                return (
                  <li key={c.code} role="option" aria-selected={on}>
                    <button
                      type="button"
                      onClick={() => {
                        onChange(c.code);
                        setOpen(false);
                      }}
                      className={`flex min-h-[52px] w-full items-center gap-3 rounded-[10px] px-3 text-left text-base text-[var(--text)] ${on ? "bg-metatron-accent/[0.14]" : "hover:bg-[var(--overlay-4)]"}`}
                    >
                      <Flag code={c.code} />
                      <span className="flex-1 truncate">{c.name}</span>
                      <span className="text-[var(--text-muted)]">{c.dial}</span>
                    </button>
                  </li>
                );
              })}
              {list.length === 0 && <li className="px-3 py-6 text-center text-sm text-[var(--text-muted)]">No country matches “{q}”.</li>}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
