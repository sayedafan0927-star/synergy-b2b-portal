import { useRef, useState, useEffect } from 'react';
import { RotateCcw, Play, Pause } from 'lucide-react';

export default function HeroBannerMedia() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.muted = true;
    video.defaultMuted = true;

    video.play()
      .then(() => setIsPlaying(true))
      .catch(() => {
        setIsPlaying(false);
      });
  }, []);

  const handleEnded = () => {
    if (videoRef.current) {
      videoRef.current.pause(); // Freeze on final frame
    }
    setIsPlaying(false);
  };

  const handleTogglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().then(() => setIsPlaying(true)).catch(() => {});
    } else {
      video.pause();
      setIsPlaying(false);
    }
  };

  const handleReplay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!videoRef.current) return;
    videoRef.current.currentTime = 0;
    videoRef.current.play().then(() => {
      setIsPlaying(true);
    }).catch(() => {});
  };

  return (
    <div 
      onClick={handleTogglePlay}
      className="hero-banner-media relative w-full h-[55vh] sm:h-[68vh] lg:h-[80vh] min-h-[420px] max-h-[860px] bg-slate-950 overflow-hidden cursor-pointer select-none group"
    >
      {/* 
        Clean video display without dark overlays or superimposed text
        object-cover ensures it fills the entire width and height cleanly
      */}
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        preload="metadata"
        poster="/assets/hero-poster.webp"
        onEnded={handleEnded}
        className="w-full h-full object-cover object-center"
      >
        <source src="/assets/hero-video.webm" type="video/webm" />
        <source src="/assets/hero-video.mp4" type="video/mp4" />
      </video>

      {/* Floating control buttons */}
      <div 
        className="absolute bottom-4 right-4 sm:bottom-6 sm:right-6 z-20 flex items-center gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={handleTogglePlay}
          className="p-2 sm:p-2.5 rounded-full bg-slate-900/85 hover:bg-slate-900 text-white border border-white/20 backdrop-blur-md shadow-lg transition-all"
          title={isPlaying ? 'Пауза' : 'Воспроизвести'}
        >
          {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        </button>

        <button
          type="button"
          onClick={handleReplay}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-slate-900/85 hover:bg-brand-600 text-white text-xs font-medium border border-white/20 hover:border-brand-400 backdrop-blur-md shadow-lg transition-all"
          title="Смотреть сначала"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Сначала</span>
        </button>
      </div>
    </div>
  );
}
