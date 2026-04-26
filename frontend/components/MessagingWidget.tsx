"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE, authJsonHeaders } from "@/lib/api";

type Conversation = {
  id: string;
  type: "kevin" | "direct";
  last_message_at: string;
  unread_count: number;
  other_name: string | null;
  last_message: string | null;
};

type Message = {
  id: string;
  sender_id: string | null;
  body: string;
  created_at: string;
  is_mine: boolean;
};

type ChatPane = {
  id: string;
  type: "kevin" | "direct";
  name: string;
  recipientId?: string;
  messages: Message[];
  input: string;
  sending: boolean;
};

function renderMarkdown(text: string): React.ReactNode[] {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) =>
    i % 2 === 1 ? <strong key={i}>{part}</strong> : (part as React.ReactNode)
  );
}

function ChatPanel({
  pane,
  onClose,
  onInputChange,
  onSend,
}: {
  pane: ChatPane;
  onClose: () => void;
  onInputChange: (val: string) => void;
  onSend: () => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [pane.messages, pane.sending]);

  return (
    <div
      className="flex flex-col rounded-t-xl border-x border-t border-[var(--border)] bg-[var(--bg-card)]"
      style={{ width: expanded ? 560 : 320, height: expanded ? 600 : 420 }}
    >
      <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          {pane.type === "kevin" ? (
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[rgba(108,92,231,0.2)] text-[11px] font-bold text-[#6c5ce7]">
              K
            </span>
          ) : (
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[rgba(255,255,255,0.06)] text-[11px] font-semibold text-[var(--text-muted)]">
              {pane.name.charAt(0).toUpperCase()}
            </span>
          )}
          <span className="text-sm font-semibold text-[var(--text)] truncate">{pane.name}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            title={expanded ? "Collapse" : "Expand"}
            className="rounded p-1 text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
          >
            {expanded ? (
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <polyline points="4 14 10 14 10 20" />
                <polyline points="20 10 14 10 14 4" />
                <line x1="10" y1="14" x2="3" y2="21" />
                <line x1="21" y1="3" x2="14" y2="10" />
              </svg>
            ) : (
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <polyline points="15 3 21 3 21 9" />
                <polyline points="9 21 3 21 3 15" />
                <line x1="21" y1="3" x2="14" y2="10" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-lg leading-none text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
          >
            ×
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {pane.messages.length === 0 && !pane.sending && (
          <p className="mt-6 text-center text-xs text-[var(--text-muted)]">
            {pane.type === "kevin"
              ? "Ask Kevin anything about your raise, investors, or strategy."
              : `Start a conversation with ${pane.name}.`}
          </p>
        )}
        {pane.messages.map((m) => (
          <div key={m.id} className={`flex ${m.is_mine ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-xl px-3 py-2 text-sm leading-snug whitespace-pre-wrap ${
                m.is_mine
                  ? "bg-[#6c5ce7] text-white"
                  : "bg-[rgba(255,255,255,0.06)] text-[var(--text)]"
              }`}
            >
              {renderMarkdown(m.body)}
            </div>
          </div>
        ))}
        {pane.sending && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-xl bg-[rgba(255,255,255,0.06)] px-3 py-2 text-sm text-[var(--text-muted)]">
              <span className="inline-flex gap-0.5">
                <span className="animate-pulse">·</span>
                <span className="animate-pulse" style={{ animationDelay: "0.15s" }}>
                  ·
                </span>
                <span className="animate-pulse" style={{ animationDelay: "0.3s" }}>
                  ·
                </span>
              </span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-[var(--border)] p-2 flex gap-2">
        <input
          className="input-metatron flex-1 py-1.5 text-sm"
          placeholder="Message…"
          value={pane.input}
          disabled={pane.sending}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
        />
        <button
          type="button"
          onClick={onSend}
          disabled={pane.sending || !pane.input.trim()}
          className="shrink-0 rounded-lg bg-[#6c5ce7] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40 hover:bg-[#7d6ff0]"
        >
          Send
        </button>
      </div>
    </div>
  );
}

export default function MessagingWidget({ token }: { token: string | null }) {
  const [listOpen, setListOpen] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [panes, setPanes] = useState<ChatPane[]>([]);

  const loadConversations = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/messages/conversations`, {
        headers: authJsonHeaders(token),
      });
      if (res.ok) setConversations(await res.json());
    } catch {}
  }, [token]);

  useEffect(() => {
    if (!listOpen || !token) return;
    void loadConversations();
    const iv = setInterval(() => void loadConversations(), 15000);
    return () => clearInterval(iv);
  }, [listOpen, token, loadConversations]);

  // Load conversations on mount so Kevin history is ready immediately
  useEffect(() => {
    if (!token) return;
    void loadConversations();
  }, [token, loadConversations]);

  useEffect(() => {
    function handler(e: Event) {
      const { userId, name } = (e as CustomEvent<{ userId: string; name: string }>).detail;
      setPanes((prev) => {
        if (prev.find((p) => p.recipientId === userId)) return prev;
        const next = prev.length >= 2 ? prev.slice(1) : prev;
        return [
          ...next,
          {
            id: `pending-${userId}`,
            type: "direct",
            name,
            recipientId: userId,
            messages: [],
            input: "",
            sending: false,
          },
        ];
      });
      setListOpen(false);
    }
    window.addEventListener("metatron:open-chat", handler);
    return () => window.removeEventListener("metatron:open-chat", handler);
  }, []);

  async function fetchMessages(convId: string): Promise<Message[]> {
    if (!token) return [];
    try {
      const res = await fetch(`${API_BASE}/messages/conversations/${convId}`, {
        headers: authJsonHeaders(token),
      });
      if (res.ok) return await res.json();
    } catch {}
    return [];
  }

  async function openKevinChat() {
    if (panes.find((p) => p.type === "kevin")) {
      setListOpen(false);
      return;
    }

    let kevinConv = conversations.find((c) => c.type === "kevin");

    // If not loaded yet, fetch directly
    if (!kevinConv && token) {
      try {
        const res = await fetch(`${API_BASE}/messages/conversations`, {
          headers: authJsonHeaders(token),
        });
        if (res.ok) {
          const fresh: Conversation[] = await res.json();
          setConversations(fresh);
          kevinConv = fresh.find((c) => c.type === "kevin");
        }
      } catch {}
    }

    const messages = kevinConv ? await fetchMessages(kevinConv.id) : [];
    setPanes((prev) => {
      const next = prev.length >= 2 ? prev.slice(1) : prev;
      return [
        ...next,
        {
          id: kevinConv?.id ?? "kevin-new",
          type: "kevin",
          name: "Kevin AI",
          messages,
          input: "",
          sending: false,
        },
      ];
    });
    setListOpen(false);
  }

  async function openConversationChat(conv: Conversation) {
    if (conv.type === "kevin") {
      await openKevinChat();
      return;
    }
    if (panes.find((p) => p.id === conv.id)) {
      setListOpen(false);
      return;
    }
    const messages = await fetchMessages(conv.id);
    if (token) {
      void fetch(`${API_BASE}/messages/conversations/${conv.id}/read`, {
        method: "PUT",
        headers: authJsonHeaders(token),
      });
      setConversations((prev) => prev.map((c) => (c.id === conv.id ? { ...c, unread_count: 0 } : c)));
    }
    setPanes((prev) => {
      const next = prev.length >= 2 ? prev.slice(1) : prev;
      return [
        ...next,
        {
          id: conv.id,
          type: "direct",
          name: conv.other_name ?? "User",
          messages,
          input: "",
          sending: false,
        },
      ];
    });
    setListOpen(false);
  }

  function closePane(paneId: string) {
    setPanes((prev) => prev.filter((p) => p.id !== paneId));
  }

  function updatePane(paneId: string, updates: Partial<ChatPane>) {
    setPanes((prev) => prev.map((p) => (p.id === paneId ? { ...p, ...updates } : p)));
  }

  async function sendMessage(paneId: string) {
    if (!token) return;
    const pane = panes.find((p) => p.id === paneId);
    if (!pane || !pane.input.trim() || pane.sending) return;
    const text = pane.input.trim();
    updatePane(paneId, { input: "", sending: true });

    try {
      if (pane.type === "kevin") {
        const res = await fetch(`${API_BASE}/messages/kevin`, {
          method: "POST",
          headers: authJsonHeaders(token),
          body: JSON.stringify({ body: text }),
        });
        if (res.ok) {
          const data = (await res.json()) as { conversation_id: string; reply: string };
          const msgs = await fetchMessages(data.conversation_id);
          setPanes((prev) =>
            prev.map((p) =>
              p.id === paneId ? { ...p, id: data.conversation_id, messages: msgs, sending: false } : p
            )
          );
          void loadConversations();
        } else {
          updatePane(paneId, { sending: false });
        }
      } else {
        const res = await fetch(`${API_BASE}/messages/direct`, {
          method: "POST",
          headers: authJsonHeaders(token),
          body: JSON.stringify({ recipient_id: pane.recipientId, body: text }),
        });
        if (res.ok) {
          const data = (await res.json()) as { conversation_id: string };
          const msgs = await fetchMessages(data.conversation_id);
          setPanes((prev) =>
            prev.map((p) =>
              p.id === paneId ? { ...p, id: data.conversation_id, messages: msgs, sending: false } : p
            )
          );
          void loadConversations();
        } else {
          updatePane(paneId, { sending: false });
        }
      }
    } catch {
      updatePane(paneId, { sending: false });
    }
  }

  const totalUnread = conversations.reduce((s, c) => s + c.unread_count, 0);
  const kevinConv = conversations.find((c) => c.type === "kevin");
  const directConvs = conversations.filter((c) => c.type === "direct");

  if (!token) return null;

  return (
    <div className="fixed bottom-0 right-4 z-[200] flex items-end gap-2">
      {panes.map((pane) => (
        <ChatPanel
          key={pane.id}
          pane={pane}
          onClose={() => closePane(pane.id)}
          onInputChange={(val) => updatePane(pane.id, { input: val })}
          onSend={() => void sendMessage(pane.id)}
        />
      ))}

      <div style={{ width: 320 }}>
        {listOpen && (
          <div
            className="border-x border-t border-[var(--border)] bg-[var(--bg-card)] overflow-y-auto"
            style={{ height: 400 }}
          >
            <button
              type="button"
              onClick={() => void openKevinChat()}
              className="flex w-full items-center gap-3 border-b border-[var(--border)] px-4 py-3 text-left transition-colors hover:bg-[rgba(108,92,231,0.06)]"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[rgba(108,92,231,0.2)] text-sm font-bold text-[#6c5ce7]">
                K
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-[#6c5ce7]">Kevin AI</p>
                  <div className="flex items-center gap-1 shrink-0">
                    {(kevinConv?.unread_count ?? 0) > 0 && (
                      <span className="rounded-full bg-[#6c5ce7] px-1.5 py-0.5 text-[10px] font-bold text-white">
                        {kevinConv!.unread_count}
                      </span>
                    )}
                    <button
                      type="button"
                      title="New Kevin chat"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPanes((prev) => {
                          const filtered = prev.filter((p) => p.type !== "kevin");
                          const next = filtered.length >= 2 ? filtered.slice(1) : filtered;
                          return [
                            ...next,
                            {
                              id: `kevin-new-${Date.now()}`,
                              type: "kevin",
                              name: "Kevin AI",
                              messages: [],
                              input: "",
                              sending: false,
                            },
                          ];
                        });
                        setListOpen(false);
                      }}
                      className="rounded p-1 text-[var(--text-muted)] hover:text-[#6c5ce7] hover:bg-[rgba(108,92,231,0.12)] transition-colors"
                    >
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden
                      >
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                      </svg>
                    </button>
                  </div>
                </div>
                <p className="text-xs text-[var(--text-muted)] truncate">
                  {kevinConv?.last_message ?? "Your AI co-pilot"}
                </p>
              </div>
            </button>

            {directConvs.length === 0 && (
              <p className="px-4 py-4 text-xs text-[var(--text-muted)]">
                No direct messages yet. Message investors from your matches page.
              </p>
            )}
            {directConvs.map((conv) => (
              <button
                key={conv.id}
                type="button"
                onClick={() => void openConversationChat(conv)}
                className="flex w-full items-center gap-3 border-b border-[var(--border)] px-4 py-3 text-left transition-colors hover:bg-[rgba(255,255,255,0.03)]"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[rgba(255,255,255,0.06)] text-sm font-semibold text-[var(--text-muted)]">
                  {(conv.other_name ?? "U").charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-[var(--text)] truncate">
                      {conv.other_name ?? "User"}
                    </p>
                    {conv.unread_count > 0 && (
                      <span className="shrink-0 rounded-full bg-[#6c5ce7] px-1.5 py-0.5 text-[10px] font-bold text-white">
                        {conv.unread_count}
                      </span>
                    )}
                  </div>
                  {conv.last_message && (
                    <p className="text-xs text-[var(--text-muted)] truncate">{conv.last_message}</p>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            setListOpen((o) => !o);
            if (!listOpen) void loadConversations();
          }}
          className="flex w-full items-center justify-between rounded-t-xl border-x border-t border-[var(--border)] bg-[var(--bg-card)] px-4 py-3 transition-colors hover:bg-[#1e1e2a]"
        >
          <div className="flex items-center gap-2">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-[var(--text-muted)]"
              aria-hidden
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <span className="text-sm font-semibold text-[var(--text)]">Messaging</span>
            {totalUnread > 0 && (
              <span className="rounded-full bg-[#6c5ce7] px-1.5 py-0.5 text-[10px] font-bold text-white">
                {totalUnread}
              </span>
            )}
          </div>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-[var(--text-muted)] transition-transform duration-200"
            style={{ transform: listOpen ? "rotate(180deg)" : "none" }}
            aria-hidden
          >
            <polyline points="18 15 12 9 6 15" />
          </svg>
        </button>
      </div>
    </div>
  );
}
