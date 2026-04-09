"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API_BASE, authJsonHeaders } from "@/lib/api";

type Msg = { role: "user" | "assistant"; content: string };

type SessionSummary = {
  session_id: string;
  title: string;
  last_message_at: string;
  message_count: number;
};

const STORAGE_KEY = "metatron_kevin_widget_v1";

const UPGRADE_MESSAGE =
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

function loadWidgetState(): { sessionId: string; messages: Msg[] } {
  if (typeof window === "undefined") {
    return { sessionId: newSessionId(), messages: [] };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
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

export default function KevinChat() {
  const [open, setOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [input, setInput] = useState("");
  const [stored] = useState(() => loadWidgetState());
  const [sessionId, setSessionId] = useState<string>(stored.sessionId);
  const [messages, setMessages] = useState<Msg[]>(stored.messages);
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const token = useMemo(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem("metatron_token");
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        sessionId,
        messages: messages.slice(-60),
      }),
    );
  }, [messages, sessionId]);

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
  }, [messages, loading, open]);

  const newChat = useCallback(() => {
    setMessages([]);
    setSessionId(crypto.randomUUID());
    setShowHistory(false);
  }, []);

  const loadSession = useCallback(
    async (sid: string) => {
      if (!token) return;
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
          session_id: sessionId,
        }),
      });

      // Backend uses 503 when AI isn't configured (e.g. free tier).
      if (res.status === 503) {
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            content: UPGRADE_MESSAGE,
          },
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
        {
          role: "assistant",
          content: data.reply ?? "…",
        },
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
  }, [input, loading, messages, token, sessionId]);

  const iconBtnBase: CSSProperties = {
    width: 32,
    height: 32,
    borderRadius: 8,
    border: "none",
    background: "transparent",
    color: "#8888a0",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close Kevin chat" : "Open Kevin chat"}
        style={{
          width: 56,
          height: 56,
          bottom: 24,
          right: 24,
          position: "fixed",
          zIndex: 200,
          borderRadius: 9999,
          border: "none",
          background: "#6c5ce7",
          color: "#ffffff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 8px 32px rgba(108,92,231,0.45)",
          cursor: "pointer",
        }}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path
            d="M4 6.5C4 5.11929 5.11929 4 6.5 4H17.5C18.8807 4 20 5.11929 20 6.5V13C20 14.3807 18.8807 15.5 17.5 15.5H10L6 19V15.5H6.5C5.11929 15.5 4 14.3807 4 13V6.5Z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path
            d="M8 9H16"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </button>

      {open && (
        <div
          style={{
            position: "fixed",
            zIndex: 200,
            right: 24,
            bottom: 88,
            width: 380,
            maxWidth: "calc(100vw - 2rem)",
            height: 500,
            maxHeight: "min(70vh, 520px)",
            background: "#16161f",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 12,
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            boxShadow: "0 24px 64px rgba(0,0,0,0.45)",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              borderBottom: "1px solid rgba(255,255,255,0.06)",
              padding: "12px 16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
                  fontSize: 14,
                  fontWeight: 600,
                  color: "#e8e8ed",
                }}
              >
                Kevin
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "#8888a0",
                  fontFamily:
                    "var(--font-jetbrains-mono), 'JetBrains Mono', monospace",
                }}
              >
                AI copilot
              </div>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 2,
                flexShrink: 0,
              }}
            >
              <button
                type="button"
                onClick={() => setShowHistory((o) => !o)}
                aria-label="Chat history"
                title="History"
                style={iconBtnBase}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(108,92,231,0.15)";
                  e.currentTarget.style.color = "#6c5ce7";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = "#8888a0";
                }}
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
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  border: "none",
                  background: "transparent",
                  color: "#8888a0",
                  fontSize: 20,
                  lineHeight: "28px",
                  cursor: "pointer",
                }}
              >
                ×
              </button>
            </div>
          </div>

          {showHistory && (
            <div
              style={{
                maxHeight: 180,
                overflowY: "auto",
                margin: "0 12px 8px",
                padding: 8,
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.06)",
                background: "#16161f",
              }}
            >
              <button
                type="button"
                onClick={newChat}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 10px",
                  marginBottom: 4,
                  borderRadius: 8,
                  border: "none",
                  background: "transparent",
                  color: "#6c5ce7",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(108,92,231,0.12)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                New chat
              </button>
              {sessions.length === 0 && (
                <p
                  style={{
                    padding: "8px 10px",
                    fontSize: 12,
                    color: "#8888a0",
                    margin: 0,
                  }}
                >
                  No past sessions
                </p>
              )}
              {sessions.map((s) => (
                <button
                  key={s.session_id}
                  type="button"
                  onClick={() => void loadSession(s.session_id)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "8px 10px",
                    marginBottom: 2,
                    borderRadius: 8,
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                    fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(108,92,231,0.12)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  <span
                    style={{
                      fontSize: 13,
                      color: "#e8e8ed",
                      lineHeight: 1.35,
                      overflow: "hidden",
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                    }}
                  >
                    {s.title.trim() || "Chat"}
                  </span>
                  <span style={{ fontSize: 11, color: "#8888a0" }}>
                    {formatSessionDate(s.last_message_at)} · {s.message_count}{" "}
                    messages
                  </span>
                </button>
              ))}
            </div>
          )}

          <div
            style={{
              position: "relative",
              flex: 1,
              overflowY: "auto",
              minHeight: 0,
              padding: "10px 12px",
              display: "flex",
              flexDirection: "column",
              gap: 12,
              color: "#e8e8ed",
            }}
          >
            {messages.map((m, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  justifyContent:
                    m.role === "user" ? "flex-end" : "flex-start",
                }}
              >
                <div
                  style={{
                    maxWidth: "85%",
                    padding: "10px 12px",
                    borderRadius: 12,
                    background: m.role === "user" ? "#6c5ce7" : "#1e1e2a",
                    color: m.role === "user" ? "#ffffff" : "#e8e8ed",
                    whiteSpace: "pre-wrap",
                    lineHeight: 1.4,
                  }}
                >
                  {m.content}
                </div>
              </div>
            ))}

            {loading && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-start",
                  marginTop: 2,
                }}
              >
                <div
                  style={{
                    maxWidth: "85%",
                    padding: "10px 12px",
                    borderRadius: 12,
                    background: "#1e1e2a",
                    color: "#e8e8ed",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <span
                    style={{
                      fontSize: 12,
                      color: "#8888a0",
                    }}
                  >
                    Thinking
                  </span>
                  <span className="kevinchat-dots" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </span>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          <div
            style={{
              padding: 12,
              borderTop: "1px solid rgba(255,255,255,0.06)",
              display: "flex",
              gap: 10,
            }}
          >
            <input
              className="input-metatron flex-1 text-sm py-2.5"
              placeholder="Message Kevin…"
              value={input}
              disabled={loading}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                void send();
              }}
              style={{
                color: "#e8e8ed",
                background: "#0a0a0f",
              }}
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={loading || !input.trim()}
              style={{
                borderRadius: 12,
                padding: "10px 16px",
                background: "#6c5ce7",
                color: "#ffffff",
                fontSize: 12,
                fontWeight: 600,
                border: "none",
                cursor: loading || !input.trim() ? "not-allowed" : "pointer",
                opacity: loading || !input.trim() ? 0.4 : 1,
              }}
            >
              Send
            </button>
          </div>

          <style jsx>{`
            .kevinchat-dots {
              display: inline-flex;
              align-items: center;
              gap: 3px;
            }
            .kevinchat-dots span {
              width: 6px;
              height: 6px;
              border-radius: 999px;
              background: rgba(232, 232, 237, 0.85);
              animation: kevinchat-bounce 1.1s infinite ease-in-out;
            }
            .kevinchat-dots span:nth-child(2) {
              animation-delay: 0.15s;
            }
            .kevinchat-dots span:nth-child(3) {
              animation-delay: 0.3s;
            }
            @keyframes kevinchat-bounce {
              0%,
              80%,
              100% {
                transform: translateY(0);
                opacity: 0.6;
              }
              40% {
                transform: translateY(-4px);
                opacity: 1;
              }
            }
          `}</style>
        </div>
      )}
    </>
  );
}
