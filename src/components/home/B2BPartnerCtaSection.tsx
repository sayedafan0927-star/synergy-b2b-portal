import React from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';

interface B2BPartnerCtaSectionProps {
  onNavigate: (tab: string) => void;
}

/**
 * B2BPartnerCtaSection (Концепт 2: Pure Macro Glassmorphism)
 * Реализация на основе 4K референса макросъёмки коврового ворса
 * с парящей стеклянной карточкой (Frosted Glassmorphism)
 * и премиальной кнопкой «Техно-Люкс» (Brushed Steel + Radiant Cyan Trim).
 */
export default function B2BPartnerCtaSection({ onNavigate }: B2BPartnerCtaSectionProps) {
  return (
    <section className="py-14 sm:py-20 lg:py-24 bg-white select-none">
      <div className="container-w">
        {/* ── 4K Macro Woven Carpet Background Container ── */}
        <div className="relative overflow-hidden rounded-3xl sm:rounded-[36px] bg-slate-950 border border-slate-800/80 shadow-[0_30px_70px_rgba(0,14,35,0.45)]">
          {/* High-res Macro Carpet Background Image */}
          <div 
            className="absolute inset-0 bg-cover bg-center sm:bg-[center_35%] transform scale-[1.02] transition-transform duration-1000 ease-out"
            style={{
              backgroundImage: "url('/images/b2b_partner_macro_bg.webp')",
            }}
          />

          {/* Ambient Lighting & Vignette */}
          <div 
            aria-hidden="true" 
            className="absolute inset-0 bg-gradient-to-t from-slate-950/85 via-slate-950/30 to-slate-950/60 pointer-events-none" 
          />

          {/* ── Floating Frosted Glassmorphism Card (Variant 2) ── */}
          <div className="relative z-10 px-6 py-12 sm:px-12 sm:py-16 lg:py-20 max-w-3xl mx-auto flex flex-col items-center text-center">
            
            {/* Ambient Cyan Halo behind the Card */}
            <div 
              aria-hidden="true"
              className="absolute -top-10 left-1/2 -translate-x-1/2 w-72 h-40 bg-[#00FBFF]/15 blur-3xl rounded-full pointer-events-none" 
            />

            {/* Glowing Cyan Tag */}
            <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-[#00FBFF]/10 border border-[#00FBFF]/35 backdrop-blur-md mb-4 shadow-[0_0_15px_rgba(0,251,255,0.25)]">
              <Sparkles className="w-3.5 h-3.5 text-[#00FBFF] animate-pulse" />
              <span className="font-mono text-[11px] sm:text-xs text-[#5FFFFF] font-semibold uppercase tracking-[0.2em]">
                B2B Сотрудничество
              </span>
            </div>

            {/* Main Luxury Heading */}
            <h2 className="font-display text-2xl sm:text-4xl lg:text-5xl font-bold text-white tracking-tight leading-[1.15] drop-shadow-[0_2px_12px_rgba(0,0,0,0.8)]">
              Детали создают совершенство
            </h2>

            {/* Subheading / Value Proposition */}
            <p className="mt-4 sm:mt-5 text-sm sm:text-base lg:text-lg text-slate-200/90 font-body leading-relaxed max-w-2xl font-light drop-shadow-[0_1px_6px_rgba(0,0,0,0.9)]">
              Специальные условия для оптовых покупателей: прямые цены ведущих фабрик, персональный B2B-менеджер,
              приоритетная экспресс-отгрузка за 24 часа и резервирование складских остатков.
            </p>

            {/* ── Techno-Luxury Button (Brushed Steel + Radiant Cyan Trim #00FBFF) ── */}
            <div className="mt-8 sm:mt-10 w-full max-w-[340px] sm:max-w-[420px]">
              <button
                type="button"
                onClick={() => onNavigate('contacts')}
                className="group relative w-full block cursor-pointer select-none transition-all duration-300 transform-gpu active:scale-[0.985] hover:scale-[1.015] focus:outline-none"
              >
                {/* 1. Titanium Outer Chamfer with Cyan Ambient Glow */}
                <div 
                  className="relative rounded-[22px] p-[2px] transition-all duration-300 group-hover:shadow-[0_0_35px_rgba(0,251,255,0.5)]"
                  style={{
                    background: 'linear-gradient(180deg, #4A586E 0%, #1E2838 50%, #0C121D 100%)',
                    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.7), 0 0 16px rgba(0, 251, 255, 0.35)',
                  }}
                >
                  {/* 2. Radiant Cyan Trim Groove (#00FBFF) */}
                  <div 
                    className="relative rounded-[20px] p-[1.5px] transition-all duration-300"
                    style={{
                      background: 'linear-gradient(180deg, #8FFFFF 0%, #00FBFF 50%, #00B4BE 100%)',
                      boxShadow: '0 0 10px rgba(0, 251, 255, 0.7), inset 0 0 5px rgba(0, 251, 255, 0.8)',
                    }}
                  >
                    {/* Micro Chassis Spacer */}
                    <div className="relative rounded-[18.5px] p-[1px] bg-slate-950">
                      
                      {/* 3. Tactile Brushed Steel Face with Physical Sheen */}
                      <div 
                        className="relative w-full h-[58px] sm:h-[64px] rounded-[17.5px] px-5 flex flex-col items-center justify-center overflow-hidden bg-cover bg-center transition-all duration-300"
                        style={{
                          backgroundImage: "url('/images/brushed_steel_plate.webp')",
                          boxShadow: 'inset 0 1px 2px rgba(255,255,255,0.9), inset 0 -1.5px 3px rgba(0,0,0,0.4)',
                        }}
                      >
                        {/* Interactive Gliding Light Sheen on Hover */}
                        <div 
                          aria-hidden="true"
                          className="absolute inset-0 bg-gradient-to-r from-transparent via-white/35 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-out pointer-events-none" 
                        />

                        {/* 4. Engraved Dark Typography (Styled as Reference Screen) */}
                        <div className="relative z-10 flex flex-col items-center justify-center leading-tight">
                          <span 
                            className="font-display text-[13px] sm:text-[15px] font-bold uppercase tracking-[0.16em] text-[#0E1726]"
                            style={{
                              textShadow: '0 1px 0 rgba(255, 255, 255, 0.9), 0 -0.5px 0 rgba(0, 0, 0, 0.25)',
                            }}
                          >
                            SYNERGIYA GROUP
                          </span>
                          <span 
                            className="font-display text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.24em] text-[#1E2E48] mt-0.5 inline-flex items-center gap-1.5"
                            style={{
                              textShadow: '0 1px 0 rgba(255, 255, 255, 0.75)',
                            }}
                          >
                            CONNECT NOW • СТАТЬ ПАРТНЁРОМ
                            <ArrowRight className="w-3 h-3 text-[#1E2E48] stroke-[2.5] inline-block transition-transform duration-200 group-hover:translate-x-1" />
                          </span>
                        </div>

                      </div>
                    </div>
                  </div>

                </div>
              </button>
            </div>

          </div>
        </div>
      </div>
    </section>
  );
}
