# Дорожная карта исправлений — Synergy B2B Portal

## Этап 1: Quick Wins — Критические P0 (100% Выполнено и задеплоено в продакшн)

- [x] 1.1 Заблокировать Edge Function `create-order` (`verify_jwt = true`, строгий CORS)
- [x] 1.2 Удалить хардкод секретов из `api/erp.ts` и `supabase/functions/create-order/index.ts`
- [x] 1.3 Добавить `/api/outbox/sync` в Vercel Cron (`vercel.json`)
- [x] 1.4 Исправить баг `displaySettingsCache` — вынесен на module scope
- [x] 1.5 Исправить баг `serverKey` → `SERVER_ERP_KEY`
- [x] 1.6 Закрыть IDOR: обязательная аутентификация на `client_debt`/`orders`
- [x] 1.7 Исправить client-token scope bypass (проверка `partnerId`)
- [x] 1.8 Добавить CHECK constraints на денежные/количественные колонки (`20260929000100_add_check_constraints.sql`)
- [x] 1.9 Ограничение размера request body на webhook/API endpoints (10MB limit)
- [x] 1.10 Авторизация на `/api/health` (разделено на public статус и internal диагностику)

## Этап 2: Стабилизация P1 (100% Выполнено и задеплоено)

- [x] 2.1 Circuit Breaker в `callERP()` (`api/lib/circuitBreaker.ts` с fast-fail и автономной буферизацией в Outbox)
- [x] 2.4 Усиление паролей (минимум 8 символов, блокировка `123456` и окончаний телефонов)
- [x] 2.5 Добавить `version` column для optimistic locking (`orders`, `products`, `product_variants`)
- [x] 2.6 Перемещение и подготовка CI/CD конфигурации (`scripts/github-actions-ci.yml`)
- [x] 2.7 Добавить недостающие индексы в БД (`20260929000200_add_version_and_indexes.sql` и `full_schema.sql`)

## Этап 3: Масштабирование и оптимизация (100% Выполнено и задеплоено)

- [x] 3.1 React.lazy + code splitting (`src/App.tsx` с `Suspense` и `PageLoadingFallback`)
- [x] 3.2 Оптимизация отображения каталога (бесконечный скролл с IntersectionObserver и windowing по 12 элементов)
- [x] 3.3 Партиционирование audit logs (`20260929000300_partition_audit_logs.sql`)
- [x] 3.4 OpenTelemetry / Structured JSON logging (`api/lib/logger.ts` с correlation IDs и уровнями важности)
- [x] 3.5 Интеграция structured logger в `api/audit/logs.ts`, `api/lib/circuitBreaker.ts`, `api/outbox/sync.ts`, `api/cron/expire-holds.ts`, `api/webhooks/clients.ts`, `api/webhooks/stock_event.ts`
- [x] 3.6 Автоматическая эскалация алертов Dead Letter Queue (DLQ)
- [x] 3.7 Безопасность и лимиты входящих вебхуков 1С (`stock_event.ts`, `clients.ts`)
- [x] 3.8 Мгновенное высвобождение складских остатков по Supabase Realtime при аннулировании холдов
- [x] 3.9 Мультивалютность (`USD` / `KZT`) и переключатель валют в шапке сайта (`CurrencyContext.tsx`, `Header.tsx`)
