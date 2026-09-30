import { useRef, useState, useEffect } from 'react';
import { RotateCcw, Sparkles } from 'lucide-react';
import type { PageId } from '@/types';

interface HeroBannerMediaProps {
  onNavigate?: (page: PageId) => void;
}

export default function HeroBannerMedia({ onNavigate }: HeroBannerMediaProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isEnded, setIsEnded] = useState(false);
  const [isPlaying, setIsPlaying] = useState(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Ensure playsinline and muted for strict iOS Safari autoplay
    video.muted = true;
    video.defaultMuted = true;
    
    const playPromise = video.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => setIsPlaying(true))
        .catch(() => {
          // Autoplay fallback: if browser blocks autoplay, keep poster and allow user to click
          setIsPlaying(false);
        });
    }
  }, []);

  const handleEnded = () => {
    if (videoRef.current) {
      videoRef.current.pause(); // Freeze on final frame
    }
    setIsEnded(true);
    setIsPlaying(false);
  };

  const handleReplay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!videoRef.current) return;
    videoRef.current.currentTime = 0;
    videoRef.current.play().then(() => {
      setIsEnded(false);
      setIsPlaying(true);
    }).catch(() => {});
  };

  return (
    <div className="relative group w-full max-w-xl mx-auto lg:max-w-none">
      {/* Ambient ambient glow aura */}
      <div 
        aria-hidden="true" 
        className="absolute -inset-2 sm:-inset-4 rounded-3xl bg-gradient-to-tr from-brand-500/20 via-accent-500/15 to-white/5 blur-2xl transition-opacity duration-700 pointer-events-none" 
      />

      {/* Main card container */}
      <div className="relative rounded-2xl sm:rounded-3xl border border-white/15 bg-slate-900/60 shadow-2xl backdrop-blur-md overflow-hidden transition-all duration-300 hover:border-white/25">
        {/* Video Wrapper */}
        <div className="relative aspect-[16/9] w-full overflow-hidden bg-slate-950">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            preload="metadata"
            poster="/assets/hero-poster.webp"
            onEnded={handleEnded}
            className="w-full h-full object-cover object-center pointer-events-none"
          >
            <source src="/assets/hero-video.webm" type="video/webm" />
            <source src="/assets/hero-video.mp4" type="video/mp4" />
          </video>

          {/* Top subtle badge overlay */}
          <div className="absolute top-3 left-3 sm:top-4 sm:left-4 z-10 flex items-center gap-1.5 sm:gap-2 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-full bg-slate-900/75 backdrop-blur-md border border-white/15 text-white shadow-md pointer-events-none select-none">
            <Sparkles className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-brand-400 animate-pulse" />
            <span className="text-[10px] sm:text-xs font-medium tracking-wide">
              {isEnded ? 'B2B Каталог • В наличии' : 'Synergy B2B'}
            </span>
          </div>

          {/* Replay action button when frozen at final frame */}
          {isEnded && (
            <div className="absolute bottom-3 right-3 sm:bottom-4 sm:right-4 z-20">
              <button
                type="button"
                onClick={handleReplay}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 sm:px-3.5 sm:py-2 rounded-xl bg-slate-900/85 hover:bg-brand-600 text-white text-xs font-medium border border-white/20 hover:border-brand-400 backdrop-blur-md shadow-lg transition-all duration-200 group/btn"
                title="Повторить анимацию"
              >
                <RotateCcw className="w-3.5 h-3.5 transition-transform duration-300 group-hover/btn:-rotate-90" />
                <span className="hidden sm:inline">Повторить</span>
              </button>
            </div>
          )}

          {/* Optional banner click-through button in final state */}
          {isEnded && onNavigate && (
            <div className="absolute bottom-3 left-3 sm:bottom-4 sm:left-4 z-20">
              <button
                type="button"
                onClick={() => onNavigate('catalog')}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-brand-500/90 hover:bg-brand-500 text-white text-xs font-medium shadow-md backdrop-blur-sm transition-colors"
              >
                Открыть каталог
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
