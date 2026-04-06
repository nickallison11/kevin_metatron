# pip install psycopg2-binary python-dotenv requests

import argparse
import json
from pathlib import Path
from uuid import UUID

import psycopg2
import requests
from dotenv import load_dotenv
import os


PROFILES = {
    "8753860493": {
        "role": "founder",
        "wallet": "DXGYnw8hUK9e4upyvDQPKhgQu7x6hD9DeWQV6GgbdJ29",
        "profile_cid": "QmQAxS9JP5ohw4meFYHfDUroxqDFSAiB6DBB1SpVb3AiBa",
        "deck_cid": "QmXoeqqjEmGuM3e89jz3tupkG3TBYPxmXwRXkVbqBG5iou",
        "company_name": "metatron",
        "sector": "Ai & Blockchain",
        "stage": "Seed",
        "one_liner": "metatron is an AI agent network for founder-investor matchmaking in emerging markets.",
        "summary": "metatron is an ai agent network leveraging blockchain for founder-investor matchmaking, targeting emerging markets with a vision to launch its MTN token on Solana. The company has a four-year runway and aims to secure a $50k grant from the Solana Foundation to catalyze its token launch and access a $10 million GEM Digital token subscription facility. While currently pre-revenue, metatron's founder possesses the technical capability to build the platform and has experience engaging with the startup ecosystem through podcasts.",
    }
}

INVESTORS = {
    "8753860493": {
        "name": "Nick Allison",
        "firm": "metatron connect",
        "sectors": "Food Systems, Circular Economies, Health Systems, Renewable Energy, Zero Carbon, Exponential Tech",
        "stages": "Seed, Series A and above",
        "telegram_id": "8753860493",
        "status": "approved",
    }
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Import one-time KVM2 Telegram data into platform DB"
    )
    parser.add_argument("--user-id", required=True, help="Platform user UUID")
    return parser.parse_args()


def load_env() -> tuple[str, str]:
    env_path = Path(__file__).resolve().parent.parent / ".env"
    load_dotenv(env_path)

    database_url = os.getenv("DATABASE_URL") or os.getenv("BACKEND_DATABASE_URL")
    gemini_api_key = os.getenv("GEMINI_API_KEY")

    if not database_url:
        raise RuntimeError("DATABASE_URL (or BACKEND_DATABASE_URL) is required in ../.env")
    if not gemini_api_key:
        raise RuntimeError("GEMINI_API_KEY is required in ../.env")

    return database_url, gemini_api_key


def fetch_embedding(api_key: str, summary_text: str) -> list[float]:
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"text-embedding-004:embedContent?key={api_key}"
    )
    body = {
        "content": {"parts": [{"text": summary_text}]},
    }
    res = requests.post(url, json=body, timeout=60)
    if not res.ok:
        raise RuntimeError(f"Gemini embedding failed: {res.status_code} {res.text}")

    data = res.json()
    values = data.get("embedding", {}).get("values")
    if not isinstance(values, list) or not values:
        raise RuntimeError(f"Missing embedding values in response: {json.dumps(data)[:500]}")
    return values


def to_pgvector(values: list[float]) -> str:
    return "[" + ",".join(str(float(v)) for v in values) + "]"


def main() -> None:
    args = parse_args()
    user_id = str(UUID(args.user_id))
    database_url, gemini_api_key = load_env()

    profile_rows = 0
    investor_rows = 0
    memory_rows = 0

    conn = psycopg2.connect(database_url)
    conn.autocommit = False

    try:
        with conn.cursor() as cur:
            for telegram_id, data in PROFILES.items():
                cur.execute(
                    """
                    INSERT INTO profiles (
                        user_id, company_name, one_liner, stage, sector, pitch_deck_url, updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, now())
                    ON CONFLICT (user_id) DO UPDATE
                    SET company_name = EXCLUDED.company_name,
                        one_liner = EXCLUDED.one_liner,
                        stage = EXCLUDED.stage,
                        sector = EXCLUDED.sector,
                        pitch_deck_url = EXCLUDED.pitch_deck_url,
                        updated_at = now()
                    """,
                    (
                        user_id,
                        data.get("company_name"),
                        data.get("one_liner"),
                        data.get("stage"),
                        data.get("sector"),
                        f"ipfs://{data.get('deck_cid', '')}",
                    ),
                )
                profile_rows += 1

                summary_text = data.get("summary", "").strip()
                if summary_text:
                    try:
                        embedding_values = fetch_embedding(gemini_api_key, summary_text)
                        embedding_pgvector = to_pgvector(embedding_values)
                        cur.execute(
                            """
                            INSERT INTO kevin_memories (user_id, content, embedding)
                            VALUES (%s, %s, %s::vector)
                            """,
                            (user_id, summary_text, embedding_pgvector),
                        )
                    except Exception as e:
                        print(
                            f"Embedding failed, inserting NULL embedding instead: {e}"
                        )
                        cur.execute(
                            """
                            INSERT INTO kevin_memories (user_id, content, embedding)
                            VALUES (%s, %s, NULL)
                            """,
                            (user_id, summary_text),
                        )
                    memory_rows += 1

            for telegram_id, data in INVESTORS.items():
                _ = telegram_id  # Explicitly keep loop variable for clarity with source data shape.
                sectors = [s.strip() for s in data.get("sectors", "").split(",") if s.strip()]
                stages = [s.strip() for s in data.get("stages", "").split(",") if s.strip()]

                cur.execute(
                    """
                    INSERT INTO investor_profiles (user_id, sectors, stages, updated_at)
                    VALUES (%s, %s, %s, now())
                    ON CONFLICT (user_id) DO UPDATE
                    SET sectors = EXCLUDED.sectors,
                        stages = EXCLUDED.stages,
                        updated_at = now()
                    """,
                    (user_id, sectors, stages),
                )
                investor_rows += 1

        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    print("KVM2 import complete")
    print(f"- user_id: {user_id}")
    print(f"- profiles upserted: {profile_rows}")
    print(f"- investor_profiles upserted: {investor_rows}")
    print(f"- kevin_memories inserted: {memory_rows}")


if __name__ == "__main__":
    main()
