"use client";

import { useEffect, useState } from "react";
import { API_BASE, authJsonHeaders } from "@/lib/api";
import { getAccessToken } from "@/lib/tokenStore";
import { getReviewerToken, getReviewerEmail } from "@/lib/reviewerToken";

function StarPicker({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={disabled}
          onClick={() => onChange(n)}
          aria-label={`${n} star${n === 1 ? "" : "s"}`}
          className={[
            "text-xl leading-none transition-colors duration-200 disabled:opacity-40",
            n <= value ? "text-metatron-accent" : "text-[var(--border)]",
          ].join(" ")}
        >
          ★
        </button>
      ))}
    </div>
  );
}

function DimensionRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <p className="text-xs text-[var(--text-muted)]">{label}</p>
      <StarPicker value={value} onChange={onChange} />
    </div>
  );
}

export function RatingForm({ startupUserId }: { startupUserId: string }) {
  const [token, setToken] = useState<string | null>(null);

  const [overallStars, setOverallStars] = useState(0);
  const [teamScore, setTeamScore] = useState(0);
  const [marketScore, setMarketScore] = useState(0);
  const [tractionScore, setTractionScore] = useState(0);
  const [productScore, setProductScore] = useState(0);
  const [comment, setComment] = useState("");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [magicLinkSending, setMagicLinkSending] = useState(false);
  const [magicLinkMessage, setMagicLinkMessage] = useState<string | null>(null);

  useEffect(() => {
    const platformToken = getAccessToken();
    const reviewerToken = getReviewerToken();
    setToken(platformToken || reviewerToken);
    if (!platformToken && reviewerToken) {
      setEmail(getReviewerEmail() ?? "");
    }
  }, []);

  async function submit() {
    if (overallStars < 1) {
      setMessage("Please choose an overall rating.");
      return;
    }
    if (!token && (!name.trim() || !email.includes("@"))) {
      setMessage("Please enter your name and email.");
      return;
    }

    setSubmitting(true);
    setMessage(null);
    try {
      const body: Record<string, unknown> = {
        overall_stars: overallStars,
        team_score: teamScore || undefined,
        market_score: marketScore || undefined,
        traction_score: tractionScore || undefined,
        product_score: productScore || undefined,
        comment: comment.trim() || undefined,
      };
      if (!token) {
        body.name = name.trim();
        body.email = email.trim();
      }

      const res = await fetch(`${API_BASE}/ratings/startups/${startupUserId}`, {
        method: "POST",
        headers: authJsonHeaders(token),
        body: JSON.stringify(body),
      });

      if (res.status === 429) {
        setMessage("Too many anonymous reviews from this network today. Try again tomorrow.");
      } else if (res.status === 403) {
        setMessage("You can't rate your own startup.");
      } else if (!res.ok) {
        const data = await res.json().catch(() => null);
        setMessage(data?.message ?? "Could not submit your review. Please check your inputs.");
      } else {
        setMessage(
          token
            ? "Thanks, your review has been saved."
            : "Thanks! Check your email to confirm your review.",
        );
      }
    } catch {
      setMessage("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function sendMagicLink() {
    if (!email.includes("@")) {
      setMagicLinkMessage("Enter a valid email first.");
      return;
    }
    setMagicLinkSending(true);
    setMagicLinkMessage(null);
    try {
      await fetch(`${API_BASE}/reviewer-accounts/magic-link`, {
        method: "POST",
        headers: authJsonHeaders(null),
        body: JSON.stringify({
          email: email.trim(),
          name: name.trim() || undefined,
          return_to: typeof window !== "undefined" ? window.location.pathname : undefined,
        }),
      });
      setMagicLinkMessage("Check your inbox for a sign-in link.");
    } catch {
      setMagicLinkMessage("Network error. Please try again.");
    } finally {
      setMagicLinkSending(false);
    }
  }

  return (
    <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-5 space-y-4">
      <h3 className="text-sm font-semibold text-[var(--text)]">Rate this startup</h3>

      <div className="flex items-center justify-between gap-4">
        <p className="text-sm font-medium text-[var(--text)]">Overall</p>
        <StarPicker value={overallStars} onChange={setOverallStars} disabled={submitting} />
      </div>

      <div className="space-y-2">
        <DimensionRow label="Team" value={teamScore} onChange={setTeamScore} />
        <DimensionRow label="Market" value={marketScore} onChange={setMarketScore} />
        <DimensionRow label="Traction" value={tractionScore} onChange={setTractionScore} />
        <DimensionRow label="Product" value={productScore} onChange={setProductScore} />
      </div>

      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value.slice(0, 500))}
        placeholder="Optional comment (max 500 characters)"
        rows={3}
        className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 text-xs text-[var(--text)] placeholder:text-[var(--text-muted)]"
      />

      {!token && (
        <div className="space-y-2 border-t border-[var(--border)] pt-4">
          <p className="text-xs text-[var(--text-muted)]">
            Not signed in — enter your details to leave a review.
          </p>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2.5 text-xs text-[var(--text)] placeholder:text-[var(--text-muted)]"
          />
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Your email"
            type="email"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2.5 text-xs text-[var(--text)] placeholder:text-[var(--text-muted)]"
          />
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => void sendMagicLink()}
              disabled={magicLinkSending}
              className="text-xs text-metatron-accent hover:underline disabled:opacity-40"
            >
              {magicLinkSending ? "Sending…" : "Get a sign-in link for next time"}
            </button>
          </div>
          {magicLinkMessage && (
            <p className="text-xs text-[var(--text-muted)]">{magicLinkMessage}</p>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={submitting}
        className="w-full rounded-lg bg-metatron-accent px-4 py-2 text-xs font-semibold text-white hover:bg-metatron-accent-hover disabled:opacity-40"
      >
        {submitting ? "Submitting…" : "Submit review"}
      </button>

      {message && <p className="text-xs text-[var(--text-muted)]">{message}</p>}
    </div>
  );
}
