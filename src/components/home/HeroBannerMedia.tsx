import { useRef, useState, useEffect } from 'react';
import { RotateCcw, ArrowRight, Sparkles } from 'lucide-react';
import type { PageId } from '@/types';

// Lightweight, hardware-optimized 2.7MB stream for buttery-smooth 60fps playback
const VIDEO_MP4 = '/assets/hero-video-desktop-v4.mp4';
const VIDEO_WEBM = '/assets/hero-video-desktop-v4.webm';
const POSTER = '/assets/hero-poster-desktop-v2.webp';

interface HeroBannerMediaProps {
  onNavigate?: (page: PageId) => void;
  isReady?: boolean;
}

export default function HeroBannerMedia({ onNavigate, isReady = true }: HeroBannerMediaProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isEnded, setIsEnded] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Strict DOM properties required by iOS Safari & Android for immediate silent autoplay
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;

    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', 'true');

    // Never call video.pause() on mount to preserve browser autoplay eligibility
    const attemptPlay = () => {
      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          // Autoplay blocked by battery saver / browser policy; fallback gesture will start it
        });
      }
    };

    if (video.readyState >= 2) {
      attemptPlay();
    } else {
      const onCanPlay = () => {
        attemptPlay();
        video.removeEventListener('canplay', onCanPlay);
      };
      video.addEventListener('canplay', onCanPlay);
    }

    // Touch/click fallback for iOS devices in Low Power Mode
    const handleFirstGesture = () => {
      if (video && video.paused) {
        video.play().catch(() => {});
      }
    };
    window.addEventListener('touchstart', handleFirstGesture, { once: true, passive: true });
    window.addEventListener('click', handleFirstGesture, { once: true, passive: true });

    return () => {
      window.removeEventListener('touchstart', handleFirstGesture);
      window.removeEventListener('click', handleFirstGesture);
    };
  }, [isReady]);

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
    try {
      videoRef.current.currentTime = 0;
    } catch {}
    videoRef.current.play().catch(() => {});
  };

  return (
    <div className="hero-banner-media relative w-full bg-slate-950 select-none">
      {/* 
        Video Viewport:
        - Mobile (< sm): aspect-[16/9] renders 100% of the video frame with zero clipping (full leopard + carpet).
        - Desktop (sm+): full-height hero banner sm:h-[72vh] lg:h-[82vh] with object-cover.
        - Pure Cinema: Video plays completely clean without obstructing watermarks.
      */}
      <div className="relative w-full aspect-[16/9] sm:aspect-auto sm:h-[72vh] lg:h-[82vh] sm:min-h-[480px] max-h-[860px] overflow-hidden bg-slate-950">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          // @ts-expect-error iOS Safari webkit prefix
          webkit-playsinline="true"
          preload="auto"
          poster={POSTER}
          onEnded={handleEnded}
          style={{ willChange: 'transform' }}
          className="w-full h-full object-cover object-center sm:object-[center_right] transform-gpu"
        >
          <source src={VIDEO_MP4} type="video/mp4" />
          <source src={VIDEO_WEBM} type="video/webm" />
        </video>

        {/* 
          Cinematic End-State Floating Glass Window (as in Reference Video):
          Smoothly floats up and emerges from the bottom with rich cubic-bezier easing
          when the video reaches the final frame, revealing the brand logo, offer, and CTA buttons.
        */}
        <div 
          className="hidden sm:flex absolute inset-0 items-center pointer-events-none z-20"
        >
          {/* Subtle soft dark left vignette that gently blends into the video */}
          <div 
            aria-hidden="true"
            className={`absolute inset-0 bg-gradient-to-r from-black/60 via-black/20 to-transparent transition-opacity duration-1000 ease-out ${
              isEnded ? 'opacity-100' : 'opacity-0'
            }`} 
          />

          <div className="relative container-w py-6 sm:py-10">
            <div 
              className={`max-w-lg p-7 sm:p-8 rounded-3xl bg-slate-950/35 backdrop-blur-xl border border-white/20 shadow-[0_20px_60px_rgba(0,0,0,0.7)] transition-all duration-1000 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                isEnded 
                  ? 'opacity-100 translate-y-0 scale-100 pointer-events-auto' 
                  : 'opacity-0 translate-y-12 scale-[0.96] pointer-events-none'
              }`}
            >
              {/* Brand Header with Logo inside the window */}
              <div className="flex items-center gap-3 mb-5">
                <img 
                  src="/Вектор_Синэнергия.png" 
                  alt="Synergy Group" 
                  className="h-8 sm:h-9 w-auto brightness-0 invert opacity-95 drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]" 
                />
                <div className="h-5 w-px bg-white/20" />
                <div className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-medium text-brand-300 border border-white/15 backdrop-blur-sm">
                  <Sparkles className="w-3.5 h-3.5 text-brand-400" />
                  Оптовый портал
                </div>
              </div>

              <h1 className="font-display text-2xl sm:text-4xl font-bold text-white leading-tight drop-shadow-[0_2px_10px_rgba(0,0,0,0.9)]">
                Оптовые поставки <span className="text-brand-300">ковровых покрытий</span>
              </h1>

              <p className="mt-3 text-xs sm:text-sm text-slate-200 font-body leading-relaxed drop-shadow-[0_1px_6px_rgba(0,0,0,0.9)] font-light">
                Широкий ассортимент ковров от ведущих производителей Турции, Бельгии и Ирана. 
                Более 1500 наименований в наличии. Отгрузка за 24 часа со складов по Казахстану.
              </p>

              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => onNavigate?.('catalog')}
                  className="btn-primary inline-flex items-center justify-center gap-2 text-xs uppercase tracking-wider font-semibold px-5 py-2.5 shadow-lg shadow-brand-500/25 transition-all duration-200 hover:-translate-y-0.5 active:scale-95"
                >
                  Перейти в каталог
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate?.('contacts')}
                  className="btn-secondary border-white/20 bg-white/10 text-white backdrop-blur-md hover:bg-white/20 inline-flex items-center justify-center gap-2 text-xs uppercase tracking-wider font-semibold px-5 py-2.5 transition-all duration-200 hover:-translate-y-0.5"
                >
                  Связаться с нами
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 
          Minimalist, non-intrusive replay button:
          Positioned top-right on mobile, bottom-right on desktop.
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

      {/* ── Mobile Action Bar (Thompson's Tea style: refined, compact, single ergonomic row) ── */}
      <div className="block sm:hidden bg-slate-950 px-4 py-2.5 border-b border-slate-900/80">
        <button
          type="button"
          onClick={() => onNavigate?.('catalog')}
          className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600/90 hover:bg-brand-600 active:scale-[0.99] text-white py-2.5 px-4 text-xs font-semibold tracking-wider shadow-md shadow-brand-950/40 border border-brand-400/20 transition-all duration-200"
        >
          <span>ПЕРЕЙТИ В КАТАЛОГ КОВРОВ</span>
          <ArrowRight className="w-3.5 h-3.5 text-brand-300" />
        </button>
      </div>
    </div>
  );
}
