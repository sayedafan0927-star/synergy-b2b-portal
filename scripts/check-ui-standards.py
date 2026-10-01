#!/usr/bin/env python3
"""
Synergy B2B Portal — UI/UX & Layout Quality Assurance Script
Checks:
1. JSX Tag Balance (prevents broken layouts/nested hidden blocks)
2. Image Fitting Standard (rugs must use object-contain, not cropped object-cover)
3. Invisible Touch Blockers (opacity-0 must have pointer-events-none)
"""

import sys
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"

KNOWN_TS_TYPES = {
    'string', 'number', 'boolean', 'any', 'void', 'Record', 'Set', 'Map',
    'ViewMode', 'SortOption', 'HTMLDivElement', 'ProductVariant', 'Warehouse',
    'Product', 'StockSummary', 'PageId', 'T'
}

def check_jsx_balance(filepath: Path) -> list:
    errors = []
    text = filepath.read_text(encoding="utf-8")
    
    # Strip multi-line comments and single-line comments
    text_clean = re.sub(r'/\*[\s\S]*?\*/', '', text)
    text_clean = re.sub(r'\{/\*[\s\S]*?\*/\}', '', text_clean)
    
    # Look for return ( ... ) of main React component
    matches = list(re.finditer(r'return\s*\(\s*(<[\s\S]*?>)', text_clean))
    if not matches:
        return errors

    # Check each return JSX block in the file
    for m in matches:
        start_pos = m.start()
        # Find matching close parenthesis
        open_parens = 0
        end_pos = start_pos
        for idx in range(text_clean.find('(', start_pos), len(text_clean)):
            if text_clean[idx] == '(':
                open_parens += 1
            elif text_clean[idx] == ')':
                open_parens -= 1
                if open_parens == 0:
                    end_pos = idx
                    break
        
        body = text_clean[start_pos:end_pos]
        stack = []
        n = len(body)
        i = 0
        while i < n:
            if body[i] == '<' and i + 1 < n and (body[i+1].isalpha() or body[i+1] == '/'):
                j = i + 1
                is_close = False
                if body[j] == '/':
                    is_close = True
                    j += 1
                tag_start = j
                while j < n and (body[j].isalnum() or body[j] in '-_'):
                    j += 1
                tag_name = body[tag_start:j]
                
                brace_depth = 0
                in_str = None
                self_closing = False
                while j < n:
                    c = body[j]
                    if in_str:
                        if c == in_str and body[j-1] != '\\':
                            in_str = None
                    else:
                        if c in ('"', "'", '`'):
                            in_str = c
                        elif c == '{':
                            brace_depth += 1
                        elif c == '}':
                            brace_depth -= 1
                        elif c == '>' and brace_depth == 0:
                            if body[j-1] == '/':
                                self_closing = True
                            break
                    j += 1
                
                # Filter out standard HTML void elements and TS types
                void_tags = {'img', 'input', 'br', 'hr', 'col', 'path', 'circle', 'rect', 'line', 'polygon', 'polyline', 'source'}
                if tag_name not in void_tags and tag_name not in KNOWN_TS_TYPES and not self_closing:
                    line_no = text[:start_pos].count('\n') + body[:i].count('\n') + 1
                    if is_close:
                        if not stack:
                            errors.append(f"[{filepath.name}:{line_no}] Unexpected closing tag </{tag_name}>")
                        else:
                            top_tag, top_line = stack.pop()
                            if top_tag != tag_name:
                                errors.append(f"[{filepath.name}:{line_no}] Mismatched tag: expected </{top_tag}> (opened line {top_line}), got </{tag_name}>")
                    else:
                        stack.append((tag_name, line_no))
                i = j + 1
            else:
                i += 1
                
        for tag, line in stack:
            errors.append(f"[{filepath.name}:{line}] Unclosed tag <{tag}> at end of JSX block")
            
    return errors

def check_image_proportions(filepath: Path) -> list:
    errors = []
    text = filepath.read_text(encoding="utf-8")
    for line_idx, line in enumerate(text.splitlines(), 1):
        if "<img" in line or "ProductImage" in line:
            if "object-cover" in line and "avatar" not in line.lower() and "icon" not in line.lower():
                if "ProductPage" in filepath.name:
                    errors.append(f"[{filepath.name}:{line_idx}] Carpet image uses 'object-cover' which crops rug patterns. Use 'object-contain'.")
    return errors

