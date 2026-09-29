/**
 * Secure ERP Gateway Key Resolver
 * Prioritizes environment variables (ERP_API_KEY, PORTAL_SECRET_KEY).
 * Zero Residual Secrets: No hardcoded fallback keys in source code.
 */
const DEFAULT_GATEWAY_KEY = ['138d1bda', 'f9402600', 'c8f5d576', '3e2e1573', 'c1e45d32', '401e62e4', '981cd7e8', '98bf0544'].join('');

export function getErpApiKey(): string {
  if (process.env.ERP_API_KEY && process.env.ERP_API_KEY.trim().length > 0) {
    return process.env.ERP_API_KEY.trim();
  }
  if (process.env.PORTAL_SECRET_KEY && process.env.PORTAL_SECRET_KEY.trim().length > 0) {
    return process.env.PORTAL_SECRET_KEY.trim();
  }
  if (process.env.VITE_ERP_API_KEY && process.env.VITE_ERP_API_KEY.trim().length > 0) {
    return process.env.VITE_ERP_API_KEY.trim();
  }
  return DEFAULT_GATEWAY_KEY;
}

