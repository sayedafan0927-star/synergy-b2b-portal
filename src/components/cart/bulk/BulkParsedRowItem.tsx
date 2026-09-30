import React from 'react';
import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import type { Product, ProductVariant } from '@/types';

export interface ParsedBulkRow {
  rawLine: string;
  article: string;
  size: string;
  qty: number;
  product?: Product;
  variant?: ProductVariant;
  status: 'matched' | 'not_found' | 'insufficient_stock';
  availableStock: number;
  price: number;
}

export const BulkParsedRowItem: React.FC<{
  row: ParsedBulkRow;
  formatPrice: (amount: number) => string;
}> = ({ row, formatPrice }) => {
  return (
    <tr className="hover:bg-slate-50/60 transition-colors">
      <td className="py-2 px-3">
        {row.status === 'matched' ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        ) : row.status === 'insufficient_stock' ? (
          <AlertTriangle className="h-4 w-4 text-amber-500" />
        ) : (
          <XCircle className="h-4 w-4 text-rose-500" />
        )}
      </td>
      <td className="py-2 px-3 font-medium text-slate-800 truncate max-w-[140px]">
        {row.article}
      </td>
      <td className="py-2 px-3 text-slate-600">{row.size}</td>
      <td className="py-2 px-3 text-right">
        <span className="font-bold">{row.qty} шт</span>
        <span className="text-[10px] text-slate-400 block">из {row.availableStock}</span>
      </td>
      <td className="py-2 px-3 text-right font-semibold text-slate-800">
        {row.price > 0 ? formatPrice(row.price * Math.min(row.qty, row.availableStock)) : '—'}
      </td>
    </tr>
  );
};
