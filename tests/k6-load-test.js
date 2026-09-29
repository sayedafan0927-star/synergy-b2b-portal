import http from 'k6/http';
import { check, sleep } from 'k6';

/**
 * Enterprise Load Test Suite for Synergy B2B Wholesale Portal
 * Tests 100 Concurrent Users across Catalog Browsing, Search, Debt Check, and Checkout
 */

export const options = {
  stages: [
    { duration: '30s', target: 20 },  // Ramp-up to 20 users
    { duration: '1m', target: 100 },   // Scale up to 100 concurrent dealers
    { duration: '2m', target: 100 },   // Stay at 100 dealers (peak load)
    { duration: '30s', target: 0 },    // Ramp-down to 0
  ],
  thresholds: {
    'http_req_duration{type:catalog}': ['p(95)<1500'],    // 95% of catalog requests under 1.5s
    'http_req_duration{type:product}': ['p(95)<500'],     // 95% of product lookups under 500ms
    'http_req_duration{type:debt}': ['p(95)<400'],        // 95% of financial cache hits under 400ms
    'http_req_duration{type:order}': ['p(95)<2500'],      // 95% of orders placed/buffered under 2.5s
    'http_req_failed': ['rate<0.01'],                     // Less than 1% failures
  },
};

const BASE_URL = __ENV.TARGET_URL || 'https://b2b.synergy.kz';

export default function () {
  // Scenario 1: Browse Catalog (Staging Cache / Sub-50ms)
  {
    const res = http.get(`${BASE_URL}/api/erp?action=catalog`, {
      tags: { type: 'catalog' },
    });
    check(res, {
      'catalog status is 200': (r) => r.status === 200,
      'catalog response has products': (r) => {
        try {
          const body = JSON.parse(r.body);
          return Array.isArray(body.products) || body.success === true;
        } catch {
          return false;
        }
      },
    });
  }

  sleep(1);

  // Scenario 2: Single Product Lookup
  {
    const res = http.get(`${BASE_URL}/api/erp?action=product&id=SAMARKAND`, {
      tags: { type: 'product' },
    });
    check(res, {
      'product status is 200 or 404': (r) => r.status === 200 || r.status === 404,
    });
  }

  sleep(0.5);

  // Scenario 3: Client Financial Balance (Cached)
  {
    const res = http.get(`${BASE_URL}/api/erp?action=client_debt&counterparty_id=12345`, {
      headers: {
        'Authorization': 'Bearer test-token',
        'X-Portal-Key': __ENV.PORTAL_KEY || '',
      },
      tags: { type: 'debt' },
    });
    check(res, {
      'debt status is 200 or 401': (r) => r.status === 200 || r.status === 401,
    });
  }

  sleep(1);

  // Scenario 4: Create Order with Mandatory Idempotency Key
  {
    const idemKey = `load-test-${__VU}-${__ITER}-${Date.now()}`;
    const payload = JSON.stringify({
      idempotency_key: idemKey,
      client_name: `Dealer #${__VU}`,
      client_phone: '+77010000000',
      items: [
        {
          sku: 'SAM-001',
          quantity: 2,
          price: 150,
          warehouse: 'Основной Склад Астана',
        },
      ],
    });

    const res = http.post(`${BASE_URL}/api/erp?action=create_order`, payload, {
      headers: {
        'Content-Type': 'application/json',
        'X-Idempotency-Key': idemKey,
        'Authorization': 'Bearer test-token',
        'X-Portal-Key': __ENV.PORTAL_KEY || '',
      },
      tags: { type: 'order' },
    });

    check(res, {
      'order status is 200, 401, 403, or 409': (r) => [200, 401, 403, 409].includes(r.status),
    });
  }

  sleep(2);
}
