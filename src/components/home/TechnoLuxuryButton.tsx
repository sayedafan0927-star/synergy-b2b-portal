import React from 'react';
import { ArrowRight } from 'lucide-react';

interface TechnoLuxuryButtonProps {
  onClick?: (e: React.MouseEvent) => void;
  onTouchStart?: (e: React.TouchEvent) => void;
  onTouchMove?: (e: React.TouchEvent) => void;
  text?: string;
  subtext?: string;
  className?: string;
}

/**
 * TechnoLuxuryButton
 * Implements the exact "Техно-Люкс" (Techno-Luxury Interface) design system from reference:
 * - Deep midnight navy outer chassis with atmospheric ambient shadow
 * - Outer sculpted polished steel bezel with top specular chamfer
 * - Recessed electric cyan neon trim groove (#00FBFF) with intense dual-sided glow
 * - Tactile central brushed steel plate with horizontal anisotropic texture
 * - Crisp stamped dark graphite typography (#1A1F2B) with letterpress bevel
 */
export default function TechnoLuxuryButton({
  onClick,
  onTouchStart,
  onTouchMove,
  text = 'ПЕРЕЙТИ В КАТАЛОГ КОВРОВ',
  subtext,
  className = '',
}: TechnoLuxuryButtonProps) {
  return (
    <button
      type="button"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onClick={onClick}
      className={`group relative w-full block cursor-pointer select-none transition-transform duration-200 transform-gpu active:scale-[0.985] hover:scale-[1.008] ${className}`}
    >
      {/* ── 1. Outermost Chassis (Midnight Navy #0A1428 / Dark Graphite Bezel) ── */}
      <div 
        className="relative rounded-[26px] p-[4px] bg-gradient-to-b from-[#222E42] via-[#111A29] to-[#080D16] shadow-[0_16px_36px_rgba(0,0,0,0.85),0_4px_12px_rgba(0,0,0,0.6)]"
      >
        {/* Atmospheric Cyan Aura spilling from behind the chassis */}
        <div 
          aria-hidden="true"
          className="absolute -inset-1 rounded-[28px] opacity-40 group-hover:opacity-70 transition-opacity duration-300 blur-md pointer-events-none -z-10"
          style={{
            background: 'radial-gradient(ellipse at center, rgba(0, 251, 255, 0.45) 0%, rgba(0, 251, 255, 0) 75%)',
          }}
        />

        {/* ── 2. Outer Sculpted Steel Rim (Хромированная / Стальная внешняя фаска) ── */}
        <div 
          className="relative rounded-[22px] p-[3.5px] shadow-[inset_0_1px_1.5px_rgba(255,255,255,0.9),inset_0_-2px_4px_rgba(0,0,0,0.6)]"
          style={{
            background: 'linear-gradient(180deg, #E6EBF0 0%, #B8C2CC 45%, #6C7684 100%)',
          }}
        >
          {/* Subtle dark recess separator before neon channel */}
          <div className="relative rounded-[18.5px] p-[1.5px] bg-[#070D18]">
            
            {/* ── 3. Recessed Radiant Cyan Neon Channel (#00FBFF) ── */}
            <div 
              className="relative rounded-[17px] p-[2.5px] transition-all duration-300"
              style={{
                background: 'linear-gradient(180deg, #62FFFF 0%, #00FBFF 48%, #00BCD4 100%)',
                boxShadow: '0 0 12px #00FBFF, 0 0 24px rgba(0, 251, 255, 0.7), 0 0 40px rgba(0, 251, 255, 0.35), inset 0 0 6px #00FBFF',
              }}
            >
              {/* Inner dark chamfer separating glow from brushed face */}
              <div className="relative rounded-[14.5px] p-[1px] bg-[#09111D]/80">
                
                {/* ── 4. Central Brushed Steel Plate (Лицевая панель шлифованной стали) ── */}
                <div 
                  className="relative w-full rounded-[13.5px] py-4 px-5 sm:px-6 flex items-center justify-center gap-3 overflow-hidden bg-cover bg-center transition-all duration-300"
                  style={{
                    backgroundImage: "url('/images/brushed_steel_plate.webp')",
                    boxShadow: 'inset 0 1.5px 1.5px rgba(255,255,255,0.95), inset 0 -2px 3px rgba(0,0,0,0.45)',
                  }}
                >
                  {/* Subtle anisotropic radial light highlight in center-right */}
                  <div 
                    aria-hidden="true"
                    className="absolute inset-0 pointer-events-none mix-blend-overlay opacity-30"
                    style={{
                      background: 'radial-gradient(ellipse at 65% 50%, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0) 65%)',
                    }}
                  />

                  {/* Dynamic interactive light sheen that glides on hover */}
                  <div 
                    aria-hidden="true"
                    className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-out pointer-events-none" 
                  />

                  {/* ── 5. Stamped Dark Graphite Typography (#1A1F2B) ── */}
                  <div className="relative z-10 flex items-center justify-center gap-2.5 sm:gap-3 text-center">
                    <div className="flex flex-col items-center">
                      <span 
                        className="font-display text-xs sm:text-sm font-extrabold uppercase tracking-[0.16em] text-[#1A1F2B]"
                        style={{
                          textShadow: '0 1px 0 rgba(255, 255, 255, 0.9), 0 -0.5px 0 rgba(0, 0, 0, 0.3)',
                        }}
                      >
                        {text}
                      </span>
                      {subtext && (
                        <span 
                          className="font-mono text-[9px] sm:text-[10px] uppercase tracking-widest text-[#2D3748] mt-0.5"
                          style={{
                            textShadow: '0 1px 0 rgba(255, 255, 255, 0.7)',
                          }}
                        >
                          {subtext}
                        </span>
                      )}
                    </div>

                    <div 
                      className="inline-flex items-center justify-center transition-transform duration-300 group-hover:translate-x-1"
                      style={{
                        filter: 'drop-shadow(0 1px 0 rgba(255, 255, 255, 0.9)) drop-shadow(0 -0.5px 0 rgba(0, 0, 0, 0.3))',
                      }}
                    >
                      <ArrowRight className="w-4 h-4 sm:w-4.5 sm:h-4.5 text-[#1A1F2B] stroke-[2.75]" />
                    </div>
                  </div>

                </div>
              </div>
            </div>

          </div>
        </div>

      </div>
    </button>
  );
}
