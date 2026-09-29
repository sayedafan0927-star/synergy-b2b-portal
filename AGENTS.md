# Synergy B2B Portal — Standards & Automation Rules

## 1. Automatic Deployment Standard (Обязательное правило)
- **Всегда автоматически** после успешного завершения любой задачи, внесения правок и локальной проверки тестов:
  1. Добавить изменённые файлы (`git add <files>`).
  2. Закоммитить с понятным Conventional Commit сообщением (`git commit -m "feat/fix: ..."`).
  3. Отправить в удалённый репозиторий (`git push origin main`).
- **Цель:** Изменения должны немедленно разворачиваться на боевой среде (Vercel/Production) без необходимости ручного запроса от пользователя.

## 2. Code Quality & Resilience Invariants
- Перед пушем проверять отсутствие регрессий (`python3 scripts/test_resilience_and_security.py`).
- Соблюдать стандарты UI/UX (`UI_UX_STANDARDS.md`) и Zero-Trust интеграции с ERP (`docs/ERP_INTEGRATION_SPEC.md`).
