import { useRef, useState, useEffect } from 'react';
import { RotateCcw } from 'lucide-react';

export default function HeroBannerMedia() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isEnded, setIsEnded] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.muted = true;
    video.defaultMuted = true;

    video.play().catch(() => {
      // Autoplay fallback: poster is shown
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
    videoRef.current.currentTime = 0;
    videoRef.current.play().then(() => {
      setIsEnded(false);
    }).catch(() => {});
  };

  return (
    <div className="hero-banner-media absolute inset-0 w-full h-full overflow-hidden select-none bg-slate-950">
      {/* 
        Video layer:
        - opacity-45 to 55 prevents video from eclipsing foreground UI and text
        - object-[center_right] focuses the visual action to the right
      */}
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        preload="metadata"
        poster="/assets/hero-poster.webp"
        onEnded={handleEnded}
        className="hero-video w-full h-full object-cover object-[center_right] pointer-events-none opacity-45 lg:opacity-55 transition-opacity duration-700"
      >
        <source src="/assets/hero-video.webm" type="video/webm" />
        <source src="/assets/hero-video.mp4" type="video/mp4" />
      </video>

      {/* 
        Multi-stop horizontal mask:
        - 0% to 45%: solid deep slate-950 completely blacks out and conceals AI gibberish text behind our real text
        - 45% to 75%: smooth fade out so right-side visual animation shines through cleanly
        - 75% to 100%: subtle tint so bright video elements don't distract
      */}
      <div 
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-r from-slate-950 from-0% via-slate-950 via-42% to-slate-950/20 to-100% pointer-events-none" 
      />

      {/* Vertical vignette blending with header and lower sections */}
      <div 
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-slate-950/50 pointer-events-none" 
      />

      {/* Replay action button when frozen at final frame */}
      {isEnded && (
        <div className="absolute bottom-4 right-4 sm:bottom-6 sm:right-6 z-20">
          <button
            type="button"
            onClick={handleReplay}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-900/80 hover:bg-brand-600 text-white text-xs font-medium border border-white/20 hover:border-brand-400 backdrop-blur-md shadow-lg transition-all duration-200 group/btn"
            title="Повторить видео"
          >
            <RotateCcw className="w-3.5 h-3.5 transition-transform duration-300 group-hover/btn:-rotate-90 text-brand-400 group-hover/btn:text-white" />
            <span className="text-[11px] sm:text-xs">Повторить</span>
          </button>
        </div>
      )}
    </div>
  );
}
