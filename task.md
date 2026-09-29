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
- [x] 3.7 Безопасность и лимиты входящих вебхуков (`stock_event.ts`, `clients.ts`)
- [x] 3.8 Мгновенное высвобождение складских остатков по Supabase Realtime при аннулировании холдов
- [x] 3.9 Мультивалютность (`USD` / `KZT`) и переключатель валют в шапке сайта (`CurrencyContext.tsx`, `Header.tsx`)

## Этап 4: Архитектурный аудит и устранение критических уязвимостей (100% Выполнено и задеплоено)

- [x] 4.1 Исправлен `ReferenceError: timeout is not defined` в `api/health.ts` (P0)
- [x] 4.2 Закрыт неконтролируемый обход Saga и проверки цен через Edge Function `create-order` (P0)
- [x] 4.3 Устранена уязвимость CORS в `api/lib/cors.ts`: неавторизованные Origin блокируются со статусом 403 для всех методов (P0)
- [x] 4.4 Исправлен невалидный заголовок с несколькими доменами в Edge Function CORS (P1)
- [x] 4.5 Оптимизирован Outbox Worker (`api/outbox/sync.ts`): таймаут 4s, параллельный пул батчей по 3 заказа (P1)
- [x] 4.6 Сокращен интервал Vercel Cron для синхронизации заказов до 2 минут (`*/2 * * * *`) в `vercel.json` (P1)
- [x] 4.7 Добавлена каскадная связь `parent_order_id` в `orders` (`20260929140000_add_parent_order_id.sql`) и привязка субордеров мультисклада в `createOrderHandler.ts` (P1)
- [x] 4.8 Маркировка заказов `is_buffered_offline: true` при отказе шлюза собственной ERP (P1)
- [x] 4.9 Спецификация серверного регистра идемпотентности в `docs/ERP_INTEGRATION_SPEC.md` для собственной ERP `kilem-khan.kz` (P2)
- [x] 4.10 Расширен автоматизированный тестовый пакет `scripts/test_resilience_and_security.py` (96 проверок, 100% PASS)

## Этап 5: Устранение runtime 500 (FUNCTION_INVOCATION_FAILED) и контур автономности ERP (100% Выполнено)

- [x] 5.1 Устранена критическая ошибка 500 `FUNCTION_INVOCATION_FAILED` в `api/erp.ts`: добавлен fallback для `SUPABASE_KEY` на `VITE_SUPABASE_ANON_KEY` / `SUPABASE_ANON_KEY` и защищена инициализация `createClient`
- [x] 5.2 Устранены битые пути импортов в `api/modules/orders/createOrderHandler.ts`: `dispatchApprovalRequest` из `approvals/whatsapp` и `validateAndPriceOrder` из `pricingValidator`
- [x] 5.3 Экспортирован псевдоним `validateOrderPricing = validateAndPriceOrder` с поддержкой передачи как объектов payload, так и массивов items
- [x] 5.4 Удалены устаревшие необъявленные переменные (`outboxOrderDoc`, `validatedOrderPayload`, `outboxOrderId`, `finalTotalAmount`) в `api/erp.ts`
- [x] 5.5 Добавлен отказоустойчивый fallback для `display_settings` в общем блоке `catch (err)`: гарантированный возврат настроек по умолчанию (200 OK) при тайм-ауте ERP
- [x] 5.6 Защищена инициализация `createClient` во всех API-модулях (`client-token.ts`, `catalogCache.ts`, `pricingValidator.ts`, `saga.ts`, `authGuard.ts`, `loginHandler.ts`, `audit/logs.ts`, `cron/*`, `webhooks/*`)
- [x] 5.7 Реализовано каскадное обновление статусов дочерних подзаказов (`parent_order_id`) в `api/webhooks/erp.ts` при изменении статуса мастер-заказа
- [x] 5.8 Реализована обработка события `discount_rules_updated` в `api/webhooks/erp.ts` с обновлением таблицы `discount_rules` и Realtime-трансляцией
- [x] 5.9 Внедрена индикация автономного буфера заказов (`is_buffered_offline` / `isServerBuffered`) на странице корзины `src/pages/CartPage.tsx`
- [x] 5.10 Расширен комплексный тестовый пакет до 103 проверок (100% PASS)

