import { useState, useEffect, useCallback } from 'react';
import type { Language } from '@/i18n';
import { fetchDisplaySettingsFromErp, saveDisplaySettingsToErp } from './erpApi';
import { getAuthHeaders } from './erp/core';
import {
  SITE_MEDIA_SPECS,
  type MediaSpecInfo,
  saveMediaFileToLocalCms,
  resolveCmsMediaUrl,
  inspectMediaElement,
  type InspectedMediaMeta,
} from './siteMediaStorage';

export {
  SITE_MEDIA_SPECS,
  type MediaSpecInfo,
  saveMediaFileToLocalCms,
  resolveCmsMediaUrl,
  inspectMediaElement,
  type InspectedMediaMeta,
};

export interface SiteAnnouncementConfig {
  enabled: boolean;
  theme: 'amber' | 'brand' | 'emerald' | 'slate';
  text: Record<Language, string>;
  ctaLabel: Record<Language, string>;
  ctaTarget: 'catalog' | 'contacts' | 'profile' | '';
  ctaParam: string;
}

export interface SiteHeroConfig {
  videoMp4: string;
  videoWebm: string;
  posterUrl: string;
  endCardUrl: string;
  showEndCard: boolean;
  freezeDurationMs: number;
}

export interface SiteAdvantageItem {
  id: string;
  image: string;
  titleKey: string;
  descKey: string;
}

export interface SiteCategoryItem {
  id: string;
  name: string;
  video: string;
  poster: string;
  image: string;
}

export interface SiteContactsConfig {
  phoneDisplay: string;
  phoneRaw: string;
  whatsappIntl: string;
  email: string;
  companyLegalName: string;
  bin: string;
  legalAddress: string;
  warehouseAddress: string;
  weekdaysHours: string;
  weekendHours: string;
}

export interface SiteContentConfig {
  updatedAt: string;
  announcement: SiteAnnouncementConfig;
  hero: SiteHeroConfig;
  advantages: SiteAdvantageItem[];
  categories: SiteCategoryItem[];
  featuredSkus: string[];
  b2bBackgroundUrl: string;
  contacts: SiteContactsConfig;
  translationsOverride: Partial<Record<Language, Record<string, string>>>;
}

export const DEFAULT_SITE_CONTENT: SiteContentConfig = {
  updatedAt: '2026-10-19T00:00:00.000Z',
  announcement: {
    enabled: false,
    theme: 'amber',
    text: {
      ru: 'Новое поступление коллекций из Турции и Ирана на Центральный склад в Астане!',
      kz: 'Астанадағы Орталық қоймаға Түркия мен Ираннан жаңа коллекциялар келіп түсті!',
      en: 'New carpet collections from Turkey and Iran have arrived at the Astana Central Hub!',
      tr: 'Türkiye ve İran yeni halı koleksiyonları Astana Merkez Depoya ulaştı!',
    },
    ctaLabel: {
      ru: 'Смотреть в каталоге',
      kz: 'Каталогтан көру',
      en: 'View in catalog',
      tr: 'Katalogda gör',
    },
    ctaTarget: 'catalog',
    ctaParam: '',
  },
  hero: {
    videoMp4: '/assets/hero-video-desktop-v4.mp4',
    videoWebm: '/assets/hero-video-desktop-v4.webm',
    posterUrl: '/assets/hero-poster-desktop-v2.webp',
    endCardUrl: '/images/techno_hero_card.webp',
    showEndCard: true,
    freezeDurationMs: 1500,
  },
  advantages: [
    { id: 'loom', image: '/images/advantages/advantage_loom.webp', titleKey: 'home.adv_loom_title', descKey: 'home.adv_loom_desc' },
    { id: 'rolls', image: '/images/advantages/advantage_rolls.webp', titleKey: 'home.adv_rolls_title', descKey: 'home.adv_rolls_desc' },
    { id: 'compass', image: '/images/advantages/advantage_compass.webp', titleKey: 'home.adv_compass_title', descKey: 'home.adv_compass_desc' },
    { id: 'paisley', image: '/images/advantages/advantage_paisley.webp', titleKey: 'home.adv_paisley_title', descKey: 'home.adv_paisley_desc' },
  ],
  categories: [
    { id: 'country:Турция', name: 'Турция', image: '/videos/turkey_carpet.webp', video: '/videos/turkey_carpet.mp4', poster: '/videos/turkey_carpet.webp' },
    { id: 'country:Иран', name: 'Иран', image: '/videos/iran_carpet.webp', video: '/videos/iran_carpet.mp4', poster: '/videos/iran_carpet.webp' },
    { id: 'country:Китай', name: 'Китай', image: '/videos/china_carpet.webp', video: '/videos/china_carpet.mp4', poster: '/videos/china_carpet.webp' },
  ],
  featuredSkus: [],
  b2bBackgroundUrl: '/images/b2b_partner_macro_bg.webp',
  contacts: {
    phoneDisplay: '+7 (778) 580-68-66',
    phoneRaw: '+77785806866',
    whatsappIntl: '77785806866',
    email: 'synergiya.group@gmail.com',
    companyLegalName: 'ТОО «Синэнергия Груп»',
    bin: '250140013808',
    legalAddress: 'РК, г. Астана, район Байконыр, шоссе Алаш, зд. 13, инд. 010000',
    warehouseAddress: 'РК, г. Астана, 69-ый проезд, 20-ое строение',
    weekdaysHours: '09:00 — 17:00',
    weekendHours: 'Выходной',
  },
  translationsOverride: {},
};

const STORAGE_KEY = 'synergy:site_content_v1';
const EVENT_KEY = 'synergy:site-content-updated';

