# ТЕХНИЧЕСКОЕ ЗАДАНИЕ И СПЕЦИФИКАЦИЯ ИНТЕГРАЦИИ
## B2B-Портал Synergy ⟷ Собственная ERP (erp.synergy-tech.kz)
**Версия документа:** 2.4 (Enterprise Production Edition)  
**Статус:** Утверждено к реализации при миграции на новый хостинг  
**Целевая аудитория:** Разработчики и DevOps-инженеры учетной системы ERP  

---

## 1. Архитектурная модель взаимодействия

B2B-портал для оптовых клиентов спроектирован по стандарту высокой доступности (High Availability) и **полной автономности**:
* Портал работает на современной Serverless-инфраструктуре (Next.js / Node.js).
* Обмен данными осуществляется по двум направлениям:
  1. **Pull (Запросы Портала в ERP):** Портал обращается к Action Router вашей ERP через шлюз `/api/erp`.
  2. **Push (Вебхуки ERP в Портал):** ERP при любых изменениях в базе (проводка документов, прием оплат, резервирование) отправляет асинхронные вебхуки на адрес портала `POST /api/webhooks/erp`.
* **Zero-Downtime при переезде хостинга:** Во время миграции ERP сайт не падает — активируется защитный контур `Circuit Breaker` и автономный буфер заказов `Outbox`. После поднятия ERP на новом хостинге накопленные заказы автоматически синхронизируются.

```
┌─────────────────────────────────────────────────────────────┐
│                 B2B-ПОРТАЛ SYNERGY                          │
│     (https://synergy-b2b-portal.vercel.app)                 │
└──────────────┬───────────────────────────────▲──────────────┘
               │ 1. HTTP Pull                  │ 2. Webhooks Push
               │ (Каталог, Заказы, Сверки)    │ (Остатки, Статусы, Оплаты)
               ▼                               │
┌──────────────────────────────────────────────┴──────────────┐
│                  СОБСТВЕННАЯ ERP-СИСТЕМА                    │
│                 (https://erp.synergy-tech.kz)               │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Сетевые параметры и безопасность

1. **Точки входа Action Router ERP:**
   * Основной роутер: `https://erp.synergy-tech.kz/api_portal.php`
2. **Авторизация запросов:**
   * Все запросы от портала к ERP содержат заголовок:
     ```http
     X-Portal-Key: 138d1bdaf9402600c8f5d5763e2e1573c1e45d32401e62e4981cd7e898bf0544
     ```
   * Для обратной совместимости портал также дублирует ключ в параметрах URL: `?portal_key=138d1bdaf940...`
3. **Идемпотентность и защита от повторных списаний:**
   * При создании заказов передается заголовок `X-Idempotency-Key: <UUID>`. ERP обязана использовать этот ключ для исключения задвоения заказов при повторной отправке.
4. **Таймауты:**
   * Оформление заказа: ERP должна ответить в течение **2.5 секунд** (иначе портал безопасно сохраняет заказ в локальный буфер Outbox).
   * Выгрузка каталога: таймаут **12 секунд**.

---

## 3. БЛОК I: Входящие методы ERP (Портал ➔ ERP)

ERP должна корректно обрабатывать следующие значения параметра `action`:

### 3.1. Проверка доступности: `action=ping`
* **Метод:** `GET`
* **URL:** `.../api_portal.php?action=ping&portal_key={KEY}`
* **Ожидаемый ответ JSON:**
```json
{
  "success": true,
  "status": "healthy",
  "version": "2.4.0",
  "server_time": "2026-09-29 12:00:00"
}
```

---

### 3.2. Каталог номенклатуры и остатков: `action=catalog`
* **Метод:** `GET`
* **Параметры URL:**
  * `dealer_id` (строка, опционально, например `PRT-DEMO-001` или ID дилера).
  * `price_type` (строка, опционально: `price_wholesale`, `price_deferred`, `price_cash`).
* **Требования к ответу:**
  * Единица измерения цен: `price_per_sqm` (цена за кв. метр) или `piece_price` (за штуку).
  * Остатки: разделение на `free_stock` (свободный), `reserved_stock` (в резерве), `total_stock` (общий).
  * Склады: массив `warehouses` с указанием остатков по каждому складу (`warehouse_id = 81` — Основной Склад Астана).
