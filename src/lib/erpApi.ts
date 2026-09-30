/**
 * src/lib/erpApi.ts
 * Unified backward-compatible API facade for Synergy ERP.
 * 
 * Domain modules are decomposed under src/lib/erp/:
 * - core.ts: erpFetch, deduplicateRequest, token handling, health check, ping
 * - ordersApi.ts: submitOrderToErp, fetchClientOrdersFromErp, updateOrderStatusInErp, submitLeadToErp
 * - catalogApi.ts: fetchCatalogFromErp, fetchSingleProductFromErp, fetchPaginatedCatalogFromErp, syncAllErpData
 * - counterpartiesApi.ts: fetchCounterpartiesFromErp, authenticateClientViaErp, fetchClientDebtFromErp, updateClientAccessInErp
 * - suppliersApi.ts: fetchSupplierNetworkStock, fetchSupplierInboundShipments, fetchSupplierDefects, fetchSuppliersFromErp
 * - reconciliationApi.ts: fetchReconciliationReportFromErp
 * - displaySettingsApi.ts: fetchDisplaySettingsFromErp, saveDisplaySettingsToErp
 * - types.ts: all shared payload and response interfaces
 */

export * from './erp';

// Explicit re-exports for backward-compatibility and strict typing
export {
  ERP_PROXY_URL,
  ERP_DIRECT_URL,
  ERP_API_URL,
  deduplicateRequest,
  getAuthHeaders,
  isTokenValid,
  erpFetch,
  checkSystemHealth,
  pingErp,
} from './erp/core';

export {
  parseSizeDimensions,
  requestOrderApprovalViaWhatsApp,
  submitOrderToErp,
  fetchClientOrdersFromErp,
  updateOrderStatusInErp,
  submitLeadToErp,
  fetchActiveReservations,
  type ActiveReservation,
  type ActiveReservationItem,
  type ActiveReservationsResponse,
} from './erp/ordersApi';

export {
  fetchCatalogFromErp,
  fetchSingleProductFromErp,
  fetchPaginatedCatalogFromErp,
  syncAllErpData,
  fetchSyncBundleFromErp,
} from './erp/catalogApi';

export {
  fetchRegionalManagersFromErp,
  isCounterpartyArchivedOrMailing,
  isCounterpartyActive,
  fetchCounterpartiesFromErp,
  authenticateClientViaErp,
  broadcastClientDeactivated,
  fetchClientDebtFromErp,
  updateClientAccessInErp,
  refreshLiveClientBalance,
} from './erp/counterpartiesApi';

export {
  fetchSupplierNetworkStock,
  fetchSupplierInboundShipments,
  fetchSupplierDefects,
  fetchSuppliersFromErp,
} from './erp/suppliersApi';

export {
  fetchReconciliationReportFromErp,
} from './erp/reconciliationApi';

export {
  fetchDisplaySettingsFromErp,
  saveDisplaySettingsToErp,
} from './erp/displaySettingsApi';
