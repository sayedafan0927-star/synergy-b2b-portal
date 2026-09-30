# Synergy B2B Portal — Стандарт жизненного цикла заказов и складских резервов

> **Статус:** Обязательный архитектурный стандарт (P0 Invariant)  
> **Область действия:** Чекаут, Мультисклад, Интеграция 1С:ERP, WMS Бронирование, Отмена и DLQ  
> **Последнее обновление:** 2026-09-30 (Stage 8)

---

## 1. Фундаментальные инварианты (Core Architectural Invariants)

1. **Zero Reservation Leak Invariant (Защита от утечек и раздувания остатков):**
   - При создании любого заказа свободный остаток `free_stock` списывается, а `reserved_stock` пропорционально увеличивается атомарно в PostgreSQL (`create_order_atomic`).
   - При любой отмене заказа (`cancelled`), сбое в DLQ (`failed_dlq`) или истечении TTL брони (24ч), резерв обязан быть возвращен обратно в `free_stock` **ровно один раз**.
   - Повторный вызов отмены или освобождения брони обязан быть строго идемпотентным (флаг `orders.reservations_released = true`).

2. **Master Order Monolith & Suborder Encapsulation (Изоляция подзаказов):**
   - Клиент оформляет единую корзину. В БД создается один **Мастер-заказ** (`parent_order_id IS NULL`), содержащий полный список позиций в `order_items`.
   - Если товары заказа лежат на разных складах (мультисклад), создаются **дочерние субордеры** (`parent_order_id = master.id`).
   - **Правило отображения в UI:** Клиент в личном кабинете видит **только мастер-заказы** (`.is('parent_order_id', null)`). Подзаказы клиенту отдельно не показываются, чтобы исключить задвоение сумм и количества позиций.
   - **Правило синхронизации с 1С:** В Outbox и в 1C:ERP отправляется **только мастер-заказ** с вложенным массивом `split_orders`.

3. **Strict Schema & Relational Separation (Запрет нереляционных псевдо-колонок):**
   - Таблица `orders` **не содержит** колонок `items`, `client_name`, `client_company`, `client_phone`.
   - Товарные позиции хранятся **строго** в связанной таблице `order_items(order_id)`.
   - Профиль клиента хранится **строго** в `profiles(user_id)`.
   - Номер заказа хранится в колонке `order_number` (не `doc_number`).
   - Название склада хранится в колонке `warehouse` (не `warehouse_name`).

---

## 2. Иерархия мастер-заказа и мультискладских подзаказов

```mermaid
flowchart TD
    Cart["Корзина B2B Клиента\n(Товары с разных складов)"] --> Checkout["create_order_atomic / Checkout Saga"]
    Checkout --> MasterOrder["Мастер-заказ (orders)\nid: UUID-1\nparent_order_id: NULL\norder_number: ORD-2026-0042"]
    
    MasterOrder --> MasterItems["order_items (Мастер)\nВсе позиции заказа\n(warehouse_id: 81, 82, 83)"]
    
    Checkout --> Sub1["Дочерний подзаказ 1\nwarehouse: Основной Склад Астана (81)\nparent_order_id: UUID-1"]
    Checkout --> Sub2["Дочерний подзаказ 2\nwarehouse: Филиал Алматы (82)\nparent_order_id: UUID-1"]
    
    Sub1 --> Sub1Items["order_items (Субордер 1)\nТолько позиции склада 81"]
    Sub2 --> Sub2Items["order_items (Субордер 2)\nТолько позиции склада 82"]

    MasterOrder --> OutboxSync["api/outbox/sync.ts\n(Передает 1С единый мастер-заказ\n+ split_orders)"]
    OutboxSync --> Erp1C["1C:ERP Gateway"]
    
    subgraph UI_Layer ["Слой интерфейса (UI)"]
        DealerCabinet["Кабинет дилера (OrdersTab)\nФильтр: parent_order_id IS NULL\nКлиент видит 1 заказ, а не 3!"]
    end
    MasterOrder -.-> DealerCabinet
```

---

## 3. Конечный автомат состояний (Order & Stock FSM)

```mermaid
stateDiagram-v2
    [*] --> pending: Checkout (Атомарное списание free_stock -> reserved_stock)

    state pending {
        [*] --> InFlight: Ожидание подтверждения 1С или согласования РМ
        InFlight --> WaitingApproval: Превышен кредитный лимит
        InFlight --> OutboxQueue: В пределах лимита
    }

    WaitingApproval --> processing: Одобрено РМ в WhatsApp (approve)
    WaitingApproval --> cancelled: Отклонено РМ (reject)

    OutboxQueue --> processing: 1C:ERP приняла заказ (200 OK)
    OutboxQueue --> failed_dlq: Превышен лимит ретраев (3) или фатальная ошибка 1С (4xx)

    pending --> cancelled: Отмена пользователем / админом через UI
    pending --> cancelled: WMS Hold TTL Expired (24ч, expire-holds cron)

    processing --> assembled: Сборка завершена на складе
    assembled --> shipped: Отгружен покупателю (списание reserved_stock -> 0)
    shipped --> delivered: Доставлен клиенту

    state "Освобождение резервов (release_order_reservations)" as Rollback {
        cancelled
        failed_dlq
    }

    Rollback --> [*]: free_stock += qty, reserved_stock -= qty, reservations_released = true
```