* **Пример ответа JSON:**
```json
{
  "success": true,
  "count": 50,
  "currency": "USD",
  "price_unit": "per_sqm",
  "price_type": "price_deferred",
  "summary": {
    "total_items": 50,
    "free_stock_qty": 182,
    "reserved_stock_qty": 14,
    "total_stock_qty": 196
  },
  "products": [
    {
      "id": "140",
      "name": "Ковер SALOON 25449A (ANTRACITE / CREAM)",
      "collection": "SALOON",
      "article": "25449A",
      "category": "Ковры",
      "country": "Турция",
      "manufacturer": "LINEA",
      "material": "Полипропилен / Heat-Set",
      "density": "600 000 точек/м²",
      "pile_height": "10 мм",
      "images": ["https://erp.synergy-tech.kz/image.php?f=saloon_25449a.webp"],
      "variants": [
        {
          "id": "140",
          "sku": "78900101015474",
          "barcode": "78900101015474",
          "article": "25449A",
          "size": "4 × 5",
          "width": 4.0,
          "length": 5.0,
          "area_sqm": 20.0,
          "shape": "STAN",
          "price": 108.8,
          "price_per_sqm": 5.44,
          "free_stock": 12,
          "reserved_stock": 2,
          "total_stock": 14,
          "warehouses": [
            {
              "warehouse_id": 81,
              "warehouse_name": "Основной Склад Астана",
              "city": "Астана",
              "stock": 12,
              "free_stock": 12,
              "reserved_stock": 2,
              "total_stock": 14
            }
          ]
        }
      ]
    }
  ]
}
```

---

### 3.3. Прием и проведение заказа: `action=create_order`
* **Метод:** `POST`
* **Заголовки:**
  ```http
  Content-Type: application/json
  X-Portal-Key: {KEY}
  X-Idempotency-Key: {UUID}
  X-Correlation-ID: {TRACE_ID}
  ```
* **Тело запроса JSON (от портала в ERP):**
```json
{
  "partner_id": 42,
  "warehouse_id": 81,
  "buyer": {
    "id": 42,
    "name": "ИП Carpet House",
    "phone": "+77015551234",
    "city": "Алматы"
  },
  "customer": {
    "id": 42,
    "name": "ИП Carpet House",
    "phone": "+77015551234"
  },
  "total_amount": 1450.00,
  "comment": "Отгрузка через ТК Jet Logistic, самовывоз со склада",
  "items": [
    {
      "item_id": 140,
      "sku": "78900101015474",
      "barcode": "78900101015474",
      "article": "25449A",
      "size": "4 × 5",
      "width": 4.0,
      "length": 5.0,
      "area_sqm": 20.0,
      "quantity": 2,
      "price": 108.8,
      "warehouse_id": 81
    }
  ]
}
```
* **Ожидаемый успешный ответ ERP (200 OK):**
```json
{
  "success": true,
  "order": {
    "order_id": 5542,
    "doc_number": "ЗК-2026-00891",
    "status": "pending",
    "created_at": "2026-09-29T12:05:00Z"
  }
}
```
* **Обработка ошибки нехватки товара (409 Conflict):**
Если на складе недостаточно остатка, ERP должна вернуть HTTP 409 с телом:
```json
{
  "success": false,
  "code": "INSUFFICIENT_STOCK",
  "error": "Недостаточно свободного остатка для артикула 25449A (запрошено: 2, доступно: 0)"
}
```

---

### 3.4. Финансовое сальдо и задолженность дилера: `action=client_debt`
* **Метод:** `GET`
* **Параметры URL:** `counterparty_id` или `phone`
* **Пример ответа ERP:**
```json
{
  "success": true,
  "found": true,
  "client": {
    "name": "ИП Carpet House",
    "credit_limit_usd": 15000.00,
    "payment_delay_days": 14,
    "is_blocked_for_shipment": false
  },
  "financials": {
    "balance_usd": -1200.00,
    "total_debt_usd": 1200.00,
    "total_paid_usd": 48500.00,
    "is_overdue": false,
    "overdue_usd": 0.00,
    "max_overdue_days": 0
  },
  "regional_manager": {
    "name": "Алихан Сейдалиев",
    "phone": "+7 701 123 4567"
  }
}
```

