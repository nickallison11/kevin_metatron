#!/usr/bin/env python3
"""
metatron KVM2 end-to-end monitor
Daily health check covering all test accounts and platform features.
New feature checks are added here as features ship — one script, one report.

Current checks:
  1. Account logins — dev (founder free, founder basic, founder pro,
     investor free, investor basic, investor pro, connector). Runs against
     dev, not production: platform.metatron.id has a fresh, intentionally
     empty database pre-launch, so there's nothing to log into there yet.
  2. Free founder — Pinata reachability + profile (14-day deck trial) [dev]
  3. Basic founder — subscription plan + permanent deck [dev]
  3b. Pro founder — subscription plan = pro + is_pro flag [dev]
  4. Investor — role + profile [dev]
  5. IMAP scan (last 36h from metatron.id)
  6. Email cadence compliance (7-day, 1-day, expired)
  7. Weekly matches cron (founders + investors)
  8. Kevin chat — Moderate tier (Hermes 4 70B, falls back to Haiku) [dev]
  9. Kevin chat — Complex/DeepComplex tier (Kimi K3, falls back to Sonnet/Opus) [dev]
  10. kevin-learning cron endpoint reachable + secret-enforced (doesn't trigger
      a real run daily — that's a real LLM synthesis job, already scheduled
      weekly via its own crontab entry; this just confirms the route is alive).
      Runs against production (BACKEND_URL) — with the account checks moved to
      dev, this is the check that actually confirms production is up and
      enforcing auth correctly.
  11. Subscriber counts per role/tier + Kevin chat model usage per tier
      (last 7 days) — informational, not a pass/fail check. Production —
      will read empty/zero until platform.metatron.id has real users.
  12. Telegram bot (kevin-bot.service) health — systemd active state +
      recent journald error count. Local-only, doesn't call Telegram's API.
  13. Email bounce report (last 7 days) — bounce counts by email type and
      Permanent/Transient classification, plus how many Transient bounces
      were auto-retried as plaintext. Informational, but flags any Transient
      bounce that's gone unretried (would indicate the retry path broke).
  14. Dev tier assignments — logs into all 7 dev test accounts (founder/
      founderbasic/founderpro/investor/investorbasic/investorpro/connector)
      and verifies is_basic/is_pro match what each account's name promises.
  15. Dev Call Intelligence gating — free tier must get 403, basic/pro must
      get 200. This is the exact bug fixed in the 2026-07-28 subscription
      audit (a legacy investor bypass let free investors in).

Not covered here: the proactive high-value-match notification (fires once
per match the first time it crosses the score threshold, so it isn't a good
fit for a repeatable daily check against already-scored test-account
matches — verify that one manually if it's ever suspect).

Setup on KVM2:
  1. Copy to /root/e2e_monitor.py
  2. Add to crontab: 0 8 * * * . /root/.env && /usr/bin/python3 /root/e2e_monitor.py >> /root/e2e_monitor.log 2>&1
  3. Ensure /root/.env exports: GMAIL_APP_PASSWORD, CRON_SECRET
     (PINATA_GATEWAY, BACKEND_URL, PLATFORM_URL have sensible defaults)

Required env vars:
  GMAIL_APP_PASSWORD  — Gmail app password for kevin.metatron.testing@gmail.com
  CRON_SECRET         — Bearer token for /api/cron/* endpoints (from Vercel env)
  PINATA_GATEWAY      — Pinata gateway hostname (default: gateway.pinata.cloud)
  BACKEND_URL         — Backend API base URL, production (default: http://localhost:4000)
  FRONTEND_URL        — Vercel frontend URL for cron endpoints (default: https://platform.metatron.id)

Dev-environment checks (1-4, 8-9, 14-15) don't use TEST_PASSWORD from the
shell-sourced env at all -- dev has its own database with its own password,
so those checks read it straight out of /root/.env.dev (DEV_ENV_FILE) rather
than requiring the crontab to source a second env file. DEV_BACKEND_URL
defaults to http://localhost:4001.
"""

import os
import re
import imaplib
import email as email_lib
from email.header import decode_header, make_header
import requests
import smtplib
import subprocess
import datetime
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.utils import parsedate_to_datetime

