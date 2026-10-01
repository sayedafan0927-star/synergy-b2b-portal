import React from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';

interface B2BPartnerCtaSectionProps {
  onNavigate: (tab: string) => void;
}

/**
 * B2BPartnerCtaSection (Концепт 2: Pure Macro Glassmorphism — Максимальная прозрачность)
 * - 100% аутентичная прозрачность матового стекла 4K-референса (текстура ворса просвечивает насквозь).
 * - Каркас ковра полностью открыт и занимает максимум кадра.
 * - Кнопка «Техно-Люкс»: в покое спокойный шлифованный титан, неоновое сияние (#00FBFF) загорается ТОЛЬКО при наведении.
 */
export default function B2BPartnerCtaSection({ onNavigate }: B2BPartnerCtaSectionProps) {
  return (
    <section className="py-10 sm:py-16 lg:py-20 bg-white select-none">
      <div className="container-w">
        {/* ── 4K Macro Woven Carpet Background Container ── */}
        <div className="relative overflow-hidden rounded-3xl sm:rounded-[36px] bg-slate-950 border border-slate-700/40 shadow-[0_25px_60px_rgba(0,14,35,0.35)] min-h-[440px] sm:min-h-[500px] lg:min-h-[540px] flex items-center justify-center">
          {/* High-res Macro Carpet Background with Frosted Glass Window */}
          <div 
            className="absolute inset-0 bg-cover bg-center transform scale-[1.01] transition-transform duration-1000 ease-out"
            style={{
              backgroundImage: "url('/images/b2b_partner_macro_bg.webp')",
            }}
          />

          {/* Ultra-subtle bottom edge shadow for depth without obscuring carpet texture */}
          <div 
            aria-hidden="true" 
            className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-slate-950/40 to-transparent pointer-events-none" 
          />

          {/* ── Ultra-Transparent Frosted Glassmorphism Card Container ── */}
          <div className="relative z-10 w-full px-5 py-8 sm:px-12 sm:py-12 lg:py-14 max-w-2xl lg:max-w-3xl mx-auto flex flex-col items-center text-center">
            
            {/* Glowing Cyan Tag */}
            <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-slate-950/30 border border-[#00FBFF]/40 backdrop-blur-md mb-3 sm:mb-4 shadow-[0_0_12px_rgba(0,251,255,0.2)]">
              <Sparkles className="w-3.5 h-3.5 text-[#00FBFF]" />
              <span className="font-mono text-[11px] sm:text-xs text-[#5FFFFF] font-semibold uppercase tracking-[0.2em]">
                B2B Сотрудничество
              </span>
            </div>

            {/* Main Luxury Heading */}
            <h2 className="font-display text-2xl sm:text-4xl lg:text-5xl font-bold text-white tracking-tight leading-[1.15] drop-shadow-[0_2px_14px_rgba(0,0,0,0.85)]">
              Детали создают совершенство
            </h2>

            {/* Subheading / Value Proposition */}
            <p className="mt-3 sm:mt-4 text-xs sm:text-base lg:text-lg text-slate-100/90 font-body leading-relaxed max-w-xl font-light drop-shadow-[0_1px_8px_rgba(0,0,0,0.9)]">
              Специальные условия для оптовых покупателей: прямые цены ведущих фабрик, персональный B2B-менеджер,
              приоритетная экспресс-отгрузка за 24 часа и резервирование складских остатков.
            </p>

            {/* ── Techno-Luxury Button (Illuminates ONLY on Hover) ── */}
            <div className="mt-6 sm:mt-8 w-full max-w-[320px] sm:max-w-[400px]">
              <button
                type="button"
                onClick={() => onNavigate('contacts')}
                className="group relative w-full block cursor-pointer select-none transition-all duration-300 transform-gpu active:scale-[0.985] hover:scale-[1.015] focus:outline-none"
              >
                {/* 1. Titanium Outer Chamfer — ambient glow illuminates on hover */}
                <div 
                  className="relative rounded-[20px] p-[2px] transition-all duration-300 shadow-[0_6px_20px_rgba(0,0,0,0.6)] group-hover:shadow-[0_8px_30px_rgba(0,0,0,0.7),0_0_30px_rgba(0,251,255,0.55)]"
                  style={{
                    background: 'linear-gradient(180deg, #4A586E 0%, #1E2838 50%, #0C121D 100%)',
                  }}
                >
                  {/* 2. Trim Groove Container */}
                  <div 
                    className="relative rounded-[18px] p-[1.5px] transition-all duration-300 bg-slate-900 overflow-hidden"
                  >
                    {/* Glowing Cyan Layer (#00FBFF) — STRICTLY HIDDEN BY DEFAULT, GLOWS ONLY ON HOVER */}
                    <div 
                      className="absolute inset-0 rounded-[18px] opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                      style={{
                        background: 'linear-gradient(180deg, #8FFFFF 0%, #00FBFF 50%, #00B4BE 100%)',
                        boxShadow: '0 0 14px rgba(0, 251, 255, 0.9), inset 0 0 6px rgba(0, 251, 255, 0.9)',
                      }}
                    />

                    {/* Subtle Resting Metallic Rim (Visible when not hovering) */}
                    <div 
                      className="absolute inset-0 rounded-[18px] opacity-100 group-hover:opacity-0 transition-opacity duration-300 pointer-events-none"
                      style={{
                        background: 'linear-gradient(180deg, #5A6980 0%, #2A3648 50%, #182230 100%)',
                      }}
                    />

                    {/* Micro Chassis Spacer */}
                    <div className="relative rounded-[16.5px] p-[1px] bg-slate-950">
                      
                      {/* 3. Tactile Brushed Steel Face with Physical Sheen */}
                      <div 
                        className="relative w-full h-[52px] sm:h-[60px] rounded-[15.5px] px-5 flex flex-col items-center justify-center overflow-hidden bg-cover bg-center transition-all duration-300"
                        style={{
                          backgroundImage: "url('/images/brushed_steel_plate.webp')",
                          boxShadow: 'inset 0 1px 2px rgba(255,255,255,0.9), inset 0 -1.5px 3px rgba(0,0,0,0.4)',
                        }}
                      >
                        {/* Interactive Gliding Light Sheen — slides across ONLY on hover */}
                        <div 
                          aria-hidden="true"
                          className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-out pointer-events-none" 
                        />

                        {/* 4. Engraved Dark Typography */}
                        <div className="relative z-10 flex flex-col items-center justify-center leading-tight">
                          <span 
                            className="font-display text-[12px] sm:text-[14px] font-bold uppercase tracking-[0.16em] text-[#0E1726] transition-colors duration-200 group-hover:text-[#060D18]"
                            style={{
                              textShadow: '0 1px 0 rgba(255, 255, 255, 0.9), 0 -0.5px 0 rgba(0, 0, 0, 0.25)',
                            }}
                          >
                            SYNERGIYA GROUP
                          </span>
                          <span 
                            className="font-display text-[9px] sm:text-[10.5px] font-semibold uppercase tracking-[0.24em] text-[#1E2E48] mt-0.5 inline-flex items-center gap-1.5 transition-colors duration-200 group-hover:text-[#004A7C]"
                            style={{
                              textShadow: '0 1px 0 rgba(255, 255, 255, 0.75)',
                            }}
                          >
                            CONNECT NOW • СТАТЬ ПАРТНЁРОМ
                            <ArrowRight className="w-3 h-3 text-[#1E2E48] group-hover:text-[#004A7C] stroke-[2.5] inline-block transition-transform duration-200 group-hover:translate-x-1" />
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
