"use client";

import { API_BASE, authJsonHeaders } from "@/lib/api";
import { useCallback, useEffect, useRef, useState } from "react";

type Msg = { role: "user" | "assistant"; content: string };

const STORAGE_KEY = "metatron_kevin_chat_card_v1";

const KEVIN_UNAVAILABLE =
  "Kevin is temporarily unavailable. Please try again later.";

function normalizeHistory(data: unknown): Msg[] {
  if (!Array.isArray(data)) return [];
  const out: Msg[] = [];
  for (const x of data) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const role = o.role;
    const content = o.content;
    if (
      (role === "user" || role === "assistant") &&
      typeof content === "string"
    ) {
      out.push({ role, content });
    }
  }
  return out.slice(-60);
}

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
  const [messages, setMessages] = useState<Msg[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return [];
      const parsed = JSON.parse(saved) as Msg[];
      return Array.isArray(parsed) ? parsed.slice(-60) : [];
    } catch {
      return [];
    }
  });
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-60)));
  }, [messages]);

  useEffect(() => {
    if (!token) return;
    fetch(`${API_BASE}/kevin/chat/history`, {
      headers: authJsonHeaders(token),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: unknown) => {
        const parsed = normalizeHistory(data);
        if (parsed.length > 0) {
          setMessages(parsed);
        }
      })
      .catch(() => {
        /* localStorage fallback already in initial state */
      });
  }, [token]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const clearHistory = useCallback(() => {
    setMessages([]);
    if (typeof window !== "undefined") {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

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

      <div className="relative flex h-[320px] min-h-0 flex-col gap-3 overflow-y-auto rounded-lg border border-[var(--border)] bg-[#0a0a0f] p-3">
        <button
          type="button"
          onClick={clearHistory}
          className="absolute right-2 top-2 z-10 text-[10px] font-medium text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          Clear history
        </button>
        {messages.length === 0 && !loading && (
          <p className="mt-6 text-center text-xs text-[var(--text-muted)]">
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
