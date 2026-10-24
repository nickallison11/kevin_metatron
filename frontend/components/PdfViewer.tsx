"use client";

import { useEffect, useRef, useState } from "react";
import { IconArrowUpRight, IconX } from "@tabler/icons-react";

/**
 * Shows a PDF over the page so the user stays in the app. Full screen on a
 * phone, a large dialog on wider screens. pdf.js is loaded only when this
 * opens; the legacy build keeps older phones working. Pages are drawn one by
 * one at the viewer's width.
 */
export default function PdfViewer({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  const pagesRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [pageCount, setPageCount] = useState(0);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    let destroy: (() => void) | null = null;
    const box = pagesRef.current;

    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
        const doc = await pdfjs.getDocument({ url }).promise;
        destroy = () => void doc.destroy();
        if (cancelled || !box) return;
        setPageCount(doc.numPages);
        setState("ready");
        const width = box.clientWidth;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        for (let n = 1; n <= doc.numPages; n++) {
          if (cancelled) return;
          const page = await doc.getPage(n);
          const viewport = page.getViewport({ scale: (width / page.getViewport({ scale: 1 }).width) * dpr });
          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.setAttribute("role", "img");
          canvas.setAttribute("aria-label", `Page ${n} of ${doc.numPages}`);
          canvas.style.width = "100%";
          canvas.style.height = "auto";
          canvas.className = "rounded-lg bg-white shadow-[0_8px_30px_rgba(0,0,0,0.35)]";
          box.appendChild(canvas);
          const ctx = canvas.getContext("2d");
          if (ctx) await page.render({ canvasContext: ctx, viewport }).promise;
        }
      } catch {
        if (!cancelled) setState("error");
      }
    })();

    return () => {
      cancelled = true;
      destroy?.();
      if (box) box.innerHTML = "";
    };
  }, [url]);

  return (
    <div className="fixed inset-0 z-[70] flex bg-[var(--bg)] sm:bg-black/80 sm:p-6 sm:backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-label={title} className="mx-auto flex h-full w-full max-w-4xl flex-col bg-[var(--bg)] sm:rounded-2xl sm:border sm:border-[var(--overlay-12)] sm:bg-[var(--bg-card)]">
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--border)] pl-4 pr-1.5 pt-[env(safe-area-inset-top)] sm:pl-5">
          <strong className="min-w-0 flex-1 truncate text-base">{title}</strong>
          {pageCount > 0 && <span className="font-mono text-xs text-[var(--text-muted)]">{pageCount} pages</span>}
          <button type="button" aria-label="Close" onClick={onClose} className="flex h-11 w-11 items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)]">
            <IconX size={20} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-6 sm:py-6">
          {state === "loading" && (
            <div aria-live="polite" className="flex h-full items-center justify-center">
              <span className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--overlay-12)] border-t-metatron-accent" aria-label="Loading deck" />
            </div>
          )}
          {state === "error" && (
            <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <span className="text-sm text-[var(--text-muted)]">Couldn&apos;t show the deck here.</span>
              <a href={url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-[var(--overlay-12)] px-4 text-sm font-semibold text-[var(--text)] hover:bg-[var(--overlay-4)]">
                Open in a new tab <IconArrowUpRight size={15} stroke={2} />
              </a>
            </div>
          )}
          <div ref={pagesRef} className="mx-auto flex w-full max-w-3xl flex-col gap-3 sm:gap-4" />
        </div>
      </div>
    </div>
  );
}
