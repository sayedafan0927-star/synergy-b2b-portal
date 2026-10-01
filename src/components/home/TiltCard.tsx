import { useState, useRef, type ReactNode, type PointerEvent } from 'react';

interface TiltCardProps {
  children: ReactNode;
  maxTilt?: number; // max tilt in degrees (default 10)
  perspective?: number; // perspective in px (default 1000)
  scale?: number; // scale on hover (default 1.02)
  glare?: boolean; // whether to show specular light glare
  className?: string;
}

/**
 * TiltCard
 * High-performance 3D Tilt physical depth effect (inspired by Tilt.js / Apple TV UI).
 * - Reacts dynamically to mouse coordinates with physical angular rotation.
 * - Hardware-accelerated GPU transforms with preserve-3d context.
 * - Specular dynamic light sheen reflecting across the surface.
 * - Graceful spring return on pointer leave.
 * - Passive on touch to maintain fluid native scrolling.
 */
export default function TiltCard({
  children,
  maxTilt = 10,
  perspective = 1000,
  scale = 1.02,
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

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    // Only apply 3D tilt on mouse pointers (not touch/pen) to preserve frictionless scrolling
    if (e.pointerType === 'touch') return;

    const el = cardRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Normalized coordinates (-0.5 to 0.5)
    const normX = mouseX / rect.width - 0.5;
    const normY = mouseY / rect.height - 0.5;

    // Target rotation angles (deg)
    const rotateY = normX * maxTilt;
    const rotateX = -normY * maxTilt;

    setTilt({
      x: rotateX,
      y: rotateY,
      glareX: (mouseX / rect.width) * 100,
      glareY: (mouseY / rect.height) * 100,
      opacity: 0.28,
    });
  };

  const handlePointerEnter = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return;
    setIsHovered(true);
  };

  const handlePointerLeave = () => {
    setIsHovered(false);
    setTilt(prev => ({
      ...prev,
      x: 0,
      y: 0,
      opacity: 0,
    }));
  };

  return (
    <div
      ref={cardRef}
      onPointerMove={handlePointerMove}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      className={`relative transform-gpu will-change-transform ${className}`}
      style={{
        perspective: `${perspective}px`,
        transformStyle: 'preserve-3d',
      }}
    >
      <div
        className="w-full h-full transition-transform ease-out will-change-transform rounded-2xl"
        style={{
          transform: isHovered
            ? `rotateX(${tilt.x.toFixed(2)}deg) rotateY(${tilt.y.toFixed(2)}deg) scale3d(${scale}, ${scale}, ${scale})`
            : 'rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)',
          transitionDuration: isHovered ? '90ms' : '500ms',
          transitionTimingFunction: isHovered ? 'linear' : 'cubic-bezier(0.16, 1, 0.3, 1)',
          transformStyle: 'preserve-3d',
        }}
      >
        {children}

        {/* Dynamic Specular Sheen Glare */}
        {glare && (
          <div
            aria-hidden="true"
            className="absolute inset-0 rounded-2xl pointer-events-none transition-opacity duration-300 overflow-hidden z-30"
            style={{
              opacity: tilt.opacity,
              background: `radial-gradient(circle 320px at ${tilt.glareX}% ${tilt.glareY}%, rgba(255, 255, 255, 0.45) 0%, rgba(255, 255, 255, 0.1) 40%, transparent 80%)`,
              mixBlendMode: 'overlay',
            }}
          />
        )}
      </div>
    </div>
  );
}
