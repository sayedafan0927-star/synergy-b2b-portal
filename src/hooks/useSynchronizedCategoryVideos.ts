import { useEffect, useRef, useState, useCallback } from 'react';

interface UseSynchronizedCategoryVideosOptions {
  playDurationMs?: number; // duration of video playback phase (default: 6000ms)
  pauseDurationMs?: number; // breathing pause phase on final frame (default: 1200ms)
}

export function useSynchronizedCategoryVideos({}: UseSynchronizedCategoryVideosOptions = {}) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const isVisibleRef = useRef(false);
  const [isBreathing] = useState(false);

  const registerVideoRef = useCallback((index: number) => (el: HTMLVideoElement | null) => {
    videoRefs.current[index] = el;
    if (el) {
      el.muted = true;
      el.playsInline = true;
      el.loop = true;
      el.setAttribute('muted', '');
      el.setAttribute('playsinline', '');
      el.setAttribute('webkit-playsinline', 'true');
      el.setAttribute('loop', '');
    }
  }, []);

  const startVideos = useCallback(() => {
    if (!isVisibleRef.current || document.visibilityState === 'hidden') {
      return;
    }

    const activeVideos = videoRefs.current.filter((v): v is HTMLVideoElement => Boolean(v));
    if (activeVideos.length === 0) return;

    activeVideos.forEach((v) => {
      v.muted = true;
      v.playsInline = true;
      v.loop = true;
      try {
        if (v.paused) {
          v.currentTime = 0;
          const playPromise = v.play();
          if (playPromise !== undefined) {
            playPromise.catch(() => {});
          }
        }
      } catch {
        // Autoplay policy fallback
      }
    });
  }, []);

  // Handle Visibility and Viewport Intersection
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        videoRefs.current.forEach((v) => v?.pause());
      } else if (isVisibleRef.current) {
        startVideos();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            isVisibleRef.current = true;
            startVideos();
          } else {
            isVisibleRef.current = false;
            videoRefs.current.forEach((v) => v?.pause());
          }
        });
      },
      { threshold: 0.1 }
    );

    const sectionEl = sectionRef.current;
    if (sectionEl) {
      observer.observe(sectionEl);
    }

    // Touch/click fallback for iOS Low Power Mode
    const handleFirstGesture = () => {
      if (isVisibleRef.current) {
        startVideos();
      }
    };
    window.addEventListener('touchstart', handleFirstGesture, { once: true, passive: true });
    window.addEventListener('click', handleFirstGesture, { once: true, passive: true });

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('touchstart', handleFirstGesture);
      window.removeEventListener('click', handleFirstGesture);
      if (sectionEl) {
        observer.unobserve(sectionEl);
      }
      observer.disconnect();
    };
  }, [startVideos]);

  return {
    sectionRef,
    registerVideoRef,
    isBreathing,
  };
}
