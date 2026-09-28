export default function RockArtChase() {
  return (
    <div className="rock-art-chase" aria-label="Анимация наскальных рисунков" role="img">
      <svg viewBox="0 0 320 72" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path className="rock-art-ground" d="M4 59C44 57 73 61 108 59C146 57 181 61 217 59C255 57 284 61 316 58" />
        <g className="rock-art-rider">
          <path className="rock-art-line" d="M20 51C28 44 34 44 42 48C47 51 54 50 60 48L65 52C56 56 47 56 39 53C33 51 27 54 22 57" />
          <path className="rock-art-line" d="M28 49L25 59M42 51L43 60M55 50L59 58M61 48L67 55" />
          <path className="rock-art-line" d="M21 48C16 44 16 39 21 36C25 34 31 36 34 40" />
          <circle className="rock-art-fill" cx="42" cy="30" r="4" />
          <path className="rock-art-line" d="M42 34L39 42L45 47M40 37L34 40M40 37L47 39" />
          <path className="rock-art-ray" d="M48 34L65 25M50 36L68 36M49 38L65 47" />
          <path className="rock-art-line" d="M66 25L70 22M66 36L72 36M65 47L69 50" />
        </g>
        <g className="rock-art-swordsman">
          <path className="rock-art-line" d="M95 52C101 47 106 47 111 50C116 53 122 52 127 49C132 47 136 49 140 53" />
          <path className="rock-art-line" d="M102 50L100 59M113 51L115 60M127 49L130 58M137 51L143 58" />
          <circle className="rock-art-fill" cx="114" cy="36" r="3.5" />
          <path className="rock-art-line" d="M114 40L111 47L118 50M112 42L106 45M113 42L120 43" />
          <path className="rock-art-sword" d="M119 42L135 28M131 30L138 27M133 34L138 37" />
        </g>
        <g className="rock-art-markings">
          <path className="rock-art-line faint" d="M176 29C183 24 190 24 196 29C190 34 183 34 176 29ZM181 29H191" />
          <path className="rock-art-line faint" d="M229 45C236 39 242 39 249 45M239 39V51" />
          <circle className="rock-art-dot" cx="270" cy="28" r="1.7" />
          <circle className="rock-art-dot" cx="279" cy="25" r="1.2" />
          <circle className="rock-art-dot" cx="287" cy="29" r="1.5" />
        </g>
      </svg>
    </div>
  );
}