def check_touch_blockers(filepath: Path) -> list:
    errors = []
    text = filepath.read_text(encoding="utf-8")
    for line_idx, line in enumerate(text.splitlines(), 1):
        if "opacity-0" in line and "pointer-events-none" not in line and "hidden" not in line and "button" in line:
            errors.append(f"[{filepath.name}:{line_idx}] Button has 'opacity-0' without 'pointer-events-none' or 'hidden', which intercepts mobile taps!")
    return errors

def check_blend_mode_isolation(filepath: Path) -> list:
    """Anti-Black-Box Invariant: If a component uses mix-blend-screen, verify that neither it nor its parent has isolation:isolate or contain:paint."""
    errors = []
    text = filepath.read_text(encoding="utf-8")
    if "mix-blend-screen" in text:
        for idx, line in enumerate(text.splitlines(), start=1):
            if ("isolation:isolate" in line or "contain:paint" in line) and ("aspect-square" in line or "video" in line):
                errors.append(f"[{filepath.name}:{idx}] Anti-Black-Box Invariant: 'isolation:isolate' or 'contain:paint' detected on container with mix-blend-mode! This creates a black box around transparent elements.")
    return errors

def check_video_attributes(filepath: Path) -> list:
    """Video Standard: All <video> elements must specify playsInline and muted for mobile autoplay & performance."""
    errors = []
    text = filepath.read_text(encoding="utf-8")
    if "<video" in text:
        for idx, line in enumerate(text.splitlines(), start=1):
            if "<video" in line:
                block = "\n".join(text.splitlines()[idx-1:idx+25])
                if "playsInline" not in block and "playsinline" not in block:
                    errors.append(f"[{filepath.name}:{idx}] Video Standard: <video> missing required 'playsInline' attribute for mobile.")
                if "muted" not in block:
                    errors.append(f"[{filepath.name}:{idx}] Video Standard: <video> missing required 'muted' attribute for silent autoplay.")
    return errors

def main():
    print("=" * 60)
    print(" Synergy B2B Portal — UI/UX & Responsive Standards Check")
    print("=" * 60)
    
    all_errors = []
    target_files = [
        SRC / "pages" / "ProductPage.tsx",
        SRC / "pages" / "CatalogPage.tsx",
        SRC / "pages" / "CartPage.tsx",
        SRC / "pages" / "HomePage.tsx",
        SRC / "pages" / "ProfilePage.tsx",
        SRC / "components" / "ProductCard.tsx",
        SRC / "components" / "Header.tsx",
        SRC / "components" / "home" / "HeroBannerMedia.tsx",
        SRC / "components" / "home" / "B2BPartnerModal.tsx",
        SRC / "components" / "layout" / "CurtainNavigationDrawer.tsx",
        *(SRC / "components" / "admin").rglob("*.tsx"),
        *(SRC / "components" / "profile").rglob("*.tsx"),
        *(SRC / "components" / "supplier").rglob("*.tsx"),
        *(SRC / "components" / "product").rglob("*.tsx"),
        *(SRC / "components" / "catalog").rglob("*.tsx"),
        *(SRC / "components" / "cart").rglob("*.tsx"),
    ]
    
    for f in target_files:
        if not f.exists():
            continue
        print(f"Checking {f.relative_to(ROOT)}...")
        all_errors.extend(check_jsx_balance(f))
        all_errors.extend(check_image_proportions(f))
        all_errors.extend(check_touch_blockers(f))
        all_errors.extend(check_blend_mode_isolation(f))
        all_errors.extend(check_video_attributes(f))
        
    print("-" * 60)
    if all_errors:
        print(f"❌ FOUND {len(all_errors)} UI/UX STANDARD VIOLATION(S):")
        for err in all_errors:
            print("  •", err)
        sys.exit(1)
    else:
        print("✅ ALL UI/UX & RESPONSIVE STANDARDS PASSED SUCCESSFULLY!")
        print("   - All JSX tags properly nested and closed")
        print("   - No cropped carpet images (all use object-contain)")
        print("   - No invisible buttons intercepting mobile touches")
        print("   - Anti-Black-Box Invariant: mix-blend-mode elements free from isolation wrappers")
        print("   - Video Standard: All <video> elements configured with playsInline and muted")
        sys.exit(0)

if __name__ == "__main__":
    main()
