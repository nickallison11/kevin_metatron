#!/usr/bin/env python3
"""
metatron KVM2 end-to-end monitor
Daily health check covering all test accounts and platform features.
New feature checks are added here as features ship — one script, one report.

Current checks:
  1. Account logins (founder free, founder basic, investor)
  2. Free founder — Pinata reachability + profile (14-day deck trial)
  3. Basic founder — subscription plan + permanent deck
  4. Investor — role + profile
  5. IMAP scan (last 36h from metatron.id)
  6. Email cadence compliance (7-day, 1-day, expired)
  7. Weekly matches cron (founders + investors)

Setup on KVM2:
  1. Copy to /root/e2e_monitor.py
  2. Add to crontab: 0 8 * * * . /root/.env && /usr/bin/python3 /root/e2e_monitor.py >> /root/e2e_monitor.log 2>&1
  3. Ensure /root/.env exports: GMAIL_APP_PASSWORD, TEST_PASSWORD, CRON_SECRET
     (PINATA_GATEWAY, BACKEND_URL, PLATFORM_URL have sensible defaults)

Required env vars:
  GMAIL_APP_PASSWORD  — Gmail app password for kevin.metatron.testing@gmail.com
  TEST_PASSWORD       — Shared platform password for all three test accounts
  CRON_SECRET         — Bearer token for /api/cron/* endpoints (from Vercel env)
  PINATA_GATEWAY      — Pinata gateway hostname (default: gateway.pinata.cloud)
  BACKEND_URL         — Backend API base URL (default: http://localhost:4000)
  FRONTEND_URL        — Vercel frontend URL for cron endpoints (default: https://platform.metatron.id)
"""

import os
import imaplib
import email as email_lib
import requests
import smtplib
import datetime
from email.mime.text import MIMEText
from email.utils import parsedate_to_datetime

# ── CONFIG ────────────────────────────────────────────────────────────────────
PINATA_GATEWAY     = os.environ.get("PINATA_GATEWAY", "gateway.pinata.cloud")
BACKEND_URL        = os.environ.get("BACKEND_URL", "http://localhost:4000")
TEST_PASSWORD      = os.environ["TEST_PASSWORD"]
GMAIL_USER         = "kevin.metatron.testing@gmail.com"
GMAIL_APP_PASSWORD = os.environ["GMAIL_APP_PASSWORD"]
REPORT_TO          = "nick.allison@metatrondao.io"

ACCOUNTS = {
    "founder":      "kevin.metatron.testing+founder@gmail.com",
    "founderbasic": "kevin.metatron.testing+founderbasic@gmail.com",
    "investor":     "kevin.metatron.testing+investor@gmail.com",
}
# ─────────────────────────────────────────────────────────────────────────────


def pinata_url(cid):
    gateway = PINATA_GATEWAY.rstrip("/")
    if not gateway.startswith("http"):
        gateway = f"https://{gateway}"
    return f"{gateway}/ipfs/{cid}"


def get_jwt(email):
    r = requests.post(
        f"{BACKEND_URL}/auth/login",
        json={"email": email, "password": TEST_PASSWORD},
        timeout=10,
    )
    r.raise_for_status()
    return r.json()["token"]


def check_pinata(cid):
    try:
        r = requests.get(pinata_url(cid), timeout=15)
        return r.status_code, len(r.content)
    except Exception as e:
        return None, str(e)


def check_profile(jwt):
    r = requests.get(
        f"{BACKEND_URL}/profile",
        headers={"Authorization": f"Bearer {jwt}"},
        timeout=10,
    )
    r.raise_for_status()
    return r.json()


def check_subscription(jwt):
    r = requests.get(
        f"{BACKEND_URL}/subscriptions/status",
        headers={"Authorization": f"Bearer {jwt}"},
        timeout=10,
    )
    r.raise_for_status()
    return r.json()


def check_investor_profile(jwt):
    r = requests.get(
        f"{BACKEND_URL}/investor-profile",
        headers={"Authorization": f"Bearer {jwt}"},
        timeout=10,
    )
    r.raise_for_status()
    return r.json()


def imap_fetch(hours):
    """Returns list of {from, subject, date} for all inbox mail in last N hours."""
    mail = imaplib.IMAP4_SSL("imap.gmail.com")
    mail.login(GMAIL_USER, GMAIL_APP_PASSWORD)
    mail.select("inbox")
    cutoff_dt = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=hours)
    since_str = cutoff_dt.strftime("%d-%b-%Y")
    _, data = mail.search(None, f'(SINCE "{since_str}")')
    msgs = []
    for num in (data[0].split() if data[0] else []):
        _, msg_data = mail.fetch(num, "(RFC822)")
        if not msg_data or not msg_data[0]:
            continue
        msg = email_lib.message_from_bytes(msg_data[0][1])
        date_str = msg.get("Date", "")
        try:
            dt = parsedate_to_datetime(date_str).astimezone(datetime.timezone.utc)
            if dt < cutoff_dt:
                continue
        except Exception:
            pass
        msgs.append({
            "from": msg.get("From", ""),
            "subject": msg.get("Subject", ""),
            "date": date_str,
        })
    mail.logout()
    return msgs



