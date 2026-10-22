# Synergy B2B Portal — Standards & Automation Rules

## 1. Production Hosting & Automatic Deployment Standard (Обязательное правило)
- **Боевой сервер:** Проект перенесён с Vercel на собственный выделенный сервер (`https://synergy-group.kz`).
- **FTP доступ для деплоя:**
  - Host: `212.116.233.173` (порт `21`)
  - User: `ftp_synergygroupkz`
  - Pass: `FWK1KxaX@skASL`
- **Клиентские запросы:** Отказались от прямых запросов с клиента в Supabase и loop/polling запросов; все обращения идут через шлюз ERP (`/api/erp` -> `api_portal.php`).
- **Автоматический деплой (выполнять в текущей и всех последующих сессиях):**
  Единый стандарт выпуска (выполнять без напоминаний, в каждой сессии):
  ```bash
  python3 scripts/ship.py -m "feat/fix: ..." <только свои изменённые файлы>
  ```
  Скрипт сам: показывает `git status` (свои и чужие изменения) → гоняет гейты (`test_resilience_and_security`, `check-ui-standards`, `check-modularity-standards`) → собирает и деплоит по FTP (`deploy_ftp.py`) → проверяет ответ сервера → коммитит **только** перечисленные файлы → `git push origin HEAD` → печатает отчёт.
  - Запрещено: `git add -A`, `git add .`, `git commit -a`, `git stash`, `git reset --hard`; чужие незакоммиченные изменения не деплоить, не коммитить, не откатывать.
  - Не коммитить: `data/`, `.deploy_backup/`, `scratch/`, `dist/`, логи и временные файлы (скрипт их блокирует).
  - При падении гейта или ответе сервера не 200 деплой не форсировать; при 500 — откат из `.deploy_backup/latest/`.
  - Итоговый отчёт агента: список файлов, коммит, результат проверки сервера и отдельной строкой — какие чужие изменения остались нетронутыми.
- **Цель:** Изменения должны немедленно разворачиваться на боевой среде (`https://synergy-group.kz`) и сохраняться в репозитории без необходимости ручных действий со стороны пользователя.

## 2. Code Quality & Resilience Invariants
- Перед деплоем и пушем проверять отсутствие регрессий (`python3 scripts/test_resilience_and_security.py && python3 scripts/check-ui-standards.py && python3 scripts/check-modularity-standards.py`).
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

