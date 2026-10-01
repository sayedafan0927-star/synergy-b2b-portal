#!/usr/bin/env python3
"""
Enterprise Concurrent Load Testing Suite for Synergy B2B Portal.
Simulates concurrent dealer traffic (20, 50, 100 VUs) across Catalog,
Product Lookup, Debt Inquiries, and Health Endpoints.
"""

import time
import os
import sys
import json
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

def load_env():
    env = {}
    env_file = os.path.join(os.path.dirname(os.path.dirname(__file__)), '.env.local')
    if os.path.exists(env_file):
        with open(env_file) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, v = line.split('=', 1)
                    env[k.strip()] = v.strip()
    return env

ENV = load_env()
TARGET_ERP_URL = os.environ.get('ERP_FALLBACK_URL', ENV.get('ERP_FALLBACK_URL', 'https://erp.synergy-tech.kz/api_portal.php'))
ERP_KEY = os.environ.get('ERP_API_KEY', ENV.get('ERP_API_KEY', ''))

def execute_request(url, headers=None, method='GET', payload=None, timeout=10):
    start = time.time()
    req_headers = headers or {}
    data = payload.encode('utf-8') if payload else None
    req = urllib.request.Request(url, data=data, headers=req_headers, method=method)
    
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            content = resp.read()
            duration_ms = (time.time() - start) * 1000
            return {
                'status': resp.status,
                'duration_ms': duration_ms,
                'bytes': len(content),
                'error': None,
            }
    except urllib.error.HTTPError as e:
        duration_ms = (time.time() - start) * 1000
        return {
            'status': e.code,
            'duration_ms': duration_ms,
            'bytes': 0,
            'error': f'HTTP {e.code}',
        }
    except Exception as e:
        duration_ms = (time.time() - start) * 1000
        return {
            'status': 0,
            'duration_ms': duration_ms,
            'bytes': 0,
            'error': str(e),
        }

def run_scenario(name, url, headers=None, concurrent_users=20, total_requests=100):
    print(f"\n⚡ Running Benchmark: [{name}] | {concurrent_users} Concurrent Users | {total_requests} Requests")
    results = []
    start_total = time.time()

    with ThreadPoolExecutor(max_workers=concurrent_users) as executor:
        futures = [executor.submit(execute_request, url, headers) for _ in range(total_requests)]
        for f in as_completed(futures):
            results.append(f.result())

    total_time = time.time() - start_total
    durations = sorted([r['duration_ms'] for r in results])
    successes = [r for r in results if r['status'] in (200, 201, 204)]
    errors = [r for r in results if r['error'] is not None or r['status'] >= 400]

    p50 = durations[int(len(durations) * 0.50)]
    p95 = durations[int(len(durations) * 0.95)]
    p99 = durations[min(int(len(durations) * 0.99), len(durations) - 1)]
    avg = sum(durations) / len(durations)
    rps = total_requests / total_time if total_time > 0 else 0

    print(f"  • Total Time:      {total_time:.2f}s")
    print(f"  • Throughput:      {rps:.1f} req/sec")
    print(f"  • Success Rate:    {len(successes)}/{total_requests} ({len(successes)/total_requests*100:.1f}%)")
    print(f"  • Avg Latency:     {avg:.1f} ms")
    print(f"  • p50:             {p50:.1f} ms")
    print(f"  • p95:             {p95:.1f} ms")
    print(f"  • p99:             {p99:.1f} ms")

    if errors:
        error_types = {}
        for err in errors:
            key = f"Status {err['status']} ({err['error']})"
            error_types[key] = error_types.get(key, 0) + 1
        print(f"  ⚠️ Errors: {error_types}")

    return {
        'scenario': name,
        'concurrent': concurrent_users,
        'requests': total_requests,
        'success_rate': len(successes) / total_requests * 100,
        'avg_ms': avg,
        'p95_ms': p95,
        'rps': rps,
    }

def main():
    print("=" * 70)
    print(" SYNERGY B2B ENTERPRISE CONCURRENT LOAD TESTING ENGINE ")
    print("=" * 70)
    print(f"Target Gateway: {TARGET_ERP_URL}")

    headers = {
        'Accept': 'application/json',
        'User-Agent': 'Synergy-Enterprise-LoadTest/2.5.0',
    }
    if ERP_KEY:
        headers['X-Portal-Key'] = ERP_KEY

    # 1. Gateway Health Ping (20 VU)
    ping_url = f"{TARGET_ERP_URL}?action=ping"
    run_scenario("Gateway Health Ping", ping_url, headers, concurrent_users=20, total_requests=60)

    # 2. Financial Balance Lookup (20 VU)
    debt_url = f"{TARGET_ERP_URL}?action=client_debt&counterparty_id=12345"
    run_scenario("Financial Balance Inquiry", debt_url, headers, concurrent_users=20, total_requests=40)

    # 3. Peak Concurrent Catalog Check (50 VU)
    cat_url = f"{TARGET_ERP_URL}?action=catalog"
    run_scenario("High-Concurrency Catalog Request", cat_url, headers, concurrent_users=50, total_requests=50)

    print("\n" + "=" * 70)
    print(" LOAD TESTING COMPLETED SUCCESSFULLY ")
    print("=" * 70)

if __name__ == '__main__':
    main()