---

## 4. Матрица ответственности и правил отмены

| Инициатор отмены | Точка входа | Действие со складом | Каскад на субордеры |
| :--- | :--- | :--- | :--- |
| **Пользователь из списка заказов** | `useOrdersList.ts -> handleCancelOrder` | `rpc('release_order_reservations')` | `UPDATE orders SET status='cancelled' WHERE id=X OR parent_order_id=X` |
| **Пользователь из детальной карточки** | `OrderDetail.tsx -> handleStatusChange` | `rpc('release_order_reservations')` | `UPDATE orders SET status='cancelled' WHERE id=X OR parent_order_id=X` |
| **Менеджер через WhatsApp** | `api/approvals/action.ts?decision=reject` | `rpc('release_order_reservations')` | Каскадный `UPDATE status='cancelled'` для `parent_order_id=X` |
| **Фоновый крон истечения срока (TTL)** | `api/cron/expire-holds.ts` | `cancel_expired_order_holds()` | Изоляция мастера + каскад `status='cancelled'` на подзаказы |
| **Сбой очереди синхронизации (DLQ)** | `api/outbox/sync.ts` | `rpc('release_order_reservations')` | Каскадный `UPDATE status='failed_dlq'` для `parent_order_id=X` |
| **Вебхук статуса от 1С:ERP** | `orderStatusHandler.ts` (`status: cancelled`) | `rpc('release_order_reservations')` | Каскадный `UPDATE status='cancelled'` для `parent_order_id=X` |

---

## 5. Словарь сущностей базы данных (Database Entity Mapping)

```mermaid
erDiagram
    PROFILES ||--o{ ORDERS : "places"
    ORDERS ||--o{ ORDER_ITEMS : "contains"
    ORDERS ||--o{ ORDERS : "parent_of (suborders)"
    INVENTORY_BALANCES ||--o{ ORDER_ITEMS : "reserves"

    ORDERS {
        uuid id PK
        uuid parent_order_id FK
        string order_number
        string status
        boolean reservations_released
        numeric total_amount
    }
    ORDER_ITEMS {
        uuid id PK
        uuid order_id FK
        string sku
        integer warehouse_id
        integer quantity
    }
    INVENTORY_BALANCES {
        string sku PK
        integer warehouse_id PK
        integer free_stock
        integer reserved_stock
    }
    PROFILES {
        uuid id PK
        string full_name
        string company_name
        numeric debt_usd
    }
```

| Сущность | Таблица PostgreSQL | Обязательные правила обращения |
| :--- | :--- | :--- |
| **Мастер-заказ** | `orders` | Колонка `parent_order_id IS NULL`. Номер: `order_number`. Склад: `warehouse`. Суммы: `total_amount`, `total_sqm`, `total_items`. |
| **Субордер склада** | `orders` | Колонка `parent_order_id = master.id`. Не включать в выдачу клиентского списка заказов! |
| **Позиции заказа** | `order_items` | Связь `order_id -> orders.id`. Содержит `sku`, `warehouse_id`, `warehouse`, `size`, `price`, `quantity`. |
| **Остатки склада** | `inventory_balances` | Составной ключ `(sku, warehouse_id)`. Колонки: `free_stock`, `reserved_stock`, `total_stock`. |
| **Профиль клиента** | `profiles` | Связь `orders.user_id -> profiles.id`. Содержит `full_name`, `company_name`, `phone`, `debt_usd`, `credit_limit_usd`. |

---

## 6. Чеклист для разработчиков и AI-агентов (Definition of Done)

Перед внесением любых изменений в модули чекаута, корзины, заказов или синхронизации:

- [ ] В любых выборках заказов для клиента (`useOrdersList`, `activeReservationsHandler` и др.) обязательно присутствует `.is('parent_order_id', null)`.
- [ ] При отмене заказа всегда вызывается процедура `release_order_reservations` ровно **один раз** для мастер-заказа.
- [ ] При обновлении статуса мастер-заказа статус каскадно обновляется для `parent_order_id = master.id`.
- [ ] Запрещено обращаться к несуществующим колонкам `orders.items`, `orders.client_name`, `orders.doc_number`.
- [ ] Пройдены все проверки пайплайна:
  ```bash
  python3 scripts/test_resilience_and_security.py && python3 scripts/check-ui-standards.py && python3 scripts/check-modularity-standards.py
  ```
