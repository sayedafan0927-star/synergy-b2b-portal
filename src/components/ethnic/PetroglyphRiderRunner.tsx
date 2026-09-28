import { useState } from 'react';

/**
 * PetroglyphRiderRunner
 * Micro-scene for the Catalog toolbar:
 * Galloping petroglyph horse archer followed by a running petroglyph warrior (swordsman).
 * Styled with authentic Tamgaly petroglyph silhouettes, dust particles, and ancient steppe track.
 */
export default function PetroglyphRiderRunner() {
  const [isHovered, setIsHovered] = useState(false);
  const [sparks, setSparks] = useState<{ id: number; x: number; y: number }[]>([]);

  const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const newSparks = Array.from({ length: 6 }, (_, i) => ({
      id: Date.now() + i,
      x: x + (Math.random() - 0.5) * 20,
      y: y + (Math.random() - 0.5) * 15,
    }));
    setSparks((prev) => [...prev.slice(-12), ...newSparks]);
    setTimeout(() => {
      setSparks((prev) => prev.filter((s) => !newSparks.includes(s)));
    }, 800);
  };

  return (
    <div
      onClick={handleTrackClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      title="Петроглифы Тамгалы (Танбалы) • III тыс. до н.э. — Наследие Великой Степи"
      className="relative hidden lg:flex items-center justify-center h-10 px-3 py-1 rounded-xl bg-gradient-to-r from-amber-950/5 via-brand-900/5 to-amber-950/5 border border-amber-900/10 hover:border-amber-700/30 transition-all duration-300 cursor-pointer overflow-hidden group select-none max-w-[260px] xl:max-w-[320px] flex-1 mx-2"
    >
      {/* Background horizon ground line with dashed stone texture */}
      <div className="absolute inset-x-0 bottom-2.5 h-[1.5px] bg-gradient-to-r from-transparent via-amber-800/30 to-transparent border-b border-dashed border-amber-600/30" />

      {/* Subtle ambient gold glow on hover */}
      <div
        className={`absolute inset-0 bg-gradient-to-r from-amber-500/0 via-amber-500/10 to-amber-500/0 transition-opacity duration-500 ${
          isHovered ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Micro-spark particles when clicked */}
      {sparks.map((spark) => (
        <span
          key={spark.id}
          className="absolute w-1 h-1 rounded-full bg-amber-400 animate-ping pointer-events-none"
          style={{ left: `${spark.x}px`, top: `${spark.y}px` }}
        />
      ))}

      {/* Galloping and running figures container */}
      <div className="relative w-full h-full flex items-center justify-end overflow-hidden">
        {/* Animated track traversing horizontally */}
        <div
          className={`flex items-end gap-3 transition-transform duration-700 ${
            isHovered ? 'scale-105' : 'scale-100'
          }`}
          style={{
            animation: 'petroglyphPatrol 18s ease-in-out infinite alternate',
          }}
        >
          {/* Warrior swordsman on foot (charging behind the rider) */}
          <div
            className="relative flex flex-col items-center group-hover:drop-shadow-[0_0_8px_rgba(242,179,36,0.6)]"
            style={{
              animation: 'warriorSprint 0.45s ease-in-out infinite alternate',
              transformOrigin: 'bottom center',
            }}
          >
            <img
              src="/ethnic/warrior_swordsman_teal.png"
              alt="Мечник"
              className="h-7 w-auto object-contain transition-all group-hover:brightness-125"
            />
            {/* Dust puff under foot */}
            <div
              className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-3 h-0.5 rounded-full bg-amber-700/20 blur-[1px]"
              style={{ animation: 'dustPuff 0.45s ease-out infinite' }}
            />
          </div>

          {/* Horse archer / rider (galloping in the lead) */}
          <div
            className="relative flex flex-col items-center group-hover:drop-shadow-[0_0_10px_rgba(242,179,36,0.8)]"
            style={{
              animation: 'horseGallop 0.4s ease-in-out infinite alternate',
              transformOrigin: 'bottom center',
            }}
          >
            <img
              src="/ethnic/horse_archer_teal.png"
              alt="Лучник на коне"
              className="h-8 w-auto object-contain transition-all group-hover:brightness-125"
            />
            {/* Dust cloud under hooves */}
            <div
              className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-4 h-0.5 rounded-full bg-amber-700/25 blur-[1px]"
              style={{ animation: 'dustPuff 0.4s ease-out infinite' }}
            />
          </div>
        </div>
      </div>

      {/* Tooltip badge on hover */}
      <div
        className={`absolute -top-7 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-md bg-slate-900/90 text-amber-200 text-[10px] font-medium tracking-wide shadow-md border border-amber-500/20 pointer-events-none transition-all duration-300 whitespace-nowrap z-20 ${
          isHovered ? 'opacity-100 -translate-y-0.5' : 'opacity-0 translate-y-1'
        }`}
      >
        Петроглифы Тамгалы: лучник и мечник
      </div>

      <style>{`
        @keyframes horseGallop {
          0% {
            transform: translateY(0px) rotate(0deg);
          }
          50% {
            transform: translateY(-2.5px) rotate(-1.5deg);
          }
          100% {
            transform: translateY(1px) rotate(1deg);
          }
        }
        @keyframes warriorSprint {
          0% {
            transform: translateY(0px) rotate(1.5deg);
          }
          50% {
            transform: translateY(-2px) rotate(0deg);
          }
          100% {
            transform: translateY(0.5px) rotate(-2deg);
          }
        }
        @keyframes dustPuff {
          0% {
            opacity: 0.5;
            transform: translateX(-2px) scale(0.8);
          }
          100% {
            opacity: 0;
            transform: translateX(4px) scale(1.4);
          }
        }
        @keyframes petroglyphPatrol {
          0% {
            transform: translateX(25px);
          }
          50% {
            transform: translateX(-40px);
          }
          100% {
            transform: translateX(25px);
          }
        }
      `}</style>
    </div>
  );
}
