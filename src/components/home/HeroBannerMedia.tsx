import { useRef, useState, useEffect } from 'react';
import { RotateCcw, ArrowRight, Sparkles } from 'lucide-react';
import type { PageId } from '@/types';

const MOBILE_VIDEO_WEBM = '/assets/hero-video-mobile-v1.webm';
const MOBILE_VIDEO_MP4 = '/assets/hero-video-mobile-v1.mp4';
const MOBILE_POSTER = '/assets/hero-poster-mobile-v1.webp';

const DESKTOP_VIDEO_WEBM = '/assets/hero-video-desktop-v2.webm';
const DESKTOP_VIDEO_MP4 = '/assets/hero-video-desktop-v2.mp4';
const DESKTOP_POSTER = '/assets/hero-poster-desktop-v2.webp';

interface HeroBannerMediaProps {
  onNavigate?: (page: PageId) => void;
  isReady?: boolean;
}

export default function HeroBannerMedia({ onNavigate, isReady = true }: HeroBannerMediaProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isEnded, setIsEnded] = useState(false);
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth < 768;
    }
    return false;
  });

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.muted = true;
    video.defaultMuted = true;

    // While preloader logo is displaying, hold video paused at beginning (frame 0)
    if (!isReady) {
      video.pause();
      try {
        video.currentTime = 0;
      } catch {}
      return;
    }

    // Preloader is done and user sees the screen: start cleanly from frame 0
    setIsEnded(false);
    try {
      video.currentTime = 0;
    } catch {}
    
    video.play().catch(() => {
      // If browser blocks autoplay, show final CTA card
      setIsEnded(true);
    });
  }, [isReady, isMobile]);

  const handleEnded = () => {
    if (videoRef.current) {
      videoRef.current.pause(); // Freeze on final frame
    }
    setIsEnded(true);
  };

  const handleReplay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!videoRef.current) return;
    setIsEnded(false);
    videoRef.current.currentTime = 0;
    videoRef.current.play().catch(() => {});
  };

  const poster = isMobile ? MOBILE_POSTER : DESKTOP_POSTER;

  return (
    <div className="hero-banner-media relative w-full h-[66vh] sm:h-[72vh] lg:h-[82vh] min-h-[480px] max-h-[860px] bg-slate-950 overflow-hidden select-none">
      {/* 
        Full clean video background:
        Dynamic responsive source selection with key-recreation to guarantee Safari/Android
        pick the right stream without loading redundant data.
      */}
      <video
        key={isMobile ? 'mobile-v1' : 'desktop-v2'}
        ref={videoRef}
        autoPlay={isReady}
        muted
        playsInline
        preload="metadata"
        poster={poster}
        onEnded={handleEnded}
        className="w-full h-full object-cover object-center"
      >
        {isMobile ? (
          <>
            <source src={MOBILE_VIDEO_WEBM} type="video/webm" />
            <source src={MOBILE_VIDEO_MP4} type="video/mp4" />
          </>
        ) : (
          <>
            <source src={DESKTOP_VIDEO_WEBM} type="video/webm" />
            <source src={DESKTOP_VIDEO_MP4} type="video/mp4" />
          </>
        )}
      </video>

      {/* 
        Harmonious End-State Interactive Overlay:
        Fades in smoothly when video freezes at final frame.
        - Desktop: Left-aligned glass card preserving carpet visual on the right.
        - Mobile: Bottom-aligned glass card preserving the central golden Synergy Group logo.
      */}
      <div 
        className={`absolute inset-0 flex items-end sm:items-center transition-all duration-700 ease-out ${
          isEnded ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Soft dark vignette that blends into the video */}
        <div 
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-t sm:bg-gradient-to-r from-slate-950/85 via-slate-950/40 to-transparent pointer-events-none" 
        />

        <div className="relative container-w pb-5 sm:pb-0 sm:py-10 w-full">
          <div className="max-w-lg p-5 sm:p-8 rounded-2xl sm:rounded-3xl bg-slate-950/85 backdrop-blur-md border border-white/15 shadow-2xl transition-all duration-500 mx-auto sm:mx-0 text-center sm:text-left">
            <div className="hidden sm:inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 mb-4 text-xs font-medium text-brand-400 border border-white/10">
              <Sparkles className="w-3.5 h-3.5 text-brand-400" />
              Оптовый поставщик • В наличии на складах
            </div>

            <h1 className="font-display text-xl sm:text-4xl font-bold text-white leading-tight">
              Оптовые поставки <span className="text-brand-400">ковровых покрытий</span>
            </h1>

            <p className="hidden sm:block mt-3 text-xs sm:text-sm text-slate-300 font-body leading-relaxed">
              Широкий ассортимент ковров от ведущих производителей Турции, Бельгии и Ирана. 
              Более 1500 наименований в наличии. Отгрузка за 24 часа.
            </p>

            <div className="mt-4 sm:mt-6 flex flex-row items-center justify-center sm:justify-start gap-2.5 sm:gap-3">
              <button
                type="button"
                onClick={() => onNavigate?.('catalog')}
                className="btn-primary flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 sm:gap-2 text-xs sm:text-sm px-4 sm:px-5 py-2.5 shadow-lg shadow-brand-500/20"
              >
                Перейти в каталог
                <ArrowRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => onNavigate?.('contacts')}
                className="btn-secondary flex-1 sm:flex-initial border-white/20 bg-white/10 text-white backdrop-blur-sm hover:bg-white/20 inline-flex items-center justify-center gap-1.5 sm:gap-2 text-xs sm:text-sm px-3.5 sm:px-5 py-2.5"
              >
                Контакты
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 
        Minimalist, non-intrusive replay button:
        Top-right on mobile to prevent overlapping bottom CTA card, bottom-right on desktop.
      */}
      <button
        type="button"
        onClick={handleReplay}
        className="absolute top-3 right-3 sm:top-auto sm:bottom-4 sm:right-4 z-30 w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-black/40 hover:bg-black/80 text-white/60 hover:text-white border border-white/15 backdrop-blur-md flex items-center justify-center shadow transition-all duration-200 group/btn"
        title="Повторить видео с начала"
      >
        <RotateCcw className="w-3.5 h-3.5 transition-transform duration-300 group-hover/btn:-rotate-90" />
      </button>
    </div>
  );
}
