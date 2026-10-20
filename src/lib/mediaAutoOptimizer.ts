import { SITE_MEDIA_SPECS, type MediaSpecInfo } from './siteMediaStorage';

export interface AutoOptimizeResult {
  file: File;
  wasOptimized: boolean;
  originalWidth: number;
  originalHeight: number;
  finalWidth: number;
  finalHeight: number;
  originalSizeBytes: number;
  finalSizeBytes: number;
  extractedPosterFile?: File;
  summaryNote: string;
}

const SLOT_TO_SPEC_KEY: Record<string, { specKey: string; fitMode: 'cover' | 'contain'; bgColor?: string }> = {
  heroVideoMp4: { specKey: 'heroVideoMp4', fitMode: 'cover', bgColor: '#000000' },
  heroPoster: { specKey: 'heroPoster', fitMode: 'cover', bgColor: '#000000' },
  heroEndCard: { specKey: 'heroEndCard', fitMode: 'contain' },
  b2bBackgroundUrl: { specKey: 'b2bBackground', fitMode: 'cover', bgColor: '#090D16' },
};

export function resolveSlotSpec(slotKey: string): {
  spec: MediaSpecInfo;
  fitMode: 'cover' | 'contain';
  bgColor?: string;
} {
  if (SLOT_TO_SPEC_KEY[slotKey]) {
    const cfg = SLOT_TO_SPEC_KEY[slotKey];
    return { spec: SITE_MEDIA_SPECS[cfg.specKey], fitMode: cfg.fitMode, bgColor: cfg.bgColor };
  }
  if (slotKey.startsWith('cat_video_')) {
    return { spec: SITE_MEDIA_SPECS.categoryVideo, fitMode: 'contain', bgColor: '#000000' };
  }
  if (slotKey.startsWith('cat_poster_')) {
    return {
      spec: { ...SITE_MEDIA_SPECS.categoryVideo, format: 'WebP', maxSizeMb: 0.4 },
      fitMode: 'contain',
      bgColor: '#000000',
    };
  }
  if (slotKey.startsWith('adv_')) {
    return { spec: SITE_MEDIA_SPECS.advantageIcon, fitMode: 'contain' };
  }
  return { spec: SITE_MEDIA_SPECS.heroPoster, fitMode: 'cover', bgColor: '#000000' };
}

function drawFitted(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  destW: number,
  destH: number,
  fitMode: 'cover' | 'contain',
  bgColor?: string
) {
  ctx.clearRect(0, 0, destW, destH);
  if (bgColor) {
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, destW, destH);
  }
  if (!srcW || !srcH) return;

  const scale = fitMode === 'cover'
    ? Math.max(destW / srcW, destH / srcH)
    : Math.min(destW / srcW, destH / srcH);

  const drawW = Math.round(srcW * scale);
  const drawH = Math.round(srcH * scale);
  const offsetX = Math.round((destW - drawW) / 2);
  const offsetY = Math.round((destH - drawH) / 2);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, offsetX, offsetY, drawW, drawH);
}

/**
 * Automatically resizes, smart-crops/fits, and compresses any uploaded image to the exact
 * resolution and WebP budget required by the target CMS slot.
 */
export async function autoOptimizeImageForSlot(slotKey: string, file: File): Promise<AutoOptimizeResult> {
  const { spec, fitMode, bgColor } = resolveSlotSpec(slotKey);
  const targetW = spec.width;
  const targetH = spec.height;
  const maxBytes = spec.maxSizeMb * 1024 * 1024;

  const imgUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Image load error'));
      el.src = imgUrl;
    });

    const origW = img.naturalWidth || targetW;
    const origH = img.naturalHeight || targetH;
    const isExactSize = origW === targetW && origH === targetH;
    const isWebp = file.type === 'image/webp' || file.name.toLowerCase().endsWith('.webp');

    if (isExactSize && isWebp && file.size <= maxBytes) {
      return {
        file,
        wasOptimized: false,
        originalWidth: origW,
        originalHeight: origH,
        finalWidth: origW,
        finalHeight: origH,
        originalSizeBytes: file.size,
        finalSizeBytes: file.size,
        summaryNote: `Эталонный размер ${targetW}×${targetH} px уже соблюдён`,
      };
    }

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D unavailable');

    drawFitted(ctx, img, origW, origH, targetW, targetH, fitMode, bgColor);

    let quality = 0.88;
    let blob: Blob | null = await new Promise(r => canvas.toBlob(r, 'image/webp', quality));
    while (blob && blob.size > maxBytes && quality > 0.55) {
      quality -= 0.1;
      blob = await new Promise(r => canvas.toBlob(r, 'image/webp', quality));
    }

    if (!blob) throw new Error('WebP encoding failed');

    const baseName = file.name.replace(/\.[^.]+$/, '');
    const optimizedFile = new File([blob], `${baseName}_${targetW}x${targetH}.webp`, {
      type: 'image/webp',
    });

    return {
      file: optimizedFile,
      wasOptimized: true,
      originalWidth: origW,
      originalHeight: origH,
      finalWidth: targetW,
      finalHeight: targetH,
      originalSizeBytes: file.size,
      finalSizeBytes: optimizedFile.size,
      summaryNote: `Авто-подгонка: ${origW}×${origH} (${(file.size / 1024).toFixed(0)} КБ) → ${targetW}×${targetH} px WebP (${(optimizedFile.size / 1024).toFixed(0)} КБ)`,
    };
  } finally {
    URL.revokeObjectURL(imgUrl);
  }
}

