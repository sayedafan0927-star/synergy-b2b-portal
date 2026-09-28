export default function RockArtChase() {
  return (
    <div className="rock-art-chase" aria-label="Наскальная анимация охоты" role="img">
      <svg viewBox="0 0 420 120" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <radialGradient id="rockBg" cx="50%" cy="40%" r="75%">
            <stop offset="0%" stopColor="#e8dcc8" />
            <stop offset="55%" stopColor="#d4c4a8" />
            <stop offset="100%" stopColor="#b8a685" />
          </radialGradient>
          <filter id="rockTexture" x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" seed="7" />
            <feColorMatrix values="0 0 0 0 0.35  0 0 0 0 0.28  0 0 0 0 0.2  0 0 0 0.12 0" />
            <feComposite in2="SourceGraphic" operator="in" />
          </filter>
          <linearGradient id="pigmentRed" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#a8431e" />
            <stop offset="100%" stopColor="#7a2e12" />
          </linearGradient>
          <linearGradient id="pigmentOchre" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#c8862e" />
            <stop offset="100%" stopColor="#9a621c" />
          </linearGradient>
          <linearGradient id="pigmentChar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3a3128" />
            <stop offset="100%" stopColor="#1e1812" />
          </linearGradient>
          <radialGradient id="dustGrad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#c4a87a" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#c4a87a" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Stone wall background */}
        <rect width="420" height="120" fill="url(#rockBg)" />
        <rect width="420" height="120" filter="url(#rockTexture)" opacity="0.5" />

        {/* Cave wall cracks */}
        <g opacity="0.15" stroke="#5a4a38" strokeWidth="0.8" fill="none">
          <path d="M30 0L45 30L38 60L52 90L48 120" />
          <path d="M180 0L170 25L185 50L175 80L190 120" />
          <path d="M340 0L355 35L348 70L360 120" />
        </g>

        {/* Ground line */}
        <path
          d="M0 96C60 93 120 98 210 95C280 93 350 98 420 95"
          stroke="#6b5538" strokeWidth="1.5" fill="none" opacity="0.4" strokeDasharray="4 6"
        />

        {/* Decorative cave markings */}
        <g className="rock-art-markings" opacity="0.3">
          <g stroke="#6b5538" strokeWidth="1.2" fill="none" strokeLinecap="round">
            <path d="M330 30C338 24 346 24 352 30C346 36 338 36 330 30Z" />
            <path d="M335 30H347" />
            <path d="M380 50C388 44 396 44 402 50M391 44V58" />
            <circle cx="365" cy="25" r="1.5" fill="#6b5538" stroke="none" />
            <circle cx="372" cy="22" r="1" fill="#6b5538" stroke="none" />
            <circle cx="378" cy="26" r="1.3" fill="#6b5538" stroke="none" />
            <path d="M350 70L355 65L360 70L355 75Z" />
            <path d="M390 80L395 75L400 80L395 85Z" />
          </g>
        </g>

        {/* Dust particles under rider */}
        <g className="rock-art-dust">
          <circle className="dust-particle p1" cx="0" cy="92" r="2.5" fill="url(#dustGrad)" />
          <circle className="dust-particle p2" cx="0" cy="90" r="1.8" fill="url(#dustGrad)" />
          <circle className="dust-particle p3" cx="0" cy="94" r="3" fill="url(#dustGrad)" />
          <circle className="dust-particle p4" cx="0" cy="91" r="2" fill="url(#dustGrad)" />
        </g>

        {/* ── Rider on horseback with bow ── */}
        <g className="rock-art-rider">
          {/* Horse body */}
          <g fill="url(#pigmentOchre)" stroke="#6b4a1e" strokeWidth="1.5" strokeLinejoin="round">
            {/* Body */}
            <path d="M18 58C24 54 32 53 40 55C48 57 56 56 62 54L68 58C64 64 56 66 48 65C40 64 32 66 24 64C20 63 17 61 18 58Z" />
            {/* Neck */}
            <path d="M60 54C64 48 68 46 72 46C74 48 73 52 70 55C66 58 62 58 60 56Z" />
            {/* Head */}
            <path d="M70 46C74 43 78 42 82 44C84 46 83 49 80 50C76 51 72 50 70 48Z" />
            {/* Mane */}
            <path d="M64 48C66 44 68 43 70 45C68 47 66 49 64 50ZM68 46C70 42 72 41 74 43C72 45 70 47 68 48Z" fill="#6b4a1e" stroke="none" />
            {/* Legs (animated via CSS class) */}
            <path className="leg leg-fl" d="M26 64C24 70 22 76 20 82C19 84 21 85 23 84C25 80 27 74 28 68" />
            <path className="leg leg-bl" d="M30 64C28 70 26 76 24 82C23 84 25 85 27 84C29 80 31 74 32 68" />
            <path className="leg leg-fr" d="M54 64C56 70 58 76 60 82C61 84 59 85 57 84C55 80 53 74 52 68" />
            <path className="leg leg-br" d="M58 64C60 70 62 76 64 82C65 84 63 85 61 84C59 80 57 74 56 68" />
            {/* Tail */}
            <path d="M16 58C10 60 6 64 4 70C3 73 5 74 7 72C10 68 14 63 18 60Z" />
          </g>

          {/* Rider figure */}
          <g fill="url(#pigmentRed)" stroke="#5a1e0e" strokeWidth="1.3" strokeLinejoin="round">
            {/* Torso */}
            <path d="M38 42C36 48 35 52 36 55C40 56 44 55 46 52C47 49 46 45 44 42Z" />
            {/* Head */}
            <ellipse cx="42" cy="38" rx="3.5" ry="4" />
            {/* Headdress/feathers */}
            <path d="M39 34C38 30 39 27 41 26C43 27 44 30 43 33Z" fill="#7a2e12" stroke="none" />
            <path d="M44 34C45 30 47 28 49 28C49 31 47 34 45 35Z" fill="#7a2e12" stroke="none" />
            {/* Front arm holding bow */}
            <path d="M44 45C48 43 52 41 56 40C57 41 56 43 54 44C50 46 46 48 44 48Z" />
            {/* Back arm drawing bowstring */}
            <path d="M36 45C34 47 32 49 30 51C29 52 30 53 32 52C34 50 36 48 38 47Z" />
            {/* Legs on horse */}
            <path d="M37 55C36 58 35 61 34 63C36 64 38 64 40 63C41 60 42 57 42 55Z" />
            <path d="M43 55C44 58 45 61 46 63C48 64 50 64 50 63C49 60 48 57 47 55Z" />
          </g>

          {/* Bow */}
          <g stroke="#4a3a28" strokeWidth="2" fill="none" strokeLinecap="round">
            <path d="M56 38C62 36 66 38 68 42" />
            {/* Bowstring */}
            <path className="bowstring" d="M56 38L56 48L68 42" stroke="#8a7a5a" strokeWidth="0.8" strokeDasharray="2 2" />
          </g>

          {/* Arrow */}
          <g className="rock-art-arrow">
            <line x1="56" y1="43" x2="78" y2="43" stroke="#4a3a28" strokeWidth="1.2" strokeLinecap="round" />
            <path d="M78 43L74 41M78 43L74 45" stroke="#4a3a28" strokeWidth="1.2" strokeLinecap="round" fill="none" />
            <path d="M56 43L52 41L54 43L52 45Z" fill="#4a3a28" stroke="none" />
          </g>
        </g>

        {/* ── Swordsman chasing on foot ── */}
        <g className="rock-art-swordsman">
          {/* Body */}
          <g fill="url(#pigmentChar)" stroke="#0e0a06" strokeWidth="1.3" strokeLinejoin="round">
            {/* Torso */}
            <path d="M95 52C93 58 92 63 93 66C97 67 101 66 103 63C104 59 103 55 101 52Z" />
            {/* Head */}
            <ellipse cx="99" cy="47" rx="3.2" ry="3.8" />
            {/* Horned headdress */}
            <path d="M96 43C94 39 93 36 94 34C96 35 97 38 97 41Z" fill="#1e1812" stroke="none" />
            <path d="M102 43C104 39 105 36 104 34C102 35 101 38 101 41Z" fill="#1e1812" stroke="none" />
            {/* Front arm with sword */}
            <path d="M101 55C105 53 109 51 113 50C114 51 113 53 111 54C107 56 103 58 101 57Z" />
            {/* Back arm */}
            <path d="M93 55C91 57 89 59 87 61C86 62 87 63 89 62C91 60 93 58 95 57Z" />
            {/* Legs - running pose */}
            <path className="leg-s-front" d="M97 66C99 70 101 74 103 78C104 80 102 81 100 80C98 76 96 72 95 68Z" />
            <path className="leg-s-back" d="M93 66C91 70 89 74 87 78C86 80 88 81 90 80C92 76 94 72 95 68Z" />
          </g>

          {/* Sword */}
          <g stroke="#5a4a3a" strokeWidth="1.8" fill="none" strokeLinecap="round">
            <line x1="113" y1="50" x2="135" y2="35" />
            {/* Crossguard */}
            <line x1="110" y1="52" x2="116" y2="48" />
            {/* Pommel */}
            <circle cx="109" cy="53" r="1.5" fill="#5a4a3a" stroke="none" />
            {/* Blade tip */}
            <path d="M135 35L131 36M135 35L133 39" />
          </g>

          {/* Shield on back */}
          <g fill="url(#pigmentChar)" stroke="#0e0a06" strokeWidth="1.2">
            <ellipse cx="90" cy="58" rx="4" ry="5" opacity="0.7" />
          </g>
        </g>

        {/* Impact flash when swordsman leaps */}
        <g className="rock-art-impact">
          <circle cx="0" cy="0" r="0" fill="#e8a838" opacity="0" />
        </g>
      </svg>
    </div>
  );
}
