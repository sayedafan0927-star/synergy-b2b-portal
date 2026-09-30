interface CarpetSectionDividerProps {
  variant?: 
    | 'dark-to-linen' 
    | 'linen-to-sapphire' 
    | 'sapphire-to-light' 
    | 'dark-to-light'
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
  // Pure seamless organic transition without any hatch lines or border strokes
  if (variant === 'dark-to-linen' || variant === 'dark-to-light') {
    const bottomColor = variant === 'dark-to-linen' ? '#faf7f2' : '#ffffff';
    return (
      <div
        className={`relative w-full overflow-hidden select-none pointer-events-none -mt-px ${className}`}
        aria-hidden="true"
      >
        <div className="relative w-full bg-slate-950">
          {/* Smooth organic curve transition */}
          <svg
            className="w-full h-4 sm:h-6 block"
            style={{ color: bottomColor }}
            viewBox="0 0 1440 24"
            preserveAspectRatio="none"
          >
            <path
              d="
                M0,24 L0,12 
                Q180,16 360,10 
                T720,13 
                T1080,9 
                T1440,12 
                L1440,24 Z
              "
              fill="currentColor"
            />
          </svg>
        </div>
      </div>
    );
  }

  // 2. Warm Linen (#faf6ee) -> Deep Midnight Sapphire (#0e1726)
  // Authentic Oriental Kilim Diamond Fretwork
  if (variant === 'linen-to-sapphire') {
    return (
      <div
        className={`relative w-full overflow-hidden select-none pointer-events-none -mt-px ${className}`}
        aria-hidden="true"
      >
        <div className="relative w-full bg-[#faf6ee]">
          {/* Ethnic Kilim Border Motif */}
          <div className="container-w flex items-center justify-center gap-3 py-1.5 opacity-60">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-[#c59b48]/40 to-slate-400/30" />
            <div className="flex items-center gap-2 text-[#c59b48] text-[9px] tracking-widest font-serif">
              <span>❖</span>
              <span>✦</span>
              <span>❖</span>
            </div>
            <div className="h-px flex-1 bg-gradient-to-l from-transparent via-[#c59b48]/40 to-slate-400/30" />
          </div>

          <svg
            className="w-full h-4 sm:h-6 text-[#0e1726] fill-current block"
            viewBox="0 0 1440 24"
            preserveAspectRatio="none"
          >
            <path
              d="
                M0,24 L0,10 
                Q160,5 320,12 
                T640,8 
                T960,13 
                T1280,7 
                T1440,11 
                L1440,24 Z
              "
              fill="currentColor"
            />
          </svg>
        </div>
      </div>
    );
  }

  // 3. Deep Midnight Sapphire (#0e1726) -> Warm Light Canvas (#faf6ee)
  if (variant === 'sapphire-to-light') {
    return (
      <div
        className={`relative w-full overflow-hidden select-none pointer-events-none -mt-px ${className}`}
        aria-hidden="true"
      >
        <div className="relative w-full bg-[#0e1726]">
          <div className="h-[1px] w-full bg-gradient-to-r from-transparent via-[#c59b48]/60 to-transparent" />
          <svg
            className="w-full h-4 sm:h-6 text-[#faf6ee] fill-current block"
            viewBox="0 0 1440 24"
            preserveAspectRatio="none"
          >
            <path
              d="
                M0,24 L0,11 
                Q180,7 360,13 
                T720,8 
                T1080,14 
                T1440,10 
                L1440,24 Z
              "
              fill="currentColor"
            />
          </svg>
        </div>
      </div>
    );
  }

  // 4. Default / Accent separator
  return (
    <div
      className={`relative w-full overflow-hidden select-none pointer-events-none py-3 bg-[#faf6ee] ${className}`}
      aria-hidden="true"
    >
      <div className="container-w flex items-center justify-center gap-4">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-[#c59b48]/40 to-slate-400/20" />
        <span className="font-mono text-[9px] text-[#c59b48] uppercase tracking-[0.3em] flex items-center gap-2">
          <span>❖</span>
          <span>Synergy Heritage Weave</span>
          <span>❖</span>
        </span>
        <div className="h-px flex-1 bg-gradient-to-l from-transparent via-[#c59b48]/40 to-slate-400/20" />
      </div>
    </div>
  );
}
