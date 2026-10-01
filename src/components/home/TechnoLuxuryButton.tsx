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
 * Normalized luxury industrial ergonomics (Apple Titanium / Swiss Horology standards):
 * - Slim 44px mobile height (balanced visual weight, no bulky aggressive bumper)
 * - Proportional 14px rounded geometry
 * - Hairline 1px radiant cyan inner contour with elegant, non-blinding luminescence
 * - Tactile brushed steel metal face with physical specular highlight
 * - Engraved dark graphite typography (#16202E) with stamped letterpress bevel
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
      className={`group relative w-full block cursor-pointer select-none transition-all duration-200 transform-gpu active:scale-[0.985] hover:scale-[1.008] ${className}`}
    >
      {/* ── 1. Slim Titanium Outer Bezel (Hairline chamfer with subtle cyan ambient glow) ── */}
      <div 
        className="relative rounded-[16px] p-[1.5px] transition-all duration-300"
        style={{
          background: 'linear-gradient(180deg, #4A586E 0%, #1E2838 50%, #0C121D 100%)',
          boxShadow: '0 4px 14px rgba(0, 0, 0, 0.55), 0 0 10px rgba(0, 251, 255, 0.35)',
        }}
      >
        {/* ── 2. Delicate Hairline Cyan Trim Groove (#00FBFF) ── */}
        <div 
          className="relative rounded-[14.5px] p-[1px] transition-all duration-300"
          style={{
            background: 'linear-gradient(180deg, #5FFFFF 0%, #00FBFF 50%, #00C8D2 100%)',
            boxShadow: '0 0 6px rgba(0, 251, 255, 0.5), inset 0 0 3px rgba(0, 251, 255, 0.6)',
          }}
        >
          {/* Micro dark separator */}
          <div className="relative rounded-[13.5px] p-[1px] bg-slate-950/80">
            
            {/* ── 3. Tactile Brushed Steel Face (Refined 40px inner height) ── */}
            <div 
              className="relative w-full h-[40px] sm:h-[42px] rounded-[12px] px-4 flex items-center justify-center gap-2 overflow-hidden bg-cover bg-center transition-all duration-200"
              style={{
                backgroundImage: "url('/images/brushed_steel_plate.webp')",
                boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.9), inset 0 -1px 2px rgba(0,0,0,0.35)',
              }}
            >
              {/* Interactive light sheen on hover */}
              <div 
                aria-hidden="true"
                className="absolute inset-0 bg-gradient-to-r from-transparent via-white/25 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-out pointer-events-none" 
              />

              {/* ── 4. Stamped Dark Graphite Typography (#16202E) ── */}
              <div className="relative z-10 flex items-center justify-center gap-2 text-center">
                <span 
                  className="font-display text-[11px] sm:text-xs font-bold uppercase tracking-[0.14em] text-[#16202E]"
                  style={{
                    textShadow: '0 1px 0 rgba(255, 255, 255, 0.85), 0 -0.5px 0 rgba(0, 0, 0, 0.2)',
                  }}
                >
                  {text}
                </span>

                <div 
                  className="inline-flex items-center justify-center transition-transform duration-200 group-hover:translate-x-1"
                  style={{
                    filter: 'drop-shadow(0 1px 0 rgba(255, 255, 255, 0.85))',
                  }}
                >
                  <ArrowRight className="w-3.5 h-3.5 text-[#16202E] stroke-[2.75]" />
                </div>
              </div>

            </div>
          </div>
        </div>

      </div>
    </button>
  );
}
