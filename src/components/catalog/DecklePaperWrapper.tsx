import { ReactNode } from 'react';

interface DecklePaperWrapperProps {
  children: ReactNode;
}

export default function DecklePaperWrapper({ children }: DecklePaperWrapperProps) {
  return (
    <div className="min-h-screen bg-[#0f111a] text-slate-800 transition-colors py-0 sm:py-3 lg:py-4 px-0 sm:px-3 lg:px-6">
      {/* Central Parchment Canvas */}
      <div className="relative mx-auto max-w-[1600px] min-h-screen bg-[#faf6ee] shadow-[0_20px_60px_rgba(0,0,0,0.6)] overflow-hidden">
        {/* Left Deckle Torn Paper Edge */}
        <div
          className="absolute left-0 top-0 bottom-0 w-3 sm:w-5 pointer-events-none z-20 select-none"
          style={{
            backgroundImage: "url('/deckle-edge-left.svg')",
            backgroundRepeat: 'repeat-y',
            backgroundSize: '100% 360px',
          }}
          aria-hidden="true"
        />

        {/* Right Deckle Torn Paper Edge */}
        <div
          className="absolute right-0 top-0 bottom-0 w-3 sm:w-5 pointer-events-none z-20 select-none"
          style={{
            backgroundImage: "url('/deckle-edge-left.svg')",
            backgroundRepeat: 'repeat-y',
            backgroundSize: '100% 360px',
            transform: 'scaleX(-1)',
          }}
          aria-hidden="true"
        />

        {/* Top Deckle Torn Paper Edge */}
        <div
          className="absolute top-0 left-0 right-0 h-3 sm:h-5 pointer-events-none z-20 select-none"
          style={{
            backgroundImage: "url('/deckle-edge-top.svg')",
            backgroundRepeat: 'repeat-x',
            backgroundSize: '360px 100%',
          }}
          aria-hidden="true"
        />

        {/* Parchment Content Area */}
        <div className="relative z-10 px-3 sm:px-6 lg:px-8 pt-18 sm:pt-20 pb-20 sm:pb-24">
          {children}
        </div>
      </div>
    </div>
  );
}
