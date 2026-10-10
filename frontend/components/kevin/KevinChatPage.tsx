"use client";

import { StartupKevinChatCard } from "@/components/StartupKevinChatCard";
import { KevinChannelPicker } from "@/components/kevin/KevinChannelPicker";
import { useAuth } from "@/lib/auth";

/** Chat with Kevin, for every role: the chat, plus the one-app phone picker and email. */
export function KevinChatPage({ subtitle, emptyHint }: { subtitle: string; emptyHint?: string }) {
  const { token, loading } = useAuth();
  if (loading || !token) return null;

  return (
    <main className="min-w-0 flex-1">
      <section className="mx-auto flex max-w-6xl flex-col gap-5 p-6 md:p-10">
        <header className="flex flex-col gap-1.5">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)]">Chat with Kevin</span>
          <h1 className="text-[28px] font-semibold tracking-tight">Kevin</h1>
          <p className="text-sm text-[var(--text-muted)]">{subtitle}</p>
        </header>
        <div className="flex flex-col items-start gap-5 lg:flex-row">
          <div className="w-full min-w-0 flex-1">
            <StartupKevinChatCard token={token} emptyHint={emptyHint} />
          </div>
          <aside className="flex w-full flex-col gap-3 lg:w-80 lg:shrink-0">
            <KevinChannelPicker token={token} />
            <section className="flex flex-col gap-1 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-5 shadow-[var(--card-shadow)]">
              <h2 className="text-base font-semibold">Kevin by email</h2>
              <span className="text-[13px] text-[var(--text-muted)]">
                Email{" "}
                <a href="mailto:kevin@metatron.id" className="text-[var(--accent-fg)] hover:underline">
                  kevin@metatron.id
                </a>{" "}
                or reply to any Kevin email. Always on, no setup needed.
              </span>
            </section>
          </aside>
        </div>
      </section>
    </main>
  );
}