function mergeWithDefaults(raw: Partial<SiteContentConfig> | null | undefined): SiteContentConfig {
  if (!raw || typeof raw !== 'object') return DEFAULT_SITE_CONTENT;
  return {
    updatedAt: raw.updatedAt || DEFAULT_SITE_CONTENT.updatedAt,
    announcement: {
      ...DEFAULT_SITE_CONTENT.announcement,
      ...(raw.announcement || {}),
      text: { ...DEFAULT_SITE_CONTENT.announcement.text, ...(raw.announcement?.text || {}) },
      ctaLabel: { ...DEFAULT_SITE_CONTENT.announcement.ctaLabel, ...(raw.announcement?.ctaLabel || {}) },
    },
    hero: { ...DEFAULT_SITE_CONTENT.hero, ...(raw.hero || {}) },
    advantages: Array.isArray(raw.advantages) && raw.advantages.length === 4 ? raw.advantages : DEFAULT_SITE_CONTENT.advantages,
    categories: Array.isArray(raw.categories) && raw.categories.length === 3 ? raw.categories : DEFAULT_SITE_CONTENT.categories,
    featuredSkus: Array.isArray(raw.featuredSkus) ? raw.featuredSkus : DEFAULT_SITE_CONTENT.featuredSkus,
    b2bBackgroundUrl: raw.b2bBackgroundUrl || DEFAULT_SITE_CONTENT.b2bBackgroundUrl,
    contacts: { ...DEFAULT_SITE_CONTENT.contacts, ...(raw.contacts || {}) },
    translationsOverride: raw.translationsOverride || {},
  };
}

export function getSiteContent(): SiteContentConfig {
  if (typeof window === 'undefined') return DEFAULT_SITE_CONTENT;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return mergeWithDefaults(JSON.parse(raw));
  } catch {}
  return DEFAULT_SITE_CONTENT;
}

export async function saveSiteContent(patch: Partial<SiteContentConfig>): Promise<SiteContentConfig> {
  const current = getSiteContent();
  const next = mergeWithDefaults({
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  });

  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      window.dispatchEvent(new CustomEvent(EVENT_KEY, { detail: next }));
    } catch (e) {
      console.warn('[siteContentStore] Failed to save to localStorage:', e);
    }
  }

  try {
    const authHeaders = await getAuthHeaders();
    await fetch('/cms_api.php?action=save_content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ site_content: next }),
    });
  } catch {}

  try {
    await saveDisplaySettingsToErp({ site_content: next } as any);
  } catch {}

  return next;
}

export async function resetSiteContentSection(
  section: 'announcement' | 'hero' | 'advantages' | 'categories' | 'contacts' | 'translationsOverride' | 'all'
): Promise<SiteContentConfig> {
  if (section === 'all') return saveSiteContent(DEFAULT_SITE_CONTENT);
  return saveSiteContent({ [section]: DEFAULT_SITE_CONTENT[section] } as Partial<SiteContentConfig>);
}

let serverSyncInitiated = false;

export function useSiteContent() {
  const [content, setContent] = useState<SiteContentConfig>(getSiteContent);
  const [resolvedUrls, setResolvedUrls] = useState<Record<string, string>>({});

  const refresh = useCallback(() => {
    setContent(getSiteContent());
  }, []);

  useEffect(() => {
    const handleUpdate = () => refresh();
    window.addEventListener(EVENT_KEY, handleUpdate);
    window.addEventListener('storage', handleUpdate);

    if (!serverSyncInitiated) {
      serverSyncInitiated = true;
      fetch('/cms_api.php?action=get_content')
        .then(async res => {
          const isJson = (res.headers.get('content-type') || '').includes('application/json');
          if (res.ok && isJson) {
            const data = await res.json();
            if (data?.success && data?.site_content && typeof data.site_content === 'object') {
              const merged = mergeWithDefaults(data.site_content);
              localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
              window.dispatchEvent(new CustomEvent(EVENT_KEY, { detail: merged }));
              return;
            }
          }
          const erpSettings = await fetchDisplaySettingsFromErp();
          const remoteContent = (erpSettings as any)?.site_content;
          if (remoteContent && typeof remoteContent === 'object') {
            const merged = mergeWithDefaults(remoteContent);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
            window.dispatchEvent(new CustomEvent(EVENT_KEY, { detail: merged }));
          }
        })
        .catch(() => {});
    }

    return () => {
      window.removeEventListener(EVENT_KEY, handleUpdate);
      window.removeEventListener('storage', handleUpdate);
    };
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    const resolveAll = async () => {
      const map: Record<string, string> = {};
      const entries: Array<[string, string]> = [
        ['heroVideoMp4', content.hero.videoMp4],
        ['heroVideoWebm', content.hero.videoWebm],
        ['heroPoster', content.hero.posterUrl],
        ['heroEndCard', content.hero.endCardUrl],
        ['b2bBackgroundUrl', content.b2bBackgroundUrl],
      ];
      content.advantages.forEach((adv, idx) => entries.push([`adv_${idx}`, adv.image]));
      content.categories.forEach((cat, idx) => {
        entries.push([`cat_video_${idx}`, cat.video]);
        entries.push([`cat_poster_${idx}`, cat.poster]);
        entries.push([`cat_image_${idx}`, cat.image]);
      });

      for (const [k, rawUri] of entries) {
        if (rawUri && rawUri.startsWith('idb://')) {
          const resolved = await resolveCmsMediaUrl(rawUri);
          if (resolved) map[k] = resolved;
        }
      }
      if (!cancelled) setResolvedUrls(map);
    };
    resolveAll();
    return () => { cancelled = true; };
  }, [content]);

  return { content, resolvedUrls, saveSiteContent, resetSiteContentSection };
}
