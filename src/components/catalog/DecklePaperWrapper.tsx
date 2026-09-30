import { ReactNode } from 'react';

interface DecklePaperWrapperProps {
  children: ReactNode;
}

export default function DecklePaperWrapper({ children }: DecklePaperWrapperProps) {
  return (
    <div className="min-h-screen bg-[#faf6ee] text-slate-800 transition-colors">
      {/* Subtle organic linen canvas with delicate tone-on-tone margins */}
      <div className="relative mx-auto max-w-[1600px] px-3 sm:px-6 lg:px-10 pt-24 sm:pt-28 lg:pt-32 pb-20 sm:pb-24">
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
