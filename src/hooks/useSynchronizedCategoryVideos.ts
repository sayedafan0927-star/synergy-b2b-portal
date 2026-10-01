import { useEffect, useRef, useState, useCallback } from 'react';

interface UseSynchronizedCategoryVideosOptions {
  playDurationMs?: number; // duration of video playback phase (default: 6000ms)
  pauseDurationMs?: number; // breathing pause phase on final frame (default: 1200ms)
}

export function useSynchronizedCategoryVideos({
  playDurationMs = 6000,
  pauseDurationMs = 1200,
}: UseSynchronizedCategoryVideosOptions = {}) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isVisibleRef = useRef(false);
  const [isBreathing, setIsBreathing] = useState(false);

  const registerVideoRef = useCallback((index: number) => (el: HTMLVideoElement | null) => {
    videoRefs.current[index] = el;
  }, []);

  const runSyncCycle = useCallback(() => {
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = null;
    }

    if (!isVisibleRef.current || document.visibilityState === 'hidden') {
      return;
    }

    // Skip heavy multi-video synchronization loop on mobile screens (< 768px)
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      return;
    }

    const activeVideos = videoRefs.current.filter((v): v is HTMLVideoElement => Boolean(v));
    if (activeVideos.length === 0) return;

    // 1. Start Phase: Reset all videos to 0 and play simultaneously
    setIsBreathing(false);
    activeVideos.forEach((v) => {
      try {
        v.pause();
        v.currentTime = 0;
        const playPromise = v.play();
        if (playPromise !== undefined) {
          playPromise.catch(() => {});
        }
      } catch {
        // Safe fallback for strict autoplay policies
      }
    });

    // 2. Playback Phase: Wait until full animation finishes
    syncTimeoutRef.current = setTimeout(() => {
      // 3. Breathing Pause Phase: freeze on final majestic frame
      setIsBreathing(true);
      activeVideos.forEach((v) => {
        try {
          v.pause();
        } catch {}
      });

      // 4. Hold pause for pauseDurationMs, then restart next synchronized cycle
      syncTimeoutRef.current = setTimeout(() => {
        runSyncCycle();
      }, pauseDurationMs);
    }, playDurationMs);
  }, [playDurationMs, pauseDurationMs]);

  // Handle Visibility and Viewport Intersection
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
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
            if (syncTimeoutRef.current) {
              clearTimeout(syncTimeoutRef.current);
              syncTimeoutRef.current = null;
            }
            videoRefs.current.forEach((v) => v?.pause());
          }
        });
      },
      { threshold: 0.15 }
    );

    const sectionEl = sectionRef.current;
    if (sectionEl) {
      observer.observe(sectionEl);
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (sectionEl) {
        observer.unobserve(sectionEl);
      }
      observer.disconnect();
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
    };
  }, [runSyncCycle]);

  return {
    sectionRef,
    registerVideoRef,
    isBreathing,
  };
}
