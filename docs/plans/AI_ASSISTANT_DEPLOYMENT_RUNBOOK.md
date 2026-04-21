# AI Assistant Deployment Runbook

Этот runbook нужен для доведения новой архитектуры AI-ассистента до рабочего удалённого состояния в Supabase после локальной реализации.

## Что уже должно быть в репозитории

Новая backend/runtime часть:

- `supabase/functions/_shared/openai-responses.ts`
- `supabase/functions/_shared/openai.ts`
- `supabase/functions/_shared/assistant-session.ts`
- `supabase/functions/_shared/assistant-parser.ts`
- `supabase/functions/_shared/assistant-synthesis.ts`
- `supabase/functions/_shared/assistant-tools.ts`
- `supabase/functions/_shared/assistant-usage.ts`
- `supabase/functions/_shared/assistant-events.ts`
- `supabase/functions/_shared/assistant-runtime.ts`
- `supabase/functions/api/index.ts`

Новые миграции:

- `supabase/migrations/20250406141000_create_assistant_sessions_table.sql`
- `supabase/migrations/20250406141100_create_assistant_daily_usage_table.sql`
- `supabase/migrations/20250406141200_create_assistant_events_table.sql`

## Что должно быть в `.env_xcode`

Минимум:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`

Опционально для автоматического применения SQL:

- `SUPABASE_DB_URL`

## Analysis V2 environment

Для production и nightly checks отдельно держать следующие переменные:

- `ANALYSIS_API_BASE_URL` - base URL для `analysis/v2` smoke/golden checks
- `ANALYSIS_AUTH_EMAIL` - service login для evaluation jobs
- `ANALYSIS_AUTH_PASSWORD` - service password для evaluation jobs
- `ANALYSIS_SHADOW_PERCENT` - percentage rollout для shadow/canary; в production не должен оставаться `0`, если нужен shadow
- `ANALYSIS_SHADOW_MIN_REMAINING_USD` - минимальный остаток бюджета для shadow-запуска
- `ANALYSIS_MAX_IMAGE_BYTES` - верхний лимит размера изображения
- `OPENAI_MODEL_TEXT_SIMPLE` - модель для простого text-path
- `OPENAI_MODEL_TEXT_COMPLEX` - модель для complex text-path
- `OPENAI_MODEL_PHOTO` - модель для photo-path
- `OPENAI_MODEL_SHADOW` - модель для shadow сравнений

Рекомендуемый подход:

- хранить эти значения в GitHub Secrets / environment variables для production
- в локальной среде держать их в `.env_xcode`
- не полагаться на fallback-дефолты в коде для production rollout

## Порядок удалённого применения

### 1. Применить SQL-миграции

Если есть прямой `SUPABASE_DB_URL`, можно использовать:

```bash
./scripts/apply_assistant_backend.sh
```

Если `SUPABASE_DB_URL` нет, SQL нужно применить вручную в Supabase SQL Editor в таком порядке:

1. `20250406141000_create_assistant_sessions_table.sql`
2. `20250406141100_create_assistant_daily_usage_table.sql`
3. `20250406141200_create_assistant_events_table.sql`

### 2. Задеплоить обновлённый backend API

Нужно задеплоить текущую версию `supabase/functions/api/index.ts` вместе с `_shared` модулями.

Критично проверить, что в удалённой среде доступны:

- `OPENAI_API_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

### 3. Проверить runtime руками

Проверки:

1. `POST /assistant/turn` текстовый turn без фото
2. `POST /assistant/turn` turn с фото
3. add meal flow с confirm
4. delete meal flow с confirm
5. edit meal flow с confirm
6. free-limit response после превышения quota
7. `assistant_events` начинает заполняться
8. `assistant_daily_usage` начинает заполняться
9. `assistant_sessions` хранит `pending_action` и `recent_turn_summaries`

## Smoke checklist

### Session/runtime

- создаётся `assistant_sessions` запись
- сохраняется `sessionId`
- follow-up запросы используют тот же session context

### Actions

- add meal не записывает еду без подтверждения
- delete meal не удаляет без подтверждения
- edit meal не меняет без подтверждения
- ambiguous delete/edit отдаёт candidate selection

### Usage policy

- free user получает usage state
- free user получает `429 assistant_limit_reached` после исчерпания лимита
- premium/trial user не ограничен этими лимитами

### Observability

- `assistant_events` пишет:
  - `assistant_turn`
  - `assistant_action`
  - `confirmation_requested`
  - `confirmed`
  - `clarification`
  - `limit_reached`
  - `error`

## Что считать финальным состоянием

Новый assistant runtime можно считать доведённым до production-ready baseline, если:

- deprecated Assistants API больше не используется
- основным runtime является Responses API
- iOS работает только через structured assistant flow
- free/premium различаются лимитами, а не качеством logic path
- session memory хранится на backend
- assistant actions проходят только через explicit confirmation
- есть audit trail и usage tracking
