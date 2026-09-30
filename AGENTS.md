# Synergy B2B Portal — Standards & Automation Rules

## 1. Automatic Deployment Standard (Обязательное правило)
- **Всегда автоматически** после успешного завершения любой задачи, внесения правок и локальной проверки тестов:
  1. Добавить изменённые файлы (`git add <files>`).
  2. Закоммитить с понятным Conventional Commit сообщением (`git commit -m "feat/fix: ..."`).
  3. Отправить в удалённый репозиторий (`git push origin main`).
- **Цель:** Изменения должны немедленно разворачиваться на боевой среде (Vercel/Production) без необходимости ручного запроса от пользователя.

## 2. Code Quality & Resilience Invariants
- Перед пушем проверять отсутствие регрессий (`python3 scripts/test_resilience_and_security.py && python3 scripts/check-ui-standards.py && python3 scripts/check-modularity-standards.py`).
- Строго соблюдать архитектурные стандарты проекта:
  - Свод стандартов и планка качества: [`docs/standards/README.md`](docs/standards/README.md)
  - Стандарты модульности кода: [`docs/standards/MODULARITY_STANDARDS.md`](docs/standards/MODULARITY_STANDARDS.md)
  - Стандарты Frontend и UI/UX: [`docs/standards/FRONTEND_STANDARDS.md`](docs/standards/FRONTEND_STANDARDS.md) и [`UI_UX_STANDARDS.md`](UI_UX_STANDARDS.md)
  - Стандарты Backend API и безопасности: [`docs/standards/BACKEND_API_STANDARDS.md`](docs/standards/BACKEND_API_STANDARDS.md)
  - Стандарты БД и миграций: [`docs/standards/DATABASE_STANDARDS.md`](docs/standards/DATABASE_STANDARDS.md)
  - Интеграция с ERP и CDC: [`docs/standards/INTEGRATION_STANDARDS.md`](docs/standards/INTEGRATION_STANDARDS.md) и [`docs/ERP_INTEGRATION_SPEC.md`](docs/ERP_INTEGRATION_SPEC.md)
  - Жизненный цикл заказов и резервы: [`docs/standards/ORDER_LIFECYCLE_AND_STOCK_RESERVATIONS.md`](docs/standards/ORDER_LIFECYCLE_AND_STOCK_RESERVATIONS.md)
  - Сквозные процессы и блок-схемы архитектуры: [`docs/standards/END_TO_END_PROCESS_FLOWS.md`](docs/standards/END_TO_END_PROCESS_FLOWS.md)
  - Бесшовная навигация и Zero-Flicker: [`docs/standards/PAGE_TRANSITIONS_AND_LOADING_STANDARDS.md`](docs/standards/PAGE_TRANSITIONS_AND_LOADING_STANDARDS.md)
  - Definition of Done и чеклист ревью: [`docs/standards/CODE_REVIEW_AND_DOD.md`](docs/standards/CODE_REVIEW_AND_DOD.md)

