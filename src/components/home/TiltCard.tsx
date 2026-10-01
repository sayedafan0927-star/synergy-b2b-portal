import { useState, useRef, type ReactNode, type MouseEvent } from 'react';

interface TiltCardProps {
  children: ReactNode;
  maxTilt?: number; // max tilt angle in degrees (default 15)
  perspective?: number; // 3D perspective in px (default 1000)
  scale?: number; // scale on hover (default 1.035)
  glare?: boolean; // dynamic specular sheen glare
  className?: string;
}

/**
 * TiltCard
 * High-precision 3D physical depth tilt effect (Tilt.js / Apple TV parity).
 * - Real-time zero-latency angular deflection mapped to cursor position.
 * - Dynamic 3D directional cast shadow moving opposite to tilt angle.
 * - Physical specular highlight sheen tracking cursor coordinates.
 * - Gentle spring dampening on cursor leave.
 * - Touch-safe: passive on touch devices to preserve fluid native scrolling.
 */
export default function TiltCard({
  children,
  maxTilt = 15,
  perspective = 1000,
  scale = 1.035,
  glare = true,
  className = '',
}: TiltCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState<{ x: number; y: number; glareX: number; glareY: number; opacity: number }>({
    x: 0,
    y: 0,
    glareX: 50,
    glareY: 50,
    opacity: 0,
  });
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    const el = cardRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Normalized coordinates (-0.5 to 0.5)
    const normX = mouseX / rect.width - 0.5;
    const normY = mouseY / rect.height - 0.5;

    // Calculate 3D rotation angles
    const rotateY = Number((normX * maxTilt).toFixed(2));
    const rotateX = Number((-normY * maxTilt).toFixed(2));

    setTilt({
      x: rotateX,
      y: rotateY,
      glareX: Math.round((mouseX / rect.width) * 100),
      glareY: Math.round((mouseY / rect.height) * 100),
      opacity: 0.38,
    });
    if (!isHovered) setIsHovered(true);
  };

  const handleMouseEnter = () => {
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    setTilt({
      x: 0,
      y: 0,
      glareX: 50,
      glareY: 50,
      opacity: 0,
    });
  };

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`relative transform-gpu ${className}`}
      style={{
        perspective: `${perspective}px`,
        transformStyle: 'preserve-3d',
      }}
    >
      <div
        className="w-full h-full rounded-2xl will-change-transform"
        style={{
          transform: isHovered
            ? `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg) scale3d(${scale}, ${scale}, ${scale}) translateZ(14px)`
            : 'rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1) translateZ(0px)',
          boxShadow: isHovered
            ? `${-tilt.y * 1.8}px ${tilt.x * 1.8 + 14}px 34px -4px rgba(0, 0, 0, 0.22)`
            : '0 4px 14px rgba(0, 0, 0, 0.06)',
          transitionProperty: 'transform, box-shadow',
          transitionDuration: isHovered ? '0ms' : '450ms',
          transitionTimingFunction: isHovered ? 'linear' : 'cubic-bezier(0.16, 1, 0.3, 1)',
          transformStyle: 'preserve-3d',
        }}
      >
        {children}

        {/* Dynamic Specular Sheen Glare */}
        {glare && (
          <div
            aria-hidden="true"
            className="absolute inset-0 rounded-2xl pointer-events-none transition-opacity duration-200 overflow-hidden z-30"
            style={{
              opacity: tilt.opacity,
              background: `radial-gradient(circle 360px at ${tilt.glareX}% ${tilt.glareY}%, rgba(255, 255, 255, 0.6) 0%, rgba(255, 255, 255, 0.15) 45%, transparent 80%)`,
              mixBlendMode: 'overlay',
            }}
          />
        )}
      </div>
    </div>
  );
}
