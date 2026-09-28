# Интеграционный протокол и спецификация REST API: Synergy B2B Portal ⟷ Собственная ERP

Данный документ предназначен для команды разработчиков собственной ERP-системы (бэкенд `kilem-khan.kz`). Он содержит исчерпывающее описание протокола двустороннего обмена данными, схем JSON, алгоритмов формирования SSO-ссылок и вебхуков.

---

## 1. Архитектурная схема взаимодействия

```
┌──────────────────────────┐                 ┌──────────────────────────┐
│   Собственная ERP        │                 │    Synergy B2B Portal    │
│   (бэкенд kilem-khan.kz) │                 │      (Next/Vercel)       │
└────────────┬─────────────┘                 └────────────┬─────────────┘
             │                                            │
             │ 1. Вызовы портала (Заказы, Каталог, Долги) │
             │ ◄──────────────────────────────────────────┤ (POST/GET /api/erp)
             │                                            │
             │ 2. Вебхуки ERP (Дельты остатков, Статусы)  │
             ├──────────────────────────────────────────► │ (POST /api/webhooks/erp)
             │                                            │
             │ 3. SSO Magic Link (Автовход менеджера)     │
             ├─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ► │ (GET /api/auth/erp-sso)
```

---

## 2. Безопасность и авторизация

Все запросы между системами защищаются мастер-ключом и криптографической HMAC-SHA256 подписью:

1. **Заголовок авторизации:** При всех HTTP-запросах передается заголовок `X-Portal-Key` или `Authorization: Bearer <token>`:
   ```http
   X-Portal-Key: <YOUR_ERP_API_KEY>
   ```

2. **Секретный ключ подписи (Shared Secret для SSO):**
   ```
   ERP_PORTAL_SECRET = <YOUR_ERP_PORTAL_SECRET>
   ```

---

## 3. Модуль бесшовного автовхода персонала (SSO Magic Link)

Чтобы ваши Администраторы, Региональные менеджеры (РМ) и Локальные менеджеры (ЛМ) могли из интерфейса вашей ERP в один клик переходить на B2B-портал под своей ролью без ввода паролей:

### 3.1. Алгоритм генерации ссылки в вашей ERP:
* **Базовый URL портала:** `https://<b2b-portal-domain>/api/auth/erp-sso`
* **Параметры URL:**
  - `manager_id`: уникальный ID сотрудника в вашей ERP (строка или число).
  - `name`: ФИО сотрудника (URL-encoded).
  - `role`: роль на портале:
    - `admin` — полный административный доступ.
    - `manager_rm` — региональный менеджер (видит своих привязанных дилеров).
    - `manager_lm` — локальный менеджер (склад/шоурум).
    - `client` — вход от лица клиента (имперсонация).
  - `phone`: номер телефона сотрудника.
  - `timestamp`: текущий Unix Timestamp в секундах (`time()`).
  - `token`: HMAC-SHA256 подпись строки: `"{manager_id}:{role}:{timestamp}"`.

### 3.2. Готовый пример кода на PHP (для вашей ERP):
```php
<?php
function generatePortalSsoUrl(string $managerId, string $name, string $role, string $phone, string $portalBaseUrl = 'https://b2b.synergy.kz'): string {
    $secret = getenv('ERP_PORTAL_SECRET') ?: 'SynergySecretKey2025';
    $timestamp = time();
    
    // Формирование криптографической подписи (TTL = 15 минут)
    $payloadToSign = "{$managerId}:{$role}:{$timestamp}";
    $token = hash_hmac('sha256', $payloadToSign, $secret);

    $params = http_build_query([
        'manager_id' => $managerId,
        'name'       => $name,
        'role'       => $role,
        'phone'      => $phone,
        'timestamp'  => $timestamp,
        'token'      => $token,
        'redirect'   => '/profile'
    ]);

    return "{$portalBaseUrl}/api/auth/erp-sso?{$params}";
}

// Пример использования в кнопке интерфейса:
$ssoUrl = generatePortalSsoUrl('101', 'Алихан Сейдалиев', 'manager_rm', '+77011234567');
echo "<a href='{$ssoUrl}' target='_blank' class='btn'>Перейти в B2B-портал</a>";
```

---

