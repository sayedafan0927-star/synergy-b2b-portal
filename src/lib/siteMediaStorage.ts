export interface MediaSpecInfo {
  slot: string;
  title: string;
  recommendedResolution: string;
  width: number;
  height: number;
  aspectRatio: string;
  format: string;
  maxSizeMb: number;
  durationHint?: string;
  safeZoneNote: string;
}

export const SITE_MEDIA_SPECS: Record<string, MediaSpecInfo> = {
  heroVideoMp4: {
    slot: 'heroVideoMp4',
    title: 'Главное видео с барсом (Hero MP4)',
    recommendedResolution: '1920 × 1080 px (Full HD)',
    width: 1920,
    height: 1080,
    aspectRatio: '16:9',
    format: 'MP4 (кодек H.264, без звука / muted)',
    maxSizeMb: 5,
    durationHint: '6 сек (за 0.4 сек до конца выезжает карточка оффера, пауза 1.5 сек)',
    safeZoneNote: 'Главный объект (барс и ковёр) размещать в центральной зоне кадра (20%–80% по высоте), так как снизу наплывает белая волна (30–62 px).',
  },
  heroPoster: {
    slot: 'heroPoster',
    title: 'Постер главного видео (1-й кадр)',
    recommendedResolution: '1920 × 1080 px',
    width: 1920,
    height: 1080,
    aspectRatio: '16:9',
    format: 'WebP / JPG',
    maxSizeMb: 0.5,
    safeZoneNote: 'Должен совпадать с первым кадром видеоролика для бесшовного старта без чёрной вспышки.',
  },
  heroEndCard: {
    slot: 'heroEndCard',
    title: 'Карточка оффера в финале видео (HUD)',
    recommendedResolution: '964 × 714 px',
    width: 964,
    height: 714,
    aspectRatio: '4:3',
    format: 'WebP / PNG с прозрачным фоном',
    maxSizeMb: 0.5,
    safeZoneNote: 'Кнопка действия встроена в нижнюю часть карточки (координаты 76%–91% по высоте).',
  },
  categoryVideo: {
    slot: 'categoryVideo',
    title: 'Видео-символ страны (Турция / Иран / Китай)',
    recommendedResolution: '720 × 720 px (Квадрат)',
    width: 720,
    height: 720,
    aspectRatio: '1:1',
    format: 'MP4 (H.264) на чисто чёрном фоне (#000000)',
    maxSizeMb: 4,
    durationHint: '6–11 сек (синхронный цикл)',
    safeZoneNote: 'Используется режим наложения mix-blend-screen: чёрный фон становится полностью прозрачным на каменной текстуре.',
  },
  advantageIcon: {
    slot: 'advantageIcon',
    title: 'Иллюстрация карточки преимуществ',
    recommendedResolution: '512 × 512 px',
    width: 512,
    height: 512,
    aspectRatio: '1:1',
    format: 'WebP / PNG с прозрачным фоном',
    maxSizeMb: 0.3,
    safeZoneNote: 'Графическая иконка по центру с отступами 10% от краёв.',
  },
  b2bBackground: {
    slot: 'b2bBackground',
    title: 'Фон блока «Стать B2B-партнёром»',
    recommendedResolution: '2560 × 1138 px',
    width: 2560,
    height: 1138,
    aspectRatio: '21:9',
    format: 'WebP / JPG',
    maxSizeMb: 1,
    safeZoneNote: 'Макро-текстура ковра, поверх по центру выводится заголовок и металлическая кнопка.',
  },
};

const IDB_NAME = 'synergy_cms_media_db';
const IDB_STORE = 'media_blobs';

function openMediaDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not supported'));
      return;
    }
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const blobObjectUrlCache = new Map<string, string>();

export async function saveMediaFileToLocalCms(slotKey: string, file: File): Promise<string> {
  const idbUri = `idb://${slotKey}_${Date.now()}`;
  const db = await openMediaDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(file, idbUri);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  const objUrl = URL.createObjectURL(file);
  blobObjectUrlCache.set(idbUri, objUrl);
  return idbUri;
}

export async function resolveCmsMediaUrl(uri: string): Promise<string> {
  if (!uri || !uri.startsWith('idb://')) return uri;
  const cached = blobObjectUrlCache.get(uri);
  if (cached) return cached;
  try {
    const db = await openMediaDb();
    const blob = await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(uri);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    if (blob) {
      const objUrl = URL.createObjectURL(blob);
      blobObjectUrlCache.set(uri, objUrl);
      return objUrl;
    }
  } catch {}
  return '';
}

export interface InspectedMediaMeta {
  width: number;
  height: number;
  aspectRatio: string;
  durationSec?: number;
  sizeBytes?: number;
}

function formatAspectRatio(w: number, h: number): string {
  if (!w || !h) return '—';
  const ratio = w / h;
  if (Math.abs(ratio - 16 / 9) < 0.05) return '16:9';
  if (Math.abs(ratio - 1) < 0.05) return '1:1';
  if (Math.abs(ratio - 4 / 3) < 0.06) return '4:3';
  if (Math.abs(ratio - 21 / 9) < 0.12) return '21:9';
  return `${ratio.toFixed(2)}:1`;
}

export function inspectMediaElement(
  source: File | string,
  mediaType: 'video' | 'image'
): Promise<InspectedMediaMeta | null> {
  if (typeof document === 'undefined') return Promise.resolve(null);
  return new Promise(resolve => {
    const isFile = typeof source !== 'string';
    const url = isFile ? URL.createObjectURL(source) : source;
    const sizeBytes = isFile ? source.size : undefined;
    const cleanup = () => {
      if (isFile) URL.revokeObjectURL(url);
    };

    if (mediaType === 'video') {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      const timer = setTimeout(() => { cleanup(); resolve(null); }, 6000);
      video.onloadedmetadata = () => {
        clearTimeout(timer);
        const w = video.videoWidth || 0;
        const h = video.videoHeight || 0;
        const dur = video.duration && !Number.isNaN(video.duration) ? Math.round(video.duration * 10) / 10 : undefined;
        cleanup();
        resolve({ width: w, height: h, aspectRatio: formatAspectRatio(w, h), durationSec: dur, sizeBytes });
      };
      video.onerror = () => { clearTimeout(timer); cleanup(); resolve(null); };
      video.src = url;
    } else {
      const img = new Image();
      const timer = setTimeout(() => { cleanup(); resolve(null); }, 6000);
      img.onload = () => {
        clearTimeout(timer);
        const w = img.naturalWidth || 0;
        const h = img.naturalHeight || 0;
        cleanup();
        resolve({ width: w, height: h, aspectRatio: formatAspectRatio(w, h), sizeBytes });
      };
      img.onerror = () => { clearTimeout(timer); cleanup(); resolve(null); };
      img.src = url;
    }
  });
}
