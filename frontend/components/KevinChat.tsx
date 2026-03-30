"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE, authJsonHeaders } from "@/lib/api";

type Msg = { role: "user" | "assistant"; content: string };

export default function KevinChat() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      content:
        "Hi — I'm Kevin, your Metatron copilot. Ask about pitches, intros, or your raise."
    }
  ]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const token =
    typeof window !== "undefined"
      ? window.localStorage.getItem("metatron_token")
      : null;

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  const send = useCallback(async () => {
    const t = input.trim();
    if (!t || loading) return;
    setErr(null);
    const next: Msg[] = [...messages, { role: "user", content: t }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/kevin/chat`, {
        method: "POST",
        headers: authJsonHeaders(token),
        body: JSON.stringify({
          messages: next.map((m) => ({ role: m.role, content: m.content }))
        })
      });
      const raw = await res.text();
      if (!res.ok) {
        throw new Error(raw || "Chat failed");
      }
      let data: { reply?: string } = {};
      try {
        data = JSON.parse(raw) as { reply?: string };
      } catch {
        throw new Error("Invalid response");
      }
      const reply = data.reply ?? "";
      setMessages((m) => [...m, { role: "assistant", content: reply || "…" }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Chat failed";
      setErr(msg);
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content:
            "Sorry — I couldn't complete that. If the server has no ANTHROPIC_API_KEY, Kevin cannot call Claude."
        }
      ]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, token]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-6 right-6 z-[200] flex h-14 w-14 items-center justify-center rounded-full bg-metatron-accent text-white shadow-[0_8px_32px_rgba(108,92,231,0.45)] hover:bg-metatron-accent-hover transition-all hover:scale-105"
        aria-label={open ? "Close Kevin chat" : "Open Kevin chat"}
      >
        <span className="text-xl font-semibold">K</span>
      </button>

      {open && (
        <div
          className="fixed bottom-24 right-6 z-[200] flex w-[min(100vw-2rem,380px)] flex-col rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] shadow-[0_24px_64px_rgba(0,0,0,0.45)] overflow-hidden"
          style={{ maxHeight: "min(70vh, 520px)" }}
        >
          <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-[var(--text)]">Kevin</p>
              <p className="text-[11px] text-[var(--text-muted)]">
                Metatron copilot
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-[var(--text-muted)] hover:text-[var(--text)] text-lg leading-none px-1"
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 text-sm">
            {messages.map((m, i) => (
              <div
                key={i}
                className={
                  m.role === "user"
                    ? "ml-6 rounded-lg bg-metatron-accent/12 border border-metatron-accent/20 px-3 py-2 text-[var(--text)]"
                    : "mr-4 rounded-lg bg-[color-mix(in_srgb,var(--bg)_70%,transparent)] border border-[var(--border)] px-3 py-2 text-[var(--text)] whitespace-pre-wrap"
                }
              >
                {m.content}
              </div>
            ))}
            {loading && (
              <p className="text-xs text-[var(--text-muted)] px-1">Thinking…</p>
            )}
            {err && (
              <p className="text-xs text-red-400/90 px-1">{err}</p>
            )}
            <div ref={bottom} />
          </div>
          <div className="border-t border-[var(--border)] p-3 flex gap-2">
            <input
              className="input-metatron flex-1 text-sm py-2.5"
              placeholder="Message Kevin…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send())}
              disabled={loading}
            />
            <button
              type="button"
              onClick={send}
              disabled={loading || !input.trim()}
              className="shrink-0 rounded-lg bg-metatron-accent px-4 py-2 text-xs font-semibold text-white disabled:opacity-40 hover:bg-metatron-accent-hover"
            >
              Send
            </button>
          </div>
        </div>
      )}
    </>
  );
}
