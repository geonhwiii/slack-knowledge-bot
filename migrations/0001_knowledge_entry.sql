-- Knowledge Entry: 스레드 하나에서 뽑아낸 지식 한 건.
--
-- 검색은 두 갈래로 이루어진다.
--   embedding   같은 뜻의 다른 표현을 잡는다 ("결제 안 됨" ~ "구매 실패")
--   search_text 벡터가 놓치는 고유명사와 에러 코드를 잡는다 (ERR_PAYMENT_5031)
-- 둘 중 하나만으로는 부족해서 함께 건다.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS knowledge_entry (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 정체성: 스레드 하나가 Entry 하나다. 재저장은 새 행이 아니라 이 행의 갱신이다.
  thread_key   text NOT NULL UNIQUE,
  channel_id   text NOT NULL,
  channel_name text,
  permalink    text,

  -- 추출된 내용
  kind       text NOT NULL CHECK (kind IN ('issue', 'decision', 'howto')),
  status     text NOT NULL CHECK (status IN ('resolved', 'unresolved')),
  title      text NOT NULL,
  situation  text NOT NULL,
  cause      text,
  resolution text,
  systems    text[] NOT NULL DEFAULT '{}',
  tags       text[] NOT NULL DEFAULT '{}',

  -- 출처
  participants  text[] NOT NULL DEFAULT '{}',
  message_count integer NOT NULL DEFAULT 0,
  saved_by      text NOT NULL,

  -- 검색
  search_text     text NOT NULL,
  embedding       vector(1536),
  embedding_model text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 벡터 검색. 1536차원인 이유는 pgvector 인덱스가 2000차원까지만 지원하기 때문이다
-- (text-embedding-3-large의 기본 3072차원으로는 인덱스를 걸 수 없다).
CREATE INDEX IF NOT EXISTS knowledge_entry_embedding_idx
  ON knowledge_entry USING hnsw (embedding vector_cosine_ops);

-- 키워드 검색. 한국어는 조사가 붙어 형태가 변하므로 어절 단위 전문검색보다
-- 트라이그램 유사도가 실제로 더 잘 맞고, 에러 코드 부분일치에도 강하다.
CREATE INDEX IF NOT EXISTS knowledge_entry_search_text_idx
  ON knowledge_entry USING gin (search_text gin_trgm_ops);

-- "이 채널에 뭐가 쌓였나" 같은 조회용.
CREATE INDEX IF NOT EXISTS knowledge_entry_channel_idx
  ON knowledge_entry (channel_id, created_at DESC);
