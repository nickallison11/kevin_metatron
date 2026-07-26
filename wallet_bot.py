#!/usr/bin/env python3
from dotenv import load_dotenv

load_dotenv("/root/.env")

import logging
import os
import requests
import time

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("kevin_bot")

BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
if not BOT_TOKEN:
    raise RuntimeError("TELEGRAM_BOT_TOKEN not set in environment")
PLATFORM_URL = os.getenv("PLATFORM_URL", "https://platform.metatron.id")
BOT_SECRET = os.getenv("PLATFORM_BOT_SECRET", "")
ELEVENLABS_KEY = os.getenv("ELEVENLABS_API_KEY", "")
ELEVENLABS_VOICE = os.getenv("ELEVENLABS_VOICE_ID", "")
WHISPER_URL = "http://localhost:9000/asr"
API = f"https://api.telegram.org/bot{BOT_TOKEN}"


def redact(text):
    """Telegram puts the bot token directly in the request URL, so any
    connection-level exception (DNS failure, reset, timeout) has it embedded
    in str(e) via the URL requests/urllib3 report. Strip it before it ever
    reaches a log line -- this is exactly how the token leaked into bot.log
    previously."""
    return str(text).replace(BOT_TOKEN, "***REDACTED***")


def send_text(chat_id, text):
    try:
        r = requests.post(
            f"{API}/sendMessage",
            json={"chat_id": chat_id, "text": text, "parse_mode": "Markdown"},
            timeout=10,
        )
        if r.status_code != 200:
            log.warning("send_text: chat_id=%s status=%s body=%s", chat_id, r.status_code, r.text[:200])
        else:
            log.info("send_text: chat_id=%s reply_chars=%s", chat_id, len(text))
    except Exception as e:
        log.error("send_text error: chat_id=%s %s", chat_id, redact(e))


def send_voice(chat_id, audio_bytes):
    try:
        r = requests.post(
            f"{API}/sendVoice",
            files={"voice": ("reply.mp3", audio_bytes, "audio/mpeg")},
            data={"chat_id": chat_id},
            timeout=30,
        )
        if r.status_code != 200:
            log.warning("send_voice: chat_id=%s status=%s body=%s", chat_id, r.status_code, r.text[:200])
        else:
            log.info("send_voice: chat_id=%s bytes=%s", chat_id, len(audio_bytes))
    except Exception as e:
        log.error("send_voice error: chat_id=%s %s", chat_id, redact(e))


def typing(chat_id):
    try:
        requests.post(
            f"{API}/sendChatAction",
            json={"chat_id": chat_id, "action": "typing"},
            timeout=5,
        )
    except Exception:
        pass


def download_file(file_id):
    try:
        r = requests.get(f"{API}/getFile", params={"file_id": file_id}, timeout=10)
        file_path = r.json()["result"]["file_path"]
        r2 = requests.get(
            f"https://api.telegram.org/file/bot{BOT_TOKEN}/{file_path}", timeout=30
        )
        log.info("download_file: file_id=%s bytes=%s", file_id, len(r2.content))
        return r2.content
    except Exception as e:
        log.error("download_file error: file_id=%s %s", file_id, redact(e))
        return None


def transcribe(audio_bytes):
    try:
        r = requests.post(
            f"{WHISPER_URL}?encode=true&task=transcribe&language=en&output=txt",
            files={"audio_file": ("audio.ogg", audio_bytes, "audio/ogg")},
            timeout=60,
        )
        text = r.text.strip()
        log.info("transcribe: input_bytes=%s output_chars=%s", len(audio_bytes), len(text))
        return text
    except Exception as e:
        log.error("transcribe error: %s", redact(e))
        return None


def ask_kevin(telegram_id, message):
    started = time.monotonic()
    try:
        r = requests.post(
            f"{PLATFORM_URL}/kevin/telegram",
            json={"telegram_id": telegram_id, "message": message},
            headers={"X-Bot-Secret": BOT_SECRET, "Content-Type": "application/json"},
            timeout=60,
        )
        elapsed = time.monotonic() - started
        if r.status_code == 404:
            log.warning("ask_kevin: telegram_id=%s not_registered (%.1fs)", telegram_id, elapsed)
            return None, "not_registered"
        if r.status_code == 429:
            log.info("ask_kevin: telegram_id=%s daily_limit_reached (%.1fs)", telegram_id, elapsed)
            return None, r.json().get("message", "Daily limit reached.")
        if r.status_code == 200:
            reply = r.json().get("reply", "")
            log.info("ask_kevin: telegram_id=%s ok reply_chars=%s (%.1fs)", telegram_id, len(reply), elapsed)
            return reply, None
        log.warning("ask_kevin: telegram_id=%s status=%s body=%s (%.1fs)", telegram_id, r.status_code, r.text[:200], elapsed)
        return None, f"Error {r.status_code}"
    except Exception as e:
        log.error("ask_kevin error: telegram_id=%s %s", telegram_id, redact(e))
        return None, "error"


