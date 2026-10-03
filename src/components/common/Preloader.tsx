import { useState, useEffect } from 'react';

export function Preloader({ onFinished }: { onFinished: () => void }) {
  const [phase, setPhase] = useState<'logo' | 'expand' | 'done'>('logo');
  const [imageReady, setImageReady] = useState(false);

  useEffect(() => {
    // Гарантируем полную готовность оптимизированного логотипа перед стартом анимации
    const img = new Image();
    img.src = '/Вектор_Синэнергия.png';
    if (img.complete && img.naturalWidth > 0) {
      setImageReady(true);
    } else {
      img.onload = () => setImageReady(true);
      img.onerror = () => setImageReady(true);
    }
  }, []);

  useEffect(() => {
    // Zero-Wait TTI: мгновенный переход без искусственных задержек для B2B-пользователей
    const t = setTimeout(() => {
      setPhase('done');
      onFinished();
    }, 50);
    return () => clearTimeout(t);
  }, [onFinished]);

  return (
    <div
      className={`fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900 transition-opacity duration-400 ease-out ${
        phase === 'done' ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      {/* Radial glow behind logo */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div
          className={`w-72 h-72 rounded-full bg-brand-600/30 blur-3xl transition-all duration-700 ${
            phase === 'logo' ? 'scale-100 opacity-100' : 'scale-125 opacity-0'
          }`}
        />
      </div>

      {/* Logo container */}
      <div
        className={`relative flex flex-col items-center gap-5 transition-all duration-400 ease-out ${
          phase === 'expand' ? 'scale-105 opacity-0 -translate-y-2' : 'scale-100 opacity-100 translate-y-0'
        }`}
      >
        <img
          src="/Вектор_Синэнергия.png"
          alt="Synergiya Group"
          onLoad={() => setImageReady(true)}
          className={`h-28 sm:h-36 w-auto drop-shadow-2xl brightness-0 invert transition-opacity duration-300 ${
            imageReady ? 'opacity-100 animate-preloader-logo' : 'opacity-0'
          }`}
        />
        <div className={`flex items-center gap-2 transition-opacity duration-300 ${imageReady ? 'opacity-100' : 'opacity-0'}`}>
          <div className="h-0.5 w-8 bg-brand-400 rounded-full animate-preloader-line-left" />
          <div className="h-1.5 w-1.5 rounded-full bg-brand-400 animate-preloader-dot" />
          <div className="h-0.5 w-8 bg-brand-400 rounded-full animate-preloader-line-right" />
        </div>
      </div>
    </div>
  );
}

export default Preloader;
