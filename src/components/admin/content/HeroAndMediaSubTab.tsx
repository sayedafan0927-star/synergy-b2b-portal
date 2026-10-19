import React, { useState, useEffect } from 'react';
import {
  Video, Upload, RotateCcw, CheckCircle2, AlertTriangle, Film, Layers, Star, Save,
} from 'lucide-react';
import {
  SITE_MEDIA_SPECS,
  useSiteContent,
  saveMediaFileToLocalCms,
  inspectMediaElement,
  type InspectedMediaMeta,
  DEFAULT_SITE_CONTENT,
} from '@/lib/siteContentStore';
import { useToast } from '@/contexts/ToastContext';
import { MediaSpecsReferenceTable } from './MediaSpecsReferenceTable';

export function HeroAndMediaSubTab() {
  const { content, resolvedUrls, saveSiteContent, resetSiteContentSection } = useSiteContent();
  const toast = useToast();

  const [heroForm, setHeroForm] = useState(content.hero);
  const [b2bBg, setB2bBg] = useState(content.b2bBackgroundUrl);
  const [featuredInput, setFeaturedInput] = useState(content.featuredSkus.join(', '));
  const [categoriesForm, setCategoriesForm] = useState(content.categories);
  const [advantagesForm, setAdvantagesForm] = useState(content.advantages);
  const [inspected, setInspected] = useState<Record<string, InspectedMediaMeta | null>>({});
  const [uploadingSlot, setUploadingSlot] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setHeroForm(content.hero);
    setB2bBg(content.b2bBackgroundUrl);
    setFeaturedInput(content.featuredSkus.join(', '));
    setCategoriesForm(content.categories);
    setAdvantagesForm(content.advantages);
  }, [content]);

  useEffect(() => {
    let active = true;
    const videoSrc = resolvedUrls.heroVideoMp4 || heroForm.videoMp4;
    const posterSrc = resolvedUrls.heroPoster || heroForm.posterUrl;
    const endCardSrc = resolvedUrls.heroEndCard || heroForm.endCardUrl;

    if (videoSrc) {
      inspectMediaElement(videoSrc, 'video').then(meta => {
        if (active && meta) setInspected(prev => ({ ...prev, heroVideoMp4: meta }));
      });
    }
    if (posterSrc) {
      inspectMediaElement(posterSrc, 'image').then(meta => {
        if (active && meta) setInspected(prev => ({ ...prev, heroPoster: meta }));
      });
    }
    if (endCardSrc) {
      inspectMediaElement(endCardSrc, 'image').then(meta => {
        if (active && meta) setInspected(prev => ({ ...prev, heroEndCard: meta }));
      });
    }
    return () => { active = false; };
  }, [heroForm.videoMp4, heroForm.posterUrl, heroForm.endCardUrl, resolvedUrls]);

  const handleFileUpload = async (
    slotKey: string,
    file: File | undefined,
    mediaType: 'video' | 'image',
    expectedAspect: string,
    onResolvedUri: (uri: string) => void
  ) => {
    if (!file) return;
    setUploadingSlot(slotKey);
    try {
      const meta = await inspectMediaElement(file, mediaType);
      if (meta) {
        setInspected(prev => ({ ...prev, [slotKey]: meta }));
        if (expectedAspect && meta.aspectRatio !== expectedAspect) {
          toast.info(`Пропорции файла ${meta.width}×${meta.height} (${meta.aspectRatio}) отличаются от эталона (${expectedAspect}).`);
        }
      }
      const idbUri = await saveMediaFileToLocalCms(slotKey, file);
      onResolvedUri(idbUri);
      toast.success(`Файл «${file.name}» загружен. Нажмите «Сохранить медиа-настройки».`);
    } catch {
      toast.error('Не удалось обработать медиафайл.');
    } finally {
      setUploadingSlot(null);
    }
  };

  const onHeroMp4File = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFileUpload('heroVideoMp4', e.target.files?.[0], 'video', '16:9', uri => {
      setHeroForm(p => ({ ...p, videoMp4: uri }));
    });
  };

  const onHeroPosterFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFileUpload('heroPoster', e.target.files?.[0], 'image', '16:9', uri => {
      setHeroForm(p => ({ ...p, posterUrl: uri }));
    });
  };

  const onHeroEndCardFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFileUpload('heroEndCard', e.target.files?.[0], 'image', '4:3', uri => {
      setHeroForm(p => ({ ...p, endCardUrl: uri }));
    });
  };

  const onB2bBgFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFileUpload('b2bBackgroundUrl', e.target.files?.[0], 'image', '21:9', uri => {
      setB2bBg(uri);
    });
  };

  const onCategoryVideoFile = (idx: number, e: React.ChangeEvent<HTMLInputElement>) => {
    handleFileUpload(`cat_video_${idx}`, e.target.files?.[0], 'video', '1:1', uri => {
      setCategoriesForm(prev => prev.map((item, i) => (i === idx ? { ...item, video: uri } : item)));
    });
  };

  const onAdvantageImageFile = (idx: number, e: React.ChangeEvent<HTMLInputElement>) => {
    handleFileUpload(`adv_${idx}`, e.target.files?.[0], 'image', '1:1', uri => {
      setAdvantagesForm(prev => prev.map((it, i) => (i === idx ? { ...it, image: uri } : it)));
    });
  };

  const updateCatField = (idx: number, field: 'video' | 'poster', val: string) => {
    setCategoriesForm(prev =>
      prev.map((item, i) => {
        if (i !== idx) return item;
        return field === 'poster' ? { ...item, poster: val, image: val } : { ...item, video: val };
      })
    );
  };

  const updateAdvImage = (idx: number, val: string) => {
    setAdvantagesForm(prev => prev.map((it, i) => (i === idx ? { ...it, image: val } : it)));
  };

  const handleSaveAllMedia = async () => {
    setSaving(true);
    try {
      const parsedSkus = featuredInput.split(',').map(s => s.trim()).filter(Boolean);
      await saveSiteContent({
        hero: heroForm,
        b2bBackgroundUrl: b2bBg.trim() || DEFAULT_SITE_CONTENT.b2bBackgroundUrl,
        featuredSkus: parsedSkus,
        categories: categoriesForm,
        advantages: advantagesForm,
      });
      toast.success('Медиа-контент и настройки главной страницы сохранены!');
    } finally {
      setSaving(false);
    }
  };

  const renderMetaBadge = (slotKey: string, expectedW: number, expectedH: number, expectedAspect: string) => {
    const meta = inspected[slotKey];
    if (!meta || !meta.width) return null;
    const isExact = meta.width === expectedW && meta.height === expectedH;
    const isRatioOk = meta.aspectRatio === expectedAspect;
    const tone = isExact
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : isRatioOk ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-amber-50 text-amber-700 border-amber-200';
    return (
      <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${tone}`}>
        {isRatioOk ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
        Факт: {meta.width} × {meta.height} px ({meta.aspectRatio})
        {meta.durationSec ? ` • ${meta.durationSec} сек` : ''}
        {meta.sizeBytes ? ` • ${(meta.sizeBytes / (1024 * 1024)).toFixed(2)} МБ` : ''}
      </span>
    );
  };

  const activeHeroVideo = resolvedUrls.heroVideoMp4 || heroForm.videoMp4;
  const activeHeroPoster = resolvedUrls.heroPoster || heroForm.posterUrl;
  const activeHeroEndCard = resolvedUrls.heroEndCard || heroForm.endCardUrl;
  const heroSpec = SITE_MEDIA_SPECS.heroVideoMp4;

  return (
    <div className="space-y-6">
      <MediaSpecsReferenceTable />

      <div className="card p-5 space-y-5 border border-slate-200/90">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2.5">
            <Film className="h-5 w-5 text-brand-700" />
            <div>
              <h4 className="text-base font-bold text-slate-900">Главный Hero-баннер (Видео с барсом + Постер + Финальная карточка)</h4>
              <p className="text-xs text-slate-500">
                Эталон видео: <strong className="text-slate-800">{heroSpec.recommendedResolution} ({heroSpec.aspectRatio})</strong>, {heroSpec.format}, до {heroSpec.maxSizeMb} МБ
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => resetSiteContentSection('hero').then(() => toast.success('Главный баннер с барсом возвращён к эталону'))}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Вернуть исходного барса</span>
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          <div className="lg:col-span-5 space-y-2">
            <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-slate-950 border border-slate-800 shadow-md">
              <video key={activeHeroVideo} src={activeHeroVideo} poster={activeHeroPoster} muted playsInline loop controls className="h-full w-full object-cover" />
              <span className="absolute top-2 left-2 rounded bg-black/75 px-2 py-0.5 text-[10px] font-mono font-bold text-white">ПРЕВЬЮ 16:9 (1920×1080)</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {renderMetaBadge('heroVideoMp4', 1920, 1080, '16:9')}
              {renderMetaBadge('heroPoster', 1920, 1080, '16:9')}
            </div>
          </div>

          <div className="lg:col-span-7 space-y-3.5">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-bold text-slate-700">1. Основной видеофайл MP4 (1920 × 1080 px, 16:9, H.264)</label>
                <label className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:text-brand-800 cursor-pointer">
                  <Upload className="h-3.5 w-3.5" />
                  <span>{uploadingSlot === 'heroVideoMp4' ? 'Загрузка...' : 'Загрузить MP4 с диска'}</span>
                  <input type="file" accept="video/mp4,video/webm" className="hidden" onChange={onHeroMp4File} />
                </label>
              </div>
              <input type="text" value={heroForm.videoMp4} onChange={e => setHeroForm({ ...heroForm, videoMp4: e.target.value })} placeholder="/assets/hero-video-desktop-v4.mp4" className="input-field text-xs font-mono" />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-bold text-slate-700">2. Постер первого кадра (1920 × 1080 px, 16:9, WebP/JPG)</label>
                <label className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:text-brand-800 cursor-pointer">
                  <Upload className="h-3.5 w-3.5" />
                  <span>Загрузить постер</span>
                  <input type="file" accept="image/*" className="hidden" onChange={onHeroPosterFile} />
                </label>
              </div>
              <input type="text" value={heroForm.posterUrl} onChange={e => setHeroForm({ ...heroForm, posterUrl: e.target.value })} placeholder="/assets/hero-poster-desktop-v2.webp" className="input-field text-xs font-mono" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-slate-700">3. Финальная карточка (964 × 714 px, WebP)</label>
                  <label className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-700 cursor-pointer">
                    <Upload className="h-3 w-3" />
                    <span>Файл</span>
                    <input type="file" accept="image/*" className="hidden" onChange={onHeroEndCardFile} />
                  </label>
                </div>
                <input type="text" value={heroForm.endCardUrl} onChange={e => setHeroForm({ ...heroForm, endCardUrl: e.target.value })} className="input-field text-xs font-mono" />
              </div>

              <div className="flex flex-col justify-between rounded-lg bg-slate-50 p-2.5 border border-slate-200/80">
                <label className="flex items-center justify-between text-xs font-semibold text-slate-800 cursor-pointer">
                  <span>Показывать карточку оффера в финале</span>
                  <input type="checkbox" checked={heroForm.showEndCard} onChange={e => setHeroForm({ ...heroForm, showEndCard: e.target.checked })} className="h-4 w-4 accent-brand-700" />
                </label>
                <div className="flex items-center justify-between gap-2 mt-2">
                  <span className="text-[11px] text-slate-500">Пауза на финальном кадре (мс):</span>
                  <input type="number" min={500} max={10000} step={250} value={heroForm.freezeDurationMs} onChange={e => setHeroForm({ ...heroForm, freezeDurationMs: Number(e.target.value) || 1500 })} className="w-24 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-mono text-right" />
                </div>
              </div>
            </div>
            {activeHeroEndCard && (
              <div className="flex items-center gap-3 pt-1">
                <img src={activeHeroEndCard} alt="End Card" className="h-12 w-16 rounded border border-slate-200 bg-slate-900 object-contain p-0.5" />
                {renderMetaBadge('heroEndCard', 964, 714, '4:3')}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card p-5 space-y-4 border border-slate-200/90">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <Video className="h-5 w-5 text-brand-700" />
            <div>
              <h4 className="text-sm sm:text-base font-bold text-slate-900">Видео-символы стран (Турция, Иран, Китай)</h4>
              <p className="text-xs text-slate-500">Эталон: <strong className="text-slate-800">720 × 720 px (Квадрат 1:1)</strong>, MP4 на чисто чёрном фоне (#000000)</p>
            </div>
          </div>
          <button type="button" onClick={() => resetSiteContentSection('categories').then(() => toast.success('Видео стран сброшены'))} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer">
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Сбросить страны</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {categoriesForm.map((cat, idx) => {
            const resolvedVid = resolvedUrls[`cat_video_${idx}`] || cat.video;
            const resolvedPost = resolvedUrls[`cat_poster_${idx}`] || cat.poster;
            return (
              <div key={cat.id} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900">{cat.name} (720×720, 1:1)</span>
                  <label className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-700 cursor-pointer">
                    <Upload className="h-3 w-3" />
                    <span>MP4</span>
                    <input type="file" accept="video/mp4,video/webm" className="hidden" onChange={e => onCategoryVideoFile(idx, e)} />
                  </label>
                </div>
                <div className="aspect-square w-28 mx-auto overflow-hidden rounded-lg bg-black border border-slate-800">
                  <video key={resolvedVid} src={resolvedVid} poster={resolvedPost} muted playsInline loop autoPlay className="h-full w-full object-contain" />
                </div>
                <input type="text" value={cat.video} onChange={e => updateCatField(idx, 'video', e.target.value)} placeholder="URL видео MP4 (720x720)" className="input-field text-[11px] font-mono" />
                <input type="text" value={cat.poster} onChange={e => updateCatField(idx, 'poster', e.target.value)} placeholder="URL постера WebP (720x720)" className="input-field text-[11px] font-mono" />
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-4 sm:p-5 space-y-3 border border-slate-200/90">
          <div className="flex items-center gap-2">
            <Star className="h-4 w-4 text-amber-500" />
            <h4 className="text-sm font-bold text-slate-900">Закреплённые ковры в «Популярные коллекции»</h4>
          </div>
          <p className="text-xs text-slate-500">Укажите артикулы или SKU через запятую (или оставьте пустым для авто-отбора топ-8 ковров в наличии).</p>
          <input type="text" value={featuredInput} onChange={e => setFeaturedInput(e.target.value)} placeholder="Например: 1205A, EFSANE-01 (или пусто для авто-отбора)" className="input-field text-xs font-mono" />

          <div className="pt-2 border-t border-slate-100">
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-bold text-slate-700">Фон блока «Стать B2B-партнёром» (2560 × 1138 px, 21:9)</label>
              <label className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 cursor-pointer">
                <Upload className="h-3.5 w-3.5" />
                <span>Загрузить фон</span>
                <input type="file" accept="image/*" className="hidden" onChange={onB2bBgFile} />
              </label>
            </div>
            <input type="text" value={b2bBg} onChange={e => setB2bBg(e.target.value)} placeholder="/images/b2b_partner_macro_bg.webp" className="input-field text-xs font-mono" />
          </div>
        </div>

        <div className="card p-4 sm:p-5 space-y-3 border border-slate-200/90">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-brand-700" />
              <h4 className="text-sm font-bold text-slate-900">Иконки 4 карточек преимуществ (512 × 512 px, 1:1)</h4>
            </div>
            <button type="button" onClick={() => resetSiteContentSection('advantages').then(() => toast.success('Иконки сброшены'))} className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 cursor-pointer">Сбросить</button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {advantagesForm.map((adv, idx) => {
              const resolvedAdv = resolvedUrls[`adv_${idx}`] || adv.image;
              return (
                <div key={adv.id} className="flex items-center gap-2.5 rounded-lg border border-slate-200 p-2 bg-slate-50/50">
                  <img src={resolvedAdv} alt={adv.id} className="h-10 w-10 rounded bg-slate-900 object-contain p-1 shrink-0" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-slate-700 uppercase">{adv.id}</span>
                      <label className="text-[10px] font-semibold text-brand-700 cursor-pointer">
                        <span>Загрузить</span>
                        <input type="file" accept="image/*" className="hidden" onChange={e => onAdvantageImageFile(idx, e)} />
                      </label>
                    </div>
                    <input type="text" value={adv.image} onChange={e => updateAdvImage(idx, e.target.value)} className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-[10px] font-mono" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button type="button" onClick={handleSaveAllMedia} disabled={saving} className="btn-primary inline-flex items-center gap-2 px-6 py-2.5 text-sm font-bold cursor-pointer">
          <Save className="h-4 w-4" />
          <span>{saving ? 'Сохранение...' : 'Сохранить медиа-настройки'}</span>
        </button>
      </div>
    </div>
  );
}