def tts(text):
    if not ELEVENLABS_KEY or not ELEVENLABS_VOICE:
        return None
    try:
        r = requests.post(
            f"https://api.elevenlabs.io/v1/text-to-speech/{ELEVENLABS_VOICE}",
            json={
                "text": text,
                "model_id": "eleven_turbo_v2_5",
                "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
            },
            headers={
                "xi-api-key": ELEVENLABS_KEY,
                "Content-Type": "application/json",
            },
            timeout=30,
        )
        if r.status_code == 200:
            log.info("tts: ok bytes=%s", len(r.content))
            return r.content
        log.warning("tts error: status=%s body=%s", r.status_code, r.text[:200])
        return None
    except Exception as e:
        log.error("tts error: %s", redact(e))
        return None


def confirm_link(telegram_id, code):
    try:
        url = f"{PLATFORM_URL}/auth/telegram/confirm"
        r = requests.post(
            url,
            json={"telegram_id": telegram_id, "code": code},
            headers={"Content-Type": "application/json"},
            timeout=10,
        )
        ok = r.status_code == 200
        log.info("confirm_link: telegram_id=%s status=%s ok=%s", telegram_id, r.status_code, ok)
        return ok
    except Exception as e:
        log.error("confirm_link error: telegram_id=%s %s", telegram_id, redact(e))
        return False


def handle_message(telegram_id, chat_id, text=None, voice_bytes=None, is_voice=False):
    typing(chat_id)
    if is_voice and voice_bytes:
        text = transcribe(voice_bytes)
        if not text:
            log.warning("handle_message: telegram_id=%s voice transcription failed", telegram_id)
            send_text(
                chat_id,
                "Sorry, I couldn't transcribe your voice note. Please try again.",
            )
            return
    if not text:
        return
    log.info(
        "handle_message: telegram_id=%s chat_id=%s type=%s chars=%s",
        telegram_id, chat_id, "voice" if is_voice else "text", len(text),
    )
    reply, error = ask_kevin(telegram_id, text)
    if error == "not_registered":
        send_text(
            chat_id,
            "👋 You need a metatron account to chat with Kevin.\n\n"
            "Sign up free at platform.metatron.id, then link your Telegram in Settings.",
        )
        return
    if error and not reply:
        send_text(
            chat_id,
            error
            if error != "error"
            else "Sorry, Kevin is temporarily unavailable. Please try again.",
        )
        return
    if is_voice:
        audio = tts(reply)
        if audio:
            send_voice(chat_id, audio)
            return
    send_text(chat_id, reply)


def get_updates(offset=0):
    try:
        r = requests.get(
            f"{API}/getUpdates",
            params={
                "timeout": 30,
                "offset": offset,
                "allowed_updates": '["message"]',
            },
            timeout=35,
        )
        body = r.json()
        if not body.get("ok"):
            # Telegram returns 200-with-ok:false or 4xx for problems like a
            # second concurrent poller (409 Conflict) -- this used to be
            # silently swallowed since only exceptions were logged, not
            # unsuccessful-but-non-exception responses.
            log.warning(
                "getUpdates: status=%s error_code=%s description=%s",
                r.status_code, body.get("error_code"), body.get("description"),
            )
            return []
        return body.get("result", [])
    except requests.exceptions.ReadTimeout:
        # Expected under normal long-polling -- no update arrived within the
        # window. Not worth logging every ~30s.
        return []
    except Exception as e:
        log.warning("getUpdates error: %s", redact(e))
        return []


def main():
    log.info("Kevin bot started (polling for updates)")
    offset = 0
    while True:
        updates = get_updates(offset)
        for u in updates:
            offset = u["update_id"] + 1
            try:
                msg = u.get("message", {})
                chat_id = msg.get("chat", {}).get("id")
                telegram_id = msg.get("from", {}).get("id")
                if not chat_id or not telegram_id:
                    continue
                text = msg.get("text", "")
                voice = msg.get("voice")
                if text.startswith("/start"):
                    parts = text.split(None, 1)
                    if len(parts) == 2:
                        code = parts[1].strip()
                        if confirm_link(telegram_id, code):
                            send_text(
                                chat_id,
                                "✅ Your Telegram is now linked to your metatron account!\n\n"
                                "You can now chat with Kevin here. What would you like to work on?",
                            )
                        else:
                            send_text(
                                chat_id,
                                "❌ That code is invalid or expired. Go to Settings on "
                                "platform.metatron.id to get a new one.",
                            )
                    else:
                        send_text(
                            chat_id,
                            "👋 Welcome to *metatron*!\n\n"
                            "I'm Kevin, your AI copilot for fundraising.\n\n"
                            "Sign up free at platform.metatron.id and link your Telegram in "
                            "Settings to get started.",
                        )
                    continue
                if voice:
                    audio_bytes = download_file(voice["file_id"])
                    if audio_bytes:
                        handle_message(
                            telegram_id, chat_id, voice_bytes=audio_bytes, is_voice=True
                        )
                    continue
                if text:
                    handle_message(telegram_id, chat_id, text=text)
            except Exception as e:
                # A single malformed/unexpected update shouldn't take the
                # whole poll loop down -- log it and keep going.
                log.error("update processing error: update_id=%s %s", u.get("update_id"), redact(e))
        if not updates:
            time.sleep(1)


if __name__ == "__main__":
    main()
