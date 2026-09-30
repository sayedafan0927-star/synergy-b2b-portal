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

    video.muted = true;
    video.defaultMuted = true;

    // While preloader logo is displaying, hold video paused at beginning (frame 0)
    if (!isReady) {
      video.pause();
      return;
    }

    // Preloader is done and user sees the screen: start immediately
    setIsEnded(false);
    
    // Only seek to 0 if it was played previously and not at the beginning
    if (video.currentTime > 0.1) {
      try {
        video.currentTime = 0;
      } catch {}
    }

    const startPlayback = () => {
      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          // If browser policy blocks autoplay, graceful fallback
        });
      }
    };

    if (video.readyState >= 2) {
      startPlayback();
    } else {
      const onCanPlay = () => {
        startPlayback();
        video.removeEventListener('canplay', onCanPlay);
      };
      video.addEventListener('canplay', onCanPlay);
      return () => video.removeEventListener('canplay', onCanPlay);
    }
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
          autoPlay={isReady}
          muted
          playsInline
          preload="auto"
          poster={POSTER}
          onEnded={handleEnded}
          className="w-full h-full object-cover object-center sm:object-[center_right]"
        >
          <source src={VIDEO_MP4} type="video/mp4" />
          <source src={VIDEO_WEBM} type="video/webm" />
        </video>

        {/* 
          Harmonious End-State Interactive Overlay (Desktop sm+):
          Ultra-transparent luxury glass overlay:
          Preserves 100% of the oriental carpet visual while providing crystal-clear readability.
        */}
        <div 
          className={`hidden sm:flex absolute inset-0 items-center transition-all duration-700 ease-out ${
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
              <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 mb-4 text-xs font-medium text-brand-300 border border-white/15 backdrop-blur-sm">
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
          Mobile Floating Glass CTA (Variant A):
          Ultra-clean, compact floating pill at the bottom edge of the video.
          Zero clutter, 100% video/carpet visibility, seamless luxury feel.
        */}
        <div 
          className={`sm:hidden absolute inset-x-0 bottom-3 px-4 flex items-center justify-center transition-all duration-500 ease-out z-20 ${
            isEnded ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-2 pointer-events-none'
          }`}
        >
          <button
            type="button"
            onClick={() => onNavigate?.('catalog')}
            className="w-full max-w-xs inline-flex items-center justify-center gap-2 rounded-full bg-slate-950/75 hover:bg-slate-900/90 active:scale-95 text-white border border-white/20 backdrop-blur-md px-5 py-2.5 text-xs font-semibold shadow-xl shadow-black/60 transition-all duration-200"
          >
            <span>Перейти в каталог ковров</span>
            <ArrowRight className="w-3.5 h-3.5 text-brand-400" />
          </button>
        </div>

        {/* 
          Minimalist, non-intrusive replay button:
          Positioned top-right on mobile so it never collides with bottom pill,
          bottom-right on desktop.
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
    </div>
  );
}
