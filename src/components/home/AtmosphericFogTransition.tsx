import { useRef, useEffect } from 'react';

/**
 * AtmosphericFogTransition
 * Volumetric Fog / Smoke Effect (Atmospheric Scroll / Parallax Fog)
 * Inspired by high-end luxury editorial interfaces (e.g. Voyage UI).
 * - Gentle, ethereal, low-opacity smoke wisps billowing near the bottom rim
 * - Reacts to user scroll velocity and scroll position with subtle vertical parallax
 * - Procedural particle mist with soft blur & organic alpha falloff
 * - Strictly non-intrusive (subtle, atmospheric, doesn't obscure content)
 * - Automatically pauses when out of viewport for peak performance & battery life
 */
export default function AtmosphericFogTransition({ className = '' }: { className?: string }) {
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

    // Handle high-DPI crispness while keeping performance light
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

    // Track scroll for atmospheric parallax drift
    let lastScrollY = window.scrollY;
    let scrollVelocity = 0;
    const onScroll = () => {
      const currentScroll = window.scrollY;
      scrollVelocity = (currentScroll - lastScrollY) * 0.15;
      lastScrollY = currentScroll;
    };
    window.addEventListener('scroll', onScroll, { passive: true });

    // Procedural fog particles
    interface FogParticle {
      x: number;
      y: number;
      radius: number;
      baseAlpha: number;
      vx: number;
      vy: number;
      phase: number;
      hue: number;
    }

    const PARTICLE_COUNT = 18;
    const particles: FogParticle[] = [];

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particles.push({
        x: Math.random() * (width || 1200),
        y: (height || 240) * (0.35 + Math.random() * 0.65),
        radius: 90 + Math.random() * 140,
        baseAlpha: 0.035 + Math.random() * 0.055, // Delicate, barely noticeable mist
        vx: (Math.random() - 0.45) * 0.28,
        vy: -0.05 - Math.random() * 0.08,
        phase: Math.random() * Math.PI * 2,
        hue: Math.random() > 0.6 ? 210 : 40, // Cool steel vs gentle warm champagne reflection
      });
    }

    let time = 0;

    const render = () => {
      if (!isVisible) return;

      time += 0.012;
      // Decay scroll velocity smoothly
      scrollVelocity *= 0.92;

      ctx.clearRect(0, 0, width, height);

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        // Organic undulating motion + scroll reaction
        p.x += p.vx + Math.sin(time + p.phase) * 0.18;
        p.y += p.vy - scrollVelocity * 0.35;

        // Wrap around seamlessly
        if (p.x < -p.radius * 2) p.x = width + p.radius;
        if (p.x > width + p.radius * 2) p.x = -p.radius;
        if (p.y < height * 0.1) {
          p.y = height + p.radius * 0.5;
          p.x = Math.random() * width;
        }
        if (p.y > height + p.radius) {
          p.y = height * 0.3;
        }

        // Draw soft radial puff
        const currentAlpha = p.baseAlpha * (0.85 + Math.sin(time * 0.7 + p.phase) * 0.15);
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius);

        if (p.hue === 210) {
          // Cool airy mist
          grad.addColorStop(0, `rgba(215, 230, 245, ${currentAlpha})`);
          grad.addColorStop(0.5, `rgba(200, 218, 238, ${currentAlpha * 0.45})`);
          grad.addColorStop(1, 'rgba(200, 218, 238, 0)');
        } else {
          // Warm ethereal champagne mist
          grad.addColorStop(0, `rgba(245, 240, 228, ${currentAlpha * 0.9})`);
          grad.addColorStop(0.5, `rgba(235, 228, 212, ${currentAlpha * 0.4})`);
          grad.addColorStop(1, 'rgba(235, 228, 212, 0)');
        }

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
      }

      animId = requestAnimationFrame(render);
    };

    // Pause canvas physics when scrolled away
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
  }, []);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className={`relative w-full overflow-hidden pointer-events-none select-none ${className}`}
    >
      {/* ── Layer 1: Atmospheric Canvas Particles (Scroll & Drift Physics) ── */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full block transform-gpu pointer-events-none"
      />

      {/* ── Layer 2: Ethereal Ambient Fog Ribbons (Soft Glowing Wisps) ── */}
      <div 
        className="absolute inset-x-0 bottom-0 h-32 sm:h-44 pointer-events-none opacity-40 mix-blend-screen"
        style={{
          background: 'radial-gradient(ellipse 85% 70% at 50% 100%, rgba(220, 235, 255, 0.22) 0%, rgba(245, 240, 230, 0.12) 40%, transparent 80%)',
          filter: 'blur(20px)',
        }}
      />

      {/* ── Layer 3: Ultra-subtle Ground Smoke Contour ── */}
      <div 
        className="absolute inset-x-0 bottom-0 h-16 sm:h-24 pointer-events-none opacity-30"
        style={{
          background: 'linear-gradient(to top, rgba(255, 255, 255, 0.35) 0%, transparent 100%)',
          maskImage: 'radial-gradient(ellipse 90% 100% at 50% 100%, black 30%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(ellipse 90% 100% at 50% 100%, black 30%, transparent 100%)',
        }}
      />
    </div>
  );
}
