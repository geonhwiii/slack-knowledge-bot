-- 원문 보관, Entry 사이의 관계, 그리고 임베딩 레시피 버전.

-- 추출 결과만 저장하면 프롬프트나 모델을 개선해도 이미 쌓인 Entry는 옛 품질로 남는다.
-- 다시 뽑으려면 원문이 필요한데, 슬랙은 믿을 만한 보관소가 아니다 — 무료 플랜은 90일이
-- 지나면 안 보여주고, 채널은 아카이브되고, 사람은 자기 메시지를 지운다.
--
-- 스레드 하나가 몇 KB다. 이걸 안 남겨서 나중에 전량 재추출을 포기하는 쪽이 훨씬 비싸다.
ALTER TABLE knowledge_entry ADD COLUMN IF NOT EXISTS source_transcript text;

-- 결정은 뒤집힌다. "세션 기반으로 간다"(2024)와 "JWT로 전환한다"(2026)가 둘 다 살아서
-- 검색되면 봇이 폐기된 결정을 근거로 답하는데, 그건 기록이 없는 것보다 나쁘다.
-- 없으면 사람이 찾아보지만, 틀린 답이 나오면 그대로 믿는다.
ALTER TABLE knowledge_entry
  ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES knowledge_entry(id) ON DELETE SET NULL;

-- 같은 증상이 세 번 났다는 것 자체가 정보다. 합쳐버리면 그게 사라지므로, 합치지 않고 잇는다.
ALTER TABLE knowledge_entry
  ADD COLUMN IF NOT EXISTS recurrence_of uuid REFERENCES knowledge_entry(id) ON DELETE SET NULL;

-- 벡터가 낡는 경로는 둘이다. 임베딩 모델을 바꿀 때(embedding_model)와, 무엇을 임베딩할지를
-- 바꿀 때(이 컬럼). 후자는 모델이 그대로라 티가 안 나는데도 좌표가 달라진다.
--
-- 기존 행은 1로 남는다. 지금 코드가 만드는 벡터는 2라서, 재생성 전까지 옛 행은 벡터 검색에서
-- 빠진다(키워드로는 계속 찾힌다). `bun run reembed`로 되살린다.
ALTER TABLE knowledge_entry ADD COLUMN IF NOT EXISTS embedding_version integer NOT NULL DEFAULT 1;

-- 대체된 결정을 검색에서 걸러내는 경로. 대부분의 행이 NULL이라 부분 인덱스로 둔다.
CREATE INDEX IF NOT EXISTS knowledge_entry_superseded_idx
  ON knowledge_entry (superseded_by) WHERE superseded_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS knowledge_entry_recurrence_idx
  ON knowledge_entry (recurrence_of) WHERE recurrence_of IS NOT NULL;
