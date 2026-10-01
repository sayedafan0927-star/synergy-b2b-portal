import { useRef, useState, useEffect } from 'react';
import { RotateCcw } from 'lucide-react';
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

    const isVisibleRef = { current: true };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        if (video && !video.paused) {
          video.pause();
        }
      } else {
        if (video && video.paused && isVisibleRef.current) {
          video.play().catch(() => {});
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            isVisibleRef.current = true;
            if (document.visibilityState !== 'hidden' && video && video.paused) {
              video.play().catch(() => {});
            }
          } else {
            isVisibleRef.current = false;
            if (video && !video.paused) {
              video.pause();
            }
          }
        });
      },
      { threshold: 0.05 }
    );
    observer.observe(video);

    // Touch/click fallback for iOS devices in Low Power Mode
    const handleFirstGesture = () => {
      if (video && video.paused && isVisibleRef.current) {
        video.play().catch(() => {});
      }
    };
    window.addEventListener('touchstart', handleFirstGesture, { once: true, passive: true });
    window.addEventListener('click', handleFirstGesture, { once: true, passive: true });

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      observer.disconnect();
      window.removeEventListener('touchstart', handleFirstGesture);
      window.removeEventListener('click', handleFirstGesture);
    };
  }, [isReady]);

  const loopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (loopTimerRef.current) {
        clearTimeout(loopTimerRef.current);
      }
    };
  }, []);

  const handleEnded = () => {
    // Freeze on final frame for 1.5 seconds across all devices (desktop and mobile)
    if (videoRef.current) {
      videoRef.current.pause();
    }
    setIsEnded(true);

    if (loopTimerRef.current) clearTimeout(loopTimerRef.current);
    loopTimerRef.current = setTimeout(() => {
      const video = videoRef.current;
      if (video) {
        setIsEnded(false);
        try {
          video.currentTime = 0;
        } catch {}
        video.play().catch(() => {});
      }
    }, 1500);
  };

  // High-performance hardware frame presentation callback (60Hz / 120Hz ProMotion VSync)
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let callbackId: number | null = null;
    let isCancelled = false;

    const onFrame = (_now: DOMHighResTimeStamp, metadata: { mediaTime: number }) => {
      if (isCancelled) return;
      if (video.duration && !Number.isNaN(video.duration)) {
        if (metadata.mediaTime >= video.duration - 0.35 && !isEnded) {
          setIsEnded(true);
        }
      }
      if ('requestVideoFrameCallback' in video) {
        callbackId = (video as any).requestVideoFrameCallback(onFrame);
      }
    };

    if ('requestVideoFrameCallback' in video) {
      callbackId = (video as any).requestVideoFrameCallback(onFrame);
    }

    return () => {
      isCancelled = true;
      if (callbackId !== null && 'cancelVideoFrameCallback' in video) {
        (video as any).cancelVideoFrameCallback(callbackId);
      }
    };
  }, [isEnded]);

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video || !video.duration || Number.isNaN(video.duration)) return;
    if (video.currentTime >= video.duration - 0.4 && !isEnded) {
      setIsEnded(true);
    }
  };

  const handleReplay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (loopTimerRef.current) {
      clearTimeout(loopTimerRef.current);
      loopTimerRef.current = null;
    }
    if (!videoRef.current) return;
    setIsEnded(false);
    try {
      videoRef.current.currentTime = 0;
    } catch {}
    videoRef.current.play().catch(() => {});
  };

  // Guard against scroll gestures being misinterpreted as clicks on touch screens
  const touchStartY = useRef<number | null>(null);
  const touchStartX = useRef<number | null>(null);
  const hasMoved = useRef(false);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    hasMoved.current = false;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const dx = Math.abs(e.touches[0].clientX - touchStartX.current);
    const dy = Math.abs(e.touches[0].clientY - touchStartY.current);
    if (dx > 8 || dy > 8) {
      hasMoved.current = true;
    }
  };

  const handleCatalogNavigate = (e: React.MouseEvent) => {
    if (hasMoved.current) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    onNavigate?.('catalog');
  };

  return (
    <div className="hero-banner-media relative w-full bg-slate-950 select-none">
      {/* 
        Video Viewport:
        - Mobile (< sm): aspect-[16/9] renders 100% of the video frame with zero clipping (full leopard + carpet).
        - Desktop (sm+): full-height hero banner sm:h-[72vh] lg:h-[82vh] with object-cover.
        - Pure Cinema: Video plays completely clean without obstructing watermarks.
        - Strict GPU containment & isolation to eliminate reflows and battery drain.
      */}
      <div className="relative w-full aspect-[16/9] sm:aspect-auto sm:h-[72vh] lg:h-[82vh] sm:min-h-[480px] max-h-[860px] overflow-hidden bg-slate-950 [contain:paint_layout] [isolation:isolate] transform-gpu">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          {...({ 'webkit-playsinline': 'true' } as any)}
          disablePictureInPicture
          disableRemotePlayback
          preload="auto"
          poster={POSTER}
          onEnded={handleEnded}
          onTimeUpdate={handleTimeUpdate}
          style={{
            willChange: 'transform, opacity',
            transform: 'translateZ(0)',
            backfaceVisibility: 'hidden',
          }}
          className="w-full h-full object-cover object-center sm:object-[center_right] transform-gpu pointer-events-none"
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
          {/* Subtle soft dark left vignette that gently blends into the video without overpowering it */}
          <div 
            aria-hidden="true"
            className={`absolute inset-0 bg-gradient-to-r from-black/40 via-black/15 to-transparent transition-opacity duration-1000 ease-out ${
              isEnded ? 'opacity-100' : 'opacity-0'
            }`} 
          />

          <div className="relative container-w py-6 sm:py-10">
            {/* ── Techno-Luxury End-State Call To Action Card (Air Tint HUD) ── */}
            <div 
              className={`max-w-[480px] lg:max-w-[540px] rounded-[32px] bg-slate-950/25 backdrop-blur-md shadow-[0_20px_50px_rgba(0,0,0,0.6),0_0_35px_rgba(0,251,255,0.2)] transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] relative select-none ${
                isEnded 
                  ? 'opacity-100 translate-y-0 scale-100 pointer-events-auto' 
                  : 'opacity-0 translate-y-16 scale-[0.92] pointer-events-none'
              }`}
            >
              <img 
                src="/images/techno_hero_card.webp" 
                alt="Прямые оптовые поставки ковровых коллекций" 
                className="w-full h-auto block select-none pointer-events-none drop-shadow-[0_10px_30px_rgba(0,0,0,0.8)]"
              />

              {/* Interactive Button Overlay precisely mapped to the brushed steel CTA button */}
              <button
                type="button"
                onClick={handleCatalogNavigate}
                className="absolute z-10 rounded-[14px] cursor-pointer group focus:outline-none transition-transform duration-200 active:scale-[0.985] hover:scale-[1.01]"
                style={{
                  left: '9.34%',
                  top: '76.33%',
                  width: '81.33%',
                  height: '14.71%',
                }}
                title="Перейти в каталог"
                aria-label="Перейти в каталог"
              >
                {/* Dynamic light sheen that glides across the metal button on hover */}
                <span 
                  aria-hidden="true"
                  className="absolute inset-0 rounded-[14px] opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none shadow-[0_0_20px_rgba(0,251,255,0.6)]"
                  style={{
                    background: 'linear-gradient(180deg, rgba(255,255,255,0.18) 0%, rgba(0,251,255,0.2) 100%)',
                  }}
                />
              </button>
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
    </div>
  );
}
