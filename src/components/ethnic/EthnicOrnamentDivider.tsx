/**
 * EthnicOrnamentDivider
 * Decorative border / frieze with authentic Kazakh national patterns (қошқар мүйіз & ою-өрнек)
 * separating major portal sections.
 */
export default function EthnicOrnamentDivider() {
  return (
    <div className="relative w-full py-4 bg-gradient-to-r from-slate-900 via-brand-950 to-slate-900 overflow-hidden border-y border-amber-500/20">
      {/* Decorative top & bottom hairline in gold */}
      <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-amber-400/40 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-[1px] bg-gradient-to-r from-transparent via-amber-400/40 to-transparent" />

      <div className="container-w flex items-center justify-between gap-4">
        {/* Left ornament accent */}
        <div className="hidden sm:flex items-center gap-3 opacity-60">
          <img
            src="/ethnic/diamond_ornament_1_gold.png"
            alt=""
            className="w-5 h-5 object-contain"
          />
          <div className="w-16 lg:w-32 h-[1px] bg-gradient-to-r from-amber-400/60 to-transparent" />
        </div>

        {/* Center Kazakh horn emblem & slogan */}
        <div className="flex items-center justify-center gap-4 mx-auto">
          <img
            src="/ethnic/ornament_single_alpha.png"
            alt=""
            className="h-6 w-auto brightness-0 invert opacity-70 drop-shadow-[0_0_8px_rgba(242,179,36,0.5)]"
          />
          <span className="font-display text-xs sm:text-sm uppercase tracking-widest text-amber-200/90 font-medium">
            Традиции ковроткачества Великой Степи
          </span>
          <img
            src="/ethnic/ornament_single_alpha.png"
            alt=""
            className="h-6 w-auto brightness-0 invert opacity-70 -scale-x-100 drop-shadow-[0_0_8px_rgba(242,179,36,0.5)]"
          />
        </div>

        {/* Right ornament accent */}
        <div className="hidden sm:flex items-center gap-3 opacity-60">
          <div className="w-16 lg:w-32 h-[1px] bg-gradient-to-l from-amber-400/60 to-transparent" />
          <img
            src="/ethnic/diamond_ornament_1_gold.png"
            alt=""
            className="w-5 h-5 object-contain"
          />
        </div>
      </div>
    </div>
  );
}
