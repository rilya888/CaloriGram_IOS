# План полной переделки AI-анализа калорий и БЖУ (V2)

Дата: 2026-04-15  
Статус: Approved for implementation  
Область: `supabase/functions`, iOS API contract, data/migrations, observability

## Статус реализации (живой)

1. ✅ Этап A.1: locale registry и базовые словари ошибок (`en/ru/it`) добавлены.
2. ✅ Этап A.2: cost ledger и run-logging добавлены (`ai_usage_monthly`, `ai_analysis_runs`).
3. ✅ Этап A.3: `POST /analysis/v2` реализован.
4. ✅ Этап A.4: бюджет `$1/user/month` enforced на backend.
5. ✅ Этап A.5: photo ephemeral audit + cleanup function добавлены.
6. ✅ Этап B.1 (частично): deterministic ingredient resolver подключен к V2.
7. ✅ Этап B.1 (дополнительно): endpoint для сбора корректировок `/analysis/v2/feedback` добавлен.
8. ✅ Этап B.2 (первый проход): подключены provider adapters USDA/OFF + source-priority lookup + cache.
9. ✅ Этап C (частично): добавлен `POST /analysis/v2/shadow` для canary/shadow сравнения.
10. ✅ Добавлены operational scripts: `scripts/deploy-analysis-v2.sh` и `scripts/smoke-analysis-v2.sh`.
11. ✅ Добавлены unit-тесты и test-runner: `nutrition-resolver.test.ts`, `scripts/test-nutrition-v2.sh`.
12. ✅ Добавлен CI workflow для Deno-тестов: `.github/workflows/nutrition-analysis-v2-tests.yml`.
13. ✅ Исправлен публичный доступ к `/auth/register|/auth/login`: добавлен `supabase/config.toml` (`[functions.api] verify_jwt = false`) + deploy с `--no-verify-jwt`.
14. ✅ Добавлен fail-open для budget/usage слоя до применения миграций (fallback без падения API при отсутствии таблиц).
15. ✅ Добавлен диагностический endpoint `GET /analysis/v2/health` для проверки runtime readiness и версий анализа.
16. ✅ Исправлена JSON schema для Responses API strict-mode (nullable поля + полный `required`) — `analysis/v2` успешно работает.
17. ✅ Smoke validation на проде пройдена: `analysis/v2`, `analysis/v2/budget`, `analysis/v2/feedback` (с fallback warning до миграций).
18. ✅ Миграция `20260415090000_create_ai_analysis_cost_tables.sql` применена на remote БД.
19. ✅ Post-migration validation: `feedback` сохраняется штатно, `budget` отражает фактический накопленный расход.
20. ✅ Добавлен photo preprocessing pipeline: data-url/base64 normalizer, MIME allowlist, payload-size guardrail.
21. ✅ Добавлена model routing стратегия для text/photo (`simple/complex/photo`) через env-конфигурацию.
22. ✅ Добавлен canary rollout для `/analysis/v2`: auto-shadow sampling + forced override header `x-analysis-shadow`.
23. ✅ Legacy `/analysis/photo` и assistant photo hooks синхронизированы с новым preprocessing/validation.
24. ✅ Добавлен regression smoke script: `scripts/smoke-analysis-v2-regression.sh` (locale + shadow + invalid-photo cases).
25. ✅ Проверен `assistant/turn` после миграции: добавление еды работает через V2-анализ с confirmation flow.
26. ✅ i18n вынесен в отдельный словарный модуль `locale-dictionaries.ts` (готово к расширению локалей без правок core).
27. ✅ Этап C (migration) закрыт: legacy endpoints и assistant runtime стабильно работают на V2-пайплайне.
28. ✅ Этап D (optimization) закрыт по backend-ядру: model routing, image guardrails, canary/shadow rollout, regression smoke.
29. ✅ Добавлен golden dataset + evaluator (`scripts/data/analysis-v2-golden.json`, `scripts/eval-analysis-v2-golden.sh`) с порогами MAE/MAPE/schema/locale.
30. ✅ Golden evaluator выполнен на проде: `schema_valid_rate=1`, `locale_mismatch_rate=0`, MAE/MAPE по dataset в целевых пределах.
31. ✅ Добавлен CI workflow для регулярной golden-проверки: `.github/workflows/nutrition-analysis-v2-golden.yml`.
32. ✅ Добавлен admin endpoint наблюдаемости `GET /analysis/v2/metrics` (success/error/cost/confidence breakdown).
33. ✅ `GET /analysis/v2/metrics` валидирован в проде для non-admin (403) и admin (200 + агрегаты).

## 1. Цели

1. Обеспечить корректный и воспроизводимый расчет калорий/БЖУ для text и photo.
2. Перейти с форматированного текста + regex на строго типизированный JSON schema output.
3. Всегда отвечать на языке запроса пользователя.
4. Подготовить архитектуру к масштабируемому добавлению языков через словари.
5. Ввести жесткий контроль затрат: максимум `$1` на пользователя в месяц.
6. Реализовать политику быстрого удаления фото (ephemeral handling).

## 2. Принципы архитектуры

1. **LLM отвечает за интерпретацию**, детерминированный слой отвечает за финальный расчет/валидацию.
2. **Единый контракт V2** для text/photo/multimodal.
3. **Versioned everything**: prompt/schema/resolver/dictionaries/nutrition snapshots.
4. **Locale-first pipeline**: язык определяется до анализа и передается во все этапы.
5. **Fail-safe**: при низкой уверенности возвращаются warnings + fallback, без silent ошибок.

## 3. Стратегия данных питания (EU + US)

