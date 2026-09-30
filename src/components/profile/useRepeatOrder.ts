import { useState, useCallback } from 'react';
import { useCart } from '@/contexts/CartContext';
import { fetchCatalogFromErp } from '@/lib/erpApi';
import { mergeProducts } from '@/hooks/useProductData';
import type { Order, RepeatResult, RepeatItemAdded, RepeatItemMissing } from './types';

export function useRepeatOrder(partnerId?: string | number | null, profileId?: string | null) {
  const { addItem } = useCart();
  const [repeatingOrderId, setRepeatingOrderId] = useState<string | null>(null);
  const [repeatResult, setRepeatResult] = useState<RepeatResult | null>(null);

  const handleRepeatOrder = useCallback(async (order: Order) => {
    if (repeatingOrderId) return;
    setRepeatingOrderId(order.id);

    try {
      const clientId = partnerId
        ? Number(partnerId)
        : (profileId && !isNaN(Number(profileId)) ? Number(profileId) : undefined);

      const catalogData = await fetchCatalogFromErp(clientId);
      const rawProducts: any[] = (catalogData && catalogData.success && Array.isArray(catalogData.products))
        ? catalogData.products
        : [];
      const erpProducts = mergeProducts(rawProducts);

      const added: RepeatItemAdded[] = [];
      const missing: RepeatItemMissing[] = [];

      for (const item of order.items) {
        let foundProd: any;
        let foundVariant: any;

        // 1. Match by SKU or item id
        if (item.sku || item.id) {
          for (const p of erpProducts) {
            const v = p.variants?.find((vr: any) =>
              (item.sku && vr.sku === item.sku) ||
              (item.id && (String(vr.id) === String(item.id) || vr.sku === item.id))
            );
            if (v) {
              foundProd = p;
              foundVariant = v;
              break;
            }
          }
        }

        // 2. Match by collection and size
        if (!foundVariant && item.collection && item.size) {
          const itemCol = item.collection.toLowerCase().trim();
          const itemSize = item.size.replace(/\s+/g, '');
          for (const p of erpProducts) {
            if (p.collection && p.collection.toLowerCase().trim() === itemCol) {
              const v = p.variants?.find((vr: any) => vr.size.replace(/\s+/g, '') === itemSize);
              if (v) {
                foundProd = p;
                foundVariant = v;
                break;
              }
            }
          }
        }

        // 3. Fallback match by product name and size
        if (!foundVariant && item.productName) {
          const itemSize = (item.size || '').replace(/\s+/g, '');
          for (const p of erpProducts) {
            if (p.name && p.name.toLowerCase().includes(item.productName.toLowerCase())) {
              const v = p.variants?.find((vr: any) => !itemSize || vr.size.replace(/\s+/g, '') === itemSize);
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
        const itemWhId = (item as any).warehouse_id;
        const itemWhName = (item.warehouse || '').toLowerCase().trim();
        let wh = foundVariant.warehouses?.find((w: any) =>
          ((itemWhId && w.warehouse_id === itemWhId) ||
           (itemWhName && (w.warehouse_name?.toLowerCase().includes(itemWhName) || w.city?.toLowerCase().includes(itemWhName)))) &&
          (w.stock || 0) > 0
        );

        const hadOriginalStock = Boolean(wh);

        if (!wh && Array.isArray(foundVariant.warehouses)) {
          wh = foundVariant.warehouses.find((w: any) => (w.warehouse_id === 81 || w.is_hub) && (w.stock || 0) > 0)
            || foundVariant.warehouses.find((w: any) => (w.stock || 0) > 0);
        }

        const stock = wh ? (wh.stock ?? 0) : (foundVariant.warehouses?.reduce((s: number, w: any) => s + (w.stock || 0), 0) ?? (foundVariant.stock || 0));

        if (stock <= 0) {
          missing.push({
            name: foundProd.name || item.productName,
            size: item.size,
            requestedQty: item.quantity,
            reason: 'Нет в наличии на складах',
          });
          continue;
        }

        const qtyToAdd = Math.min(item.quantity, stock);
        const prodImg = (foundProd.images && foundProd.images.length > 0) ? foundProd.images[0] : (foundProd.image_thumb || '');
        const resolvedWhName = wh?.warehouse_name || wh?.city || item.warehouse || 'Основной Склад Астана';
        const resolvedWhId = wh?.warehouse_id || (item as any).warehouse_id || 81;
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
          productId: foundProd.id,
          item_id: foundVariant.item_id || (Number(foundVariant.id) > 0 ? Number(foundVariant.id) : undefined),
          productName: foundProd.name,
          collection: foundProd.collection,
          image: prodImg,
          size: foundVariant.size,
          sku: foundVariant.sku,
          warehouse: resolvedWhName,
          warehouse_id: resolvedWhId,
          price: currentPrice,
          price_per_sqm: foundVariant.price_per_sqm,
          area_sqm: foundVariant.area_sqm,
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
