#!/usr/bin/env python3
"""
Kevin Telegram bot — long-poll Telegram, call platform /kevin/telegram and /auth/telegram/confirm.

Deploy on KVM2 as /root/wallet_bot.py; requires TELEGRAM_BOT_TOKEN and PLATFORM_BOT_SECRET in /root/.env
"""
from dotenv import load_dotenv

load_dotenv("/root/.env")

import json
import os
import time

import requests

BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
PLATFORM_URL = os.getenv("PLATFORM_URL", "https://platform.metatron.id")
BOT_SECRET = os.getenv("PLATFORM_BOT_SECRET", "")
ELEVENLABS_KEY = os.getenv("ELEVENLABS_API_KEY", "")
ELEVENLABS_VOICE = os.getenv("ELEVENLABS_VOICE_ID", "")
WHISPER_URL = os.getenv("WHISPER_URL", "http://localhost:9000/asr")
API = f"https://api.telegram.org/bot{BOT_TOKEN}"


def send_text(chat_id, text):
    try:
        requests.post(
            f"{API}/sendMessage",
            json={"chat_id": chat_id, "text": text, "parse_mode": "Markdown"},
            timeout=10,
        )
    except Exception as e:
        print(f"send_text error: {e}", flush=True)


def send_voice(chat_id, audio_bytes):
    try:
        requests.post(
            f"{API}/sendVoice",
            files={"voice": ("reply.mp3", audio_bytes, "audio/mpeg")},
            data={"chat_id": chat_id},
            timeout=30,
        )
    except Exception as e:
        print(f"send_voice error: {e}", flush=True)


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
        return r2.content
    except Exception as e:
        print(f"download_file error: {e}", flush=True)
        return None


def transcribe(audio_bytes, mime="audio/ogg"):
    try:
        r = requests.post(
            f"{WHISPER_URL}?encode=true&task=transcribe&language=en&output=txt",
            files={"audio_file": ("audio.ogg", audio_bytes, mime)},
            timeout=60,
        )
        return r.text.strip()
    except Exception as e:
        print(f"transcribe error: {e}", flush=True)
        return None


def ask_kevin(telegram_id, message):
    try:
        r = requests.post(
            f"{PLATFORM_URL}/kevin/telegram",
            json={"telegram_id": telegram_id, "message": message},
            headers={
                "X-Bot-Secret": BOT_SECRET,
                "Content-Type": "application/json",
            },
            timeout=60,
        )
        if r.status_code == 404:
            return None, "not_registered"
        if r.status_code == 429:
            try:
                data = r.json()
                return None, data.get("message", "Daily limit reached.")
            except Exception:
                return None, r.text.strip() or "Daily limit reached."
        if r.status_code == 200:
            try:
                data = r.json()
                return data.get("reply", ""), None
            except Exception:
                return None, "error"
        return None, f"Error {r.status_code}"
    except Exception as e:
        print(f"ask_kevin error: {e}", flush=True)
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
            headers={"xi-api-key": ELEVENLABS_KEY, "Content-Type": "application/json"},
            timeout=30,
        )
        if r.status_code == 200:
            return r.content
        print(f"tts error: {r.status_code} {r.text[:200]}", flush=True)
        return None
    except Exception as e:
        print(f"tts error: {e}", flush=True)
        return None


def confirm_link(telegram_id, code):
    try:
        r = requests.post(
            f"{PLATFORM_URL}/auth/telegram/confirm",
            json={"telegram_id": telegram_id, "code": code},
            headers={"Content-Type": "application/json"},
            timeout=10,
        )
        return r.status_code == 200
    except Exception as e:
        print(f"confirm_link error: {e}", flush=True)
        return False


def handle_message(telegram_id, chat_id, text=None, voice_bytes=None, is_voice=False):
    typing(chat_id)

    if is_voice and voice_bytes:
        transcript = transcribe(voice_bytes)
        if not transcript:
            send_text(
                chat_id,
                "Sorry, I couldn't transcribe your voice note. Please try again.",
            )
            return
        text = transcript

    if not text:
        return

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
                "allowed_updates": json.dumps(["message"]),
            },
            timeout=35,
        )
        return r.json().get("result", [])
    except Exception as e:
        print(f"getUpdates error: {e}", flush=True)
        return []


def main():
    if not BOT_TOKEN:
        print("TELEGRAM_BOT_TOKEN is not set", flush=True)
        return
    if not BOT_SECRET:
        print("PLATFORM_BOT_SECRET is not set — /kevin/telegram will fail", flush=True)

    print("Kevin Telegram bot starting...", flush=True)
    offset = 0
    while True:
        updates = get_updates(offset)
        for u in updates:
            offset = u["update_id"] + 1
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
                        "To get started, sign up at platform.metatron.id and link your "
                        "Telegram in Settings.",
                    )
                continue

            if voice:
                file_id = voice["file_id"]
                audio_bytes = download_file(file_id)
                if audio_bytes:
                    handle_message(
                        telegram_id,
                        chat_id,
                        voice_bytes=audio_bytes,
                        is_voice=True,
                    )
                continue

            if text:
                handle_message(telegram_id, chat_id, text=text)

        if not updates:
            time.sleep(1)


if __name__ == "__main__":
    main()
