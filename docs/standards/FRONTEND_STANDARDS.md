# 🎨 Frontend & UI/UX Архитектурные Стандарты Synergy B2B Portal

Данный документ устанавливает обязательные инженерные стандарты разработки клиентской части B2B-портала Synergy (React 18, TypeScript, Tailwind CSS, Vite, PWA).

---

## 1. Архитектура компонентов и декомпозиция

### 1.1. Борьба с монолитами (Правило 400 строк)
* **Проблема**: Исторически страницы вроде `ProfilePage.tsx` или `ProductPage.tsx` разрастались до сотен килобайт и тысяч строк кода, объединяя UI, стейт заказов, модалки, фильтры и сетевые запросы. Это приводит к каскадным ререндерам и затрудняет тестирование.
* **Стандарт**:
  - Ни один файл компонента не должен превышать **400 строк кода**.
  - Если компонент превышает 400 строк, он **обязан** быть декомпозирован на:
    1. **Smart Container (Страница/Контроллер)**: управляет стейтом и хуками.
    2. **UI Sub-components**: тупые презентационные компоненты (Presentational Components).
    3. **Custom Hooks**: вынос логики загрузки, фильтрации и пагинации в `src/hooks/use<Feature>.ts`.
    4. **Modals & Drawers**: вынос всплывающих окон в отдельные файлы `components/<feature>/<ModalName>.tsx`.

### 1.2. Структура директории `src/`
```
src/
├── components/          # Переиспользуемые UI-компоненты (ProductCard, Header, etc.)
│   └── <feature>/       # Компоненты, специфичные для конкретного домена
├── contexts/            # Глобальные контексты (AuthContext, CartContext, LanguageContext)
├── hooks/               # Пользовательские хуки бизнес-логики (useProductData, useOfflineQueue)
├── lib/                 # Клиентские утилиты, API-клиенты и форматирование
├── pages/               # Корневые экраны страниц (только композиция)
└── types/               # TypeScript интерфейсы и схемы данных
```

---

## 2. Паттерны каталога ковров RugsUSA

B2B-покупатели ковров оперируют не отдельными артикулами, а коллекциями, дизайнами и размерными сетками.

```
┌─────────────────────────────────────────────────────────────┐
│                    DESIGN: Kashan 3062A                     │
├──────────────┬──────────────┬───────────────┬───────────────┤
│ Variant S    │ Variant M    │ Variant L     │ RUNNER        │
│ 0.8×1.5 м    │ 1.6×2.3 м    │ 2.0×3.0 м     │ 0.8×25.0 м    │
│ Stock: 14 шт │ Stock: 42 шт │ Stock: 8 шт   │ Stock: 3 рул. │
└──────────────┴──────────────┴───────────────┴───────────────┘
```

### 2.1. Кластеризация по размерам (`size_cluster`)
Все карточки и варианты нормализуются с помощью стандартной функции `getSizeCluster(width, length)`:
- `S` — маленькие коврики (площадь до 2.0 м²);
- `M` — стандартные ковры гостиной/спальни (2.0 – 5.5 м², например 1.6×2.3 м);
- `L` — большие ковры (5.5 – 9.0 м², например 2.0×3.0 м, 2.4×3.4 м);
- `XL` — сверхкрупные размеры (более 9.0 м²);
- `RUNNER` — ковровые дорожки и рулоны;
- `OVERSIZE` — нестандартные крупногабаритные изделия.

### 2.2. Определение ковровых дорожек (`is_runner`)
Для ковровых дорожек действует специальная математическая модель:
```typescript
export function isRunnerDimension(width: number, length: number): boolean {
  if (width <= 0 || length <= 0) return false;
  const ratio = Math.max(width, length) / Math.min(width, length);
  // Соотношение сторон >= 2.2 либо длина рулона >= 10 метров
  return ratio >= 2.2 || Math.max(width, length) >= 10.0;
}
```
* **Правило**: В карточке дорожки обязательно отображается как цена за штуку/рулон, так и индикативная цена за погонный/квадратный метр ($/м² или ₸/м²).

