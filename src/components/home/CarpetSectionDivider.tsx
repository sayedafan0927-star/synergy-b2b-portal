interface CarpetSectionDividerProps {
  variant?: 'dark-to-light' | 'light-to-muted' | 'muted-to-light' | 'light-to-accent';
  className?: string;
}

export default function CarpetSectionDivider({
  variant = 'dark-to-light',
  className = '',
}: CarpetSectionDividerProps) {
  if (variant === 'dark-to-light') {
    return (
      <div
        className={`relative w-full overflow-hidden select-none pointer-events-none -mt-px ${className}`}
        aria-hidden="true"
      >
        {/* Background transition wrapper */}
        <div className="relative w-full bg-slate-950">
          {/* Subtle gold filament line */}
          <div className="h-[1px] w-full bg-gradient-to-r from-transparent via-amber-400/50 to-transparent" />

          {/* Kilim Micro-border SVG */}
          <svg
            className="w-full h-5 sm:h-7 text-white fill-current block"
            viewBox="0 0 1200 28"
            preserveAspectRatio="none"
          >
            {/* Base triangular / tooth fringe pattern mimicking woven carpet hem */}
            <path
              d="
                M0,28 L0,14 
                C150,14 200,6 300,10 
                C400,14 450,22 600,18 
                C750,14 800,4 900,10 
                C1000,16 1100,24 1200,14 
                L1200,28 Z
              "
              fill="currentColor"
            />
            {/* Delicate rhythmic tassels along the edge */}
            {Array.from({ length: 48 }).map((_, i) => {
              const x = i * 25 + 12;
              return (
                <line
                  key={i}
                  x1={x}
                  y1={0}
                  x2={x}
                  y2={12}
                  stroke="#d4af37"
                  strokeWidth="1"
                  strokeOpacity="0.35"
                  strokeDasharray="2,2"
                />
              );
            })}
          </svg>
        </div>
      </div>
    );
  }

  if (variant === 'light-to-muted') {
    return (
      <div
        className={`relative w-full overflow-hidden select-none pointer-events-none py-2 bg-gradient-to-b from-white to-slate-50 ${className}`}
        aria-hidden="true"
      >
        <div className="container-w flex items-center justify-center gap-3">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-amber-400/25 to-slate-300/40" />
          <div className="flex items-center gap-1.5 px-2 text-amber-500/50">
            <span className="text-[10px]">◇</span>
            <span className="text-xs font-serif">❖</span>
            <span className="text-[10px]">◇</span>
          </div>
          <div className="h-px flex-1 bg-gradient-to-l from-transparent via-amber-400/25 to-slate-300/40" />
        </div>
      </div>
    );
  }

  if (variant === 'muted-to-light') {
    return (
      <div
        className={`relative w-full overflow-hidden select-none pointer-events-none py-2 bg-gradient-to-b from-slate-50 to-white ${className}`}
        aria-hidden="true"
      >
        <div className="container-w flex items-center justify-center gap-3">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-300/40 to-amber-400/25" />
          <div className="flex items-center gap-1.5 px-2 text-amber-500/50">
            <span className="text-[10px]">◇</span>
            <span className="text-xs font-serif">❖</span>
            <span className="text-[10px]">◇</span>
          </div>
          <div className="h-px flex-1 bg-gradient-to-l from-transparent via-slate-300/40 to-amber-400/25" />
        </div>
      </div>
    );
  }

  // default / light-to-accent
  return (
    <div
      className={`relative w-full overflow-hidden select-none pointer-events-none py-3 ${className}`}
      aria-hidden="true"
    >
      <div className="container-w flex items-center justify-center gap-4">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-amber-400/30 to-brand-500/20" />
        <span className="font-mono text-[10px] text-amber-600/60 uppercase tracking-[0.25em]">
          Synergy Heritage Carpet Weave
        </span>
        <div className="h-px flex-1 bg-gradient-to-l from-transparent via-amber-400/30 to-brand-500/20" />
      </div>
    </div>
  );
}
