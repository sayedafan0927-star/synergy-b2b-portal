import { useEffect, useRef, useState, useCallback } from 'react';

interface UseSynchronizedCategoryVideosOptions {
  playDurationMs?: number; // duration of video playback phase (default: 6000ms)
  pauseDurationMs?: number; // breathing pause phase on final frame (default: 1200ms)
}

export function useSynchronizedCategoryVideos({}: UseSynchronizedCategoryVideosOptions = {}) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const isVisibleRef = useRef(false);
  const cycleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHoldingPauseRef = useRef(false);
  const [isBreathing, setIsBreathing] = useState(false);

  const registerVideoRef = useCallback((index: number) => (el: HTMLVideoElement | null) => {
    videoRefs.current[index] = el;
    if (el) {
      el.muted = true;
      el.playsInline = true;
      el.loop = false; // Never use native independent loop so they don't desynchronize
      el.setAttribute('muted', '');
      el.setAttribute('playsinline', '');
      el.setAttribute('webkit-playsinline', 'true');
    }
  }, []);

  const frameCallbackIdRef = useRef<number | null>(null);

  const freezeAndHold = useCallback(() => {
    if (isHoldingPauseRef.current) return;
    isHoldingPauseRef.current = true;
    setIsBreathing(true);

    if (cycleTimeoutRef.current) {
      clearTimeout(cycleTimeoutRef.current);
      cycleTimeoutRef.current = null;
    }

    const activeVideos = videoRefs.current.filter((v): v is HTMLVideoElement => Boolean(v));
    activeVideos.forEach((v) => {
      try {
        v.pause();
      } catch {}
    });

    // Hold pause on final face for exactly 1.5 seconds (1500ms)
    cycleTimeoutRef.current = setTimeout(() => {
      if (isVisibleRef.current) {
        runSyncCycle();
      }
    }, 1500);
  }, []);

  const runSyncCycle = useCallback(() => {
    if (cycleTimeoutRef.current) {
      clearTimeout(cycleTimeoutRef.current);
      cycleTimeoutRef.current = null;
    }

    const primaryVid = videoRefs.current[0];
    if (primaryVid && frameCallbackIdRef.current !== null && 'cancelVideoFrameCallback' in primaryVid) {
      (primaryVid as any).cancelVideoFrameCallback(frameCallbackIdRef.current);
      frameCallbackIdRef.current = null;
    }

    if (!isVisibleRef.current || document.visibilityState === 'hidden') {
      return;
    }

    const activeVideos = videoRefs.current.filter((v): v is HTMLVideoElement => Boolean(v));
    if (activeVideos.length === 0) return;

    isHoldingPauseRef.current = false;
    setIsBreathing(false);

    // 1. Reset all videos to frame 0 and play in lockstep
    activeVideos.forEach((v) => {
      try {
        v.currentTime = 0;
        const playPromise = v.play();
        if (playPromise !== undefined) {
          playPromise.catch(() => {});
        }
      } catch {}
    });

    // 2. High-precision hardware frame sync using requestVideoFrameCallback (60Hz / 120Hz ProMotion)
    const primary = activeVideos[0];
    if (primary && 'requestVideoFrameCallback' in primary) {
      const checkFrame = (_now: DOMHighResTimeStamp, metadata: { mediaTime: number }) => {
        if (!isVisibleRef.current || isHoldingPauseRef.current) return;
        if (metadata.mediaTime >= 5.85) {
          freezeAndHold();
          return;
        }
        frameCallbackIdRef.current = (primary as any).requestVideoFrameCallback(checkFrame);
      };
      frameCallbackIdRef.current = (primary as any).requestVideoFrameCallback(checkFrame);
    }

    // 3. Fallback timer at 5.95s in case rVFC is unsupported on legacy browsers
    cycleTimeoutRef.current = setTimeout(() => {
      freezeAndHold();
    }, 5950);
  }, [freezeAndHold]);

  // Handle Visibility and Viewport Intersection
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        if (cycleTimeoutRef.current) clearTimeout(cycleTimeoutRef.current);
        videoRefs.current.forEach((v) => v?.pause());
      } else if (isVisibleRef.current) {
        runSyncCycle();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            isVisibleRef.current = true;
            runSyncCycle();
          } else {
            isVisibleRef.current = false;
            if (cycleTimeoutRef.current) {
              clearTimeout(cycleTimeoutRef.current);
              cycleTimeoutRef.current = null;
            }
            videoRefs.current.forEach((v) => v?.pause());
          }
        });
      },
      { threshold: 0.05, rootMargin: '250px 0px 100px 0px' }
    );

    const sectionEl = sectionRef.current;
    if (sectionEl) {
      observer.observe(sectionEl);
    }

    // Touch/click fallback for iOS Low Power Mode
    const handleFirstGesture = () => {
      if (isVisibleRef.current && !isHoldingPauseRef.current) {
        runSyncCycle();
      }
    };
    window.addEventListener('touchstart', handleFirstGesture, { once: true, passive: true });
    window.addEventListener('click', handleFirstGesture, { once: true, passive: true });

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('touchstart', handleFirstGesture);
      window.removeEventListener('click', handleFirstGesture);
      if (cycleTimeoutRef.current) {
        clearTimeout(cycleTimeoutRef.current);
      }
      const primaryVid = videoRefs.current[0];
      if (primaryVid && frameCallbackIdRef.current !== null && 'cancelVideoFrameCallback' in primaryVid) {
        (primaryVid as any).cancelVideoFrameCallback(frameCallbackIdRef.current);
        frameCallbackIdRef.current = null;
      }
      if (sectionEl) {
        observer.unobserve(sectionEl);
      }
      observer.disconnect();
    };
  }, [runSyncCycle]);

  return {
    sectionRef,
    registerVideoRef,
    isBreathing,
  };
}
