import { useState } from 'react';

/**
 * PetroglyphRiderRunner
 * Ancient Petroglyph Horse Archer & Running Swordsman galloping across the catalog page.
 * Completely transparent (no background / box), high-speed fluid 60fps gallop,
 * traversing smoothly from left to right, disappearing at the end, and repeating.
 */
export default function PetroglyphRiderRunner() {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="relative hidden md:flex items-center h-11 flex-1 max-w-[320px] lg:max-w-[400px] xl:max-w-[480px] mx-3 overflow-hidden select-none pointer-events-auto cursor-pointer"
      title="Петроглифы Тамгалы: сакский лучник на коне и воин-мечник"
    >
      {/* Soft edge fade masks on left and right edges so entry and exit blend seamlessly into the white page */}
      <div className="absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-white via-white/80 to-transparent z-10 pointer-events-none" />
      <div className="absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-white via-white/80 to-transparent z-10 pointer-events-none" />

      {/* Galloping Caravan running from left to right across the page */}
      <div
        className="absolute bottom-1 flex items-end gap-4 will-change-transform"
        style={{
          animation: 'petroglyphCharge 6.2s cubic-bezier(0.4, 0.08, 0.45, 0.98) infinite',
        }}
      >
        {/* Swordsman on foot running with sword and shield behind the horse */}
        <div
          className="relative flex flex-col items-center"
          style={{
            animation: 'swordsmanSprint 0.28s ease-in-out infinite alternate',
            transformOrigin: 'bottom center',
          }}
        >
          {/* Flipped with -scale-x-100 so he faces and charges towards the right */}
          <img
            src="/ethnic/warrior_swordsman_teal.png"
            alt="Мечник"
            className="h-8 w-auto object-contain -scale-x-100 drop-shadow-[0_2px_4px_rgba(47,94,94,0.18)]"
          />
          {/* Dust trail behind feet */}
          <div
            className="absolute -bottom-0.5 -left-1 w-2.5 h-1 rounded-full bg-amber-800/20 blur-[1px]"
            style={{ animation: 'dustTrail 0.28s ease-out infinite' }}
          />
        </div>

        {/* Horse Archer galloping in the lead */}
        <div
          className="relative flex flex-col items-center"
          style={{
            animation: 'horseGallopFast 0.32s cubic-bezier(0.35, 0.7, 0.4, 1) infinite alternate',
            transformOrigin: 'bottom center',
          }}
        >
          {/* Flipped with -scale-x-100 so horse and archer face and gallop towards the right */}
          <img
            src="/ethnic/horse_archer_teal.png"
            alt="Лучник на коне"
            className="h-9 w-auto object-contain -scale-x-100 drop-shadow-[0_2px_6px_rgba(47,94,94,0.22)]"
          />
          {/* Dust puff behind horse hooves */}
          <div
            className="absolute -bottom-0.5 -left-1.5 w-3.5 h-1 rounded-full bg-amber-800/25 blur-[1px]"
            style={{ animation: 'dustTrail 0.32s ease-out infinite' }}
          />
        </div>
      </div>

      <style>{`
        @keyframes petroglyphCharge {
          0% {
            transform: translate3d(-150px, 0, 0);
            opacity: 0;
          }
          3% {
            opacity: 1;
          }
          84% {
            opacity: 1;
          }
          95% {
            transform: translate3d(520px, 0, 0);
            opacity: 0;
          }
          100% {
            transform: translate3d(520px, 0, 0);
            opacity: 0;
          }
        }

        @keyframes horseGallopFast {
          0% {
            transform: translate3d(0, 0px, 0) rotate(0deg);
          }
          30% {
            transform: translate3d(0, -4.5px, 0) rotate(2deg);
          }
          70% {
            transform: translate3d(0, 1.5px, 0) rotate(-1.5deg);
          }
          100% {
            transform: translate3d(0, -1px, 0) rotate(0.5deg);
          }
        }

        @keyframes swordsmanSprint {
          0% {
            transform: translate3d(0, 0px, 0) rotate(-1deg);
          }
          50% {
            transform: translate3d(0, -3.5px, 0) rotate(1.5deg);
          }
          100% {
            transform: translate3d(0, 1.2px, 0) rotate(-2deg);
          }
        }

        @keyframes dustTrail {
          0% {
            opacity: 0.45;
            transform: translate3d(0, 0, 0) scale(0.8);
          }
          100% {
            opacity: 0;
            transform: translate3d(-14px, -3px, 0) scale(1.6);
          }
        }
      `}</style>
    </div>
  );
}
