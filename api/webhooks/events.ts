/**
 * Unified ERP Webhook Events Endpoint
 * Route: POST /api/webhooks/events
 * Handles stock_changed (with HMAC-SHA256 verification, local cache reset & ?refresh=1 warmup) and all ERP CDC events.
 */
import erpWebhookHandler, { verifyErpWebhookSignature } from './erp';

export { verifyErpWebhookSignature };
export default erpWebhookHandler;
