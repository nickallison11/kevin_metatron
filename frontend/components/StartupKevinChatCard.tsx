"use client";

import { API_BASE, authJsonHeaders } from "@/lib/api";
import { decodeJwtSub } from "@/lib/auth";
import { useCallback, useEffect, useRef, useState } from "react";

type Msg = { role: "user" | "assistant"; content: string };

type SessionSummary = {
  session_id: string;
  title: string;
  last_message_at: string;
  message_count: number;
};

const KEVIN_UNAVAILABLE =
  "Kevin is temporarily unavailable. Please try again later.";

function newSessionId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

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

function formatSessionDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function loadCardState(storageKey: string): { sessionId: string; messages: Msg[] } {
  if (typeof window === "undefined") {
    return { sessionId: newSessionId(), messages: [] };
  }
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { sessionId: newSessionId(), messages: [] };
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return {
        sessionId: newSessionId(),
        messages: normalizeHistory(parsed),
      };
    }
    if (parsed && typeof parsed === "object" && "messages" in parsed) {
      const o = parsed as { sessionId?: string; messages?: unknown };
      return {
        sessionId:
          typeof o.sessionId === "string" && o.sessionId
            ? o.sessionId
            : newSessionId(),
        messages: normalizeHistory(o.messages),
      };
    }
  } catch {
    /* ignore */
  }
  return { sessionId: newSessionId(), messages: [] };
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
  // Keyed by the JWT's `sub` claim, not a raw token prefix — every metatron
  // JWT shares the same fixed header bytes, so slicing the raw token put
  // every user's chat history in the same localStorage bucket on a shared
  // or reused browser profile.
  const storageKey = `metatron_kevin_chat_card_v1_${(token && decodeJwtSub(token)) || "anon"}`;
  const [showHistory, setShowHistory] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [input, setInput] = useState("");
  const [stored] = useState(() => loadCardState(storageKey));
  const [sessionId, setSessionId] = useState<string>(stored.sessionId);
  const [messages, setMessages] = useState<Msg[]>(stored.messages);
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        sessionId,
        messages: messages.slice(-60),
      }),
    );
  }, [messages, sessionId, storageKey]);

  useEffect(() => {
    if (!showHistory || !token) return;
    fetch(`${API_BASE}/kevin/chat/sessions`, {
      headers: authJsonHeaders(token),
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((data: unknown) =>
        setSessions(Array.isArray(data) ? (data as SessionSummary[]) : []),
      )
      .catch(() => setSessions([]));
  }, [showHistory, token]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const newChat = useCallback(() => {
    setMessages([]);
    setSessionId(crypto.randomUUID());
    setShowHistory(false);
  }, []);

  const loadSession = useCallback(
    async (sid: string) => {
      const res = await fetch(
        `${API_BASE}/kevin/chat/history?session_id=${encodeURIComponent(sid)}`,
        { headers: authJsonHeaders(token) },
      );
      if (!res.ok) return;
      const turns = (await res.json()) as unknown;
      setMessages(normalizeHistory(turns));
      setSessionId(sid);
      setShowHistory(false);
    },
    [token],
  );

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
          session_id: sessionId,
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
  }, [input, loading, messages, token, systemContext, sessionId]);

  return (
    <div className="flex flex-col rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-5 sm:col-span-2">
      <div className="mb-4 flex items-start justify-between gap-3 border-b border-[var(--border)] pb-4">
        <div>
          <h2 className="text-sm font-semibold text-metatron-accent">
            Chat with Kevin
          </h2>
          <p className="mt-0.5 font-sans text-[11px] text-[var(--text-muted)]">
            AI co-pilot
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={() => setShowHistory((o) => !o)}
            aria-label="Chat history"
            title="History"
            className="rounded-lg p-2 text-[var(--text-muted)] transition-colors hover:bg-[rgba(108,92,231,0.15)] hover:text-metatron-accent"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {showHistory && (
        <div className="mb-3 max-h-[200px] overflow-y-auto rounded-[12px] border border-[var(--border)] bg-[var(--bg-card)] p-2">
          <button
            type="button"
            onClick={newChat}
            className="mb-1 w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-metatron-accent transition-colors hover:bg-[rgba(108,92,231,0.12)]"
          >
            New chat
          </button>
          {sessions.length === 0 && (
            <p className="px-3 py-2 text-xs text-[var(--text-muted)]">No past sessions</p>
          )}
          {sessions.map((s) => (
            <button
              key={s.session_id}
              type="button"
              onClick={() => void loadSession(s.session_id)}
              className="flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left transition-colors hover:bg-[rgba(108,92,231,0.12)]"
            >
              <span className="line-clamp-2 text-sm text-[var(--text)]">
                {s.title.trim() || "Chat"}
              </span>
              <span className="text-[11px] text-[var(--text-muted)]">
                {formatSessionDate(s.last_message_at)} · {s.message_count}{" "}
                messages
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="relative flex h-[320px] min-h-0 flex-col gap-3 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
        {messages.length === 0 && !loading && (
          <p className="mt-6 text-center text-xs text-[var(--text-muted)]">
            {emptyHint ??
              "Ask Kevin anything about your pitch, investors, or fundraising."}
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className="grid grid-cols-[56px_1fr] items-baseline gap-2 font-mono text-xs">
            <span
              className={
                m.role === "user"
                  ? "text-right text-metatron-accent"
                  : "text-right text-[var(--text-muted)]"
              }
            >
              {m.role === "user" ? "YOU ›" : "KEVIN ›"}
            </span>
            <span className="whitespace-pre-wrap leading-relaxed text-[var(--text)]">
              {m.content}
            </span>
          </div>
        ))}
        {loading && (
          <div className="grid grid-cols-[56px_1fr] items-baseline gap-2 font-mono text-xs">
            <span className="text-right text-[var(--text-muted)]">KEVIN ›</span>
            <span className="inline-flex items-center gap-0.5 text-[var(--text-muted)]" aria-hidden>
              thinking
              <span className="inline-block h-1 w-1 animate-pulse rounded-full bg-current" />
              <span
                className="inline-block h-1 w-1 animate-pulse rounded-full bg-current"
                style={{ animationDelay: "0.15s" }}
              />
              <span
                className="inline-block h-1 w-1 animate-pulse rounded-full bg-current"
                style={{ animationDelay: "0.3s" }}
              />
            </span>
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
