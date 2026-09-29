# 📊 Руководство по мониторингу, алертам и окружениям (Grafana, Telegram, Dev/Stage/Prod)

## 1. Метрики и дашборды Grafana / Supabase

Все события интеграции, задержки вызовов 1C:ERP и ошибки автоматически логируются в таблицу `integration_audit_logs`.

### 1.1. Задержка вызовов 1С:ERP (p50, p95, p99)
```sql
SELECT
  date_trunc('hour', created_at) AS time_bucket,
  percentile_cont(0.50) WITHIN GROUP (ORDER BY latency_ms) AS p50_latency_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_latency_ms,
  percentile_cont(0.99) WITHIN GROUP (ORDER BY latency_ms) AS p99_latency_ms
FROM integration_audit_logs
WHERE direction = 'outbound'
  AND created_at > now() - interval '24 hours'
GROUP BY 1
ORDER BY 1;
```

### 1.2. Пропускная способность и статус заказов (Throughput)
```sql
SELECT
  date_trunc('hour', created_at) AS time_bucket,
  count(*) FILTER (WHERE status = 'confirmed') AS confirmed_orders,
  count(*) FILTER (WHERE status = 'pending') AS buffered_outbox_orders,
  count(*) FILTER (WHERE status = 'failed_dlq') AS dlq_failed_orders
FROM orders
WHERE created_at > now() - interval '24 hours'
GROUP BY 1
ORDER BY 1;
```

### 1.3. Глубина очереди сбоев DLQ
```sql
SELECT
  count(*) AS total_dlq_orders,
  coalesce(sum(total_amount), 0) AS total_dlq_amount_usd,
  max(created_at) AS latest_dlq_event
FROM orders
WHERE status = 'failed_dlq';
```

---

## 2. Стек алертинга (Telegram Bot & WhatsApp)

Модуль `api/lib/alerting.ts` активируется автоматически при следующих событиях:

| Триггер | Уровень | Канал | Описание |
|---|---|---|---|
| **Circuit Breaker OPEN** | `CRITICAL` | Telegram, WhatsApp | 5 сбоев ERP подряд. Все запросы переведены в автономный кэш |
| **Order Moved to DLQ** | `CRITICAL` | Telegram, WhatsApp | Заказ исчерпал 5 попыток отправки через Outbox worker |
| **Reconciliation Drift** | `WARNING` | Telegram | Расхождение остатков или баланса > порога |
| **Circuit Probe Failed** | `WARNING` | Telegram | Неудачный тестовый запрос в состоянии HALF_OPEN |

### Необходимые переменные окружения:
* `TELEGRAM_BOT_TOKEN`: токен бота от `@BotFather`
* `TELEGRAM_ALERTS_CHAT_ID`: ID приватного инженерного канала/чата
* `ADMIN_WHATSAPP_PHONE`: номер дежурного администратора для WhatsApp-шлюза

---

## 3. Изоляция окружений (T-23: Dev / Staging / Production)

Для исключения случайной модификации боевых данных:

1. **Базы данных Supabase:**
   * `synergy-portal-dev`: локальная разработка и функциональное тестирование
   * `synergy-portal-stage`: интеграционные тесты с тестовой базой 1С
   * `synergy-portal-prod`: боевой контур

2. **Vercel Environments:**
   * **Production:** привязан к ветке `main`
   * **Preview:** привязан к PR с ограничением CORS `*.synergy-b2b-portal.vercel.app`
   * **Development:** локальный запуск через `.env.local`

3. **Секреты:**
   * Боевые ключи `ERP_API_KEY`, `PORTAL_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY` настраиваются **исключительно** через Vercel Dashboard (Project Settings → Environment Variables).
