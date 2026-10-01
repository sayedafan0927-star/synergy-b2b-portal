import { useState, useRef, useEffect, type ReactNode, type MouseEvent } from 'react';

interface TiltCardProps {
  children: ReactNode;
  maxTilt?: number; // max tilt angle in degrees (default 12)
  perspective?: number; // 3D perspective in px (default 1000)
  scale?: number; // scale on hover (default 1 = pure tilt without zoom)
  glare?: boolean; // dynamic specular sheen glare
  autoTiltMobile?: boolean; // autonomous 3D tilt oscillation on mobile
  cardIndex?: number; // card index for staggered natural motion (default 0)
  className?: string;
}

/**
 * TiltCard
 * High-performance 3D physical tilt depth effect:
 * - Pure 3D angular deflection strictly WITHOUT size zooming/scaling.
 * - Desktop: Instant zero-latency mouse cursor tracking with directional cast shadow.
 * - Mobile: Autonomous, hypnotic 3D floating pendulum tilt loop (cards gently tilt by themselves).
 * - Specular highlight sheen gliding across the card surface in sync with tilt.
 * - Hardware-accelerated GPU transforms with preserve-3d context.
 */
export default function TiltCard({
  children,
  maxTilt = 12,
  perspective = 1000,
  scale = 1,
  glare = true,
  autoTiltMobile = true,
  cardIndex = 0,
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
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 640 || 'ontouchstart' in window);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile, { passive: true });
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (isMobile) return;

    const el = cardRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const normX = mouseX / rect.width - 0.5;
    const normY = mouseY / rect.height - 0.5;

    const rotateY = Number((normX * maxTilt).toFixed(2));
    const rotateX = Number((-normY * maxTilt).toFixed(2));

    setTilt({
      x: rotateX,
      y: rotateY,
      glareX: Math.round((mouseX / rect.width) * 100),
      glareY: Math.round((mouseY / rect.height) * 100),
      opacity: 0.35,
    });
    if (!isHovered) setIsHovered(true);
  };

  const handleMouseEnter = () => {
    if (!isMobile) setIsHovered(true);
  };

  const handleMouseLeave = () => {
    if (!isMobile) {
      setIsHovered(false);
      setTilt({
        x: 0,
        y: 0,
        glareX: 50,
        glareY: 50,
        opacity: 0,
      });
    }
  };

  // Staggered autonomous mobile animation parameters
  const animDuration = 4.2 + (cardIndex % 3) * 0.7; // 4.2s, 4.9s, 5.6s
  const animDelay = (cardIndex * 0.8) % 3.0; // staggered phase start

  const transformStyle = isMobile && autoTiltMobile
    ? undefined // Handled by inline keyframes animation on mobile
    : isHovered
    ? `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)${scale !== 1 ? ` scale3d(${scale}, ${scale}, ${scale})` : ''}`
    : 'rotateX(0deg) rotateY(0deg)';

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
          transform: transformStyle,
          boxShadow: !isMobile && isHovered
            ? `${-tilt.y * 1.5}px ${tilt.x * 1.5 + 8}px 24px -4px rgba(0, 0, 0, 0.16)`
            : '0 4px 14px rgba(0, 0, 0, 0.06)',
          transitionProperty: 'transform, box-shadow',
          transitionDuration: isHovered ? '0ms' : '400ms',
          transitionTimingFunction: isHovered ? 'linear' : 'cubic-bezier(0.16, 1, 0.3, 1)',
          transformStyle: 'preserve-3d',
          ...(isMobile && autoTiltMobile
            ? {
                animation: `mobileTiltOscillate ${animDuration}s ease-in-out ${animDelay}s infinite alternate`,
              }
            : {}),
        }}
      >
        {children}

        {/* Dynamic Specular Sheen Glare (Desktop Hover or Mobile Idle Sheen) */}
        {glare && (
          <div
            aria-hidden="true"
            className="absolute inset-0 rounded-2xl pointer-events-none transition-opacity duration-200 overflow-hidden z-30"
            style={{
              opacity: isMobile ? 0.25 : tilt.opacity,
              background: isMobile
                ? 'radial-gradient(circle 240px at 50% 30%, rgba(255, 255, 255, 0.45) 0%, rgba(255, 255, 255, 0.1) 40%, transparent 75%)'
                : `radial-gradient(circle 320px at ${tilt.glareX}% ${tilt.glareY}%, rgba(255, 255, 255, 0.6) 0%, rgba(255, 255, 255, 0.15) 45%, transparent 80%)`,
              mixBlendMode: 'overlay',
            }}
          />
        )}
      </div>
    </div>
  );
}
