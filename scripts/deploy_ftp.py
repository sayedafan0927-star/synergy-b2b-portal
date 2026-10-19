#!/usr/bin/env python3
"""
Synergy B2B Portal — Automated FTP Deployment Script.
Deploys built assets (dist/) and server files to production server:
  Host: 212.116.233.173:21
  Target: https://synergy-group.kz
"""

import os
import sys
import ftplib
import argparse
import subprocess
import hashlib
import time

FTP_HOST = os.environ.get("FTP_HOST", "212.116.233.173")
FTP_PORT = int(os.environ.get("FTP_PORT", 21))
FTP_USER = os.environ.get("FTP_USER", "ftp_synergygroupkz")
FTP_PASS = os.environ.get("FTP_PASS", "FWK1KxaX@skASL")

NODE_BIN = "/Users/mechta/.gemini/antigravity/bin/node"
PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def run_build():
    print("🚀 Building frontend with Vite...")
    vite_bin = os.path.join(PROJECT_DIR, "node_modules", ".bin", "vite")
    cmd = [NODE_BIN, vite_bin, "build"]
    res = subprocess.run(cmd, cwd=PROJECT_DIR, capture_output=True, text=True)
    if res.returncode != 0:
        print("❌ Vite build failed:")
        print(res.stderr or res.stdout)
        sys.exit(1)
    print("✅ Build successful!")


def get_ftp_connection():
    print(f"📡 Connecting to FTP {FTP_HOST}:{FTP_PORT} as {FTP_USER}...")
    ftp = ftplib.FTP()
    ftp.connect(FTP_HOST, FTP_PORT, timeout=30)
    ftp.login(FTP_USER, FTP_PASS)
    print("✅ Connected to FTP server.")
    return ftp


def ensure_remote_dir(ftp: ftplib.FTP, remote_dir: str):
    parts = remote_dir.strip("/").split("/")
    current = ""
    for part in parts:
        if not part:
            continue
        current += "/" + part
        try:
            ftp.cwd(current)
        except ftplib.error_perm:
            try:
                ftp.mkd(current)
                ftp.cwd(current)
            except Exception as e:
                pass
    ftp.cwd("/")


def upload_file(ftp: ftplib.FTP, local_path: str, remote_path: str):
    remote_dir = os.path.dirname(remote_path)
    if remote_dir:
        ensure_remote_dir(ftp, remote_dir)
    with open(local_path, "rb") as f:
        ftp.storbinary(f"STOR {remote_path}", f)


def get_remote_file_size(ftp: ftplib.FTP, remote_path: str):
    try:
        return ftp.size(remote_path)
    except Exception:
        return None


import json

CACHE_FILE = "/tmp/synergy_ftp_sha256_cache.json"


def load_hash_cache() -> dict:
    try:
        if os.path.exists(CACHE_FILE):
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return {}


def save_hash_cache(cache: dict):
    try:
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(cache, f)
    except Exception:
        pass


def compute_sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def sync_directory(ftp: ftplib.FTP, local_dir: str, remote_base: str, force: bool = False):
    """Syncs a local directory to a remote directory on the FTP server."""
    count = 0
    skipped = 0
    total_bytes = 0
    start_time = time.time()
    hash_cache = load_hash_cache()

    for root, dirs, files in os.walk(local_dir):
        # Exclude hidden files or OS junk
        files = [f for f in files if not f.startswith(".") and f != ".DS_Store"]
        dirs[:] = [d for d in dirs if not d.startswith(".") and d != "__MACOSX"]

        rel_root = os.path.relpath(root, local_dir)
        if rel_root == ".":
            remote_dir = remote_base
        else:
            remote_dir = os.path.join(remote_base, rel_root).replace("\\", "/")

        ensure_remote_dir(ftp, remote_dir)

        for file in files:
            local_file = os.path.join(root, file)
            remote_file = os.path.join(remote_dir, file).replace("\\", "/")
            file_size = os.path.getsize(local_file)
            file_hash = compute_sha256(local_file)

            # Always upload entrypoints, manifests, and PHP endpoints regardless of size
            is_critical_entry = file in ("index.html", "sw.js", "manifest.json") or file.endswith(".html") or file.endswith(".php")
            is_hashed_asset = remote_file.startswith("dist/assets/")

            if not force and not is_critical_entry:
                rem_size = get_remote_file_size(ftp, remote_file)
                if rem_size is not None and rem_size == file_size:
                    if is_hashed_asset or hash_cache.get(remote_file) == file_hash:
                        hash_cache[remote_file] = file_hash
                        skipped += 1
                        continue

            print(f"  ⬆️ Uploading: {remote_file} ({file_size} bytes)")
            upload_file(ftp, local_file, remote_file)
            hash_cache[remote_file] = file_hash
            count += 1
            total_bytes += file_size

    save_hash_cache(hash_cache)
    elapsed = time.time() - start_time
    print(f"✨ Synced {count} files ({total_bytes / 1024:.1f} KB), skipped {skipped} unchanged in {elapsed:.2f}s")


def main():
    parser = argparse.ArgumentParser(description="Deploy Synergy Portal to FTP")
    parser.add_argument("--build", action="store_true", help="Run vite build before uploading")
    parser.add_argument("--dist-only", action="store_true", help="Only upload dist/ directory")
    parser.add_argument("--force", action="store_true", help="Force upload all files, ignoring size check")
    parser.add_argument("--file", type=str, help="Upload a single file (relative to project root)")
    args = parser.parse_args()

    if args.build or args.dist_only or not args.file:
        run_build()

    ftp = get_ftp_connection()
    try:
        if args.file:
            local_file = os.path.join(PROJECT_DIR, args.file)
            if not os.path.exists(local_file):
                print(f"❌ File not found: {local_file}")
                sys.exit(1)
            remote_file = args.file.replace("\\", "/")
            print(f"⬆️ Uploading single file: {remote_file}")
            upload_file(ftp, local_file, remote_file)
            print("✅ Upload complete.")
        elif args.dist_only:
            print("📦 Syncing dist/ directory...")
            sync_directory(ftp, os.path.join(PROJECT_DIR, "dist"), "dist", force=args.force)
        else:
            print("📦 Syncing dist/ directory to production...")
            sync_directory(ftp, os.path.join(PROJECT_DIR, "dist"), "dist", force=args.force)
            
            # Also sync any critical backend/api files if updated
            print("📦 Syncing api/ directory...")
            sync_directory(ftp, os.path.join(PROJECT_DIR, "api"), "api", force=args.force)
            
            # Sync index.html at root if needed
            print("📦 Syncing root files...")
            upload_file(ftp, os.path.join(PROJECT_DIR, "index.html"), "index.html")
            upload_file(ftp, os.path.join(PROJECT_DIR, "package.json"), "package.json")
            if os.path.exists(os.path.join(PROJECT_DIR, "AGENTS.md")):
                upload_file(ftp, os.path.join(PROJECT_DIR, "AGENTS.md"), "AGENTS.md")
    finally:
        ftp.quit()
        print("🔒 FTP session closed.")


if __name__ == "__main__":
    main()
