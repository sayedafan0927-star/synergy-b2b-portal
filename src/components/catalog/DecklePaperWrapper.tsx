import { ReactNode } from 'react';

interface DecklePaperWrapperProps {
  children: ReactNode;
}

export default function DecklePaperWrapper({ children }: DecklePaperWrapperProps) {
  return (
    <div className="min-h-screen bg-[#faf6ee] text-slate-800 transition-colors">
      {/* Subtle organic linen canvas with delicate tone-on-tone margins */}
      <div className="relative mx-auto max-w-[1600px] px-3 sm:px-6 lg:px-10 pt-16 sm:pt-20 lg:pt-24 pb-20 sm:pb-24">
        {/* Top Center Synergy Group Crest Tab Pill */}
        <div 
          aria-hidden="true"
          className="absolute top-0 left-1/2 -translate-x-1/2 bg-[#f4ebe1] border-b border-x border-[#e3d9cb] rounded-b-2xl px-6 py-2 shadow-xs flex flex-col items-center justify-center z-20 pointer-events-none"
        >
          <img src="/Вектор_Синэнергия.png" alt="Synergy Group" className="h-6 w-auto object-contain mx-auto" />
          <span className="text-[9px] font-bold tracking-wider text-[#1e293b] uppercase mt-0.5 text-center leading-none font-sans">
            SYNERGIYA
          </span>
          <span className="text-[7.5px] font-semibold tracking-widest text-slate-500 uppercase text-center leading-none mt-0.5 font-sans">
            GROUP
          </span>
        </div>
        {/* Soft, delicate antique carpet boundary hairlines on edges (editorial & laconic) */}
        <div 
          className="absolute left-3 sm:left-6 lg:left-10 top-20 bottom-12 w-px bg-gradient-to-b from-transparent via-[#c59b48]/30 to-transparent pointer-events-none hidden md:block" 
          aria-hidden="true" 
        />
        <div 
          className="absolute right-3 sm:right-6 lg:right-10 top-20 bottom-12 w-px bg-gradient-to-b from-transparent via-[#c59b48]/30 to-transparent pointer-events-none hidden md:block" 
          aria-hidden="true" 
        />

        {/* Content Area */}
        <div className="relative z-10">
          {children}
        </div>
      </div>
    </div>
  );
}
