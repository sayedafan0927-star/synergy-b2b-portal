interface CarpetSectionDividerProps {
  variant?: 
    | 'dark-to-light' 
    | 'dark-to-linen' 
    | 'linen-to-sapphire' 
    | 'sapphire-to-light' 
    | 'light-to-muted' 
    | 'muted-to-light' 
    | 'light-to-accent';
  className?: string;
}

export default function CarpetSectionDivider({
  variant = 'dark-to-linen',
  className = '',
}: CarpetSectionDividerProps) {
  // 1. Dark Hero (slate-950) -> Warm Linen Parchment (#faf7f2)
  if (variant === 'dark-to-linen' || variant === 'dark-to-light') {
    const bottomBg = variant === 'dark-to-linen' ? '#faf7f2' : '#ffffff';
    return (
      <div
        className={`relative w-full overflow-hidden select-none pointer-events-none -mt-px ${className}`}
        aria-hidden="true"
      >
        <div className="relative w-full bg-slate-950">
          {/* Subtle gold filament line */}
          <div className="h-[1.5px] w-full bg-gradient-to-r from-transparent via-amber-400/60 to-transparent" />

          {/* Kilim Micro-border SVG with warm linen bottom */}
          <svg
            className="w-full h-5 sm:h-7 block"
            style={{ color: bottomBg }}
            viewBox="0 0 1200 28"
            preserveAspectRatio="none"
          >
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
                  strokeWidth="1.2"
                  strokeOpacity="0.4"
                  strokeDasharray="2,2"
                />
              );
            })}
          </svg>
        </div>
      </div>
    );
  }

  // 2. Warm Linen Parchment (#faf7f2) -> Deep Midnight Sapphire (#051325)
  if (variant === 'linen-to-sapphire') {
    return (
      <div
        className={`relative w-full overflow-hidden select-none pointer-events-none -mt-px ${className}`}
        aria-hidden="true"
      >
        <div className="relative w-full bg-[#faf7f2]">
          <div className="h-[1px] w-full bg-gradient-to-r from-transparent via-amber-500/30 to-transparent" />
          <svg
            className="w-full h-5 sm:h-7 text-[#051325] fill-current block"
            viewBox="0 0 1200 28"
            preserveAspectRatio="none"
          >
            <path
              d="
                M0,28 L0,14 
                C120,6 220,18 360,10 
                C500,2 620,16 760,12 
                C900,8 1020,18 1200,14 
                L1200,28 Z
              "
              fill="currentColor"
            />
            {Array.from({ length: 40 }).map((_, i) => (
              <circle
                key={i}
                cx={i * 30 + 15}
                cy={10}
                r="1.5"
                fill="#d4af37"
                fillOpacity="0.6"
              />
            ))}
          </svg>
        </div>
      </div>
    );
  }

  // 3. Deep Midnight Sapphire (#051325) -> Crisp Light (#f8f9fb)
  if (variant === 'sapphire-to-light') {
    return (
      <div
        className={`relative w-full overflow-hidden select-none pointer-events-none -mt-px ${className}`}
        aria-hidden="true"
      >
        <div className="relative w-full bg-[#051325]">
          <div className="h-[1.5px] w-full bg-gradient-to-r from-transparent via-amber-400/50 to-transparent" />
          <svg
            className="w-full h-5 sm:h-7 text-[#f8f9fb] fill-current block"
            viewBox="0 0 1200 28"
            preserveAspectRatio="none"
          >
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
                  strokeWidth="1.2"
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

  // 4. Default / light-to-accent
  return (
    <div
      className={`relative w-full overflow-hidden select-none pointer-events-none py-3 ${className}`}
      aria-hidden="true"
    >
      <div className="container-w flex items-center justify-center gap-4">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-amber-400/40 to-brand-500/20" />
        <span className="font-mono text-[10px] text-amber-700/80 uppercase tracking-[0.25em] flex items-center gap-2">
          <span>◇</span>
          <span>Synergy Heritage Carpet Weave</span>
          <span>◇</span>
        </span>
        <div className="h-px flex-1 bg-gradient-to-l from-transparent via-amber-400/40 to-brand-500/20" />
      </div>
    </div>
  );
}
