import { useState, useCallback } from 'react';
import { useCart } from '@/contexts/CartContext';
import { fetchCatalogFromErp } from '@/lib/erpApi';
import { mergeProducts } from '@/hooks/useProductData';
import { parse1CNomenclature } from '@/lib/nomenclatureParser';
import type { Order, RepeatResult, RepeatItemAdded, RepeatItemMissing } from './types';

function normalizeSize(s?: string): string {
  if (!s) return '';
  return s
    .replace(/,/g, '.')
    .replace(/[*xXхХ]/g, '×')
    .replace(/\s+/g, '')
    .trim();
}

export function useRepeatOrder(partnerId?: string | number | null, profileId?: string | null) {
  const { addItem } = useCart();
  const [repeatingOrderId, setRepeatingOrderId] = useState<string | null>(null);
  const [repeatResult, setRepeatResult] = useState<RepeatResult | null>(null);

  const handleRepeatOrder = useCallback(async (order: Order) => {
    if (repeatingOrderId) return;
    setRepeatingOrderId(order.id);

    try {
      const clientId = partnerId
        ? (Number(String(partnerId).replace(/\D+/g, '')) || undefined)
        : (profileId && !isNaN(Number(profileId)) ? Number(profileId) : undefined);

      // Запрашиваем актуальный каталог из ERP
      const catalogData = await fetchCatalogFromErp(clientId, undefined, true);
      const rawProducts: any[] = (catalogData && catalogData.success && Array.isArray(catalogData.products))
        ? catalogData.products
        : [];
      const erpProducts = mergeProducts(rawProducts);

      const added: RepeatItemAdded[] = [];
      const missing: RepeatItemMissing[] = [];

      for (const item of order.items) {
        let foundProd: any;
        let foundVariant: any;

        const parsed = parse1CNomenclature(item.productName || '', item.collection);
        const targetArticle = (item.sku || parsed.sku || '').toLowerCase().trim();
        const targetCollection = (item.collection || parsed.collection || '').toLowerCase().trim();
        const normItemSize = normalizeSize(item.size) || normalizeSize(parsed.size);

        // Стратегия 1: Прямой поиск по item_id номенклатуры ERP (с верификацией размера)
        if (item.item_id) {
          for (const p of erpProducts) {
            const v = p.variants?.find((vr: any) =>
              (String(vr.item_id) === String(item.item_id) || String(vr.id) === String(item.item_id)) &&
              (!normItemSize || normalizeSize(vr.size) === normItemSize)
            );
            if (v) {
              foundProd = p;
              foundVariant = v;
              break;
            }
          }
          if (!foundVariant) {
            for (const p of erpProducts) {
              const v = p.variants?.find((vr: any) =>
                String(vr.item_id) === String(item.item_id) || String(vr.id) === String(item.item_id)
              );
              if (v) {
                foundProd = p;
                foundVariant = v;
                break;
              }
            }
          }
        }

        // Стратегия 2: Точный поиск по штрихкоду (barcode) или коду 1С
        if (!foundVariant && item.sku && item.sku.length >= 6) {
          const targetCode = item.sku.trim();
          for (const p of erpProducts) {
            const v = p.variants?.find((vr: any) =>
              vr.barcode === targetCode ||
              vr.code === targetCode ||
              (vr.sku === targetCode && (!normItemSize || normalizeSize(vr.size) === normItemSize))
            );
            if (v) {
              foundProd = p;
              foundVariant = v;
              break;
            }
          }
        }

        // Стратегия 3: Поиск по Артикулу дизайна + Размеру (+ Коллекции)
        if (!foundVariant && targetArticle && normItemSize) {
          for (const p of erpProducts) {
            const pArt = (p.article || '').toLowerCase().trim();
            const pColl = (p.collection || '').toLowerCase().trim();
            const artMatches = pArt === targetArticle || p.name?.toLowerCase().includes(targetArticle);
            const collMatches = !targetCollection ||
              pColl.includes(targetCollection) ||
              targetCollection.includes(pColl) ||
              p.name?.toLowerCase().includes(targetCollection);

            if (artMatches && collMatches) {
              const v = p.variants?.find((vr: any) => {
                const vArt = (vr.article || vr.design_article || '').toLowerCase().trim();
                const vArtMatches = !vArt || vArt === targetArticle || artMatches;
                return vArtMatches && normalizeSize(vr.size) === normItemSize;
              });
              if (v) {
                foundProd = p;
                foundVariant = v;
                break;
              }
            }
          }
        }

        // Стратегия 4: Поиск по Коллекции и Размеру
        if (!foundVariant && targetCollection && normItemSize) {
          for (const p of erpProducts) {
            const pColl = (p.collection || '').toLowerCase().trim();
            if (pColl === targetCollection || pColl.includes(targetCollection) || targetCollection.includes(pColl)) {
              const v = p.variants?.find((vr: any) => normalizeSize(vr.size) === normItemSize);
              if (v) {
                foundProd = p;
                foundVariant = v;
                break;
              }
            }
          }
        }

        // Стратегия 5: Поиск по названию товара и размеру
        if (!foundVariant && item.productName && normItemSize) {
          const rawName = item.productName.toLowerCase();
          for (const p of erpProducts) {
            const pName = (p.name || '').toLowerCase();
            if (pName && (rawName.includes(pName) || pName.includes(rawName.slice(0, 15)))) {
              const v = p.variants?.find((vr: any) => normalizeSize(vr.size) === normItemSize);
              if (v) {
                foundProd = p;
                foundVariant = v;
                break;
              }
            }
          }
        }

        // Стратегия 6: Поиск по ID родительского товара (productId) и размеру
        if (!foundVariant && item.productId) {
          const targetProdId = String(item.productId);
          for (const p of erpProducts) {
            if (String(p.id) === targetProdId) {
              const v = p.variants?.find((vr: any) => !normItemSize || normalizeSize(vr.size) === normItemSize);
              if (v) {
                foundProd = p;
                foundVariant = v;
                break;
              }
            }
          }
        }

        if (!foundVariant || !foundProd) {
          missing.push({
            name: item.productName || item.collection,
            size: item.size,
            requestedQty: item.quantity,
            reason: 'Товар отсутствует в текущем каталоге',
          });
          continue;
        }

        // Мультискладской подбор остатка: приоритет оригинальному складу заказа, затем хабам
        const itemWhId = item.warehouse_id || (item as any).warehouse_id;
        const itemWhName = (item.warehouse || '').toLowerCase().trim();
        let wh = foundVariant.warehouses?.find((w: any) =>
          ((itemWhId && w.warehouse_id === itemWhId) ||
           (itemWhName && (w.warehouse_name?.toLowerCase().includes(itemWhName) || w.city?.toLowerCase().includes(itemWhName)))) &&
          Number(w.free_stock ?? w.stock ?? 0) > 0
        );

        const hadOriginalStock = Boolean(wh);

        if (!wh && Array.isArray(foundVariant.warehouses)) {
          wh = foundVariant.warehouses.find((w: any) => (w.warehouse_id === 81 || w.is_hub) && Number(w.free_stock ?? w.stock ?? 0) > 0)
            || foundVariant.warehouses.find((w: any) => Number(w.free_stock ?? w.stock ?? 0) > 0);
        }

        const stock = wh
          ? Number(wh.free_stock ?? wh.stock ?? 0)
          : (foundVariant.warehouses?.reduce((s: number, w: any) => s + Number(w.free_stock ?? w.stock ?? 0), 0) ?? Number(foundVariant.free_stock ?? foundVariant.stock ?? 0));

        if (stock <= 0) {
          missing.push({
            name: foundProd.name || item.productName,
            size: foundVariant.size || item.size,
            requestedQty: item.quantity,
            reason: 'Нет в наличии на складах',
          });
          continue;
        }

        const qtyToAdd = Math.min(item.quantity, stock);
        const prodImg = (foundProd.images && foundProd.images.length > 0) ? foundProd.images[0] : (foundProd.image_thumb || '');
        const resolvedWhName = wh?.warehouse_name || wh?.city || item.warehouse || 'Основной Склад Астана';
        const resolvedWhId = wh?.warehouse_id || itemWhId || 81;
        const currentPrice = Number(foundVariant.price || foundVariant.base_price || item.price || 0);

        // Детекция автоматической подмены склада при отсутствии на исходном складе
        const isWarehouseSubstituted = Boolean(
          !hadOriginalStock &&
          item.warehouse &&
          resolvedWhName &&
          !resolvedWhName.toLowerCase().includes(itemWhName) &&
          !itemWhName.includes(resolvedWhName.toLowerCase())
        );

        addItem({
          productId: String(foundProd.id),
          item_id: foundVariant.item_id || (Number(foundVariant.id) > 0 ? Number(foundVariant.id) : undefined),
          productName: foundProd.name,
          collection: foundProd.collection,
          image: prodImg,
          size: foundVariant.size,
          sku: foundVariant.sku || foundVariant.article || item.sku || '',
          warehouse: resolvedWhName,
          warehouse_id: resolvedWhId,
          price: currentPrice,
          price_per_sqm: foundVariant.price_per_sqm,
          area_sqm: foundVariant.area_sqm,
          maxStock: stock,
        }, qtyToAdd);

        added.push({
          name: foundProd.name,
          size: foundVariant.size,
          requestedQty: item.quantity,
          addedQty: qtyToAdd,
          originalWarehouse: item.warehouse,
          warehouse: resolvedWhName,
          isWarehouseSubstituted,
        });
      }

      setRepeatResult({
        orderNumber: order.orderNumber || order.id,
        added,
        missing,
      });
    } catch (err) {
      console.error('Failed to repeat order:', err);
      alert('Не удалось проверить остатки. Попробуйте еще раз.');
    } finally {
      setRepeatingOrderId(null);
    }
  }, [repeatingOrderId, partnerId, profileId, addItem]);

  const closeRepeatModal = useCallback(() => {
    setRepeatResult(null);
  }, []);

  return {
    repeatingOrderId,
    repeatResult,
    handleRepeatOrder,
    closeRepeatModal,
  };
}

export default useRepeatOrder;
