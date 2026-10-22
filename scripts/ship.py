#!/usr/bin/env python3
"""Стандартный выпуск: гейты -> деплой -> коммит ТОЛЬКО указанных файлов -> push -> отчёт.

Использование:
    python3 scripts/ship.py -m "feat: ..." path/to/file1 path/to/file2
    python3 scripts/ship.py --dry-run -m "..." file...   # только проверки и отчёт

Правила (AGENTS.md, раздел 3): никаких git add -A / . / commit -a / stash / reset --hard;
data/, .deploy_backup/, scratch/, dist/ и временные файлы не коммитятся.
"""
import argparse
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FORBIDDEN_PREFIXES = ("data/", ".deploy_backup/", "scratch/", "public/dist/", "dist/", "node_modules/")
FORBIDDEN_SUFFIXES = (".log", ".tmp", ".bak", ".env", ".pem", ".key")
GATES = [
    "scripts/test_resilience_and_security.py",
    "scripts/check-ui-standards.py",
    "scripts/check-modularity-standards.py",
]
SITE = "https://synergy-group.kz/"


def run(cmd, check=True, capture=False):
    r = subprocess.run(cmd, cwd=ROOT, text=True, capture_output=capture)
    if check and r.returncode != 0:
        if capture:
            print(r.stdout, r.stderr)
        sys.exit(f"❌ Ошибка: {' '.join(cmd)}")
    return r


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-m", "--message", required=True)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--no-deploy", action="store_true", help="только коммит и push (без FTP)")
    ap.add_argument("files", nargs="+")
    args = ap.parse_args()

    files = [f.removeprefix("./") for f in args.files]
    for f in files:
        if f.startswith(FORBIDDEN_PREFIXES) or f.endswith(FORBIDDEN_SUFFIXES):
            sys.exit(f"❌ Запрещено коммитить: {f}")
        if not (ROOT / f).exists() and run(["git", "ls-files", "--", f], capture=True).stdout.strip() == "":
            sys.exit(f"❌ Файл не найден: {f}")

    # 1. git status и чужие изменения
    status = run(["git", "status", "--porcelain"], capture=True).stdout.splitlines()
    changed = {line[3:].strip().strip('"') for line in status}
    mine = [f for f in files if f in changed]
    foreign = sorted(p for p in changed if not any(p == f or p.startswith(f.rstrip("/") + "/") for f in files))
    if not mine:
        sys.exit("ℹ️ В указанных файлах нет изменений — нечего выпускать.")
    print("📋 Свои файлы:", *mine, sep="\n  ")
    print("🙈 Чужие изменения (не трогаем):", *(foreign or ["нет"]), sep="\n  ")

    # 2. Гейты
    for g in GATES:
        print(f"🔎 {g}")
        run(["python3", g], capture=True)
    print("✅ Гейты пройдены")
    if args.dry_run:
        return

    # 3. Деплой (скрипт сам собирает Vite и синхронизирует изменённые файлы)
    if not args.no_deploy:
        run(["python3", "scripts/deploy_ftp.py"])
        try:
            code = urllib.request.urlopen(SITE, timeout=15).status
        except Exception as e:  # urllib бросает на 4xx/5xx
            code = getattr(e, "code", f"ошибка: {e}")
        print(f"🌐 {SITE} -> {code}")
        if code != 200:
            sys.exit("❌ Сервер ответил не 200 — коммит не делается. При 500 откат из .deploy_backup/latest/.")

    # 4. Коммит только своих файлов и push
    run(["git", "add", "--"] + mine)
    run(["git", "commit", "-m", args.message, "--only", "--"] + mine)
    commit = run(["git", "rev-parse", "--short", "HEAD"], capture=True).stdout.strip()
    push = run(["git", "push", "origin", "HEAD"], check=False, capture=True)
    print("🚀 push:", "OK" if push.returncode == 0 else f"ПРОВАЛ\n{push.stderr}")

    # 5. Отчёт
    print("\n===== ОТЧЁТ =====")
    print("Файлы:", ", ".join(mine))
    print("Коммит:", commit)
    print("Сервер:", "не деплоился" if args.no_deploy else f"{SITE} {code}")
    print("Чужие изменения нетронуты:", ", ".join(foreign) or "нет")
    if push.returncode != 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
