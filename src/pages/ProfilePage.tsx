import { useState, useMemo, useEffect } from 'react';
import {
  Package,
  Settings,
  User,
  Users,
  LogOut,
  DollarSign,
  Eye,
  Server,
  FileText,
  RefreshCw,
} from 'lucide-react';
import type { PageId } from '@/types';
import { useAuth, type UserRole } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  fetchClientDebtFromErp,
  type ClientDebtReport,
  fetchReconciliationReportFromErp,
} from '@/lib/erpApi';
import { useShowroomMode } from '@/contexts/ShowroomModeContext';
import { useLanguage } from '@/contexts/LanguageContext';
import SupplierCabinet from '@/components/SupplierCabinet';
import LoginPage from './LoginPage';
import { AdminDisplaySettingsTab, AdminUsersTab, AdminErpSyncTab } from '@/components/admin';
import {
  type Order,
  type RepeatResult,
  roleName,
  roleColor,
  fmtPrice,
  OrderDetail,
  OrdersTab,
  SettingsTab,
  ReconciliationModal,
  RepeatOrderModal,
  useRepeatOrder,
} from '@/components/profile';

type TabId = 'orders' | 'supplier-portal' | 'admin-erp' | 'admin-users' | 'admin-display' | 'settings';

export default function ProfilePage({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const { user, profile, loading, signOut, isAdmin, realIsAdmin, isManager, isSupplier } = useAuth();
  const { t } = useLanguage();
  const adminAccess = realIsAdmin;
  const clientsAccess = realIsAdmin || isManager;
  const [activeTab, setActiveTab] = useState<TabId>(isSupplier ? 'supplier-portal' : 'orders');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [clientDebt, setClientDebt] = useState<ClientDebtReport | null>(null);
  const [loadingDebt, setLoadingDebt] = useState<boolean>(false);
  const { isShowroomMode } = useShowroomMode();
  const {
    repeatingOrderId,
    repeatResult,
    handleRepeatOrder,
    closeRepeatModal,
  } = useRepeatOrder(profile?.partner_id, profile?.id);
  const [reconciliationModalOpen, setReconciliationModalOpen] = useState(false);
  const [reconciliationPeriod, setReconciliationPeriod] = useState<'month' | 'quarter' | 'year'>('month');
  const [reconciliationLoading, setReconciliationLoading] = useState(false);
  const [reconciliationData, setReconciliationData] = useState<any | null>(null);

  const handleOpenReconciliationModal = async (period: 'month' | 'quarter' | 'year' = 'month') => {
    setReconciliationModalOpen(true);
    setReconciliationPeriod(period);
    setReconciliationLoading(true);

    try {
      const now = new Date();
      let daysAgo = 30;
      if (period === 'quarter') daysAgo = 90;
      if (period === 'year') daysAgo = 365;

      const startDate = new Date(now.getTime() - daysAgo * 86400000).toISOString().split('T')[0];
      const endDate = now.toISOString().split('T')[0];
      const partnerId = profile?.partner_id || profile?.id || '';

      const data = await fetchReconciliationReportFromErp({
        partnerId: String(partnerId),
        startDate,
        endDate,
      });

      if (data.success && data.report) {
        setReconciliationData(data.report);
      }
    } catch (e) {
      console.warn('[Profile] Reconciliation report fetch failed:', e);
      setReconciliationData(null);
    } finally {
      setReconciliationLoading(false);
    }
  };


  useEffect(() => {
    const isClient = profile?.role === 'client' || Boolean(profile?.partner_id);
    if (!profile || !isClient) return;
    let cancelled = false;
    setLoadingDebt(true);

    const loadDebt = async () => {
      try {
        const phone = profile.phone || user?.phone || (user?.user_metadata?.phone as string) || undefined;
        const partnerId = profile.partner_id ? Number(profile.partner_id) : (!isNaN(Number(profile.id)) ? Number(profile.id) : undefined);
        const res = await fetchClientDebtFromErp({ phone, counterpartyId: partnerId });
        if (!cancelled && res.success) {
          setClientDebt(res);
        }
      } catch (err) {
        console.warn('Failed to load client debt from ERP', err);
      } finally {
        if (!cancelled) setLoadingDebt(false);
      }
    };

    loadDebt();
    return () => { cancelled = true; };
  }, [profile?.id, profile?.phone, profile?.partner_id, profile?.role, user?.phone, user?.user_metadata]);

  // Договоры клиента
  const [clientContracts, setClientContracts] = useState<any[]>([]);
  const [loadingContracts, setLoadingContracts] = useState(false);

  useEffect(() => {
    if (!profile?.id || profile.role !== 'client') return;
    let isMounted = true;
    const loadContracts = async () => {
      setLoadingContracts(true);
      try {
        const { data } = await supabase
          .from('client_contracts')
          .select('*')
          .eq('client_id', profile.id)
          .order('valid_from', { ascending: false });
        if (data && isMounted) {
          setClientContracts(data);
        }
      } catch (err) {
        console.warn('Failed to load client contracts:', err);
      } finally {
        if (isMounted) setLoadingContracts(false);
      }
    };
    loadContracts();
    return () => { isMounted = false; };
  }, [profile?.id, profile?.role]);

  const handleSignOut = async () => {
    await signOut();
    onNavigate('catalog');
  };

  if (loading) {
    return (
      <section className="min-h-screen bg-slate-50 pt-20 pb-24 lg:pb-8 flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-700 border-t-transparent" />
      </section>
    );
  }

  if (!user || !profile) {
    return <LoginPage onNavigate={onNavigate} />;
  }

  const tabs: Array<{ id: TabId; label: string; icon: any; show: boolean }> = [
    { id: 'orders', label: adminAccess ? t('profile.tab_all_orders') : isManager ? t('profile.tab_client_orders') : t('profile.tab_my_orders'), icon: Package, show: !isSupplier },
    { id: 'supplier-portal', label: t('profile.tab_supplier'), icon: Package, show: isSupplier || adminAccess },
    { id: 'admin-erp', label: t('profile.tab_admin_erp'), icon: Server, show: adminAccess },
    { id: 'admin-users', label: t('profile.tab_admin_users'), icon: Users, show: clientsAccess },
    { id: 'admin-display', label: t('profile.tab_admin_display'), icon: Eye, show: adminAccess },
    { id: 'settings', label: t('profile.tab_settings'), icon: Settings, show: true },
  ];

  return (
    <section className="min-h-screen bg-slate-50 pt-20 pb-24 lg:pb-8">
      <div className="container-w space-y-6">
        {/* Page header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-200/80 pb-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">{t('profile.title')}</h1>
            <p className="text-xs sm:text-sm text-slate-500">{t('profile.subtitle')}</p>
          </div>
          <button
            onClick={handleSignOut}
            className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm font-medium text-red-600 hover:bg-red-50 transition-colors cursor-pointer shrink-0"
          >
            <LogOut className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            {t('nav.logout')}
          </button>
        </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
        {/* Sidebar */}
        <div className="space-y-4 lg:col-span-1">
          {/* User card */}
          <div className="card p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-700 font-bold text-lg">
                {(profile.full_name || profile.company_name || 'U').charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-slate-900 truncate">
                  {profile.full_name || 'Пользователь'}
                </p>
                {profile.company_name && (
                  <p className="text-xs text-slate-500 truncate">{profile.company_name}</p>
                )}
                <span className={`inline-block rounded px-2 py-0.5 text-[10px] font-semibold mt-1 ${roleColor(profile.role)}`}>
                  {t(`profile.role_${profile.role}`, roleName(profile.role))}
                </span>
              </div>
            </div>

            <div className="space-y-2 border-t border-slate-100 pt-3 text-xs text-slate-500">
              {profile.phone && (
                <div className="flex items-center gap-2">
                  <User className="h-3.5 w-3.5 text-slate-400" />
                  <span>{profile.phone}</span>
                </div>
              )}
              {profile.price_type && profile.role === 'client' && !isShowroomMode && (
                <div className="flex items-center gap-2">
                  <DollarSign className="h-3.5 w-3.5 text-slate-400" />
                  <span>{t('profile.price_type_label')} <strong className="text-slate-700">{profile.price_type === 'optom_1' ? 'Опт 1' : profile.price_type === 'optom_2' ? 'Опт 2' : profile.price_type === 'optom_3' ? 'Опт 3' : profile.price_type === 'wholesale' ? 'Базовый опт' : profile.price_type}</strong></span>
                </div>
              )}
            </div>
          </div>

          {/* Nav tabs for desktop */}
          <div className="hidden lg:block">
            <div className="card divide-y divide-slate-100 overflow-hidden">
              {tabs.filter(t => t.show).map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => { setActiveTab(id); setSelectedOrder(null); }}
                  className={`flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-medium transition-colors cursor-pointer ${
                    activeTab === id
                      ? 'bg-brand-50 text-brand-700 font-semibold'
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Client Financial Widget */}
          {profile.role === 'client' && !isShowroomMode && (
            <div className="card p-4 space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">{t('profile.financial_title')}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                  (clientDebt?.financials?.total_debt_usd ?? 0) > 0 ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'
                }`}>
                  {(clientDebt?.financials?.total_debt_usd ?? 0) > 0 ? t('profile.has_debt') : t('profile.no_debt')}
                </span>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">{t('profile.current_debt')}</span>
                  <span className={`font-bold ${
                    (clientDebt?.financials?.total_debt_usd ?? 0) > 0 ? 'text-red-600' : 'text-slate-900'
                  }`}>
                    {fmtPrice(clientDebt?.financials?.total_debt_usd ?? 0)}
                  </span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-slate-500">{t('profile.credit_limit')}</span>
                  <span className="font-semibold text-slate-700">
                    {fmtPrice(clientDebt?.client?.credit_limit_usd ?? profile.credit_limit_usd ?? 0)}
                  </span>
                </div>

                <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      (clientDebt?.financials?.total_debt_usd ?? 0) > (clientDebt?.client?.credit_limit_usd ?? profile.credit_limit_usd ?? 1)
                        ? 'bg-red-500'
                        : 'bg-emerald-500'
                    }`}
                    style={{
                      width: `${Math.min(100, Math.max(0, ((clientDebt?.financials?.total_debt_usd ?? 0) / (clientDebt?.client?.credit_limit_usd ?? profile.credit_limit_usd ?? 1)) * 100))}%`
                    }}
                  />
                </div>
                <p className="text-[10px] text-slate-400 text-center">
                  {loadingDebt ? '...' : clientDebt?.found ? `${clientDebt.client?.name}` : ''}
                </p>

                <button
                  type="button"
                  onClick={() => handleOpenReconciliationModal()}
                  className="w-full mt-2 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 transition-colors shadow-2xs cursor-pointer"
                >
                  <FileText className="h-3.5 w-3.5 text-brand-600" />
                  {t('profile.reconciliation_act')}
                </button>
              </div>
            </div>
          )}

          {/* Contracts & Agreements Card */}
          {profile.role === 'client' && !isShowroomMode && (
            <div className="card p-4">
              <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-2">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-brand-700" />
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">{t('profile.contracts_limits')}</h4>
                </div>
                {loadingContracts && <span className="text-[10px] text-slate-400 animate-pulse">{t('common.loading')}</span>}
              </div>

              {clientContracts.length > 0 ? (
                <div className="space-y-2.5">
                  {clientContracts.map((c) => (
                    <div key={c.id} className="rounded-lg bg-slate-50 border border-slate-200/80 p-2.5 text-xs space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-800">№ {c.contract_number}</span>
                        <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                          c.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'
                        }`}>
                          {c.status === 'active' ? t('profile.contract_active') : c.status}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {c.contract_type === 'prepayment' ? t('profile.contract_prepayment') : c.contract_type}
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-600 pt-1 border-t border-slate-200/60">
                        <span>{t('profile.credit_limit')}</span>
                        <span className="font-bold text-slate-900">${Number(c.credit_limit_usd).toLocaleString('en-US')}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg bg-slate-50 border border-dashed border-slate-200 p-3 text-center text-xs text-slate-400">
                  <p>{t('profile.contract_erp_note')}</p>
                  {profile.credit_limit_usd ? (
                    <p className="font-semibold text-slate-600 mt-1">{t('profile.credit_limit')} ${Number(profile.credit_limit_usd).toLocaleString('en-US')}</p>
                  ) : null}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Mobile tab bar — clean horizontal scrollable pills */}
        <div className="lg:hidden -mt-2">
          <div className="-mx-4 px-4 overflow-x-auto no-scrollbar flex items-center gap-2 pb-1">
            {tabs.filter(t => t.show).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => { setActiveTab(id); setSelectedOrder(null); }}
                className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold whitespace-nowrap transition-all cursor-pointer shrink-0 ${
                  activeTab === id
                    ? 'bg-brand-700 text-white shadow-xs'
                    : 'bg-white border border-slate-200 text-slate-700 hover:border-slate-300'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Main content */}
        <div className="lg:col-span-3">
          {activeTab === 'orders' && (
            selectedOrder ? (
              <OrderDetail
                order={selectedOrder}
                onBack={() => setSelectedOrder(null)}
                isAdmin={adminAccess || isAdmin}
                onUpdateOrder={(updated) => setSelectedOrder(updated)}
                onRepeatOrder={handleRepeatOrder}
                repeatingOrderId={repeatingOrderId}
              />
            ) : (
              <OrdersTab
                onSelectOrder={setSelectedOrder}
                isAdmin={adminAccess || isAdmin}
                isManager={isManager || clientsAccess}
                onRepeatOrder={handleRepeatOrder}
                repeatingOrderId={repeatingOrderId}
              />
            )
          )}
          {activeTab === 'supplier-portal' && (isSupplier || adminAccess) && (
            <SupplierCabinet profile={profile} isAdmin={adminAccess} />
          )}
          {activeTab === 'admin-erp' && adminAccess && <AdminErpSyncTab isAdmin={adminAccess} />}
          {activeTab === 'admin-users' && clientsAccess && <AdminUsersTab onNavigate={onNavigate} />}
          {activeTab === 'admin-display' && adminAccess && <AdminDisplaySettingsTab />}
          {activeTab === 'settings' && (
            <div className="space-y-6">
              <SettingsTab />
            </div>
          )}
        </div>
      </div>

      {/* Repeat Order Result Modal */}
      <RepeatOrderModal
        repeatResult={repeatResult}
        onClose={closeRepeatModal}
        onGoToCart={() => {
          closeRepeatModal();
          onNavigate('cart');
        }}
      />

      {/* Reconciliation Modal */}
      <ReconciliationModal
        isOpen={reconciliationModalOpen}
        onClose={() => setReconciliationModalOpen(false)}
        profile={profile}
        reconciliationPeriod={reconciliationPeriod}
        onPeriodChange={handleOpenReconciliationModal}
        loading={reconciliationLoading}
        data={reconciliationData}
      />
      </div>
    </section>
  );
}