# ── CONFIG ────────────────────────────────────────────────────────────────────
PINATA_GATEWAY     = os.environ.get("PINATA_GATEWAY", "gateway.pinata.cloud")
BACKEND_URL        = os.environ.get("BACKEND_URL", "http://localhost:4000")
CRON_SECRET        = os.environ["CRON_SECRET"]
GMAIL_USER         = "kevin.metatron.testing@gmail.com"
GMAIL_APP_PASSWORD = os.environ["GMAIL_APP_PASSWORD"]
REPORT_TO          = "nick.allison@metatrondao.io"

# Dev environment (separate database + backend, port 4001) — the tier-gating
# fixes and Investor Pro tier from the 2026-07-28 subscription-engine audit
# only exist here, not on production yet, so these checks run against dev
# specifically rather than BACKEND_URL above.
DEV_BACKEND_URL = os.environ.get("DEV_BACKEND_URL", "http://localhost:4001")
DEV_ENV_FILE    = os.environ.get("DEV_ENV_FILE", "/root/.env.dev")

# Role/tier ladder — name -> expected (is_basic, is_pro). Free is (False, False).
DEV_ACCOUNTS = {
    "founder":      ("kevin.metatron.testing+founder@gmail.com",      (False, False)),
    "founderbasic": ("kevin.metatron.testing+founderbasic@gmail.com", (True, False)),
    "founderpro":   ("kevin.metatron.testing+founderpro@gmail.com",   (False, True)),
    "investor":     ("kevin.metatron.testing+investor@gmail.com",     (False, False)),
    "investorbasic":("kevin.metatron.testing+investorbasic@gmail.com",(True, False)),
    "investorpro":  ("kevin.metatron.testing+investorpro@gmail.com",  (False, True)),
    "connector":    ("kevin.metatron.testing+connector@gmail.com",    (False, False)),
}
# ─────────────────────────────────────────────────────────────────────────────


def read_env_file_value(path, key):
    """Reads one KEY=value line out of a raw .env-style file without sourcing
    the whole thing into the process environment. Used only for DEV_TEST_PASSWORD
    (dev's TEST_PASSWORD differs from production's, since dev has its own
    database) -- everything else this script needs still comes from the normal
    crontab-sourced environment."""
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line.startswith(f"{key}="):
                    value = line.split("=", 1)[1].strip()
                    # Mirror shell `source` behavior: strip one layer of
                    # matching quotes, since bash does this automatically
                    # but a naive split doesn't.
                    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                        value = value[1:-1]
                    return value
    except OSError:
        pass
    return None


DEV_TEST_PASSWORD = read_env_file_value(DEV_ENV_FILE, "TEST_PASSWORD")


def pinata_url(cid):
    gateway = PINATA_GATEWAY.rstrip("/")
    if not gateway.startswith("http"):
        gateway = f"https://{gateway}"
    return f"{gateway}/ipfs/{cid}"