## 4. Эндпоинты, которые Портал вызывает у вашей ERP
 
 Шлюз портала (`/api/erp`) выполняет вызовы к Action Router вашей ERP по адресу:
 * **Основная точка входа:** `https://crm.kilem-khan.kz/api_portal.php?action={ACTION}&portal_key={KEY}`
 * **Прямой резервный путь:** `https://kilem-khan.kz/api/sin/public/api_portal.php?action={ACTION}&portal_key={KEY}`
 
 Поддерживаемые действия (`action`): `ping`, `catalog`, `create_order`, `orders`, `client_auth`, `counterparties`, `client_debt`, `sync_bundle`, `supplier_network_stock`.
 
 ### 4.1. Проверка доступности: `action=ping`
 * **Метод:** `GET`
 * **Ожидаемый ответ от ERP:**
 ```json
 {
   "success": true,
   "version": "1.0.0",
   "server_time": "2026-09-28 16:30:00"
 }
 ```
 
 ### 4.2. Получение каталога и остатков: `action=catalog`
 * **Метод:** `GET`
 * **Параметры:** `partner_id` (опционально, для индивидуальных цен)
 * **Ожидаемый ответ от ERP:**
 ```json
 {
   "success": true,
   "products": [
     {
       "id": "1001",
       "name": "Ковер Silk Road Vintage",
       "collection": "Silk Road",
       "manufacturer": "Synergy Carpets",
       "variants": [
         {
           "sku": "SR-VINT-160230",
           "size": "1.6 × 2.3",
           "base_price": 120.00,
           "price_per_sqm": 32.60,
           "free_stock": 14,
           "reserved_stock": 3,
           "total_stock": 17,
           "warehouses": [
             { 
               "warehouse_id": 81, 
               "warehouse_name": "Основной Склад Астана",
               "city": "Астана", 
               "free_stock": 14, 
               "reserved_stock": 3, 
               "total_stock": 17 
             }
           ]
         }
       ]
     }
   ]
 }
 ```
 
 ### 4.3. Регистрация нового заказа: `action=create_order`
 * **Метод:** `POST`
 * **Заголовки:**
   - `Content-Type: application/json`
   - `X-Portal-Key: <YOUR_ERP_API_KEY>`
   - `X-Idempotency-Key: <unique-order-uuid>`
   - `X-Correlation-ID: <trace-id>`
 * **Тело запроса (от портала в ERP):**
 ```json
 {
   "partner_id": 42,
   "warehouse_id": 81,
   "buyer": {
     "id": 42,
     "name": "Aya Home Store",
     "phone": "+77019998877",
     "city": "Астана"
   },
   "customer": {
     "id": 42,
     "name": "Aya Home Store",
     "phone": "+77019998877"
   },
   "comment": "Срочная отгрузка автотранспортом",
   "total_amount": 1450.00,
   "items": [
     {
       "item_id": 1001,
       "sku": "SR-VINT-160230",
       "barcode": "8680001928312",
       "quantity": 5,
       "price": 108.00,
       "warehouse": "Основной Склад Астана"
     }
   ]
 }
 ```
 * **Ожидаемый ответ от ERP:**
 ```json
 {
   "success": true,
   "order": {
     "order_id": 5542,
     "doc_number": "ЗК-2026-00412",
     "status": "pending",
     "created_at": "2026-09-28T16:35:00Z"
   }
 }
 ```

### 4.4. Финансовый отчет и долг клиента: `action=get_client_debt`
* **Метод:** `GET`
* **Параметры:** `phone` или `counterparty_id`
* **Ожидаемый ответ от ERP:**
```json
{
  "success": true,
  "found": true,
  "client": {
    "name": "Aya Home Store",
    "credit_limit_usd": 10000.00,
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

### 4.5. Акт сверки взаиморасчетов: `action=get_reconciliation_report`
* **Метод:** `GET`
* **Параметры:** `partner_id`, `start_date` (YYYY-MM-DD), `end_date` (YYYY-MM-DD)
* **Ожидаемый ответ от ERP:**
```json
{
  "success": true,
  "report": {
    "partner_id": "42",
    "start_date": "2026-01-01",
    "end_date": "2026-09-28",
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
        "doc_type": "Платежное поручение",
        "doc_number": "ПП-00891",
        "debit": 0.00,
        "credit": 4500.00
      }
    ]
  }
}
```

---

## 5. Вебхуки: События, которые ваша ERP отправляет на Портал

Когда в вашей ERP происходят складские или финансовые операции, отправляйте HTTP POST запрос на портал:
* **URL вебхука:** `POST https://<b2b-portal-domain>/api/webhooks/erp`
* **Заголовок:** `X-Portal-Key: <YOUR_PORTAL_SECRET_KEY>`