---

## 3. Золотые правила отображения ковров (Carpet Geometry Invariants)

Любое искажение пропорций или обрезка коврового узора является **критическим дефектом** (P0).

### ❌ Строго запрещено:
1. `object-cover` на изображениях ковров — срезает кант, бахрому и центральный узор.
2. Горизонтальные контейнеры (`aspect-video`, `aspect-[4/3]`) — вертикальный ковер становится крошечным или сжимается.

### ✅ Обязательный стандарт:
```tsx
// Карточка товара в каталоге
<div className="relative w-full aspect-[4/5] sm:aspect-[3/4] bg-slate-50 border border-slate-200/80 rounded-xl p-3 flex items-center justify-center overflow-hidden">
  <img
    src={imageUrl}
    alt={productTitle}
    loading="lazy"
    className="h-full w-full object-contain pointer-events-none drop-shadow-sm transition-transform duration-300 group-hover:scale-105"
  />
</div>
```

### 3.1. Идеальное выравнивание цен в сетке (Zero Price Jumping)
В соседних карточках каталога цена и кнопка добавления обязаны находиться **на строго одной горизонтальной линии**:
- Контейнер карточки: `flex-1 flex flex-col`.
- Блок заголовка: фиксированная 2-строчная высота `min-h-[2.5rem] sm:min-h-[2.75rem]` с `line-clamp-2`.
- Блок цен: **строго с классом `mt-auto`**:
```tsx
<div className="mt-auto border-t border-slate-100 pt-2.5 flex items-center justify-between">
  <div>
    <span className="text-xs text-slate-400 block">Опт:</span>
    <span className="text-sm font-bold text-slate-900">{formatPrice(price)}</span>
  </div>
  <AddToCartButton product={product} />
</div>
```

---

## 4. Мобильный тач-интерфейс (Touch Ergonomics)

Оптовые клиенты и региональные менеджеры активно работают со смартфонов прямо на оптовых рынках и складах.

### 4.1. Зоны касания (Touch Targets)
- Минимальный размер любой кнопки или кликабельной иконки: **44×44 px**.
- Интерактивные элементы снабжаются классом `touch-manipulation` для устранения 300мс задержки двойного тапа в браузерах iOS Safari и Chrome.

### 4.2. Правило прозрачности (Zero Invisible Interceptors)
* **Запрет**: Любой невидимый элемент с `opacity-0` блокирует тач под собой, если не отключен ввод.
* **Стандарт**: Все элементы с `opacity-0` обязаны содержать `pointer-events-none`, либо скрываться на мобильных через `hidden sm:flex`:
```tsx
<button
  className="hidden sm:flex absolute ... opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto"
>
  <ChevronRight className="w-5 h-5" />
</button>
```

---

## 5. Offline-First и оптимистичный UI

Приложение поддерживает работу в условиях нестабильного интернета на удаленных складах:

1. **Service Worker (`public/sw.js`)**:
   - Кэширует статическую оболочку приложения (App Shell) и статические ассеты (`CacheFirst`).
   - Кэширует каталог товаров (`StaleWhileRevalidate`).
2. **Очередь оффлайн-заказов (`src/lib/offlineQueue.ts`)**:
   - При отсутствии сети заказ сохраняется в локальное хранилище с меткой `isServerBuffered = true`.
   - Пользователь видит мгновенное подтверждение: *"Заказ сохранен в автономном буфере и отправится в ERP при появлении связи"*.
   - Компонент `Header.tsx` отображает бейдж количества заказов в очереди и кнопку принудительной синхронизации.
3. **Sub-50ms клиентский поиск**:
   - Токенизированный быстрый поиск без ожидания ответа сервера для мгновенной фильтрации на лету:
```typescript
const tokens = searchQuery.toLowerCase().trim().split(/\s+/);
const matches = items.filter(item => 
  tokens.every(token => item.searchIndex.includes(token))
);
```
