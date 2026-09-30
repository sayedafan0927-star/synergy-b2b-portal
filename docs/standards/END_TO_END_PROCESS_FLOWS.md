# 🧭 Synergy B2B Portal — Сквозные Бизнес-Процессы и Архитектурные Блок-Схемы

> **Назначение документа**: Данный стандарт содержит детальные сквозные блок-схемы (End-to-End Flowcharts) абсолютно всех бизнес-сценариев платформы «СинЭнергия». Каждый сценарий описывает путь от пользовательского взаимодействия в UI/UX через слой безопасности API и транзакции PostgreSQL/Redis до шлюзов 1С:ERP, очередей Outbox и отказоустойчивых фоллбэков.

---

## Оглавление сценариев

1. [Сценарий 1: Аутентификация, SSO из 1С:ERP и Безопасная Имперсонация](#1-сценарий-1-аутентификация-sso-из-1серр-и-безопасная-имперсонация)
2. [Сценарий 2: Поиск, Каталог, Кластеризация RugsUSA и Расчёт Договорных Цен](#2-сценарий-2-поиск-каталог-кластеризация-rugsusa-и-расчёт-договорных-цен)
3. [Сценарий 3: Корзина, Мультисклад, Валидация Кредитного Плеча и Атомарный Чекаут](#3-сценарий-3-корзина-мультисклад-валидация-кредитного-плеча-и-атомарный-чекаут)
4. [Сценарий 4: Синхронизация с 1С:ERP, Outbox Worker, Saga Rollback и DLQ](#4-сценарий-4-синхронизация-с-1серр-outbox-worker-saga-rollback-и-dlq)
5. [Сценарий 5: Двустороннее Согласование Заказов через WhatsApp](#5-сценарий-5-двустороннее-согласование-заказов-через-whatsapp)
6. [Сценарий 6: Удержание и Автоотмена Просроченных Броней WMS (Hold TTL)](#6-сценарий-6-удержание-и-автоотмена-просроченных-броней-wms-hold-ttl)
7. [Сценарий 7: Финансовая Сверка, Поступление Оплат и Разблокировка Дилеров](#7-сценарий-7-финансовая-сверка-поступление-оплат-и-разблокировка-дилеров)
8. [Сценарий 8: Кабинет Поставщика, Рекламации и Оприходование Поступлений](#8-сценарий-8-кабинет-поставщика-рекламации-и-оприходование-поступлений)
9. [Сценарий 9: Умный Повтор Заказа из Истории с Мультискладским Подбором](#9-сценарий-9-умный-повтор-заказа-из-истории-с-мультискладским-подбором)

---

## 1. Сценарий 1: Аутентификация, SSO из 1С:ERP и Безопасная Имперсонация

### 1.1. Архитектурная блок-схема

```mermaid
flowchart TD
    Start(["Вход в систему"]) --> InputCheck{"Тип авторизации"}

    %% Обычный логин
    InputCheck -->|"Логин / Пароль / Телефон"| NormalLogin["Форма входа (/login)"]
    NormalLogin --> LoginAPI["POST /api/auth/session"]
    LoginAPI --> CheckBlock1{"is_blocked_for_shipment в profiles?"}
    CheckBlock1 -->|"Да"| BlockedErr["403 Forbidden: Доступ заблокирован 1С"]
    CheckBlock1 -->|"Нет"| GenHMAC["Генерация HMAC 24h токена"]
    GenHMAC --> SaveStore["Сохранение сессии в localStorage"]

    %% SSO из 1C
    InputCheck -->|"Переход из 1С:ERP"| SSOEntry["GET /api/auth/verify-sso?token=..."]
    SSOEntry --> VerifySSOHMAC{"Валидация подписи HMAC и TTL"}
    VerifySSOHMAC -->|"Невалиден / Истёк"| SSODenied["401 Unauthorized: Токен недействителен"]
    VerifySSOHMAC -->|"Валиден"| CheckRedisRevoke{"Ключ revoked_partner в Redis?"}
    CheckRedisRevoke -->|"Да"| BlockedErr
    CheckRedisRevoke -->|"Нет"| IssueClientToken["Выпуск клиентского токена и редирект в портал"]
    IssueClientToken --> SaveStore

    %% Имперсонация
    SaveStore --> RoleRouter{"Роль пользователя"}
    RoleRouter -->|"client"| ClientUI["Каталог дилера с персональными ценами"]
    RoleRouter -->|"admin / manager_rm / manager_lm"| AdminUI["Панель управления / Список дилеров"]

    AdminUI --> ImpersonateAction["Клик: 'Войти под дилером X'"]
    ImpersonateAction --> ImpersonateState["AuthContext: effectiveProfile = clientProfile\nisImpersonating = true"]
    ImpersonateState --> ShowBanner["Показ желтого баннера имперсонации в шапке"]
    ShowBanner --> ClientUI
```

### 1.2. Архитектурные инварианты и UI/UX сценарии
1. **Разделение прав при имперсонации**:
   - `effectiveProfile` отображает данные выбранного дилера (цены по его договору, его лимиты, его шоурум).
   - При оформлении заказа `createOrderHandler.ts` передаёт:
     - `user_id = rawPayload.user_id` (дилер);
     - `placed_by_id = callerAuth.userId` (менеджер/админ).
   - В UI шапки отображается плашка: «Вы просматриваете портал от имени [Компания Дилера]» с кнопкой «Вернуться в панель управления».
2. **Мгновенный сессионный отзыв (Zero-Trust)**:
   - При блокировке в 1С вызывается вебхук `client_deactivated`, выставляющий `revoked_partner:${partnerId}` в Redis со сроком 24ч и рассылающий Realtime-событие `client_deactivated`.
   - Клиентский браузер перехватывает событие и немедленно сбрасывает сессию с редиректом на экран логина.

---

## 2. Сценарий 2: Поиск, Каталог, Кластеризация RugsUSA и Расчёт Договорных Цен

### 2.1. Архитектурная блок-схема

```mermaid
flowchart TD
    UserCatalog["Пользователь открывает Каталог (/catalog)"] --> CacheCheck{"L1 In-Memory / L2 Redis кэш свеж?"}

    CacheCheck -->|"HIT (< 60с)"| ServeCache["Мгновенная отдача каталога (sub-20ms)"]
    CacheCheck -->|"MISS / Истёк"| FetchERP["GET 1C:ERP ?action=catalog"]
    FetchERP --> CompactPayload["Компактизация каталога (compactCatalogPayload < 4.5MB)"]
    CompactPayload --> SaveL1L2["Запись в L1 Memory и L2 Redis (TTL 300с)"]
    SaveL1L2 --> ServeCache

    ServeCache --> ClientFilter["Клиентский движок фильтрации (sub-50ms)"]
    ClientFilter --> ClusterGrouping["Кластеризация RugsUSA:\nS, M, L, XL, RUNNER, OVERSIZE"]
    ClientFilter --> WarehouseFilter["Фильтрация видимости складов:\nЦентральный (81) + Шоурум + Допущенные"]

    WarehouseFilter --> PriceEngine["B2B Pricing Engine (src/lib/pricingEngine.ts)"]
    PriceEngine --> ContractDiscount{"Тип договора дилера"}
    ContractDiscount -->|"Стандарт"| BasePrice["0% скидки (Базовая цена 1С)"]
    ContractDiscount -->|"Опт-1"| Disc10["-10% скидка"]
    ContractDiscount -->|"Опт-2"| Disc15["-15% скидка"]
    ContractDiscount -->|"Опт-3"| Disc20["-20% скидка"]
    ContractDiscount -->|"VIP"| Disc25["-25% скидка"]

    BasePrice --> FxConvert["Конвертация валют (CurrencyContext)"]
    Disc10 --> FxConvert
    Disc15 --> FxConvert
    Disc20 --> FxConvert
    Disc25 --> FxConvert

    FxConvert --> RenderCard["Рендеринг карточки товара ProductCard"]
    RenderCard --> ProportionsGuard["Защита пропорций:\naspect-[4/5] + object-contain\n(запрет object-cover)"]
    ProportionsGuard --> QuickSizesPopover["Поповер быстрого выбора размеров и остатков"]
```

### 2.2. Архитектурные инварианты и UI/UX сценарии
1. **Геометрическая целостность (Столп 4)**:
   - Никаких обрезанных ковров: свойство `object-contain` строго обязательно для всех превью и галерей.
   - Размерный ряд отображается через кластеры (S, M, L, XL, Дорожка, Оверсайз).
2. **Realtime-актуализация курсов валют**:
   - `CurrencyContext` слушает событие `currency_rate_updated` из Realtime канала `portal_live_updates`. При изменении курса валют в 1С все ценники пересчитываются моментально без перезагрузки страницы.

---

## 3. Сценарий 3: Корзина, Мультисклад, Валидация Кредитного Плеча и Атомарный Чекаут

### 3.1. Архитектурная блок-схема

```mermaid
flowchart TD
    CartOpen["Переход в корзину (/cart)"] --> GroupWarehouses["Группировка позиций по складам:\n81 Астана, 82 Алматы, 83 Шымкент, 84 Караганда"]
    GroupWarehouses --> MultiNotice{"В корзине > 1 склада?"}
    MultiNotice -->|"Да"| ShowMultiBadge["Показ баннера: Заказ из N складов (отдельные накладные)"]
    MultiNotice -->|"Нет"| SingleBadge["Стандартный заказ"]

    ShowMultiBadge --> ExposureCheck["Проверка кредитного лимита и задолженности"]
    SingleBadge --> ExposureCheck

    ExposureCheck --> CalcExposure["totalExposure = currentDebt + newOrderTotal"]
    CalcExposure --> OverdueCheck{"Есть просрочка или is_blocked?"}
    OverdueCheck -->|"Да"| SetApprovalBlocked["requiresApproval = true (Красный алерт: Требуется согласование отгрузки)"]
    OverdueCheck -->|"Нет"| LimitCheck{"totalExposure > creditLimit?"}
    LimitCheck -->|"Да"| SetApprovalLimit["requiresApproval = true (Желтый алерт: Превышение кредитного лимита)"]
    LimitCheck -->|"Нет"| GreenLight["requiresApproval = false (Зеленый коридор)"]

    SetApprovalBlocked --> SubmitOrder["Нажатие: 'Подтвердить и отправить заказ'"]
    SetApprovalLimit --> SubmitOrder
    GreenLight --> SubmitOrder

    SubmitOrder --> NetworkCheck{"Сеть доступна?"}
    NetworkCheck -->|"Оффлайн"| EnqueuePWA["PWA: сохранение в Offline Queue (IndexedDB)"]
    NetworkCheck -->|"Онлайн"| SendAPI["POST /api/erp?action=create_order"]

    SendAPI --> AntiTamper["Server Anti-Tamper Pricing Guard (pricingValidator.ts)"]
    AntiTamper --> CheckPrices{"Цены клиента совпадают с базой?"}
    CheckPrices -->|"Подделка"| RejectTamper["400 Bad Request: PRICE_TAMPER_DETECTED"]
    CheckPrices -->|"Корректно"| AtomicRPC["PostgreSQL RPC: create_order_atomic"]

    AtomicRPC --> LockStock["SELECT FOR UPDATE на inventory_balances"]
    LockStock --> StockAvailable{"Свободный остаток >= запрошенного?"}
    StockAvailable -->|"Недостаточно"| Abort409["409 Conflict: INSUFFICIENT_STOCK (Откат транзакции)"]
    StockAvailable -->|"Достаточно"| ReserveStock["free_stock -= qty\nreserved_stock += qty"]
    ReserveStock --> InsertMaster["Вставка мастер-заказа в orders"]
    InsertMaster --> InsertSuborders["Вставка подзаказов мультисклада (parent_order_id = master.id)"]
    InsertSuborders --> CheckApprovalNeed{"requiresApproval == true?"}
    CheckApprovalNeed -->|"Да"| TriggerWhatsApp["Отправка запроса в WhatsApp менеджеру"]
    CheckApprovalNeed -->|"Нет"| DispatchSync["Переход к синхронизации с ERP (Сценарий 4)"]
    TriggerWhatsApp --> DispatchSync
```

### 3.2. Архитектурные инварианты и UI/UX сценарии
1. **Сохранение физического метража при скидках**:
   - `finalTotalSqm` вычисляется строго из `it.area_sqm * it.quantity` (геометрические параметры ковра), а не обратным делением со скидочной цены на базовую стоимость кв.м.
2. **Атомарность транзакции**:
   - Создание мастер-заказа, субордеров мультисклада и блокировка складских остатков выполняются в единой транзакции базы данных. При нехватке хотя бы 1 артикула ни один заказ не сохраняется.

---

## 4. Сценарий 4: Синхронизация с 1С:ERP, Outbox Worker, Saga Rollback и DLQ

### 4.1. Архитектурная блок-схема

```mermaid
flowchart TD
    OrderCreated["Заказ создан и зарезервирован в БД"] --> FastSync["Быстрый запрос в 1С: POST ?action=create_order (тайм-аут 2.5с)"]

    FastSync --> ErpResponse{"Ответ 1С:ERP"}

    %% Успех
    ErpResponse -->|"200 OK success: true"| HandleSuccess["Обновление: status = 'processing'\nПроставление номеров накладных 1С маске и подзаказам"]
    HandleSuccess --> RespSuccess["200 OK клиенту с номерами накладных"]

    %% 409 Конфликт остатков
    ErpResponse -->|"409 Conflict / INSUFFICIENT_STOCK"| SagaRollback["Compensating Saga Rollback:\n1. release_order_reservations\n2. orders.status = 'cancelled'\n3. reservations_released = true"]
    SagaRollback --> InvalidateCache["Инвалидация кэша остатков и бродкаст в браузеры"]
    InvalidateCache --> Resp409["409 Conflict: Товар перехвачен другим покупателем"]

    %% Фатальная бизнес-ошибка
    ErpResponse -->|"400 / 404 / 422 Fatal"| FatalDLQ["Перенос в failed_dlq:\n1. release_order_reservations\n2. reservations_released = true\n3. Alert дежурной смене"]
    FatalDLQ --> RespFatal["422 Error: Отклонено по бизнес-причинам"]

    %% Тайм-аут / Разрыв сети
    ErpResponse -->|"Тайм-аут > 2.5с / Сетевой сбой"| RetainOutbox["Фиксация в Outbox:\nstatus = 'pending'\nnext_retry_at = now() + 5s"]
    RetainOutbox --> RespBuffered["200 OK: Заказ надежно сохранен и отправляется в фоне"]
    RetainOutbox --> TriggerWorker["triggerImmediateOutboxSync (sub-second worker call)"]

    TriggerWorker --> OutboxWorker["api/outbox/sync.ts (Vercel Cron / Immediate Worker)"]
    OutboxWorker --> ClaimRPC["SELECT FOR UPDATE SKIP LOCKED\norders.parent_order_id IS NULL\n(next_retry_at IS NULL OR next_retry_at <= now())"]
    ClaimRPC --> RetryLoop["Попытка отправки заказа в 1С:ERP"]

    RetryLoop --> RetryResult{"Результат ретрая"}
    RetryResult -->|"Успех"| HandleSuccess
    RetryResult -->|"Сбой (retries < 5)"| BackoffSchedule["Экспоненциальный бэкофф:\nnext_retry_at = now() + (5s, 30s, 2m, 10m, 30m)\nretry_count++"]
    RetryResult -->|"Сбой (retries >= 5)"| MoveToDLQ["Превышен лимит ретраев (DLQ):\n1. status = 'failed_dlq' на мастере и субордерах\n2. reservations_released = true\n3. release_order_reservations\n4. dispatchDlqEmergencyAlert"]
```

### 4.2. Архитектурные инварианты и UI/UX сценарии
1. **Защита от утечки резервов (Zero Reservation Leak)**:
   - При отказе 1С (409 Conflict), при фатальной бизнес-ошибке (4xx) и при переводе в `failed_dlq` процедура компенсирующей транзакции Saga возвращает остатки на баланс склада и проставляет `reservations_released: true`.
2. **Каскад на дочерние подзаказы**:
   - При переводе мастер-заказа в `failed_dlq` все подзаказы мультисклада с `parent_order_id = master.id` каскадно обновляются в статус `failed_dlq`.

---

## 5. Сценарий 5: Двустороннее Согласование Заказов через WhatsApp

### 5.1. Архитектурная блок-схема

```mermaid
sequenceDiagram
    autonumber
    participant Portal as Synergy Portal (Frontend / API)
    participant DB as PostgreSQL Database
    participant WA as WhatsApp Gateway
    participant RM as Региональный Менеджер (РМ)
    participant Client as Дилер (Клиент)

    Portal->>DB: Заказ создан (requiresApproval = true)
    Portal->>WA: dispatchApprovalRequest(orderId, amount, reason)
    WA->>RM: WhatsApp сообщение с кнопками [Подтвердить] и [Отклонить]
    Client->>Portal: Экран ожидания согласования в профиле (/profile)

    alt РМ нажимает «Подтвердить» (decision=approve)
        RM->>Portal: GET /api/approvals/action?decision=approve&token=HMAC
        Portal->>Portal: Валидация HMAC подписи и срока токена (24h)
        Portal->>DB: UPDATE orders SET status = 'confirmed' WHERE id = orderId OR parent_order_id = orderId
        Portal->>DB: Отправка события в outbox для выгрузки в 1C:ERP
        Portal-->>RM: Страница с зеленой плашкой: «Заказ успешно подтвержден»
        Portal->>Client: Realtime broadcast: статус изменен на 'confirmed'
    else РМ нажимает «Отклонить» (decision=reject)
        RM->>Portal: GET /api/approvals/action?decision=reject&token=HMAC
        Portal->>Portal: Валидация HMAC подписи и срока токена (24h)
        Portal->>DB: release_order_reservations(orderId)
        Portal->>DB: UPDATE orders SET status = 'cancelled', reservations_released = true WHERE id = orderId OR parent_order_id = orderId
        Portal-->>RM: Страница с красной плашкой: «Заказ отклонен, бронь остатков снята»
        Portal->>Client: Realtime broadcast: статус изменен на 'cancelled'
    end
```

### 5.2. Архитектурные инварианты и UI/UX сценарии
1. **Безопасность токена согласования**:
   - Ссылка подтверждения содержит криптографически подписанный токен HMAC SHA-256 (`generateSignedDecisionToken`), привязанный к ID заказа, решению и сроку экспирации (24 часа). Подделать ссылку невозможно.
2. **Мгновенное каскадное обновление**:
   - При подтверждении или отклонении действие затрагивает и мастер-заказ, и все дочерние субордеры мультисклада.

---

## 6. Сценарий 6: Удержание и Автоотмена Просроченных Броней WMS (Hold TTL)

### 6.1. Архитектурная блок-схема

```mermaid
flowchart TD
    CronTrigger["Vercel Cron: GET /api/cron/expire-holds (раз в час)"] --> AuthCheck{"X-Cron-Key или Bearer Secret валиден?"}
    AuthCheck -->|"Нет"| Return401["401 Unauthorized"]
    AuthCheck -->|"Да"| ExecRPC["Вызов PostgreSQL RPC: cancel_expired_order_holds(50)"]

    ExecRPC --> ScanExpired["Поиск заказов:\nstatus IN ('pending', 'failed_dlq')\nAND parent_order_id IS NULL\nAND (hold_expires_at <= now() OR created_at <= now() - 24h)\nFOR UPDATE SKIP LOCKED"]

    ScanExpired --> ExpiredFound{"Найдены просроченные заказы?"}
    ExpiredFound -->|"Нет"| FinishClean["200 OK: 0 просроченных броней"]

    ExpiredFound -->|"Да"| ReleaseLoop["Для каждого найденного заказа:"]
    ReleaseLoop --> ReleaseStock["PERFORM release_order_reservations(order.id)"]
    ReleaseStock --> CascadeCancelSub["UPDATE orders SET status = 'cancelled',\nreservations_released = true\nWHERE parent_order_id = order.id"]
    CascadeCancelSub --> CancelMaster["UPDATE orders SET status = 'cancelled',\nreservations_released = true\nWHERE id = order.id"]

    CancelMaster --> RealtimeBroadcast["Supabase Realtime Broadcast:\nportal_live_updates -> stock_changed\n(reason: 'wms_hold_expired')"]
    RealtimeBroadcast --> AuditLogEntry["Запись в audit_logs: wms_hold_auto_expiry"]
    AuditLogEntry --> FinishClean
```

### 6.2. Архитектурные инварианты и UI/UX сценарии
1. **Конкурентная изоляция (`SKIP LOCKED`)**:
   - Если параллельно работает другой воркер или заказ редактируется менеджером, `FOR UPDATE SKIP LOCKED` пропускает заблокированные строки, предотвращая взаимные блокировки (deadlocks).
2. **Realtime-возврат на витрину**:
   - Как только бронь снимается, событие транслируется во все открытые вкладки дилеров, возвращая товар в статус «В наличии».

---

## 7. Сценарий 7: Финансовая Сверка, Поступление Оплат и Разблокировка Дилеров

### 7.1. Архитектурная блок-схема

```mermaid
flowchart TD
    Trigger{"Инициатор события"}

    %% Вебхук поступления платежа
    Trigger -->|"Вебхук 1С: payment_received"| WebhookPayment["POST /api/webhooks/erp (action=payment_received)"]
    WebhookPayment --> VerifyHMACWebhook{"Валидация X-Portal-Key"}
    VerifyHMACWebhook -->|"Ошибка"| RejectWebhook["401 Unauthorized"]
    VerifyHMACWebhook -->|"Успех"| CalcBalances["Расчет сальдо: balance_usd и debt_usd"]

    CalcBalances --> SaveBalances["UPSERT partner_balances (balance, currency, last_synced_at)"]
    SaveBalances --> UpdateProfileDebt["UPDATE profiles (debt_usd = calculatedDebt)"]

    UpdateProfileDebt --> CheckUnblock{"Долг погашен (debt == 0)\nили is_blocked_for_shipment == false?"}
    CheckUnblock -->|"Да"| UnblockPartner["UPDATE profiles SET is_blocked_for_shipment = false\nredis.del('revoked_partner:ID')"]
    CheckUnblock -->|"Нет"| KeepStatus["Сохранение текущего статуса блокировки"]

    UnblockPartner --> BroadcastPayment["Realtime Broadcast:\npayment_received (balance, debt, unblocked)"]
    KeepStatus --> BroadcastPayment

    %% Ночная сверка
    Trigger -->|"Ночной крон: reconcile-balances"| NightlyCron["GET /api/cron/reconcile-balances"]
    NightlyCron --> BulkReconcile["GET 1C:ERP ?action=reconcile_all_balances"]
    BulkReconcile --> ReconcileLoop["Сравнение данных 1С и локальной базы"]
    ReconcileLoop --> DiscrepancyCheck{"Есть расхождения по долгу или блокировке?"}

    DiscrepancyCheck -->|"Да"| PatchProfile["Обновление profiles и partner_balances"]
    PatchProfile --> SyncRedisBlock{"is_blocked_for_shipment в 1С?"}
    SyncRedisBlock -->|"true"| RedisBlock["redis.set('revoked_partner:ID', '1', 86400)"]
    SyncRedisBlock -->|"false"| RedisUnblock["redis.del('revoked_partner:ID')"]
    DiscrepancyCheck -->|"Нет"| SkipPartner["Пропуск, данные синхронны"]

    RedisBlock --> SummaryAudit["Запись nightly_reconciliation_summary в аудит"]
    RedisUnblock --> SummaryAudit
    SkipPartner --> SummaryAudit
```

### 7.2. Архитектурные инварианты и UI/UX сценарии
1. **Исключение Deadlock сессий**:
   - При погашении задолженности клиент разблокируется одновременно в Postgres и Redis, что мгновенно снимает ограничение на оформление заказов без необходимости ожидания истечения 24-часового TTL сессии.
2. **Мгновенное обновление шапки дилера**:
   - Событие `payment_received` через Realtime обновляет финансовую плашку в шапке портала: баланс пересчитывается, статус блокировки снимается.

---

## 8. Сценарий 8: Кабинет Поставщика, Рекламации и Оприходование Поступлений

### 8.1. Архитектурная блок-схема

```mermaid
flowchart TD
    SupplierOpen["Поставщик открывает Кабинет (/supplier)"] --> CheckRole{"Роль пользователя == 'supplier'?"}
    CheckRole -->|"Нет"| AccessDenied["403 Forbidden: Доступ только для поставщиков"]
    CheckRole -->|"Да"| LoadTabs["Загрузка вкладок Кабинета Поставщика"]

    LoadTabs --> TabSelect{"Выбор вкладки"}

    %% Вкладка 1: Поступления
    TabSelect -->|"В пути / Поступления"| InboundTab["SupplierInboundTab.tsx"]
    InboundTab --> FilterInbound["Фильтрация поставок по складам:\n81 Астана, 82 Алматы, 83 Шымкент, 84 Караганда"]
    FilterInbound --> SummaryInbound["Сводные карточки: ожидается шт, площадь м², сумма $"]

    %% Вкладка 2: Брак и рекламации
    TabSelect -->|"Брак и рекламации"| DefectsTab["SupplierDefectsTab.tsx"]
    DefectsTab --> DefectList["Просмотр списка актов брака с фото и причинами"]
    DefectList --> NewDefect["Регистрация нового акта рекламации"]
    NewDefect --> UploadPhoto["Загрузка подтверждающих фото дефектов"]
    UploadPhoto --> SaveDefect["Сохранение акта в базе данных (статус: 'under_review')"]

    %% Вкладка 3: Релизы и коллекции
    TabSelect -->|"План производства / Релизы"| ReleasesTab["SupplierReleasesTab.tsx"]
    ReleasesTab --> ViewReleases["Календарный график выхода новых коллекций"]
```

### 8.2. Архитектурные инварианты и UI/UX сценарии
1. **Региональное разделение поставок**:
   - Поставки строго разделяются по региональным складам (81 Астана, 82 Алматы, 83 Шымкент, 84 Караганда), исключая смешение остатков между филиалами.
2. **Прозрачность рекламаций**:
   - Любой зафиксированный брак привязывается к партии и артикулу с возможностью прикрепления фотографий дефектов рулона.

---

## 9. Сценарий 9: Умный Повтор Заказа из Истории с Мультискладским Подбором

### 9.1. Архитектурная блок-схема

```mermaid
flowchart TD
    HistoryClick["Дилер нажимает: 'Повторить заказ' в профиле"] --> LoadOrderItems["Загрузка позиций исходного заказа"]

    LoadOrderItems --> FetchFreshCatalog["Загрузка актуального каталога с ценами и остатками"]
    FetchFreshCatalog --> ScanItems["Для каждой позиции заказа:"]

    ScanItems --> MatchWarehouse{"Товар есть на оригинальном складе?"}
    MatchWarehouse -->|"Да"| AttachOrigWh["Назначение на оригинальный склад позиции"]
    MatchWarehouse -->|"Нет"| SearchOtherWh{"Товар есть на других складах (81-84)?"}
    SearchOtherWh -->|"Да"| AttachAltWh["Назначение на альтернативный склад с ненулевым остатком"]
    SearchOtherWh -->|"Нет"| MarkOutOfStock["Пометка позиции как 'Отсутствует на складах'"]

    AttachOrigWh --> UpdateFreshPrice["Подстановка актуальной договорной цены каталога\n(защита от устаревших цен исторического заказа)"]
    AttachAltWh --> UpdateFreshPrice

    UpdateFreshPrice --> OpenRepeatModal["Открытие RepeatOrderModal"]
    MarkOutOfStock --> OpenRepeatModal

    OpenRepeatModal --> UserConfirm{"Пользователь подтверждает состав?"}
    UserConfirm -->|"Изменить количество"| AdjustQty["Корректировка количества под доступный остаток"]
    AdjustQty --> AddToCartBatch["Пакетное добавление позиций в Корзину"]
    UserConfirm -->|"Подтвердить"| AddToCartBatch

    AddToCartBatch --> RedirectCart["Переход в Корзину (/cart) для финального чекаута"]
```

### 9.2. Архитектурные инварианты и UI/UX сценарии
1. **Защита от устаревших цен**:
   - При повторе заказа исторические цены никогда не подставляются вслепую: они сверяются с актуальным каталогом и договором дилера.
2. **Мультискладская гибкость**:
   - Если позиция ранее заказывалась из Алматы (82), но сейчас доступна только в Астане (81), система автоматически предлагает альтернативный склад с предупреждением в модальном окне.

---

## 10. Матрица UI/UX Состояний и Точек Отказа (Error & Edge Case Matrix)

| Бизнес-процесс | Нормальное состояние (Happy Path) | Точка отказа / Ошибка | Реакция системы (System Behavior) | Отображение в UI/UX |
| :--- | :--- | :--- | :--- | :--- |
| **Оформление заказа** | 200 OK, номер накладной присвоен | Разрыв связи с 1С:ERP | Сохранение в Outbox, запуск фонового воркера | Зеленый баннер: «Заказ принят и надежно сохранен. Синхронизация выполняется в фоне» |
| **Оформление заказа** | Свободного остатка достаточно | 409 Conflict: перехват остатка другим дилером | Compensating Saga: откат резервов, статус `cancelled`, `reservations_released: true` | Красный баннер с точным указанием артикула и фактически доступного остатка |
| **Кредитный контроль** | Долг в пределах лимита | Превышение кредитного лимита или просрочка | Выставление `requiresApproval = true`, отправка в WhatsApp РМ | Желтый/красный информационный блок: «Заказ передан вашему менеджеру на согласование в WhatsApp» |
| **Курс валют** | Курс 520 KZT/USD | Изменение курса в 1С до 530 KZT/USD | Вебхук `currency_rate_updated` транслирует изменение через Realtime | Цены в тенге пересчитываются моментально во всех открытых вкладках без F5 |
| **Имперсонация** | Просмотр каталога под дилером | Оформление заказа менеджером от имени клиента | `user_id = client.id`, `placed_by_id = manager.id` | Желтая плашка в шапке; дилер видит оформленный заказ в своем личном кабинете |
| **Сессия клиента** | Активная работа в портале | Деактивация клиента в 1С:ERP | Вебхук `client_deactivated` вносит партнёра в Redis Blacklist и шлет broadcast | Немедленный логаут с выводом сообщения: «Учетная запись деактивирована администратором» |
| **Разблокировка** | Клиент был заблокирован за долг | Поступление оплаты и погашение задолженности | Вебхук `payment_received` удаляет ключ из Redis и обновляет `is_blocked = false` | Мгновенная разблокировка кнопки чекаута в корзине дилера |
