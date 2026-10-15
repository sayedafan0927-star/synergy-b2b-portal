import { ReactNode } from 'react';

interface DecklePaperWrapperProps {
  children: ReactNode;
}

export default function DecklePaperWrapper({ children }: DecklePaperWrapperProps) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 transition-colors">
      {/* Subtle organic linen canvas with delicate tone-on-tone margins */}
      <div className="relative w-full max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-8 xl:px-10 pt-16 sm:pt-20 lg:pt-24 pb-20 sm:pb-24">

        {/* Soft, delicate antique carpet boundary hairlines on edges (editorial & laconic) */}
        <div 
          className="absolute left-4 sm:left-6 lg:left-8 xl:left-10 top-20 bottom-12 w-px bg-gradient-to-b from-transparent via-slate-200 to-transparent pointer-events-none hidden md:block" 
          aria-hidden="true" 
        />
        <div 
          className="absolute right-4 sm:right-6 lg:right-8 xl:right-10 top-20 bottom-12 w-px bg-gradient-to-b from-transparent via-slate-200 to-transparent pointer-events-none hidden md:block" 
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
