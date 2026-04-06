"use client";

import { API_BASE, authJsonHeaders } from "@/lib/api";
import { useCallback, useEffect, useRef, useState } from "react";

type Msg = { role: "user" | "assistant"; content: string };

const KEVIN_UNAVAILABLE =
  "Kevin is temporarily unavailable. Please try again later.";

export function StartupKevinChatCard({
  token,
  systemContext,
  emptyHint,
}: {
  token: string;
  /** Appended to Kevin’s system prompt on the server. */
  systemContext?: string;
  emptyHint?: string;
}) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const send = useCallback(async () => {
    const t = input.trim();
    if (!t || loading) return;

    const nextHistory: Msg[] = [...messages, { role: "user", content: t }];
    setMessages(nextHistory);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/kevin/chat`, {
        method: "POST",
        headers: authJsonHeaders(token),
        body: JSON.stringify({
          messages: nextHistory.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          system_context: systemContext ?? null,
        }),
      });

      if (res.status === 503) {
        setMessages((m) => [
          ...m,
          { role: "assistant", content: KEVIN_UNAVAILABLE },
        ]);
        return;
      }

      if (res.status === 429) {
        const limitText = await res.text();
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            content:
              limitText.trim() ||
              "You've used your 20 daily Kevin messages across all channels. Upgrade to Founder Basic at platform.metatron.id/pricing for 200 messages/day.",
          },
        ]);
        return;
      }

      const raw = await res.text();
      if (!res.ok) throw new Error(raw || "Chat failed");

      let data: { reply?: string } = {};
      try {
        data = JSON.parse(raw) as { reply?: string };
      } catch {
        throw new Error("Invalid response");
      }

      setMessages((m) => [
        ...m,
        { role: "assistant", content: data.reply ?? "…" },
      ]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Chat failed";
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: `Sorry — I couldn't complete that. ${msg}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, token, systemContext]);

  return (
    <div className="flex flex-col rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-5 sm:col-span-2">
      <div className="mb-4 border-b border-[var(--border)] pb-4">
        <h2 className="text-sm font-semibold text-metatron-accent">
          Chat with Kevin
        </h2>
        <p className="mt-0.5 font-mono text-[11px] text-[var(--text-muted)]">
          AI co-pilot
        </p>
      </div>

      <div className="flex h-[320px] min-h-0 flex-col gap-3 overflow-y-auto rounded-lg border border-[var(--border)] bg-[#0a0a0f] p-3">
        {messages.length === 0 && !loading && (
          <p className="text-center text-xs text-[var(--text-muted)]">
            {emptyHint ??
              "Ask Kevin anything about your pitch, investors, or fundraising."}
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user" ? "flex justify-end" : "flex justify-start"
            }
          >
            <div
              className={
                m.role === "user"
                  ? "max-w-[85%] whitespace-pre-wrap rounded-[12px] bg-metatron-accent px-3 py-2.5 text-sm leading-snug text-white"
                  : "max-w-[85%] whitespace-pre-wrap rounded-[12px] bg-[#1e1e2a] px-3 py-2.5 text-sm leading-snug text-[var(--text)]"
              }
            >
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="flex max-w-[85%] items-center gap-2 rounded-[12px] bg-[#1e1e2a] px-3 py-2.5 text-sm text-[var(--text)]">
              <span className="text-xs text-[var(--text-muted)]">Thinking</span>
              <span className="inline-flex items-center gap-0.5" aria-hidden>
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--text)]" />
                <span
                  className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--text)]"
                  style={{ animationDelay: "0.15s" }}
                />
                <span
                  className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--text)]"
                  style={{ animationDelay: "0.3s" }}
                />
              </span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="mt-4 flex gap-2.5 border-t border-[var(--border)] pt-4">
        <input
          className="input-metatron flex-1 py-2.5 text-sm"
          placeholder="Message Kevin…"
          value={input}
          disabled={loading}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            void send();
          }}
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={loading || !input.trim()}
          className="shrink-0 rounded-[12px] bg-metatron-accent px-4 py-2.5 text-xs font-semibold text-white transition-opacity hover:bg-metatron-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </div>
  );
}
