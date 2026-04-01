#!/usr/bin/env python3
"""
Writes /tmp/patch_bot.py — a script to run ON KVM2 as root to patch /root/wallet_bot.py.

Usage (on your Mac):
  python3 scripts/make_patch.py
  scp /tmp/patch_bot.py root@31.97.189.18:/tmp/patch_bot.py
  ssh root@31.97.189.18 'python3 /tmp/patch_bot.py'
"""

from pathlib import Path

# Source inserted into wallet_bot.py by the remote patch (regex replacement target).
NEW_FUNCTIONS_BODY = r"""def get_platform_jwt(telegram_id, name=''):
    platform_url = os.getenv('PLATFORM_URL', PLATFORM_URL)
    bot_secret = os.getenv('PLATFORM_BOT_SECRET', PLATFORM_BOT_SECRET)
    if not bot_secret:
        print('get_platform_jwt error: PLATFORM_BOT_SECRET is empty', flush=True)
        return None
    if telegram_id in platform_jwt_cache:
        return platform_jwt_cache[telegram_id]
    try:
        r = requests.post(f'{platform_url}/auth/telegram', json={
            'telegram_id': str(telegram_id),
            'telegram_name': name,
            'bot_secret': bot_secret
        }, timeout=10)
        if r.status_code != 200:
            print(f'get_platform_jwt non-200: status={r.status_code} body={r.text[:300]}', flush=True)
            return None
        token = r.json().get('token')
        if not token:
            print(f'get_platform_jwt missing token: body={r.text[:300]}', flush=True)
            return None
        platform_jwt_cache[telegram_id] = token
        return token
    except Exception as e:
        print(f'get_platform_jwt error: {e}', flush=True)
        return None

def ask_kevin(chat_id, user_message, user_name=''):
    try:
        sessions_store = globals().setdefault('sessions', {})
        if chat_id not in sessions_store:
            sessions_store[chat_id] = []
        sessions_store[chat_id].append({'role': 'user', 'content': user_message})
        history = sessions_store[chat_id][-10:]
        jwt = get_platform_jwt(chat_id, user_name)
        if not jwt:
            return "Sorry, I'm having trouble responding right now. Please try again. 🌍"
        r = requests.post(
            f'{PLATFORM_URL}/api/kevin/chat',
            json={'messages': history},
            headers={'Authorization': f'Bearer {jwt}', 'Content-Type': 'application/json'},
            timeout=60
        )
        if r.status_code == 401:
            platform_jwt_cache.pop(chat_id, None)
            jwt = get_platform_jwt(chat_id, user_name)
            if not jwt:
                return "Sorry, I'm having trouble responding right now. Please try again. 🌍"
            r = requests.post(
                f'{PLATFORM_URL}/api/kevin/chat',
                json={'messages': history},
                headers={'Authorization': f'Bearer {jwt}', 'Content-Type': 'application/json'},
                timeout=60
            )
        r.raise_for_status()
        payload = r.json()
        reply = payload.get('reply') or "Sorry, I'm having trouble responding right now. Please try again. 🌍"
        sessions_store[chat_id].append({'role': 'assistant', 'content': reply})
        return reply
    except Exception as e:
        print(f'ask_kevin error: {e}', flush=True)
        return "Sorry, I'm having trouble responding right now. Please try again. 🌍"
"""


def patch_bot_script() -> str:
    """Full contents of /tmp/patch_bot.py as run on KVM2."""
    new_funcs_literal = repr(NEW_FUNCTIONS_BODY) + "\n"
    return f"""#!/usr/bin/env python3
\"\"\"Run on KVM2 as root. Patches /root/wallet_bot.py in place.\"\"\"

import re
from pathlib import Path

BOT_PATH = Path("/root/wallet_bot.py")

NADIRCLAW_MARKER = "NADIRCLAW_URL = 'http://localhost:8856/v1/chat/completions'"

INSERT_AFTER = \"\"\"
PLATFORM_URL = os.getenv('PLATFORM_URL', 'https://platform.metatron.id')
PLATFORM_BOT_SECRET = os.getenv('PLATFORM_BOT_SECRET', '')
platform_jwt_cache = {{}}
\"\"\"

NEW_FUNCTIONS = {new_funcs_literal}

def main() -> None:
    text = BOT_PATH.read_text(encoding="utf-8")

    # Change 1: insert platform vars after NADIRCLAW_URL line
    if "PLATFORM_URL = os.getenv" not in text:
        if NADIRCLAW_MARKER not in text:
            raise SystemExit(
                f"Expected line not found in {{BOT_PATH}}:\\n  {{NADIRCLAW_MARKER!r}}"
            )
        text = text.replace(
            NADIRCLAW_MARKER,
            NADIRCLAW_MARKER + INSERT_AFTER,
            1,
        )

    # Change 2: replace any def ask_kevin(...): ... up to next top-level def
    pattern = r"def ask_kevin\\([^\\n]*\\)\\s*:.*?(?=^def |\\Z)"
    new_text, n = re.subn(pattern, NEW_FUNCTIONS, text, flags=re.MULTILINE | re.DOTALL)
    if n != 1:
        raise SystemExit(
            f"ask_kevin replace: expected 1 match, got {{n}}. Check {{BOT_PATH}} signature/body."
        )
    text = new_text

    BOT_PATH.write_text(text, encoding="utf-8")
    print(f"Patched {{BOT_PATH}} OK")


if __name__ == "__main__":
    main()
"""


def main() -> None:
    out = Path("/tmp/patch_bot.py")
    out.write_text(patch_bot_script(), encoding="utf-8")
    print(f"Wrote {out}")
    print("Now run: scp /tmp/patch_bot.py root@31.97.189.18:/tmp/patch_bot.py")


if __name__ == "__main__":
    main()