1. **Primary source**: USDA FoodData Central (базовые продукты и ингредиенты).
2. **Secondary branded source**: Open Food Facts (EU/US) с quality-фильтрами.
3. **Internal canonical layer**:
   - алиасы продуктов (синонимы, локальные названия),
   - нормализация единиц,
   - типовые порции,
   - маппинг между внешними источниками.
4. Приоритет: Internal canonical mapping -> USDA -> OFF (если quality score >= threshold).
5. Для каждого расчета сохранять `nutrition_db_snapshot_version`.

## 4. Новый API контракт

1. Новый endpoint: `POST /analysis/v2`.
2. Режимы: `text | photo | multimodal`.
3. Ответ JSON:
   - `ok`, `analysis_id`, `input_type`, `locale`,
   - `dish_display_name`,
   - `items[]` (ingredient-level),
   - `totals` (`calories`, `protein`, `fat`, `carbs`, `weight_g`),
   - `confidence` (`overall`, optional by item),
   - `assumptions[]`, `warnings[]`,
   - `error_code`/`error_message`.
4. Старые endpoint-ы `/analysis/text` и `/analysis/photo` остаются как адаптеры на V2.

## 5. Промты V2

1. Разделить на блоки:
   - `core_policy`,
   - `input_mode_policy`,
   - `language_policy`,
   - `error_policy`.
2. Убрать требование визуального форматирования ответов (emoji/bullets).
3. Использовать Responses API `json_schema` (`strict=true`).
4. Для photo добавить поля:
   - `portion_basis`,
   - `visual_cues[]`,
   - `assumptions[]`.

## 6. Расчет БЖУ (детерминированный слой)

1. Расчет ведется от `items[]`, а не от “общей оценки блюда”.
2. Нормализация единиц и объема в граммы/мл.
3. Проверки физической реалистичности:
   - `protein + fat + carbs <= 100g / 100g`,
   - Atwater consistency (допуск),
   - диапазоны порций по типу продукта.
4. Если confidence низкий:
   - conservative fallback,
   - warnings в ответе.

## 7. Мультиязычность и словари

1. Ввести `locale registry`:
   - `supported_locales`,
   - fallback chain (`xx-YY -> xx -> en`).
2. Вынести в словари:
   - user-facing ошибки,
   - названия метрик и единиц,
   - alias-слои для продуктов.
3. Добавление нового языка:
   - новый словарь,
   - alias mapping,
   - locale regression tests,
   - без правок core-логики.

## 8. Контроль затрат ($1/user/month)

1. Ввести `ai_usage_monthly`:
   - `user_id`, `period_start`,
   - `usd_spent`, `request_count`,
   - `text_count`, `photo_count`,
   - `input_tokens`, `output_tokens`.
2. Ввести `ai_analysis_runs`:
   - trace каждого анализа,
   - model, tokens, estimated_cost, versions, locale.
3. Enforce budget:
   - hard cap при превышении `$1`/месяц,
   - мягкие предупреждения на 50/80/100%.
4. Модельная маршрутизация:
   - дешевые модели для простого text,
   - более дорогой маршрут только при необходимости.

## 9. Политика фото (быстрое удаление)

1. Фото не хранится долгосрочно.
2. Опциональный ephemeral storage с TTL (по умолчанию 24ч или меньше).
3. Авто-очистка по расписанию.
4. В постоянных таблицах хранить только результат анализа и метаданные без raw image.

## 10. Тестирование и метрики

1. Golden datasets:
   - text,
   - photo,
   - multilingual.
2. Тесты:
   - schema contract,
   - locale behavior,
   - unit conversion,
   - budget enforcement.
3. Метрики:
   - schema valid rate,
   - parse/analysis success rate,
   - MAE/MAPE kcal и макро,
   - language mismatch rate,
   - cost per user/month.

## 11. Этапы реализации

### Этап A (foundation)
1. Добавить locale registry + словари сообщений.
2. Добавить cost ledger таблицы и сервис контроля бюджета.
3. Добавить `analysis/v2` endpoint на JSON schema.
4. Включить журнал `ai_analysis_runs`.

### Этап B (quality)
1. Добавить детерминированный nutrition resolver от ingredient-level.
2. Подключить primary/secondary nutrition sources.
3. Включить строгие валидации реалистичности.

### Этап C (migration)
1. Перевести `/analysis/text` и `/analysis/photo` на адаптер V2.
2. Перевести assistant runtime на V2-результаты.
3. Включить canary rollout + shadow сравнения.

### Этап D (optimization)
1. Оптимизация latency/cost.
2. Улучшение photo preprocessing.
3. Расширение локалей через словари.

## 12. Definition of Done

1. Все анализы возвращают валидный JSON schema.
2. Язык ответа соответствует языку запроса.
3. Лимит `$1`/user/month` enforced` на backend.
4. Фото не хранится дольше TTL.
5. Старые endpoint-ы работают через адаптер V2 без регрессий.
6. Все новые комментарии в коде — только на английском.

## 13. TODO перед production

1. Добавить GitHub Actions secrets для nightly golden evaluation:
   - `ANALYSIS_API_BASE_URL`
   - `ANALYSIS_AUTH_EMAIL`
   - `ANALYSIS_AUTH_PASSWORD`
2. Включить nightly workflow `.github/workflows/nutrition-analysis-v2-golden.yml` и проверить первый успешный прогон.
3. Расширить golden dataset фото-кейсами (минимум 20 кейсов EU/US) для контроля drift качества photo-анализа.
4. Проверить, что `ANALYSIS_SHADOW_PERCENT` в production выставлен в целевое значение rollout (а не `0` по умолчанию).
5. Зафиксировать production значения env-переменных analysis-контура в runbook (budget/models/shadow/image limits).
