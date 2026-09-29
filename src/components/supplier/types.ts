import type { Profile } from '@/contexts/AuthContext';

export interface SupplierCabinetProps {
  profile: Profile;
  isAdmin?: boolean;
}

export interface SupplierItem {
  id: number;
  name: string;
  country?: string;
}

export const FALLBACK_SUPPLIERS: SupplierItem[] = [
  { id: 6, name: 'ISMEN (Турция)' },
  { id: 7, name: 'MERINOS (Турция)' },
  { id: 10, name: 'KARMEN HALI (Турция)' },
  { id: 11, name: 'SAYDAM (Турция)' },
  { id: 1, name: 'Merinos Россия (Россия)' },
  { id: 8, name: 'IRAN (Иран)' },
  { id: 9, name: 'GHEYTARAN (Иран)' },
  { id: 12, name: 'LYSANDRA HALI (Турция)' },
];

export type SupplierSubTab = 'stock' | 'releases' | 'inbound' | 'defects';