---

### 3.5. Акт сверки взаиморасчетов: `action=get_reconciliation_report`
* **Метод:** `GET`
* **Параметры URL:** `partner_id`, `start_date` (YYYY-MM-DD), `end_date` (YYYY-MM-DD)
* **Пример ответа ERP:**
```json
{
  "success": true,
  "report": {
    "partner_id": "42",
    "start_date": "2026-01-01",
    "end_date": "2026-09-29",
    "initial_balance": 0.00,
    "total_debit": 15400.00,
    "total_credit": 14200.00,
    "final_balance": 1200.00,
    "transactions": [
      {
        "date": "2026-08-14",
        "doc_type": "Расходная накладная",
        "doc_number": "РНК-00124",
        "debit": 4500.00,
        "credit": 0.00
      },
      {
        "date": "2026-08-20",
        "doc_type": "Поступление на расчетный счет",
        "doc_number": "ПП-00561",
        "debit": 0.00,
        "credit": 4500.00
      }
    ]
  }
}
```

---

### 3.6. Настройки отображения каталога: `action=display_settings`
* **Метод:** `GET`
* **Ответ ERP:**
```json
{
  "success": true,
  "settings": {
    "show_free_stock": true,
    "show_reserved_stock": true,
    "show_to_ship_stock": true,
    "show_total_stock": true,
    "show_prices": true,
    "show_price_per_sqm": true,
    "show_discounts": true,
    "show_dealer_showroom": true,
    "allow_orders_when_zero_stock": false
  }
}
```

---

## 4. БЛОК II: Исходящие вебхуки (ERP ➔ Портал)

Чтобы оптовики всегда видели актуальные остатки, цены и статусы без задержек, ERP должна отправлять HTTP POST запросы на эндпоинт портала:
* **Webhook URL:** `https://synergy-b2b-portal.vercel.app/api/webhooks/erp`
* **Заголовок:** `X-Portal-Key: 138d1bdaf9402600c8f5d5763e2e1573c1e45d32401e62e4981cd7e898bf0544`

### 4.1. Изменение остатков на складе: `event: "stock_changed"`
Отправляется ERP при поступлении товаров, инвентаризации, списании или ручном резерве:
```json
{
  "event": "stock_changed",
  "version_timestamp": 1790665000,
  "items": [
    {
      "sku": "78900101015474",
      "article": "25449A",
      "free_stock": 10,
      "reserved_stock": 4,
      "total_stock": 14,
      "warehouse_id": 81
    }
  ]
}
```
*Портал мгновенно транслирует это клиентам по WebSocket (Supabase Realtime) без перезагрузки страниц.*

### 4.2. Смена статуса накладной: `event: "order_status_changed"`
Отправляется ERP при движении заказа (Комплектация ➔ Отгружен ➔ Доставлен):
```json
{
  "event": "order_status_changed",
  "order_number": "ЗК-2026-00891",
  "status": "shipped",
  "notes": "Передано водителю, авто 124ABC01",
  "updated_at": "2026-09-29T12:15:00Z"
}
```
*Поддерживаемые статусы:* `pending` (принят), `confirmed` (подтвержден), `processing` (на сборке), `shipped` (отгружен), `delivered` (доставлен), `cancelled` (отменен).  
*Портал автоматически каскадирует статус на все связанные дочерние накладные.*

### 4.3. Поступление оплаты: `event: "payment_received"`
Отправляется ERP при проведении платежного поручения / выписки:
```json
{
  "event": "payment_received",
  "partner_id": 42,
  "amount_usd": 1200.00,
  "new_balance_usd": 0.00,
  "payment_doc": "ПП-00912",
  "payment_date": "2026-09-29"
}
```