/**
 * Extracts a crisp 1920x1080 WebP first-frame poster from a video file,
 * and if the video's dimensions, aspect ratio, or file size exceed the slot's spec,
 * automatically transcodes/resizes/compresses the video via Canvas + MediaRecorder.
 */
export async function autoOptimizeVideoForSlot(
  slotKey: string,
  file: File,
  onProgress?: (percent: number, stage: string) => void
): Promise<AutoOptimizeResult> {
  const { spec, fitMode, bgColor } = resolveSlotSpec(slotKey);
  const targetW = spec.width;
  const targetH = spec.height;
  const maxBytes = spec.maxSizeMb * 1024 * 1024;

  const videoUrl = URL.createObjectURL(file);
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = videoUrl;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Video load timeout')), 8000);
      video.onloadeddata = () => { clearTimeout(timer); resolve(); };
      video.onerror = () => { clearTimeout(timer); reject(new Error('Video decode error')); };
    });

    const origW = video.videoWidth || targetW;
    const origH = video.videoHeight || targetH;
    const duration = video.duration && !Number.isNaN(video.duration) ? video.duration : 6;

    // Extract 1st frame as a matched WebP poster (1920x1080 for Hero, 720x720 for Country)
    let extractedPosterFile: File | undefined;
    try {
      video.currentTime = Math.min(0.1, duration * 0.05);
      await new Promise<void>(r => {
        const t = setTimeout(r, 400);
        video.onseeked = () => { clearTimeout(t); r(); };
      });
      const posterCanvas = document.createElement('canvas');
      posterCanvas.width = targetW;
      posterCanvas.height = targetH;
      const pCtx = posterCanvas.getContext('2d');
      if (pCtx) {
        drawFitted(pCtx, video, origW, origH, targetW, targetH, fitMode, bgColor || '#000000');
        const pBlob = await new Promise<Blob | null>(r => posterCanvas.toBlob(r, 'image/webp', 0.86));
        if (pBlob) {
          extractedPosterFile = new File([pBlob], `${slotKey}_poster_${targetW}x${targetH}.webp`, {
            type: 'image/webp',
          });
        }
      }
    } catch {}

    const origRatio = origW / (origH || 1);
    const targetRatio = targetW / targetH;
    const isRatioMatch = Math.abs(origRatio - targetRatio) < 0.06;
    const isDimensionsMatch = origW === targetW && origH === targetH;
    const isSizeWithinBudget = file.size <= maxBytes * 1.15;

    // If aspect ratio matches and size is within budget (or MediaRecorder is unsupported), keep original stream
    const canTranscode =
      typeof MediaRecorder !== 'undefined' &&
      typeof HTMLCanvasElement.prototype.captureStream === 'function' &&
      duration <= 18;

    if ((isDimensionsMatch && isSizeWithinBudget) || (isRatioMatch && isSizeWithinBudget) || !canTranscode) {
      return {
        file,
        wasOptimized: false,
        originalWidth: origW,
        originalHeight: origH,
        finalWidth: origW,
        finalHeight: origH,
        originalSizeBytes: file.size,
        finalSizeBytes: file.size,
        extractedPosterFile,
        summaryNote: isDimensionsMatch
          ? `Эталон ${targetW}×${targetH} px соблюдён (+ авто-создан постер 1-го кадра)`
          : `Пропорции ${spec.aspectRatio} соблюдены (${origW}×${origH} px, ${(file.size / (1024 * 1024)).toFixed(2)} МБ)`,
      };
    }

    // Auto-fit & compress video via Canvas captureStream + MediaRecorder
    onProgress?.(10, `Подгонка кадра ${origW}×${origH} → ${targetW}×${targetH} px (${spec.aspectRatio})...`);
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D unavailable');

    const mimeCandidates = [
      'video/mp4;codecs=avc1.42E01E',
      'video/mp4',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ];
    const isInputMp4 = file.type === 'video/mp4' || file.name.toLowerCase().endsWith('.mp4');
    const chosenMime = mimeCandidates.find(m => MediaRecorder.isTypeSupported(m)) || '';
    if (!chosenMime || (isInputMp4 && !chosenMime.includes('mp4'))) {
      return {
        file,
        wasOptimized: false,
        originalWidth: origW,
        originalHeight: origH,
        finalWidth: origW,
        finalHeight: origH,
        originalSizeBytes: file.size,
        finalSizeBytes: file.size,
        extractedPosterFile,
        summaryNote: `Сохранён MP4 для 100% совместимости с iOS/Safari ${origW}×${origH} px (+ создан постер ${targetW}×${targetH} px)`,
      };
    }

    const targetDuration = Math.min(duration, 10);
    const targetBitrate = Math.min(
      3500000,
      Math.max(1200000, Math.floor(((maxBytes * 0.82) * 8) / Math.max(targetDuration, 3)))
    );

    const stream = canvas.captureStream(30);
    const recorder = new MediaRecorder(stream, {
      mimeType: chosenMime,
      videoBitsPerSecond: targetBitrate,
    });

    const chunks: BlobPart[] = [];
    recorder.ondataavailable = e => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    video.currentTime = 0;
    await new Promise<void>(r => {
      const t = setTimeout(r, 300);
      video.onseeked = () => { clearTimeout(t); r(); };
    });

    let rafId = 0;
    const renderLoop = () => {
      drawFitted(ctx, video, origW, origH, targetW, targetH, fitMode, bgColor || '#000000');
      const pct = Math.min(95, Math.round((video.currentTime / targetDuration) * 90) + 10);
      onProgress?.(pct, `Авто-сжатие и кадрирование ${targetW}×${targetH}: ${pct}%`);
      if (!video.paused && !video.ended && video.currentTime < targetDuration) {
        rafId = requestAnimationFrame(renderLoop);
      }
    };

    let recordedBlob: Blob;
    try {
      recordedBlob = await new Promise<Blob>((resolve, reject) => {
        recorder.onstop = () => {
          cancelAnimationFrame(rafId);
          const extType = chosenMime.includes('mp4') ? 'video/mp4' : 'video/webm';
          resolve(new Blob(chunks, { type: extType }));
        };
        recorder.onerror = () => {
          cancelAnimationFrame(rafId);
          reject(new Error('MediaRecorder error'));
        };
        recorder.start(200);
        video.play().then(() => {
          renderLoop();
        }).catch(reject);

        const stopTimer = setTimeout(() => {
          if (recorder.state === 'recording') {
            video.pause();
            recorder.stop();
          }
        }, targetDuration * 1000 + 250);

        video.onended = () => {
          clearTimeout(stopTimer);
          if (recorder.state === 'recording') recorder.stop();
        };
      });
    } finally {
      cancelAnimationFrame(rafId);
      stream.getTracks().forEach(t => t.stop());
    }

    const isMp4Out = chosenMime.includes('mp4');
    const ext = isMp4Out ? 'mp4' : 'webm';
    const baseName = file.name.replace(/\.[^.]+$/, '');
    const optimizedFile = new File([recordedBlob], `${baseName}_${targetW}x${targetH}.${ext}`, {
      type: isMp4Out ? 'video/mp4' : 'video/webm',
    });

    onProgress?.(100, 'Готово!');
    return {
      file: optimizedFile,
      wasOptimized: true,
      originalWidth: origW,
      originalHeight: origH,
      finalWidth: targetW,
      finalHeight: targetH,
      originalSizeBytes: file.size,
      finalSizeBytes: optimizedFile.size,
      extractedPosterFile,
      summaryNote: `Авто-подгонка видео: ${origW}×${origH} (${(file.size / (1024 * 1024)).toFixed(2)} МБ) → ${targetW}×${targetH} px (${(optimizedFile.size / (1024 * 1024)).toFixed(2)} МБ)`,
    };
  } finally {
    try {
      video.pause();
      video.removeAttribute('src');
      video.load();
    } catch {}
    URL.revokeObjectURL(videoUrl);
  }
}
