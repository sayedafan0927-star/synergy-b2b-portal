# 🏢 Synergy B2B Portal (Синергия Оптовый Портал)

> Высоконагруженная отказоустойчивая B2B-платформа для оптовых дилеров, региональных (РМ) и локальных менеджеров (ЛМ) группы компаний **Synergy** (ковровые изделия и напольные покрытия).

[![Production](https://img.shields.io/badge/Production-b2b.synergy.kz-emerald.svg)](https://b2b.synergy.kz)
[![Resilience Tests](https://img.shields.io/badge/Enterprise%20Tests-134%20Passing-brightgreen.svg)](scripts/test_resilience_and_security.py)
[![Architecture Bar](https://img.shields.io/badge/Architecture%20Score-Enterprise%20Grade-blue.svg)](docs/standards/README.md)

---

## 🚀 Ключевые возможности и архитектурные решения

1. **RugsUSA Pattern для коврового бизнеса**:
   - Размерная кластеризация (`size_cluster`: S, M, L, XL, RUNNER, OVERSIZE);
   - Учет геометрии рулонных дорожек (`is_runner`, расчет погонных и м²);
   - Золотые правила рендеринга ковров без обрезки узора (`object-contain` + `aspect-[4/5]`);
   - Устранение прыжков цен в каталоге (`mt-auto`).

2. **Безопасность Zero-Trust**:
   - Полная защита от IDOR: идентификация исключительно из сессионного токена (`authGuard.ts`);
   - Anti-Tamper Pricing Guard: серверный перерасчет цен и скидок из мастер-таблиц;
   - Строгий белый список CORS (`b2b.synergy.kz`).

3. **Отказоустойчивость при сбоях ERP (Autonomous Resilience)**:
   - Двухуровневый Circuit Breaker (L1 Fast In-Memory + L2 Redis);
   - Таймаут 2.5с на вызовы ERP с мгновенным переключением в автономный буфер;
   - Outbox Pattern (`api/outbox/sync.ts`) для гарантированной фоновой доставки заказов в 1C:ERP;
   - Атомарный чекаут в PostgreSQL (`create_order_atomic`) с упорядоченной блокировкой по SKU (`ORDER BY sku FOR UPDATE`) для предотвращения дедлоков.

4. **Offline-First клиентский опыт**:
   - PWA Service Worker для кэширования статики и каталога;
   - Локальная очередь оффлайн-заказов с автоматической синхронизацией при появлении сети;
   - Быстрый токенизированный поиск по каталогу со временем отклика быстрее 50 мс.

---

## 📚 Архитектурные стандарты и документация

В проекте действует строгая система стандартов разработки, исключающая снижение планки качества и деградацию архитектуры:

| Документ | Содержание |
|---|---|
| 🏛️ [**Главный архитектурный манифест**](docs/standards/README.md) | 5 столпов надежности Synergy и матрица скоринга (Quality Scorecard). |
| 🎨 [**Стандарты фронтенда и UI/UX**](docs/standards/FRONTEND_STANDARDS.md) | Компонентная модель, лимит 400 строк, правила RugsUSA и тач-эргономика. |
| ⚙️ [**Стандарты Backend API и безопасности**](docs/standards/BACKEND_API_STANDARDS.md) | Serverless-функции, Anti-IDOR, Anti-Tamper, атомарность и Circuit Breaker. |
| 🗄️ [**Стандарты базы данных**](docs/standards/DATABASE_STANDARDS.md) | Миграции PostgreSQL/Supabase, GIN-индексы, партиции и WMS-изоляция. |
| 🔌 [**Стандарты интеграции с ERP**](docs/standards/INTEGRATION_STANDARDS.md) | CDC вебхуки с монотонными таймстемпами, Outbox, SSO Magic Link и маскирование. |
| ✅ [**Definition of Done и Code Review**](docs/standards/CODE_REVIEW_AND_DOD.md) | Чеклист приемки, запуск автотестов и регламент автоматического деплоя. |

### Смежные технические спецификации:
- [UI_UX_STANDARDS.md](UI_UX_STANDARDS.md) — детальные правила адаптивности и оформления ковров.
- [docs/ERP_INTEGRATION_SPEC.md](docs/ERP_INTEGRATION_SPEC.md) — спецификация REST API для команды ERP (`kilem-khan.kz`).
- [docs/MONITORING_AND_OBSERVABILITY.md](docs/MONITORING_AND_OBSERVABILITY.md) — руководство по мониторингу Grafana и алертам в Telegram.

---

## 🛠 Технологический стек

- **Frontend**: React 18, TypeScript, Tailwind CSS, Lucide Icons, Vite, PWA Service Worker.
- **Backend / Serverless**: Node.js, Vercel Serverless Functions, TypeScript.
- **База данных**: PostgreSQL 15+ (Supabase) с расширением `pg_trgm` и процедурами PL/pgSQL.
- **Кэш и Rate Limiting**: Upstash Redis REST API + локальный L1 In-Memory Fast Cache.
- **Интеграция**: REST API, HMAC-SHA256 SSO, CDC Webhooks, WhatsApp / Telegram Gateways.

---

## 🧪 Запуск автоматических тестов качества

Перед любым коммитом обязательно запустите весь комплекс автоматических проверок:

```bash
# 1. Запуск 134 проверок устойчивости, безопасности и контрактов API
python3 scripts/test_resilience_and_security.py

# 2. Проверка соответствия стандартам верстки ковров и мобильного взаимодействия
python3 scripts/check-ui-standards.py
```

---

## 🚢 Автоматический деплой

Любой коммит, отправленный в ветку `main`, автоматически разворачивается на боевой среде Vercel:
```bash
git add .
git commit -m "feat(scope): descriptive message"
git push origin main
```
