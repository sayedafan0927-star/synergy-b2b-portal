import React, { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import B2BPartnerModal from './B2BPartnerModal';

interface B2BPartnerCtaSectionProps {
  onNavigate?: (tab: string) => void;
}

export default function B2BPartnerCtaSection({ onNavigate: _onNavigate }: B2BPartnerCtaSectionProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { t } = useLanguage();
  return (
    <section className="py-6 sm:py-16 lg:py-20 bg-white select-none">
      <div className="container-w">
        {/* ── 4K Macro Woven Carpet Background Container ── */}
        <div className="relative overflow-hidden rounded-2xl sm:rounded-[36px] bg-slate-950 border border-slate-700/40 shadow-[0_25px_60px_rgba(0,14,35,0.35)] min-h-[280px] sm:min-h-[520px] lg:min-h-[560px] flex items-center justify-center p-3 sm:p-0">
          {/* High-res Macro Carpet Background with Authentic Frosted Glass Window */}
          <div 
            className="absolute inset-0 bg-cover bg-center transform scale-[1.01] transition-transform duration-1000 ease-out"
            style={{
              backgroundImage: "url('/images/b2b_partner_macro_bg.webp')",
            }}
          />

          {/* ── Delicate Transparent Content (Completely Transparent, No Nested Double Modal) ── */}
          <div className="relative z-10 w-full max-w-[290px] sm:max-w-lg lg:max-w-xl mx-auto px-2 py-4 sm:px-10 sm:py-10 lg:py-12 bg-transparent flex flex-col items-center text-center">

            {/* Main Luxury Heading */}
            <h2 className="font-display text-xl sm:text-4xl lg:text-[42px] font-bold text-white tracking-tight leading-[1.15] drop-shadow-[0_2px_14px_rgba(0,0,0,0.85)]">
              {t('home.b2b_title')}
            </h2>

            {/* Subheading / Value Proposition */}
            <p className="mt-2 sm:mt-4 text-[11.5px] sm:text-sm lg:text-base text-slate-100/90 font-body leading-relaxed max-w-[260px] sm:max-w-md font-light drop-shadow-[0_1px_8px_rgba(0,0,0,0.9)]">
              {t('home.b2b_desc')}
            </p>

            {/* ── Techno-Luxury Button (Illuminates ONLY on Hover) ── */}
            <div className="mt-4 sm:mt-7 w-full max-w-[220px] sm:max-w-[280px]">
              <button
                type="button"
                onClick={() => setIsModalOpen(true)}
                className="group relative w-full block cursor-pointer select-none transition-all duration-300 transform-gpu active:scale-[0.985] hover:scale-[1.015] focus:outline-none"
              >
                {/* 1. Titanium Outer Chamfer — ambient glow illuminates on hover */}
                <div 
                  className="relative rounded-[16px] sm:rounded-[18px] p-[2px] transition-all duration-300 shadow-[0_6px_20px_rgba(0,0,0,0.6)] group-hover:shadow-[0_8px_30px_rgba(0,0,0,0.7),0_0_30px_rgba(0,251,255,0.6)]"
                  style={{
                    background: 'linear-gradient(180deg, #4A586E 0%, #1E2838 50%, #0C121D 100%)',
                  }}
                >
                  {/* 2. Trim Groove Container */}
                  <div 
                    className="relative rounded-[14px] sm:rounded-[16px] p-[1.5px] transition-all duration-300 bg-slate-900 overflow-hidden"
                  >
                    {/* Glowing Cyan Layer (#00FBFF) — STRICTLY HIDDEN BY DEFAULT, GLOWS ONLY ON HOVER */}
                    <div 
                      className="absolute inset-0 rounded-[14px] sm:rounded-[16px] opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                      style={{
                        background: 'linear-gradient(180deg, #8FFFFF 0%, #00FBFF 50%, #00B4BE 100%)',
                        boxShadow: '0 0 14px rgba(0, 251, 255, 0.9), inset 0 0 6px rgba(0, 251, 255, 0.9)',
                      }}
                    />

                    {/* Subtle Resting Metallic Rim (Visible when not hovering) */}
                    <div 
                      className="absolute inset-0 rounded-[14px] sm:rounded-[16px] opacity-100 group-hover:opacity-0 transition-opacity duration-300 pointer-events-none"
                      style={{
                        background: 'linear-gradient(180deg, #5A6980 0%, #2A3648 50%, #182230 100%)',
                      }}
                    />

                    {/* Micro Chassis Spacer */}
                    <div className="relative rounded-[13px] sm:rounded-[15px] p-[1px] bg-slate-950">
                      
                      {/* 3. Tactile Brushed Steel Face with Physical Sheen */}
                      <div 
                        className="relative w-full h-[40px] sm:h-[46px] rounded-[12px] sm:rounded-[14px] px-4 sm:px-6 flex items-center justify-center overflow-hidden bg-cover bg-center transition-all duration-300"
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

                        {/* 4. Engraved Dark Typography: Localized CTA with Arrow */}
                        <div className="relative z-10 flex items-center justify-center gap-2">
                          <span 
                            className="font-display text-[11px] sm:text-[13px] font-bold uppercase tracking-[0.16em] text-[#0E1726] transition-colors duration-200 group-hover:text-[#060D18]"
                            style={{
                              textShadow: '0 1px 0 rgba(255, 255, 255, 0.9), 0 -0.5px 0 rgba(0, 0, 0, 0.25)',
                            }}
                          >
                            {t('home.b2b_cta')}
                          </span>
                          <ArrowRight className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#1E2E48] group-hover:text-[#004A7C] stroke-[2.5] inline-block transition-transform duration-200 group-hover:translate-x-1" />
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

      {/* ── Apple-Style Floating Partner Application Modal ── */}
      <B2BPartnerModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </section>
  );
}
