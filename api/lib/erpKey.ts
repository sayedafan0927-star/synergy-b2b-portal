/**
 * Secure ERP Gateway Key Resolver
 * Prioritizes environment variables (ERP_API_KEY, PORTAL_SECRET_KEY, ERP_PORTAL_SECRET).
 * Zero Residual Secrets: No hardcoded fallback keys in source code.
 */
export function getErpApiKey(): string {
  if (process.env.ERP_API_KEY && process.env.ERP_API_KEY.trim().length > 0) {
    return process.env.ERP_API_KEY.trim();
  }
  if (process.env.PORTAL_SECRET_KEY && process.env.PORTAL_SECRET_KEY.trim().length > 0) {
    return process.env.PORTAL_SECRET_KEY.trim();
  }
  if (process.env.ERP_PORTAL_SECRET && process.env.ERP_PORTAL_SECRET.trim().length > 0) {
    return process.env.ERP_PORTAL_SECRET.trim();
  }
  return '';
}
