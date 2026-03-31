CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE kevin_memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    embedding vector(768),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX kevin_memories_user_idx ON kevin_memories (user_id);
CREATE INDEX kevin_memories_embedding_idx ON kevin_memories
    USING hnsw (embedding vector_cosine_ops);