### 5.1. Событие: `stock_changed` (Смена остатков)
*Отправляйте **только дельты** (позиции, где реально изменился остаток), а не полный каталог!*
```json
{
  "event": "stock_changed",
  "reason": "shipment",
  "items": [
    {
      "sku": "SR-VINT-160230",
      "free_stock": 9,
      "reserved_stock": 2,
      "total_stock": 11,
      "warehouse_id": 81
    }
  ]
}
```

### 5.2. Событие: `order_status_changed` (Смена статуса WMS / склада)
*Портал обновит статус в личном кабинете и автоматически уведомит дилера в WhatsApp:*
```json
{
  "event": "order_status_changed",
  "order_id": 5542,
  "order_doc_number": "ЗК-2026-00412",
  "new_status": "shipped",
  "track_code": "KZ-AST-9821",
  "client_name": "Aya Home Store",
  "client_phone": "+77019998877"
}
```
*Допустимые статусы:* `pending`, `confirmed`, `processing`, `shipped`, `delivered`, `cancelled`.

### 5.3. Событие: `payment_received` (Поступление оплаты)
*Мгновенно разблокирует дилера и обновит баланс в реальном времени:*
```json
{
  "event": "payment_received",
  "counterparty_id": 42,
  "payment_doc": "ПП-9912",
  "amount_usd": 1200.00,
  "new_balance_usd": 0.00,
  "new_total_debt_usd": 0.00,
  "client_phone": "+77019998877"
}
```

---

## 6. Политика учета складских остатков и защита от оверселлинга (free_stock vs total_stock)

### 6.1. Разграничение понятий:
* **`total_stock` (Физический остаток):** Общее количество единиц товара, фактически лежащее на складе в ячейках. Включает в себя товары, на которые уже выписаны расходные накладные, либо которые сейчас собираются комплектовщиком по ТСД / WMS.
* **`reserved_stock` (Резерв):** Количество единиц, забронированное под уже размещенные, но еще не списанные заказы других клиентов или внутренние перемещения.
* **`free_stock` (Свободный доступный остаток):** Чистый баланс для продажи:
  $$\text{free\_stock} = \text{total\_stock} - \text{reserved\_stock}$$

### 6.2. Почему портал СТРОГО блокирует покупку по `free_stock`, а не `total_stock`:
> [!IMPORTANT]
> Если ориентироваться на `total_stock`, дилеры смогут положить в корзину и оплатить товары, которые **уже забронированы другими покупателями** или в эту секунду сканируются кладовщиком терминалом сбора данных (ТСД/WMS). Это неминуемо приведет к кассовому разрыву, физической недостаче и конфликтным ситуациям при отгрузке.

**Архитектурное правило портала:**
1. **Каталог и Корзина:** Лимит добавления в корзину и кнопка «Купить» жестко ограничены полем `free_stock`. Если `free_stock <= 0`, позиция помечается как «Нет в наличии на складе» и блокируется для оформления.
2. **Прозрачность для руководства:** Поля `total_stock` и `reserved_stock` отображаются в карточке товара и детализации склада только в качестве справочной информации (чтобы клиент и менеджер понимали: товар физически есть на складе, но находится в брони, либо ожидается его освобождение).
3. **WMS TTL:** В случае аннулирования или истечения срока брони (TTL 48ч) в ERP, ERP пересчитывает `free_stock` и отправляет вебхук `stock_changed`, после чего товар моментально возвращается на витрину портала.

---

## 7. Чек-лист переменных окружения для боевого развертывания (Production Env)

В панели Vercel (или хостинга портала) должны быть заданы следующие переменные:

| Переменная | Описание | Пример боевого значения |
|---|---|---|
| `ERP_API_URL` | Единая точка входа Action Router ERP | `https://crm.kilem-khan.kz/api_portal.php` |
| `ERP_API_KEY` | Мастер-ключ авторизации к ERP | `<SECRET_ERP_API_KEY>` |
| `ERP_PORTAL_SECRET` | Общий секрет для HMAC-подписи SSO | `<SECRET_PORTAL_KEY>` |
| `GREEN_API_URL` | URL шлюза WhatsApp (Green-API / Chat-API) | `https://api.green-api.com/waInstance.../sendMessage/...` |
| `WHATSAPP_API_TOKEN` | Токен авторизации WhatsApp API | `<SECRET_WHATSAPP_TOKEN>` |
| `SUPABASE_URL` | База данных PostgreSQL портала | `https://your-project.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY`| Сервисный ключ базы данных (бэкенд) | `<SECRET_SUPABASE_SERVICE_ROLE_KEY>` |
| `CRON_SECRET` | Секрет защиты вызова Vercel Cron | `<SECRET_CRON_KEY>` |
