import { useRef, useState, useEffect } from 'react';
import { RotateCcw, ArrowRight, Sparkles } from 'lucide-react';
import type { PageId } from '@/types';

interface HeroBannerMediaProps {
  onNavigate?: (page: PageId) => void;
}

export default function HeroBannerMedia({ onNavigate }: HeroBannerMediaProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isEnded, setIsEnded] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.muted = true;
    video.defaultMuted = true;

    video.play().catch(() => {
      // If autoplay is blocked by browser, immediately show final state
      setIsEnded(true);
    });
  }, []);

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

  return (
    <div className="hero-banner-media relative w-full h-[62vh] sm:h-[72vh] lg:h-[82vh] min-h-[480px] max-h-[860px] bg-slate-950 overflow-hidden select-none">
      {/* 
        Full clean video background:
        Plays completely clean with zero obstruction during playback.
      */}
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        preload="metadata"
        poster="/assets/hero-poster.webp"
        onEnded={handleEnded}
        className="w-full h-full object-cover object-[center_right]"
      >
        <source src="/assets/hero-video.webm" type="video/webm" />
        <source src="/assets/hero-video.mp4" type="video/mp4" />
      </video>

      {/* 
        Harmonious End-State Interactive Overlay:
        Fades in smoothly when video freezes at final frame, covering AI pseudo-text on the left
        while keeping the B2B dashboard & oriental carpet visual on the right fully visible.
      */}
      <div 
        className={`absolute inset-0 flex items-center transition-all duration-700 ease-out ${
          isEnded ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Soft dark left vignette that blends into the video */}
        <div 
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-r from-slate-950/80 via-slate-950/40 to-transparent pointer-events-none" 
        />

        <div className="relative container-w py-6 sm:py-10">
          <div className="max-w-lg p-6 sm:p-8 rounded-2xl sm:rounded-3xl bg-slate-950/80 backdrop-blur-md border border-white/15 shadow-2xl transition-all duration-500">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 mb-4 text-xs font-medium text-brand-400 border border-white/10">
              <Sparkles className="w-3.5 h-3.5 text-brand-400" />
              Оптовый поставщик • В наличии на складах
            </div>

            <h1 className="font-display text-2xl sm:text-4xl font-bold text-white leading-tight">
              Оптовые поставки <span className="text-brand-400">ковровых покрытий</span>
            </h1>

            <p className="mt-3 text-xs sm:text-sm text-slate-300 font-body leading-relaxed">
              Широкий ассортимент ковров от ведущих производителей Турции, Бельгии и Ирана. 
              Более 1500 наименований в наличии. Отгрузка за 24 часа.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => onNavigate?.('catalog')}
                className="btn-primary inline-flex items-center justify-center gap-2 text-sm px-5 py-2.5 shadow-lg shadow-brand-500/20"
              >
                Перейти в каталог
                <ArrowRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => onNavigate?.('contacts')}
                className="btn-secondary border-white/20 bg-white/10 text-white backdrop-blur-sm hover:bg-white/20 inline-flex items-center justify-center gap-2 text-sm px-5 py-2.5"
              >
                Связаться с нами
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 
        Minimalist, non-intrusive replay button:
        Tiny icon button in the bottom-right corner without text or visual noise.
      */}
      <button
        type="button"
        onClick={handleReplay}
        className="absolute bottom-3 right-3 sm:bottom-4 sm:right-4 z-30 w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-black/40 hover:bg-black/80 text-white/60 hover:text-white border border-white/15 backdrop-blur-md flex items-center justify-center shadow transition-all duration-200 group/btn"
        title="Повторить видео с начала"
      >
        <RotateCcw className="w-3.5 h-3.5 transition-transform duration-300 group-hover/btn:-rotate-90" />
      </button>
    </div>
  );
}