### 4.4. Обновление сетки скидок: `event: "discount_rules_updated"`
Отправляется при изменении системы лояльности / скидок:
```json
{
  "event": "discount_rules_updated",
  "rules": [
    { "price_type": "price_wholesale", "discount_percent": 0 },
    { "price_type": "price_cash", "discount_percent": 5 },
    { "price_type": "price_deferred", "discount_percent": 0 }
  ]
}
```

---

## 5. БЛОК III: Бесшовный вход сотрудников (SSO Magic Link)

Чтобы региональные менеджеры (РМ) и руководители могли из интерфейса ERP в один клик переходить в профиль клиента на B2B-портале без ввода паролей, добавьте кнопку с генерацией ссылки:

### Готовый PHP-код для вашей ERP:
```php
<?php
/**
 * Генерация безопасной SSO-ссылки для перехода в B2B-портал
 */
function generatePortalSsoUrl(
    string $managerId, 
    string $fullName, 
    string $role = 'manager_rm', 
    string $phone = '+77011234567',
    string $portalBaseUrl = 'https://synergy-b2b-portal.vercel.app'
): string {
    // Секретный ключ подписи (Shared Secret)
    $secret = 'SynergySecretKey2025';
    $timestamp = time(); // Ссылка действует 15 минут

    // Формирование криптографической HMAC-SHA256 подписи
    $payloadToSign = "{$managerId}:{$role}:{$timestamp}";
    $token = hash_hmac('sha256', $payloadToSign, $secret);

    $params = http_build_query([
        'manager_id' => $managerId,
        'name'       => $fullName,
        'role'       => $role,      // admin | manager_rm | manager_lm | client
        'phone'      => $phone,
        'timestamp'  => $timestamp,
        'token'      => $token,
        'redirect'   => '/profile'
    ]);

    return "{$portalBaseUrl}/api/auth/erp-sso?{$params}";
}

// Пример вызова в интерфейсе ERP:
// $ssoLink = generatePortalSsoUrl('101', 'Алихан Сейдалиев', 'manager_rm', '+77011234567');
// echo "<a href='{$ssoLink}' target='_blank' class='btn-portal'>Войти в B2B-портал</a>";
```

---

## 6. Чек-лист для команды разработчиков ERP при миграции

Перед переключением боевого трафика выполните самопроверку через терминал (cURL):

- [ ] **1. Проверка Ping:**
  ```bash
  curl -i "https://erp.synergy-tech.kz/api_portal.php?action=ping&portal_key=138d1bdaf9402600c8f5d5763e2e1573c1e45d32401e62e4981cd7e898bf0544"
  ```
  *Ожидается: HTTP 200, success: true.*

- [ ] **2. Проверка авторизации (Zero-Key Check):**
  ```bash
  curl -i "https://erp.synergy-tech.kz/api_portal.php?action=ping"
  ```
  *Ожидается: HTTP 401 Unauthorized.*

- [ ] **3. Проверка выгрузки каталога:**
  ```bash
  curl -i -H "X-Portal-Key: 138d1bdaf9402600c8f5d5763e2e1573c1e45d32401e62e4981cd7e898bf0544" "https://erp.synergy-tech.kz/api_portal.php?action=catalog&dealer_id=PRT-DEMO-001"
  ```
  *Ожидается: HTTP 200, массив products с остатками складов.*

- [ ] **4. Проверка финансового сальдо:**
  ```bash
  curl -i -H "X-Portal-Key: 138d1bdaf9402600c8f5d5763e2e1573c1e45d32401e62e4981cd7e898bf0544" "https://erp.synergy-tech.kz/api_portal.php?action=client_debt&counterparty_id=42"
  ```
  *Ожидается: HTTP 200, financials.*

- [ ] **5. Проверка отправки вебхука в портал:**
  ```bash
  curl -i -X POST "https://synergy-b2b-portal.vercel.app/api/webhooks/erp" \
    -H "Content-Type: application/json" \
    -H "X-Portal-Key: 138d1bdaf9402600c8f5d5763e2e1573c1e45d32401e62e4981cd7e898bf0544" \
    -d '{"event":"stock_changed","version_timestamp":1790665000,"items":[{"sku":"TEST-SKU","free_stock":5}]}'
  ```
  *Ожидается: HTTP 200, {"success": true, "processed": true}.*