def get_dev_jwt(email):
    r = requests.post(
        f"{DEV_BACKEND_URL}/auth/login",
        json={"email": email, "password": DEV_TEST_PASSWORD},
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


def check_profile(jwt, base_url=None):
    r = requests.get(
        f"{base_url or BACKEND_URL}/profile",
        headers={"Authorization": f"Bearer {jwt}"},
        timeout=10,
    )
    r.raise_for_status()
    return r.json()


def check_subscription(jwt, base_url=None):
    r = requests.get(
        f"{base_url or BACKEND_URL}/subscriptions/status",
        headers={"Authorization": f"Bearer {jwt}"},
        timeout=10,
    )
    r.raise_for_status()
    return r.json()


def check_kevin_chat(jwt, message, timeout=60, base_url=None):
    """
    Round-trips a message through /kevin/chat and returns the reply text.
    Doesn't distinguish which model tier actually answered (Hermes/Kimi vs.
    their Haiku/Sonnet/Opus fallback) — the API doesn't expose that, and
    checking would mean SSH log access this script doesn't have. What this
    does confirm: the tier's whole request pipeline (routing, tool-calling
    loop, provider call) is healthy enough to produce a real reply.
    """
    r = requests.post(
        f"{base_url or BACKEND_URL}/kevin/chat",
        json={"messages": [{"role": "user", "content": message}], "session_id": None},
        headers={"Authorization": f"Bearer {jwt}"},
        timeout=timeout,
    )
    r.raise_for_status()
    return r.json().get("reply", "")


def check_kevin_learning_endpoint_secured():
    """
    Confirms /cron/kevin-learning is alive and still enforces its secret,
    without actually triggering a real (costly) synthesis run — that's
    already scheduled weekly via its own crontab entry.
    """
    unauth = requests.post(f"{BACKEND_URL}/cron/kevin-learning", timeout=10)
    return unauth.status_code


TELEGRAM_BOT_ERROR_WINDOW_HOURS = 24
TELEGRAM_BOT_ERROR_THRESHOLD = 10


def check_telegram_bot_health():
    """
    Runs locally on KVM2 (this script is cron'd there directly), so it can
    check systemd + journald state without any network call. Deliberately
    does NOT call Telegram's getUpdates itself -- that would steal the live
    long-poll connection from kevin-bot.service and cause a 409 Conflict,
    which is exactly the kind of self-inflicted noise a health check should
    avoid, not create.
    """
    active = subprocess.run(
        ["systemctl", "is-active", "kevin-bot.service"],
        capture_output=True, text=True, timeout=10,
    ).stdout.strip()

    log_out = subprocess.run(
        ["journalctl", "-u", "kevin-bot.service", "--since", f"-{TELEGRAM_BOT_ERROR_WINDOW_HOURS}h", "--no-pager", "-o", "cat"],
        capture_output=True, text=True, timeout=15,
    ).stdout
    log_lines = log_out.splitlines()
    error_lines = [l for l in log_lines if "[ERROR]" in l]
    return active, len(log_lines), error_lines


def fetch_usage_report():
    """Subscriber counts per role+tier, Kevin chat model usage per tier, and
    platform-wide LLM spend by model/feature (last 7 days)."""
    r = requests.get(
        f"{BACKEND_URL}/cron/usage-report",
        headers={"x-cron-secret": CRON_SECRET},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()


def fetch_bounce_report(days=7):
    """Bounce counts per email type + bounce classification (Permanent/Transient),
    and how many of each were auto-retried as plaintext. Covers only email types
    sent via the backend's send_tracked_email helper (currently: high_value_match)
    — the weekly/monthly digest emails are sent directly from Next.js cron routes
    on a separate code path not yet wired into this tracking."""
    r = requests.get(
        f"{BACKEND_URL}/api/founders/bounce-report",
        headers={"x-cron-secret": CRON_SECRET},
        params={"days": days},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()


def check_investor_profile(jwt, base_url=None):
    r = requests.get(
        f"{base_url or BACKEND_URL}/investor-profile",
        headers={"Authorization": f"Bearer {jwt}"},
        timeout=10,
    )
    r.raise_for_status()
    return r.json()


def imap_fetch(hours):
    """Returns list of {from, subject, date} for all mail (all folders) in last N hours."""
    mail = imaplib.IMAP4_SSL("imap.gmail.com")
    mail.login(GMAIL_USER, GMAIL_APP_PASSWORD)
    mail.select('"[Gmail]/All Mail"')
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
        raw_subj = msg.get("Subject", "")
        try:
            decoded_subj = str(make_header(decode_header(raw_subj)))
        except Exception:
            decoded_subj = raw_subj
        msgs.append({
            "from": msg.get("From", ""),
            "subject": decoded_subj,
            "date": date_str,
        })
    mail.logout()
    return msgs



def check_dev_tier_assignments():
    """
    Logs into every dev test account and compares its actual (is_basic,
    is_pro) against what its name promises. Would have caught this session's
    "founder silently drifted to Basic" and "founderpro degraded to Free"
    incidents on day one instead of being found by hand weeks later.
    Returns a list of (name, expected, actual) mismatches -- empty if clean.
    """
    mismatches = []
    for name, (email, expected) in DEV_ACCOUNTS.items():
        jwt = get_dev_jwt(email)
        r = requests.get(
            f"{DEV_BACKEND_URL}/auth/me",
            headers={"Authorization": f"Bearer {jwt}"},
            timeout=10,
        )
        r.raise_for_status()
        d = r.json()
        actual = (d.get("is_basic"), d.get("is_pro"))
        if actual != expected:
            mismatches.append((name, expected, actual))
    return mismatches


def check_dev_call_intelligence_gating():
    """
    Free tier must get 403 from Call Intelligence, Basic/Pro must get 200 --
    this is the exact bug fixed in the 2026-07-28 audit (a legacy investor
    bypass could let free-tier investors through). Checks one free + one
    paid account per role. Returns a list of failure strings, empty if clean.
    """
    cases = [
        ("founder", 403), ("founderbasic", 200),
        ("investor", 403), ("investorbasic", 200),
    ]
    failures = []
    for name, expected_status in cases:
        email, _ = DEV_ACCOUNTS[name]
        jwt = get_dev_jwt(email)
        r = requests.get(
            f"{DEV_BACKEND_URL}/calls",
            headers={"Authorization": f"Bearer {jwt}"},
            timeout=10,
        )
        if r.status_code != expected_status:
            failures.append(f"{name}: expected {expected_status}, got {r.status_code}")
    return failures


def send_report(subject, plain_body, html_body=None):
    if html_body:
        msg = MIMEMultipart("alternative")
        msg.attach(MIMEText(plain_body, "plain", "utf-8"))
        msg.attach(MIMEText(html_body, "html", "utf-8"))
    else:
        msg = MIMEText(plain_body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = GMAIL_USER
    msg["To"] = REPORT_TO
    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as s:
        s.login(GMAIL_USER, GMAIL_APP_PASSWORD)
        s.sendmail(GMAIL_USER, REPORT_TO, msg.as_string())


CHECK_HEADER_RE = re.compile(r"^## (Check \S+) — (.*?)\s*\[([^\]]+)\]\s*$")


def parse_report_sections(lines):
    """
    Splits the flat report `lines` (as built by main()) into dev/shared/
    production buckets, one entry per check: {number, title, tag, status,
    body} where status is "drift" if any line in that check's body starts
    with the ⚠ marker already used throughout, "ok" otherwise. Section
    membership is read directly from each check header's trailing [TAG] --
    the exact same tags a human reads in the plain-text version, so the two
    can never silently drift apart from each other.
    """
    dev, shared, production = [], [], []
    current = None

    def bucket_for(tag):
        if tag.startswith("DEV"):
            return dev
        if tag.startswith("PRODUCTION"):
            return production
        return shared

    for line in lines:
        m = CHECK_HEADER_RE.match(line)
        if m:
            number, title, tag = m.groups()
            current = {"number": number, "title": title, "tag": tag, "body": [], "status": "ok"}
            bucket_for(tag).append(current)
            continue
        if line.startswith("## Summary"):
            current = None
            continue
        if current is not None:
            if line.strip():
                current["body"].append(line)
            if "⚠" in line:
                current["status"] = "drift"

    return dev, shared, production


def _html_escape(s):
    return (
        str(s)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def _render_check_card(check):
    ok = check["status"] == "ok"
    dot_color = "#22c55e" if ok else "#ef4444"
    body_html = "<br>".join(_html_escape(b) for b in check["body"]) or "<span style=\"color:#94a3b8;\">no output</span>"
    return f"""
    <tr>
      <td style="padding:14px 16px;border-bottom:1px solid #e5e7eb;vertical-align:top;width:22px;">
        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:{dot_color};margin-top:4px;"></span>
      </td>
      <td style="padding:14px 16px 14px 0;border-bottom:1px solid #e5e7eb;vertical-align:top;">
        <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13.5px;font-weight:600;color:#111827;margin-bottom:4px;">
          {_html_escape(check['number'])} — {_html_escape(check['title'])}
        </div>
        <div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.6;color:#4b5563;">
          {body_html}
        </div>
      </td>
    </tr>"""


def _render_section(title, subtitle, accent, checks):
    if not checks:
        return ""
    passed = sum(1 for c in checks if c["status"] == "ok")
    total = len(checks)
    pill_bg = "#dcfce7" if passed == total else "#fee2e2"
    pill_fg = "#166534" if passed == total else "#991b1b"
    rows = "".join(_render_check_card(c) for c in checks)
    return f"""
  <tr><td style="padding:28px 0 10px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <tr>
        <td style="border-left:4px solid {accent};padding:0 0 0 14px;">
          <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:17px;font-weight:700;color:#111827;">
            {_html_escape(title)}
            <span style="display:inline-block;margin-left:10px;padding:3px 10px;border-radius:999px;font-size:11.5px;font-weight:700;background:{pill_bg};color:{pill_fg};vertical-align:middle;">
              {passed}/{total} passing
            </span>
          </div>
          <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12.5px;color:#6b7280;margin-top:2px;">
            {_html_escape(subtitle)}
          </div>
        </td>
      </tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:12px;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
      {rows}
    </table>
  </td></tr>"""


def render_html_report(now_utc, overall_tag, dev, shared, production):
    overall_ok = overall_tag == "OK"
    badge_bg = "#16a34a" if overall_ok else "#dc2626"
    badge_text = "ALL SYSTEMS OK" if overall_ok else "DRIFT DETECTED"
    dev_and_shared = dev + shared

    sections = "".join([
        _render_section(
            "Dev", "dev.metatron.id · port 4001 · its own database — where real feature testing happens",
            "#6c5ce7", dev_and_shared,
        ),
        _render_section(
            "Production", "platform.metatron.id · port 4000 — infrastructure-only for now, no real users yet",
            "#0ea5e9", production,
        ),
    ])

    return f"""<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f3f4f6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:640px;max-width:92vw;">
        <tr><td style="padding-bottom:18px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
                <div style="font-size:20px;font-weight:800;color:#111827;">metatron e2e monitor</div>
                <div style="font-size:13px;color:#6b7280;margin-top:2px;">{now_utc.strftime('%Y-%m-%d %H:%M')} UTC</div>
              </td>
              <td align="right" style="vertical-align:top;">
                <span style="display:inline-block;padding:7px 14px;border-radius:8px;background:{badge_bg};color:#ffffff;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12.5px;font-weight:700;letter-spacing:.03em;">
                  {badge_text}
                </span>
              </td>
            </tr>
          </table>
        </td></tr>
        {sections}
        <tr><td style="padding:26px 4px 0 4px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:11.5px;color:#9ca3af;">
          Dev and Shared checks are grouped together above since Shared (IMAP inbox scan) checks currently reflect dev activity.
          Production stays infra-only until platform.metatron.id has real users. Generated by e2e_monitor.py on KVM2.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""


def main():
    today = datetime.date.today()
    now_utc = datetime.datetime.now(datetime.timezone.utc)

    lines = []
    drifts = []

    lines.append(f"# {now_utc.strftime('%Y-%m-%d %H:%M')} UTC")
    lines.append(
        "[DEV] = dev.metatron.id backend (port 4001, its own database) · "
        "[PRODUCTION] = platform.metatron.id backend (port 4000) · "
        "[SHARED] = same check regardless of environment (IMAP inbox scan) — "
        "see the end of each check title."
    )
    lines.append("")

    # ── Check 1: Account logins ───────────────────────────────────────────────
    # Runs against dev (DEV_BACKEND_URL), not production -- platform.metatron.id
    # has a fresh, intentionally-empty database pre-launch, so there are no
    # test accounts to log into there yet. All feature-dependent checks below
    # (2-4, 8-9) follow suit for the same reason.
    lines.append("## Check 1 — Account logins [DEV]")
    jwts = {}
    if not DEV_TEST_PASSWORD:
        lines.append(f"- ⚠ DRIFT — could not read TEST_PASSWORD from {DEV_ENV_FILE}")
        drifts.append(f"could not read dev TEST_PASSWORD from {DEV_ENV_FILE}")
    else:
        for key, (email, _expected_tier) in DEV_ACCOUNTS.items():
            try:
                jwts[key] = get_dev_jwt(email)
                lines.append(f"- {key} ({email}): ✓ login OK")
            except Exception as e:
                lines.append(f"- {key} ({email}): ⚠ DRIFT — login failed: {e}")
                drifts.append(f"{key} login failed: {e}")
    lines.append("")

    # ── Check 2: Free founder — Pinata + profile ──────────────────────────────
    lines.append("## Check 2 — Free founder: Pinata reachability + profile [DEV]")
    founder_profile = {}
    days_since = 0
    if "founder" in jwts:
        try:
            founder_profile = check_profile(jwts["founder"], base_url=DEV_BACKEND_URL)
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
    lines.append("## Check 3 — Basic founder: subscription + permanent deck [DEV]")
    if "founderbasic" in jwts:
        try:
            sub = check_subscription(jwts["founderbasic"], base_url=DEV_BACKEND_URL)
            plan = sub.get("subscription_tier") or sub.get("subscription_plan", "—")
            lines.append(f"- subscription_plan: {plan}")
            if plan != "basic":
                drifts.append(f"founderbasic plan is '{plan}', expected 'basic'")
                lines.append(f"  ⚠ DRIFT — expected 'basic'")
        except Exception as e:
            lines.append(f"- ⚠ subscription check failed: {e}")
            drifts.append(f"founderbasic subscription failed: {e}")

        try:
            bp = check_profile(jwts["founderbasic"], base_url=DEV_BACKEND_URL)
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

    # ── Check 3b: Pro founder — subscription plan = pro ──────────────────────
    lines.append("## Check 3b — Pro founder: subscription plan = pro [DEV]")
    if "founderpro" in jwts:
        try:
            sub = check_subscription(jwts["founderpro"], base_url=DEV_BACKEND_URL)
            plan = sub.get("subscription_tier") or sub.get("subscription_plan", "—")
            lines.append(f"- subscription_plan: {plan}")
            if plan != "pro":
                drifts.append(f"founderpro plan is '{plan}', expected 'pro'")
                lines.append("  ⚠ DRIFT — expected 'pro'")
        except Exception as e:
            lines.append(f"- ⚠ subscription check failed: {e}")
            drifts.append(f"founderpro subscription failed: {e}")

        try:
            pp = check_profile(jwts["founderpro"], base_url=DEV_BACKEND_URL)
            p_expires = pp.get("deck_expires_at")
            lines.append(f"- deck_expires_at: {p_expires} (should be null)")
            if p_expires:
                drifts.append(f"founderpro deck has expiry set: {p_expires}")
                lines.append("  ⚠ DRIFT — pro deck should not expire")
        except Exception as e:
            lines.append(f"- ⚠ profile check failed: {e}")
            drifts.append(f"founderpro profile failed: {e}")
    else:
        lines.append("- ⚠ skipped (login failed)")
    lines.append("")

    # ── Check 4: Investor — investor-profile endpoint ─────────────────────────
    lines.append("## Check 4 — Investor: profile [DEV]")
    if "investor" in jwts:
        try:
            ip = check_investor_profile(jwts["investor"], base_url=DEV_BACKEND_URL)
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
    lines.append("## Check 5 — IMAP scan for metatron.id mail (last 36h) [SHARED — reflects dev]")
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
    lines.append("## Check 6 — Email cadence compliance (free founder, last 36h) [SHARED — reflects dev]")
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
    lines.append("## Check 7 — Weekly matches email (IMAP, last 8 days) [SHARED — reflects dev]")
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

    # ── Check 8: Kevin chat — Moderate tier (Hermes 4 70B) ───────────────────
    lines.append("## Check 8 — Kevin chat, Moderate tier (Hermes 4 70B → Haiku fallback) [DEV]")
    if "founderpro" in jwts:
        try:
            reply = check_kevin_chat(
                jwts["founderpro"],
                "What is the typical timeline for a seed-stage fintech startup to "
                "close a funding round after first meeting investors?",
                base_url=DEV_BACKEND_URL,
            )
            if reply.strip():
                lines.append(f"- reply received ({len(reply)} chars): ✓")
            else:
                lines.append("- ⚠ DRIFT — empty reply")
                drifts.append("kevin chat (moderate tier): empty reply")
        except Exception as e:
            lines.append(f"- ⚠ DRIFT — request failed: {e}")
            drifts.append(f"kevin chat (moderate tier) failed: {e}")
    else:
        lines.append("- ⚠ skipped (founderpro login failed)")
    lines.append("")

    # ── Check 9: Kevin chat — Complex/DeepComplex tier (Kimi K3) ─────────────
    lines.append("## Check 9 — Kevin chat, DeepComplex tier (Kimi K3 → Sonnet/Opus fallback) [DEV]")
    if "founderpro" in jwts:
        try:
            reply = check_kevin_chat(
                jwts["founderpro"],
                "I'm currently preparing for my seed fundraising round and would like "
                "your help thinking through several interconnected questions at once. "
                "First, how many investors should I realistically plan to include in my "
                "first outreach batch given typical response rates at the seed stage? "
                "Second, what does a healthy response and meeting-conversion rate usually "
                "look like for fintech founders at this stage? Third, how long should I "
                "expect the overall process to take, from the very first investor contact "
                "through to a signed term sheet? And finally, what are the most common "
                "reasons seed-stage fintech deals tend to fall through during diligence?",
                timeout=90,
                base_url=DEV_BACKEND_URL,
            )
            if reply.strip():
                lines.append(f"- reply received ({len(reply)} chars): ✓")
            else:
                lines.append("- ⚠ DRIFT — empty reply")
                drifts.append("kevin chat (deepcomplex tier): empty reply")
        except Exception as e:
            lines.append(f"- ⚠ DRIFT — request failed: {e}")
            drifts.append(f"kevin chat (deepcomplex tier) failed: {e}")
    else:
        lines.append("- ⚠ skipped (founderpro login failed)")
    lines.append("")

    # ── Check 10: kevin-learning cron endpoint reachable + secured ───────────
    lines.append("## Check 10 — kevin-learning cron endpoint (reachability + auth only) [PRODUCTION]")
    try:
        status = check_kevin_learning_endpoint_secured()
        if status == 401:
            lines.append("- unauthenticated request correctly rejected (401): ✓")
        else:
            lines.append(f"- ⚠ DRIFT — expected 401 without secret, got {status}")
            drifts.append(f"kevin-learning endpoint returned {status} without secret, expected 401")
    except Exception as e:
        lines.append(f"- ⚠ DRIFT — request failed: {e}")
        drifts.append(f"kevin-learning endpoint check failed: {e}")
    lines.append("")

    # ── Check 11: subscriber + model usage report ────────────────────────────
    # Informational, not pass/fail — only the request itself can DRIFT.
    lines.append("## Check 11 — Subscribers per tier + model usage (last 7 days) [PRODUCTION]")
    try:
        report = fetch_usage_report()

        lines.append("Subscribers by role/tier:")
        by_role = {}
        for row in report.get("subscriber_counts", []):
            by_role.setdefault(row["role"], []).append((row["tier"], row["count"]))
        for role, tiers in sorted(by_role.items()):
            total = sum(c for _, c in tiers)
            tier_str = ", ".join(f"{t}={c}" for t, c in sorted(tiers))
            lines.append(f"- {role} ({total} total): {tier_str}")

        lines.append("")
        lines.append("Kevin chat model usage by tier:")
        by_tier = {}
        for row in report.get("model_usage", []):
            by_tier.setdefault(row["tier"], []).append((row["provider"], row["model"], row["count"]))
        if not by_tier:
            lines.append("- (no Kevin chat activity in the last 7 days)")
        for tier, rows in sorted(by_tier.items()):
            tier_total = sum(c for _, _, c in rows)
            lines.append(f"- {tier} ({tier_total} replies):")
            for provider, model, count in rows:
                pct = (count / tier_total * 100) if tier_total else 0
                lines.append(f"    {provider}/{model}: {count} ({pct:.0f}%)")

        lines.append("")
        lines.append("Platform-wide LLM spend by model (last 7 days):")
        spend_by_model = report.get("spend_by_model", [])
        model_total = sum(row["cost_usd"] for row in spend_by_model)
        if not spend_by_model:
            lines.append("- (no tracked spend in the last 7 days)")
        for row in spend_by_model:
            lines.append(f"- {row['provider']}/{row['model']}: ${row['cost_usd']:.4f}")
        lines.append(f"- TOTAL: ${model_total:.4f}")

        lines.append("")
        lines.append("Platform-wide LLM spend by feature (last 7 days):")
        spend_by_feature = report.get("spend_by_feature", [])
        if not spend_by_feature:
            lines.append("- (no tracked spend in the last 7 days)")
        for row in spend_by_feature:
            lines.append(f"- {row['feature']}: ${row['cost_usd']:.4f}")
    except Exception as e:
        lines.append(f"- ⚠ DRIFT — usage report request failed: {e}")
        drifts.append(f"usage report failed: {e}")
    lines.append("")

    # ── Check 12: Telegram bot service health ───────────────────────────────
    lines.append("## Check 12 — Telegram bot (kevin-bot.service) health [PRODUCTION — KVM2 local]")
    try:
        active, log_line_count, error_lines = check_telegram_bot_health()
        if active != "active":
            lines.append(f"- ⚠ DRIFT — kevin-bot.service is not active (status: {active})")
            drifts.append(f"kevin-bot.service not active: {active}")
        else:
            lines.append("- kevin-bot.service: ✓ active")
        lines.append(
            f"- log lines in last {TELEGRAM_BOT_ERROR_WINDOW_HOURS}h: {log_line_count}, "
            f"errors: {len(error_lines)}"
        )
        if len(error_lines) > TELEGRAM_BOT_ERROR_THRESHOLD:
            lines.append(
                f"- ⚠ DRIFT — {len(error_lines)} errors logged in last "
                f"{TELEGRAM_BOT_ERROR_WINDOW_HOURS}h (threshold {TELEGRAM_BOT_ERROR_THRESHOLD})"
            )
            drifts.append(f"kevin-bot.service logged {len(error_lines)} errors in last {TELEGRAM_BOT_ERROR_WINDOW_HOURS}h")
            for e in error_lines[-3:]:
                lines.append(f"    {e}")
    except Exception as e:
        lines.append(f"- ⚠ DRIFT — telegram bot health check failed: {e}")
        drifts.append(f"telegram bot health check failed: {e}")
    lines.append("")

    # ── Check 13: Email bounce report (last 7 days) ───────────────────────────
    lines.append("## Check 13 — Email bounces + plaintext retries (last 7 days) [PRODUCTION]")
    try:
        bounce_rows = fetch_bounce_report(days=7)
        if not bounce_rows:
            lines.append("- no bounces in the last 7 days")
        else:
            for row in bounce_rows:
                btype = row.get("bounce_type") or "unknown"
                count = row.get("count", 0)
                resent = row.get("plaintext_resent_count", 0)
                lines.append(
                    f"- {row.get('email_type', '—')} / {btype}: {count} bounced, {resent} auto-retried as plaintext"
                )
                if btype.lower() == "transient" and resent < count:
                    lines.append(f"    ⚠ {count - resent} transient bounce(s) not yet retried")
    except Exception as e:
        lines.append(f"- ⚠ DRIFT — bounce report fetch failed: {e}")
        drifts.append(f"bounce report fetch failed: {e}")
    lines.append("")

    # ── Check 14: Dev tier assignments (2026-07-28 subscription audit) ─────────
    # Runs against DEV_BACKEND_URL (port 4001), not BACKEND_URL -- these
    # accounts and fixes only exist on dev, not production, as of this check
    # being added.
    lines.append("## Check 14 — Dev tier assignments (founder/investor free-basic-pro ladder) [DEV]")
    if not DEV_TEST_PASSWORD:
        lines.append(f"- ⚠ skipped — could not read TEST_PASSWORD from {DEV_ENV_FILE}")
    else:
        try:
            mismatches = check_dev_tier_assignments()
            if not mismatches:
                lines.append(f"- all {len(DEV_ACCOUNTS)} accounts correctly tiered: ✓")
            else:
                for name, expected, actual in mismatches:
                    lines.append(
                        f"- ⚠ DRIFT — {name}: expected (is_basic={expected[0]}, is_pro={expected[1]}), "
                        f"got (is_basic={actual[0]}, is_pro={actual[1]})"
                    )
                    drifts.append(f"dev tier mismatch: {name} expected {expected}, got {actual}")
        except Exception as e:
            lines.append(f"- ⚠ DRIFT — tier assignment check failed: {e}")
            drifts.append(f"dev tier assignment check failed: {e}")
    lines.append("")

    # ── Check 15: Dev Call Intelligence tier gating ─────────────────────────────
    lines.append("## Check 15 — Dev Call Intelligence gating (free=403, basic/pro=200) [DEV]")
    if not DEV_TEST_PASSWORD:
        lines.append(f"- ⚠ skipped — could not read TEST_PASSWORD from {DEV_ENV_FILE}")
    else:
        try:
            failures = check_dev_call_intelligence_gating()
            if not failures:
                lines.append("- free correctly denied, basic/pro correctly allowed: ✓")
            else:
                for f in failures:
                    lines.append(f"- ⚠ DRIFT — {f}")
                    drifts.append(f"dev call intelligence gating: {f}")
        except Exception as e:
            lines.append(f"- ⚠ DRIFT — call intelligence gating check failed: {e}")
            drifts.append(f"dev call intelligence gating check failed: {e}")
    lines.append("")

    # ── Summary ───────────────────────────────────────────────────────────────
    tag = "DRIFT" if drifts else "OK"
    lines.append(f"## Summary: {tag}")
    lines.append(
        "(9 checks on [DEV]: 1,2,3,3b,4,8,9,14,15 · 4 on [PRODUCTION]: 10,11,12,13 · "
        "3 [SHARED]: 5,6,7)"
    )
    if drifts:
        for d in drifts:
            lines.append(f"- ⚠ {d}")
    else:
        lines.append("- all checks pass")

    body = "\n".join(lines)
    subject = f"{today.strftime('%Y-%m-%d')} | metatron e2e monitor | {tag}"

    try:
        dev_checks, shared_checks, production_checks = parse_report_sections(lines)
        html_body = render_html_report(now_utc, tag, dev_checks, shared_checks, production_checks)
    except Exception as e:
        # The plain-text body is the source of truth; a rendering bug in the
        # HTML layer should never cost Nick the actual report.
        print(f"HTML render failed, sending plain-text only: {e}")
        html_body = None

    send_report(subject, body, html_body)
    print(f"Sent: {subject}")


if __name__ == "__main__":
    main()
