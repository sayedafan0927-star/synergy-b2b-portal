import { useState } from 'react';
import { X, ShieldAlert, PlusCircle, Image as ImageIcon } from 'lucide-react';
import { Portal } from '@/components/common/Portal';
import { supabase } from '@/lib/supabase';
import { parseSizeDimensions } from '@/types';
import type { SupplierDefectItem } from '@/types';
import { useToast } from '@/contexts/ToastContext';

export interface CreateDefectModalProps {
  isOpen: boolean;
  onClose: () => void;
  supplierId: number;
  supplierName?: string;
  onDefectCreated: (defect: SupplierDefectItem) => void;
}

const WAREHOUSE_OPTIONS = [
  { id: 81, name: 'Основной Склад Астана', city: 'Астана' },
  { id: 82, name: 'Филиал Алматы', city: 'Алматы' },
  { id: 83, name: 'Филиал Шымкент', city: 'Шымкент' },
  { id: 84, name: 'Филиал Караганда', city: 'Караганда' },
];

export function CreateDefectModal({
  isOpen,
  onClose,
  supplierId,
  supplierName = 'Поставщик',
  onDefectCreated,
}: CreateDefectModalProps) {
  const toast = useToast();
  const [article, setArticle] = useState('');
  const [collection, setCollection] = useState('');
  const [size, setSize] = useState('2.00x3.00');
  const [warehouseId, setWarehouseId] = useState(81);
  const [defectType, setDefectType] = useState<'factory_defect' | 'transit_damage' | 'client_return'>('factory_defect');
  const [responsibleParty, setResponsibleParty] = useState('Фабрика');
  const [qtyPcs, setQtyPcs] = useState(1);
  const [comment, setComment] = useState('');
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [photoUrlInput, setPhotoUrlInput] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleAddPhoto = () => {
    if (!photoUrlInput.trim()) return;
    setPhotoUrls((prev) => [...prev, photoUrlInput.trim()]);
    setPhotoUrlInput('');
  };

  const handleRemovePhoto = (index: number) => {
    setPhotoUrls((prev) => prev.filter((_, i) => i !== index));
  };

  if (!isOpen) return null;

  const { w, h } = parseSizeDimensions(size);
  const calculatedArea = Number((w * h * qtyPcs).toFixed(2));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!article.trim() || !collection.trim()) {
      toast.warning('Заполните артикул и коллекцию ковра');
      return;
    }

    setSubmitting(true);
    const selectedWh = WAREHOUSE_OPTIONS.find((w) => w.id === warehouseId) || WAREHOUSE_OPTIONS[0];
    const generatedActNum = `АКТ-2026-${Math.floor(1000 + Math.random() * 9000)}`;
    const today = new Date().toISOString().split('T')[0];

    const typeLabels: Record<string, string> = {
      factory_defect: 'Фабричный брак (разнооттеночность/нить)',
      transit_damage: 'Транспортное повреждение / залом',
      client_return: 'Возврат дилера с рекламацией',
    };

    const newDefect: SupplierDefectItem = {
      defect_id: `def-${Date.now()}`,
      act_number: generatedActNum,
      act_date: today,
      supplier_id: supplierId,
      supplier_name: supplierName,
      article: article.trim().toUpperCase(),
      collection: collection.trim(),
      size: size.trim(),
      warehouse_id: selectedWh.id,
      warehouse_name: selectedWh.name,
      city: selectedWh.city,
      qty_pcs: qtyPcs,
      area_sqm: calculatedArea > 0 ? calculatedArea : 6.0,
      defect_type: defectType,
      defect_type_label: typeLabels[defectType] || 'Брак',
      responsible_party: responsibleParty,
      comment: comment.trim() || undefined,
      photo_urls: photoUrls.length > 0 ? photoUrls : undefined,
      status: 'inspecting',
      status_label: 'На экспертизе',
    };

    try {
      // Пытаемся сохранить в таблицу defect_reports в Supabase
      await supabase.from('defect_reports').insert({
        act_number: newDefect.act_number,
        act_date: newDefect.act_date,
        supplier_id: newDefect.supplier_id,
        supplier_name: newDefect.supplier_name,
        article: newDefect.article,
        collection: newDefect.collection,
        size: newDefect.size,
        warehouse_id: newDefect.warehouse_id,
        warehouse_name: newDefect.warehouse_name,
        city: newDefect.city,
        qty_pcs: newDefect.qty_pcs,
        area_sqm: newDefect.area_sqm,
        defect_type: newDefect.defect_type,
        responsible_party: newDefect.responsible_party,
        comment: newDefect.comment,
        photo_urls: newDefect.photo_urls,
        status: newDefect.status,
      });
    } catch (err) {
      console.warn('[CreateDefectModal] Supabase save notice:', err);
    }

    onDefectCreated(newDefect);
    toast.success(`Акт рекламации ${generatedActNum} успешно сформирован`, 'Рекламация зафиксирована');
    setSubmitting(false);
    onClose();
  };

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
        <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 space-y-4 max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
                <ShieldAlert className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-base">Составить акт рекламации</h3>
                <p className="text-xs text-slate-500">Регистрация брака ковровой продукции для фабрики</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Артикул *</label>
                <input
                  type="text"
                  required
                  placeholder="TAB-8012-BEIGE"
                  value={article}
                  onChange={(e) => setArticle(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:border-brand-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Коллекция *</label>
                <input
                  type="text"
                  required
                  placeholder="Tabriz Gold"
                  value={collection}
                  onChange={(e) => setCollection(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:border-brand-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Размер</label>
                <input
                  type="text"
                  placeholder="2.00x3.00"
                  value={size}
                  onChange={(e) => setSize(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:border-brand-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Склад размещения</label>
                <select
                  value={warehouseId}
                  onChange={(e) => setWarehouseId(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:border-brand-500 focus:outline-none bg-white"
                >
                  {WAREHOUSE_OPTIONS.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Тип рекламации</label>
                <select
                  value={defectType}
                  onChange={(e) => setDefectType(e.target.value as any)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:border-brand-500 focus:outline-none bg-white"
                >
                  <option value="factory_defect">Фабричный брак (нить/печать)</option>
                  <option value="transit_damage">Транспортный бой / залом</option>
                  <option value="client_return">Возврат дилера с претензией</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Ответственная сторона</label>
                <select
                  value={responsibleParty}
                  onChange={(e) => setResponsibleParty(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:border-brand-500 focus:outline-none bg-white"
                >
                  <option value="Фабрика">Фабрика-изготовитель</option>
                  <option value="Транспортная компания">Транспортная компания</option>
                  <option value="Склад WMS">Склад WMS</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Количество (шт.)</label>
                <input
                  type="number"
                  min="1"
                  value={qtyPcs}
                  onChange={(e) => setQtyPcs(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:border-brand-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Площадь (м²)</label>
                <div className="w-full rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-slate-700 font-mono font-bold">
                  {calculatedArea} м²
                </div>
              </div>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Описание дефекта и комментарий</label>
              <textarea
                rows={2}
                placeholder="Укажите характер повреждения (залом ворса, повреждение оверлока, пятно)..."
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:border-brand-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Фотофиксация дефекта (URL ссылки на фото)</label>
              <div className="flex gap-2">
                <input
                  type="url"
                  placeholder="https://.../carpet-defect.jpg"
                  value={photoUrlInput}
                  onChange={(e) => setPhotoUrlInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddPhoto();
                    }
                  }}
                  className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-slate-900 focus:border-brand-500 focus:outline-none text-xs"
                />
                <button
                  type="button"
                  onClick={handleAddPhoto}
                  className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold transition-colors cursor-pointer text-xs"
                >
                  + Фото
                </button>
              </div>
              {photoUrls.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {photoUrls.map((url, idx) => (
                    <div key={idx} className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-2 py-1 rounded-md text-[11px] text-slate-700">
                      <ImageIcon className="h-3 w-3 text-brand-600 shrink-0" />
                      <span className="max-w-[140px] truncate">{url}</span>
                      <button
                        type="button"
                        onClick={() => handleRemovePhoto(idx)}
                        className="text-slate-400 hover:text-rose-600 cursor-pointer p-0.5"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                Отмена
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-semibold shadow-sm transition-all cursor-pointer disabled:opacity-50"
              >
                <PlusCircle className="h-4 w-4" />
                {submitting ? 'Формирование...' : 'Зарегистрировать акт'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Portal>
  );
}

export default CreateDefectModal;
