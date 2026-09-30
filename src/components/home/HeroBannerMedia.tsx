import { useRef, useState, useEffect } from 'react';
import { RotateCcw, ArrowRight, Sparkles } from 'lucide-react';
import type { PageId } from '@/types';

const VIDEO_MP4 = '/assets/hero-video-desktop-v3.mp4';
const VIDEO_WEBM = '/assets/hero-video-desktop-v3.webm';
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

    // Direct DOM property enforcement required by iOS Safari / Android for muted autoplay
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;

    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', 'true');

    // Never call video.pause() on mount to preserve iOS Safari autoplay eligibility!
    const attemptPlay = () => {
      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          // If browser policy or low-power mode blocks autoplay, fallback touch handler will activate it
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
          Corner Brand Hallmark (Option 2):
          Luxury hallmark in top-left corner without solid background or box.
          Preserves 100% of the carpet visual and animation completely unobstructed.
        */}
        <div className="absolute top-3 left-4 sm:top-5 sm:left-8 z-20 pointer-events-none select-none">
          <img 
            src="/Вектор_Синэнергия.png" 
            alt="Synergy Group" 
            className="h-7 sm:h-9 w-auto brightness-0 invert opacity-80 drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]" 
          />
        </div>

        {/* 
          Harmonious End-State Interactive Overlay (Desktop sm+):
          Ultra-transparent luxury glass overlay:
          Preserves 100% of the oriental carpet visual while providing crystal-clear readability.
        */}
        <div 
          className={`hidden sm:flex absolute inset-0 items-center transition-all duration-700 ease-out z-20 ${
            isEnded ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          }`}
        >
          {/* Subtle soft dark left vignette that gently darkens background for text readability without washing out carpet */}
          <div 
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-r from-black/50 via-black/20 to-transparent pointer-events-none" 
          />

          <div className="relative container-w py-6 sm:py-10">
            <div className="max-w-lg p-6 sm:p-8 rounded-3xl bg-slate-950/25 backdrop-blur-md border border-white/10 shadow-2xl transition-all duration-500">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-medium text-brand-300 border border-white/15 backdrop-blur-sm mb-4">
                <Sparkles className="w-3.5 h-3.5 text-brand-400" />
                Оптовый поставщик • В наличии на складах
              </div>

              <h1 className="font-display text-2xl sm:text-4xl font-bold text-white leading-tight drop-shadow-[0_2px_8px_rgba(0,0,0,0.85)]">
                Оптовые поставки <span className="text-brand-300">ковровых покрытий</span>
              </h1>

              <p className="mt-3 text-xs sm:text-sm text-slate-200 font-body leading-relaxed drop-shadow-[0_1px_5px_rgba(0,0,0,0.85)]">
                Широкий ассортимент ковров от ведущих производителей Турции, Бельгии и Ирана. 
                Более 1500 наименований в наличии. Отгрузка за 24 часа.
              </p>

              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => onNavigate?.('catalog')}
                  className="btn-primary inline-flex items-center justify-center gap-2 text-sm px-5 py-2.5 shadow-lg shadow-brand-500/25"
                >
                  Перейти в каталог
                  <ArrowRight className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate?.('contacts')}
                  className="btn-secondary border-white/20 bg-white/10 text-white backdrop-blur-md hover:bg-white/20 inline-flex items-center justify-center gap-2 text-sm px-5 py-2.5"
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

      {/* ── Mobile Permanent Action Bar (Clean, unclipped, directly below the 16:9 video) ── */}
      <div className="block sm:hidden bg-slate-950 px-4 py-3 border-b border-slate-900/80">
        <button
          type="button"
          onClick={() => onNavigate?.('catalog')}
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 hover:bg-brand-500 active:scale-[0.98] text-white py-2.5 px-4 text-xs font-semibold shadow-md shadow-brand-500/20 transition-all duration-200"
        >
          <span>Перейти в каталог ковров</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