def send_report(subject, body):
    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = GMAIL_USER
    msg["To"] = REPORT_TO
    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as s:
        s.login(GMAIL_USER, GMAIL_APP_PASSWORD)
        s.sendmail(GMAIL_USER, REPORT_TO, msg.as_string())


def main():
    today = datetime.date.today()
    now_utc = datetime.datetime.now(datetime.timezone.utc)

    lines = []
    drifts = []

    lines.append(f"# {now_utc.strftime('%Y-%m-%d %H:%M')} UTC")
    lines.append("")

    # ── Check 1: Account logins ───────────────────────────────────────────────
    lines.append("## Check 1 — Account logins")
    jwts = {}
    for key, email in ACCOUNTS.items():
        try:
            jwts[key] = get_jwt(email)
            lines.append(f"- {key} ({email}): ✓ login OK")
        except Exception as e:
            lines.append(f"- {key} ({email}): ⚠ DRIFT — login failed: {e}")
            drifts.append(f"{key} login failed: {e}")
    lines.append("")

    # ── Check 2: Free founder — Pinata + profile ──────────────────────────────
    lines.append("## Check 2 — Free founder: Pinata reachability + profile")
    founder_profile = {}
    days_since = 0
    if "founder" in jwts:
        try:
            founder_profile = check_profile(jwts["founder"])
            deck_url     = founder_profile.get("pitch_deck_url", "—")
            deck_expires = founder_profile.get("deck_expires_at", "—")
            deck_count   = founder_profile.get("deck_upload_count", "—")
            ipfs_vis     = founder_profile.get("ipfs_visibility", "—")
            lines.append(f"- pitch_deck_url: {deck_url}")
            lines.append(f"- deck_expires_at: {deck_expires}")
            lines.append(f"- deck_upload_count: {deck_count}")
            lines.append(f"- ipfs_visibility: {ipfs_vis}")

            # Derive upload date from expiry (expiry = upload + 14 days)
            upload_date = None
            if deck_expires and deck_expires != "—":
                try:
                    exp_date = datetime.datetime.fromisoformat(
                        str(deck_expires).replace(" ", "T").split("+")[0]
                    ).date()
                    upload_date = exp_date - datetime.timedelta(days=14)
                    days_since = (today - upload_date).days
                    days_until = 14 - days_since
                    lines.append(f"- upload_date (derived): {upload_date} | day {days_since} of 14 | {days_until} days left")
                except Exception:
                    pass

            # Check deck CID from profile URL
            if deck_url and deck_url != "—":
                cid = deck_url.split("/ipfs/")[-1]
                s1, sz1 = check_pinata(cid)
                if s1 == 200:
                    lines.append(f"- deck CID: HTTP {s1}, {sz1}B ✓")
                else:
                    lines.append(f"- deck CID: ⚠ DRIFT — HTTP {s1}: {sz1}")
                    drifts.append(f"deck Pinata unreachable: {s1}")

            context_url = founder_profile.get("context_ipfs_url")
            if context_url:
                cid = context_url.split("/ipfs/")[-1]
                s2, sz2 = check_pinata(cid)
                if s2 == 200:
                    lines.append(f"- context CID: HTTP {s2}, {sz2}B ✓")
                else:
                    lines.append(f"- context CID: ⚠ DRIFT — HTTP {s2}: {sz2}")
                    drifts.append(f"context Pinata unreachable: {s2}")
            else:
                lines.append("- context CID: ⚠ DRIFT — no context_ipfs_url in profile")
                drifts.append("no context_ipfs_url")
        except Exception as e:
            lines.append(f"- ⚠ DRIFT — profile fetch failed: {e}")
            drifts.append(f"founder profile failed: {e}")
    else:
        lines.append("- ⚠ skipped (login failed)")
    lines.append("")

    # ── Check 3: Basic founder — subscription + deck permanence ───────────────
    lines.append("## Check 3 — Basic founder: subscription + permanent deck")
    if "founderbasic" in jwts:
        try:
            sub = check_subscription(jwts["founderbasic"])
            plan = sub.get("subscription_tier") or sub.get("subscription_plan", "—")
            lines.append(f"- subscription_plan: {plan}")
            if plan != "basic":
                drifts.append(f"founderbasic plan is '{plan}', expected 'basic'")
                lines.append(f"  ⚠ DRIFT — expected 'basic'")
        except Exception as e:
            lines.append(f"- ⚠ subscription check failed: {e}")
            drifts.append(f"founderbasic subscription failed: {e}")

        try:
            bp = check_profile(jwts["founderbasic"])
            b_expires = bp.get("deck_expires_at")
            b_vis     = bp.get("ipfs_visibility", "—")
            lines.append(f"- deck_expires_at: {b_expires} (should be null)")
            lines.append(f"- ipfs_visibility: {b_vis} (should be public)")
            if b_expires:
                drifts.append(f"founderbasic deck has expiry set: {b_expires}")
                lines.append("  ⚠ DRIFT — basic deck should not expire")
            if b_vis != "public":
                drifts.append(f"founderbasic ipfs_visibility is '{b_vis}', expected 'public'")
                lines.append("  ⚠ DRIFT — basic tier should have public IPFS visibility")
        except Exception as e:
            lines.append(f"- ⚠ profile check failed: {e}")
            drifts.append(f"founderbasic profile failed: {e}")
    else:
        lines.append("- ⚠ skipped (login failed)")
    lines.append("")

    # ── Check 4: Investor — investor-profile endpoint ─────────────────────────
    lines.append("## Check 4 — Investor: profile")
    if "investor" in jwts:
        try:
            ip = check_investor_profile(jwts["investor"])
            sectors = ip.get("sectors", "—")
            stages  = ip.get("stages", "—")
            lines.append(f"- sectors: {sectors}")
            lines.append(f"- stages: {stages}")
            if not sectors and not stages:
                drifts.append("investor profile empty — no sectors or stages")
        except Exception as e:
            lines.append(f"- ⚠ profile check failed: {e}")
            drifts.append(f"investor profile failed: {e}")
    else:
        lines.append("- ⚠ skipped (login failed)")
    lines.append("")

    # ── Check 5: IMAP scan (last 36h) ────────────────────────────────────────
    lines.append("## Check 5 — IMAP scan for metatron.id mail (last 36h)")
    try:
        recent = imap_fetch(36)
        metatron = [m for m in recent if "metatron.id" in m.get("from", "")]
        if metatron:
            for m in metatron:
                lines.append(f"- From: {m['from']} | Subject: {m['subject']} | Date: {m['date']}")
        else:
            lines.append("- (none)")
    except Exception as e:
        lines.append(f"- ⚠ IMAP error: {e}")
        drifts.append(f"IMAP error: {e}")
    lines.append("")

    # ── Check 6: Email cadence compliance (free founder) ─────────────────────
    lines.append("## Check 6 — Email cadence compliance (free founder, last 36h)")
    cadence = {
        "expires in 7 days":  (7, 13),
        "goes dark tomorrow": (13, 20),
        "has expired":        (14, 99),
    }
    try:
        all_mail = imap_fetch(days_since * 24 + 48)
        subjects = [
            m.get("subject", "").lower()
            for m in all_mail
            if "metatron.id" in m.get("from", "")
        ]
        for pattern, (start_day, end_day) in cadence.items():
            found = any(pattern in s for s in subjects)
            if days_since < start_day:
                lines.append(f"- pattern '{pattern}': ⏸ not yet (window day {start_day}-{end_day})")
            elif start_day <= days_since <= end_day:
                lines.append(
                    f"- pattern '{pattern}': {'✓ seen' if found else f'⏳ pending (window day {start_day}-{end_day})'}"
                )
            else:
                if not found:
                    lines.append(f"- pattern '{pattern}': ⚠ DRIFT — expected but never received")
                    drifts.append(f"email cadence '{pattern}' never received")
                else:
                    lines.append(f"- pattern '{pattern}': ✓ seen (past window)")
    except Exception as e:
        lines.append(f"- ⚠ cadence check error: {e}")
    lines.append("")

    # ── Check 7: Weekly matches email ────────────────────────────────────────
    # Vercel blocks external calls to cron routes — verified by IMAP instead.
    # Cron fires Tuesdays 09:00 UTC via vercel.json schedule.
    lines.append("## Check 7 — Weekly matches email (IMAP, last 8 days)")
    try:
        recent_week = imap_fetch(8 * 24)
        weekly_seen = any(
            "weekly" in m.get("subject", "").lower() or "match" in m.get("subject", "").lower()
            for m in recent_week
            if "metatron.id" in m.get("from", "")
        )
        lines.append(f"- weekly-matches email received: {'✓ seen' if weekly_seen else '⚠ not seen since last Tuesday'}")
        if not weekly_seen:
            drifts.append("no weekly-matches email received in last 8 days")
    except Exception as e:
        lines.append(f"- ⚠ IMAP weekly check error: {e}")
    lines.append("")

    # ── Summary ───────────────────────────────────────────────────────────────
    tag = "DRIFT" if drifts else "OK"
    lines.append(f"## Summary: {tag}")
    if drifts:
        for d in drifts:
            lines.append(f"- ⚠ {d}")
    else:
        lines.append("- all checks pass")

    body = "\n".join(lines)
    subject = f"{today.strftime('%Y-%m-%d')} | metatron e2e monitor | {tag}"
    send_report(subject, body)
    print(f"Sent: {subject}")


if __name__ == "__main__":
    main()
