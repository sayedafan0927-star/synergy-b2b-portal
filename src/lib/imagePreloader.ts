import type { Product } from '@/types';

const WARMED_STORAGE_KEY = 'synergy:warmed_images_v1';

// In-memory set of verified loaded image URLs for 0ms synchronous rendering
export const loadedImageCache = new Set<string>();
const inFlightPreloads = new Set<string>();

// Hydrate known cached URLs from sessionStorage so page refreshes also skip placeholders
if (typeof window !== 'undefined') {
  try {
    const raw = sessionStorage.getItem(WARMED_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const u of parsed) {
          if (typeof u === 'string') loadedImageCache.add(u);
        }
      }
    }
  } catch {}
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

export function markImageLoaded(url: string): void {
  if (!url) return;
  loadedImageCache.add(url);
  if (typeof window === 'undefined') return;
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      const arr = Array.from(loadedImageCache).slice(-600);
      sessionStorage.setItem(WARMED_STORAGE_KEY, JSON.stringify(arr));
    } catch {}
  }, 1000);
}

export function getPrimaryStaticBase(): string {
  if (typeof window !== 'undefined' && window.location.hostname.includes('synergy-group.kz')) {
    return '/uploads/nomenclature/';
  }
  return 'https://synergy-group.kz/uploads/nomenclature/';
}

export function extractErpFileName(rawUrl: string): string | null {
  const clean = rawUrl.trim();
  const phpMatch = clean.match(/\/image\.php\?(?:[^#]*&)?f=([^&#]+)/i);
  if (phpMatch && phpMatch[1]) {
    try { return decodeURIComponent(phpMatch[1]).replace(/^\/+/, ''); }
    catch { return phpMatch[1].replace(/^\/+/, ''); }
  }
  const staticMatch = clean.match(/\/uploads\/nomenclature\/([^?#]+)/i);
  if (staticMatch && staticMatch[1]) {
    try { return decodeURIComponent(staticMatch[1]).replace(/^\/+/, ''); }
    catch { return staticMatch[1].replace(/^\/+/, ''); }
  }
  return null;
}

export function resolveCardThumbUrl(rawUrl?: string | null): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.includes('unsplash.com') || trimmed.includes('/carpets/')) return '';
  const fileName = extractErpFileName(trimmed);
  if (!fileName) return trimmed;
  const baseName = fileName.replace(/^thumb_/i, '');
  return `${getPrimaryStaticBase()}thumb_${baseName}`;
}

export function getProductPrimaryImageUrl(product: Product): string {
  const validImages = (product.images || []).filter(
    img => typeof img === 'string' && img.trim().length > 0 && !img.includes('unsplash.com') && !img.includes('/carpets/')
  );
  const raw = validImages[0] || product.image_thumb || '';
  return resolveCardThumbUrl(raw);
}

function preloadSingleUrl(url: string, highPriority = false): Promise<void> {
  if (!url || loadedImageCache.has(url) || inFlightPreloads.has(url)) {
    return Promise.resolve();
  }
  inFlightPreloads.add(url);

  return new Promise<void>(resolve => {
    const img = new Image();
    img.decoding = 'async';
    if (highPriority && 'fetchPriority' in img) {
      (img as any).fetchPriority = 'high';
    }
    const finish = (ok: boolean) => {
      inFlightPreloads.delete(url);
      if (ok) markImageLoaded(url);
      resolve();
    };
    img.onload = () => {
      if (typeof img.decode === 'function') {
        img.decode().catch(() => {}).finally(() => finish(true));
      } else {
        finish(true);
      }
    };
    img.onerror = () => finish(false);
    img.src = url;
    if (img.complete && img.naturalWidth > 0) {
      finish(true);
    }
  });
}

let activeQueueToken = 0;

/**
 * Prioritized background image preloader:
 * 1. Immediately preloads & decodes the first `immediateCount` visible product thumbnails in parallel.
 * 2. Quietly warms the rest of the catalog thumbnails in small batches so scrolling & filtering never show blank cards.
 */
export function preloadCatalogImages(products: Product[], immediateCount = 24): void {
  if (typeof window === 'undefined' || !products || products.length === 0) return;

  const urls: string[] = [];
  const seen = new Set<string>();

  for (const p of products) {
    const thumbUrl = getProductPrimaryImageUrl(p);
    if (thumbUrl && !seen.has(thumbUrl) && !loadedImageCache.has(thumbUrl)) {
      seen.add(thumbUrl);
      urls.push(thumbUrl);
    }
  }

  if (urls.length === 0) return;

  const queueToken = ++activeQueueToken;
  const highPriorityUrls = urls.slice(0, immediateCount);
  const backgroundUrls = urls.slice(immediateCount);

  // 1. Fire immediate batch (first 24 visible/near-viewport cards)
  Promise.all(highPriorityUrls.map(u => preloadSingleUrl(u, true))).then(() => {
    if (queueToken !== activeQueueToken || backgroundUrls.length === 0) return;

    // 2. Drain remaining catalog thumbnails in small concurrent batches of 4
    let index = 0;
    const CONCURRENCY = 4;

    const scheduleNextBatch = () => {
      if (queueToken !== activeQueueToken || index >= backgroundUrls.length) return;
      const batch = backgroundUrls.slice(index, index + CONCURRENCY);
      index += CONCURRENCY;

      Promise.all(batch.map(u => preloadSingleUrl(u, false))).then(() => {
        if (queueToken !== activeQueueToken || index >= backgroundUrls.length) return;
        if ('requestIdleCallback' in window) {
          (window as any).requestIdleCallback(scheduleNextBatch, { timeout: 400 });
        } else {
          setTimeout(scheduleNextBatch, 60);
        }
      });
    };

    scheduleNextBatch();
  });
}
