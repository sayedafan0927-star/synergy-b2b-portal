import { useRef, useEffect } from 'react';

/**
 * AtmosphericFogTransition
 * Volumetric Fog / Smoke Effect (Atmospheric Scroll / Parallax Fog)
 * Directly inspired by luxury editorial UI (Voyage UI Dribbble reference).
 * - Rich, clearly visible, ethereal smoke plumes billowing gently near the bottom rim
 * - Multi-depth volumetric particle system reacting smoothly to scroll velocity
 * - Cinematic lighting with cool pearl (#E2E8F0) and subtle champagne reflections
 * - Continuous organic billow physics + dynamic parallax lift
 * - Zero CPU waste: auto-pauses via IntersectionObserver when off-screen
 */
export default function AtmosphericFogTransition({ 
  className = '',
  intensity = 1.0 
}: { 
  className?: string;
  intensity?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let isVisible = true;
    let width = 0;
    let height = 0;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.scale(dpr, dpr);
    };

    resize();
    window.addEventListener('resize', resize, { passive: true });

    let lastScrollY = window.scrollY;
    let scrollVelocity = 0;
    const onScroll = () => {
      const currentScroll = window.scrollY;
      scrollVelocity = (currentScroll - lastScrollY) * 0.22;
      lastScrollY = currentScroll;
    };
    window.addEventListener('scroll', onScroll, { passive: true });

    interface FogParticle {
      x: number;
      y: number;
      radius: number;
      baseAlpha: number;
      vx: number;
      vy: number;
      phase: number;
      scale: number;
      hue: number;
    }

    const PARTICLE_COUNT = 28;
    const particles: FogParticle[] = [];

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particles.push({
        x: Math.random() * (width || 1200),
        y: (height || 260) * (0.3 + Math.random() * 0.7),
        radius: 130 + Math.random() * 170,
        baseAlpha: (0.16 + Math.random() * 0.18) * intensity, // Rich, clearly visible, cinematic
        vx: (Math.random() - 0.48) * 0.35,
        vy: -0.06 - Math.random() * 0.12,
        phase: Math.random() * Math.PI * 2,
        scale: 0.85 + Math.random() * 0.3,
        hue: i % 3 === 0 ? 215 : 42, // Pearl slate vs ethereal warm mist
      });
    }

    let time = 0;

    const render = () => {
      if (!isVisible) return;

      time += 0.015;
      scrollVelocity *= 0.93;

      ctx.clearRect(0, 0, width, height);

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        // Volumetric undulating motion + scroll velocity reaction
        p.x += p.vx + Math.sin(time * 0.9 + p.phase) * 0.25;
        p.y += p.vy - scrollVelocity * 0.45;

        // Wrap around seamlessly
        if (p.x < -p.radius * 1.5) p.x = width + p.radius * 1.5;
        if (p.x > width + p.radius * 1.5) p.x = -p.radius * 1.5;
        if (p.y < height * 0.05) {
          p.y = height + p.radius * 0.4;
          p.x = Math.random() * width;
        }
        if (p.y > height + p.radius * 0.8) {
          p.y = height * 0.4;
        }

        const currentAlpha = p.baseAlpha * (0.8 + Math.sin(time * 0.8 + p.phase) * 0.2);
        const rad = p.radius * p.scale;
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad);

        if (p.hue === 215) {
          // Luminous Pearl / Platinum smoke billow
          grad.addColorStop(0, `rgba(235, 244, 255, ${currentAlpha})`);
          grad.addColorStop(0.35, `rgba(210, 230, 252, ${currentAlpha * 0.65})`);
          grad.addColorStop(0.7, `rgba(180, 210, 245, ${currentAlpha * 0.25})`);
          grad.addColorStop(1, 'rgba(180, 210, 245, 0)');
        } else {
          // Warm champagne ethereal atmospheric wisp
          grad.addColorStop(0, `rgba(255, 250, 240, ${currentAlpha * 0.95})`);
          grad.addColorStop(0.4, `rgba(248, 238, 222, ${currentAlpha * 0.6})`);
          grad.addColorStop(0.75, `rgba(238, 225, 205, ${currentAlpha * 0.22})`);
          grad.addColorStop(1, 'rgba(238, 225, 205, 0)');
        }

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
        ctx.fill();
      }

      animId = requestAnimationFrame(render);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            if (!isVisible) {
              isVisible = true;
              animId = requestAnimationFrame(render);
            }
          } else {
            isVisible = false;
            cancelAnimationFrame(animId);
          }
        });
      },
      { threshold: 0.05 }
    );
    observer.observe(container);

    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
      observer.disconnect();
      window.removeEventListener('resize', resize);
      window.removeEventListener('scroll', onScroll);
    };
  }, [intensity]);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className={`relative w-full overflow-hidden pointer-events-none select-none ${className}`}
    >
      {/* ── Layer 1: Volumetric Canvas Smoke Particles (Parallax Motion) ── */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full block transform-gpu pointer-events-none mix-blend-screen"
      />

      {/* ── Layer 2: Ethereal Billowing Smoke Glow Contour ── */}
      <div 
        className="absolute inset-x-0 bottom-0 h-36 sm:h-52 pointer-events-none mix-blend-screen"
        style={{
          background: 'radial-gradient(ellipse 95% 85% at 50% 100%, rgba(225, 240, 255, 0.42) 0%, rgba(250, 245, 235, 0.28) 45%, transparent 85%)',
          filter: 'blur(28px)',
        }}
      />

      {/* ── Layer 3: Dynamic Low-Lying Atmospheric Mist Wave ── */}
      <div 
        className="absolute inset-x-0 bottom-0 h-20 sm:h-32 pointer-events-none"
        style={{
          background: 'linear-gradient(to top, rgba(255, 255, 255, 0.5) 0%, rgba(230, 240, 255, 0.2) 60%, transparent 100%)',
          maskImage: 'radial-gradient(ellipse 95% 100% at 50% 100%, black 50%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(ellipse 95% 100% at 50% 100%, black 50%, transparent 100%)',
        }}
      />
    </div>
  );
}
