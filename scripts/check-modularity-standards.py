#!/usr/bin/env python3
"""
Synergy B2B Portal — Code Modularity & File Size Standards Guard
Prevents regression into monolithic spaghetti files without fanaticism.

Standards:
- UI Components (src/components/): Max 480 lines (warning at 380)
- Top-level Pages (src/pages/): Max 650 lines (warning at 550)
- Backend Handlers & API (api/): Max 480 lines (warning at 380)
- Libraries, Hooks & Stores (src/lib/, src/hooks/, src/contexts/): Max 450 lines (warning at 380)
- Types & Interfaces (src/types/): Max 500 lines
"""

import os
import sys

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Threshold definitions (hard limits that fail CI, soft limits that warn)
THRESHOLDS = {
    "pages": {"max": 650, "warn": 550, "name": "Top-level Page Orchestrators (src/pages/)"},
    "components": {"max": 480, "warn": 380, "name": "UI Components (src/components/)"},
    "api": {"max": 480, "warn": 380, "name": "API Handlers & Middleware (api/)"},
    "lib": {"max": 450, "warn": 380, "name": "Libraries & Stores (src/lib/, hooks/, contexts/)"},
    "types": {"max": 500, "warn": 400, "name": "Type Definitions (src/types/)"},
    "default": {"max": 450, "warn": 380, "name": "General Source Files"},
}

def get_category(rel_path: str) -> str:
    if rel_path.startswith("src/pages/"):
        return "pages"
    elif rel_path.startswith("src/components/"):
        return "components"
    elif rel_path.startswith("api/"):
        return "api"
    elif rel_path.startswith("src/types/"):
        return "types"
    elif rel_path.startswith("src/lib/") or rel_path.startswith("src/hooks/") or rel_path.startswith("src/contexts/"):
        return "lib"
    return "default"

def count_lines(filepath: str) -> int:
    with open(filepath, "r", encoding="utf-8", errors="ignore") as fp:
        return sum(1 for _ in fp)

def main():
    print("=" * 64)
    print(" Synergy B2B Portal — Code Modularity & Line Count Check")
    print("=" * 64)

    directories_to_scan = [
        os.path.join(ROOT_DIR, "src"),
        os.path.join(ROOT_DIR, "api"),
    ]

    violations = []
    warnings = []
    scanned_count = 0

    for scan_dir in directories_to_scan:
        if not os.path.exists(scan_dir):
            continue
        for root, _, files in os.walk(scan_dir):
            for file in files:
                if not (file.endswith(".ts") or file.endswith(".tsx")):
                    continue
                if file.endswith(".d.ts") or ".test." in file or ".spec." in file:
                    continue

                full_path = os.path.join(root, file)
                rel_path = os.path.relpath(full_path, ROOT_DIR).replace("\\", "/")
                lines = count_lines(full_path)
                scanned_count += 1

                cat = get_category(rel_path)
                limits = THRESHOLDS[cat]

                if lines > limits["max"]:
                    violations.append((rel_path, lines, limits["max"], limits["name"]))
                elif lines > limits["warn"]:
                    warnings.append((rel_path, lines, limits["warn"], limits["name"]))

    print(f"Scanned {scanned_count} TypeScript source files across src/ and api/.\n")

    if warnings:
        print("🟡 MODULARITY NOTICES (Approaching Soft Limit):")
        for rel_path, lines, warn_lim, cat_name in sorted(warnings, key=lambda x: -x[1]):
            print(f"   - {rel_path}: {lines} lines (soft limit: {warn_lim}) — {cat_name}")
        print()

    if violations:
        print("❌ CRITICAL MODULARITY VIOLATIONS (Exceeds Hard Threshold):")
        for rel_path, lines, max_lim, cat_name in sorted(violations, key=lambda x: -x[1]):
            print(f"   [FAIL] {rel_path}: {lines} lines > MAX {max_lim} ({cat_name})")
        print("\nAction required: Decompose these monolithic files into submodules before pushing.")
        sys.exit(1)

    print("✅ ALL SOURCE FILES COMPLY WITH ENTERPRISE MODULARITY STANDARDS!")
    print("   - No monolithic components (> 480 lines)")
    print("   - No oversized API route handlers (> 480 lines)")
    print("   - Page orchestrators stay within bounds (<= 650 lines)\n")
    sys.exit(0)

if __name__ == "__main__":
    main()
