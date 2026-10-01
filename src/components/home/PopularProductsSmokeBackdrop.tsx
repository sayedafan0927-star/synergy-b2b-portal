import { useRef, useEffect } from 'react';

/**
 * PopularProductsSmokeBackdrop
 * Authentic Volumetric Smoke & Blue-Slate Mist ("Клубы сизого тумана")
 * Directly based on the user's reference image and Voyage UI design:
 * - Billowing, clearly visible plumes of slate-blue and pearl-grey smoke drifting in the background and between cards.
 * - Reactive to user scroll with atmospheric vertical and horizontal parallax.
 * - Natural swirling fluid dispersion with soft multi-gradient falloff.
 * - Zero interaction blocking (strictly pointer-events-none).
 * - Pauses automatically when out of viewport.
 */
export default function PopularProductsSmokeBackdrop({ className = '' }: { className?: string }) {
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
      const current = window.scrollY;
      scrollVelocity = (current - lastScrollY) * 0.25;
      lastScrollY = current;
    };
    window.addEventListener('scroll', onScroll, { passive: true });

    // Procedural volumetric smoke particles
    interface SmokePuff {
      x: number;
      y: number;
      radius: number;
      baseAlpha: number;
      vx: number;
      vy: number;
      phase: number;
      scale: number;
      hue: 'slate' | 'pearl' | 'deep';
    }

    const PUFF_COUNT = 32;
    const puffs: SmokePuff[] = [];

    for (let i = 0; i < PUFF_COUNT; i++) {
      const type = i % 3 === 0 ? 'slate' : i % 3 === 1 ? 'pearl' : 'deep';
      puffs.push({
        x: Math.random() * (width || 1200),
        y: Math.random() * (height || 600),
        radius: 120 + Math.random() * 180,
        baseAlpha: type === 'deep' ? 0.18 + Math.random() * 0.14 : 0.22 + Math.random() * 0.18,
        vx: (Math.random() - 0.46) * 0.42,
        vy: -0.08 - Math.random() * 0.15,
        phase: Math.random() * Math.PI * 2,
        scale: 0.85 + Math.random() * 0.35,
        hue: type,
      });
    }

    let time = 0;

    const render = () => {
      if (!isVisible) return;

      time += 0.014;
      scrollVelocity *= 0.92;

      ctx.clearRect(0, 0, width, height);

      for (let i = 0; i < puffs.length; i++) {
        const p = puffs[i];

        // Atmospheric drifting physics with subtle swirling vortices
        p.x += p.vx + Math.sin(time * 0.8 + p.phase) * 0.35;
        p.y += p.vy - scrollVelocity * 0.55;

        // Wrap around seamlessly
        if (p.x < -p.radius * 1.5) p.x = width + p.radius * 1.5;
        if (p.x > width + p.radius * 1.5) p.x = -p.radius * 1.5;
        if (p.y < -p.radius) {
          p.y = height + p.radius * 0.8;
          p.x = Math.random() * width;
        }
        if (p.y > height + p.radius) {
          p.y = -p.radius * 0.5;
        }

        const currentAlpha = p.baseAlpha * (0.8 + Math.sin(time + p.phase) * 0.2);
        const rad = p.radius * p.scale;
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad);

        if (p.hue === 'slate') {
          // Сизый туман (Slate-Blue Mist)
          grad.addColorStop(0, `rgba(182, 202, 224, ${currentAlpha * 0.85})`);
          grad.addColorStop(0.35, `rgba(165, 188, 214, ${currentAlpha * 0.55})`);
          grad.addColorStop(0.7, `rgba(150, 175, 202, ${currentAlpha * 0.18})`);
          grad.addColorStop(1, 'rgba(150, 175, 202, 0)');
        } else if (p.hue === 'pearl') {
          // Жемчужно-серебристый дым (Pearl Silver Smoke)
          grad.addColorStop(0, `rgba(240, 246, 252, ${currentAlpha * 0.9})`);
          grad.addColorStop(0.4, `rgba(222, 232, 244, ${currentAlpha * 0.5})`);
          grad.addColorStop(0.75, `rgba(205, 218, 232, ${currentAlpha * 0.15})`);
          grad.addColorStop(1, 'rgba(205, 218, 232, 0)');
        } else {
          // Глубокий объемный шлейф (Deep Atmosphere)
          grad.addColorStop(0, `rgba(160, 180, 204, ${currentAlpha * 0.65})`);
          grad.addColorStop(0.5, `rgba(145, 168, 192, ${currentAlpha * 0.35})`);
          grad.addColorStop(1, 'rgba(145, 168, 192, 0)');
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
  }, []);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className={`absolute inset-0 overflow-hidden pointer-events-none select-none ${className}`}
    >
      {/* ── Background Dynamic Canvas Smoke Plumes ── */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full block transform-gpu pointer-events-none opacity-85"
      />

      {/* ── Ambient Soft Slate Cloud Filter ── */}
      <div 
        className="absolute inset-x-0 top-1/4 bottom-0 pointer-events-none opacity-45 mix-blend-multiply"
        style={{
          background: 'radial-gradient(ellipse 90% 75% at 50% 55%, rgba(188, 208, 228, 0.35) 0%, rgba(205, 222, 238, 0.18) 50%, transparent 85%)',
          filter: 'blur(36px)',
        }}
      />
    </div>
  );
}
