import { useEffect, useRef, useState, useCallback } from 'react';
import { RotateCw, Sparkles } from 'lucide-react';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  alpha: number;
  color: string;
  angle: number;
  dist: number;
  targetX?: number;
  targetY?: number;
  speed: number;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

export default function PetroglyphVortexCanvas({
  className = '',
}: {
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number>(0);
  const [phase, setPhase] = useState<'vortex' | 'forming' | 'carved' | 'carpet'>('vortex');
  const [progress, setProgress] = useState<number>(0);

  // Images for canvas rendering
  const imagesRef = useRef<{
    sunDeity: HTMLImageElement | null;
    horseArcher: HTMLImageElement | null;
    deer: HTMLImageElement | null;
    carpetOrnament: HTMLImageElement | null;
  }>({
    sunDeity: null,
    horseArcher: null,
    deer: null,
    carpetOrnament: null,
  });

  // State refs for animation loop
  const stateRef = useRef({
    startTime: Date.now(),
    particles: [] as Particle[],
    sparks: [] as Spark[],
    mouse: { x: -1000, y: -1000, active: false },
    phaseProgress: 0,
    width: 600,
    height: 480,
  });

  // Preload ethnic assets
  useEffect(() => {
    const sun = new Image();
    sun.src = '/ethnic/sun_deity_gold.png';
    sun.onload = () => (imagesRef.current.sunDeity = sun);

    const archer = new Image();
    archer.src = '/ethnic/horse_archer_gold.png';
    archer.onload = () => (imagesRef.current.horseArcher = archer);

    const deer = new Image();
    deer.src = '/ethnic/deer_scythian_gold.png';
    deer.onload = () => (imagesRef.current.deer = deer);

    const ornament = new Image();
    ornament.src = '/ethnic/diamond_ornament_1_gold.png';
    ornament.onload = () => (imagesRef.current.carpetOrnament = ornament);
  }, []);

  const initParticles = useCallback((w: number, h: number) => {
    const count = 180;
    const particles: Particle[] = [];
    const colors = [
      '#f5c54c', // Gold
      '#f2b324', // Rich amber
      '#e39a0b', // Deep gold
      '#ffffff', // Spark white
      '#d9ecec', // Subtle teal mineral
      '#c97607', // Bronze
    ];

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 30 + Math.random() * (Math.min(w, h) * 0.45);
      particles.push({
        x: w / 2 + Math.cos(angle) * dist,
        y: h / 2 + Math.sin(angle) * dist,
        vx: 0,
        vy: 0,
        radius: 1.2 + Math.random() * 2.2,
        alpha: 0.3 + Math.random() * 0.7,
        color: colors[Math.floor(Math.random() * colors.length)],
        angle,
        dist,
        speed: (0.015 + Math.random() * 0.025) * (Math.random() > 0.5 ? 1 : 1),
      });
    }
    stateRef.current.particles = particles;
  }, []);

  const restartVortex = useCallback(() => {
    stateRef.current.startTime = Date.now();
    stateRef.current.sparks = [];
    const w = stateRef.current.width;
    const h = stateRef.current.height;
    initParticles(w, h);
    setPhase('vortex');
    setProgress(0);
  }, [initParticles]);

  const addSparks = (x: number, y: number, count = 15) => {
    const colors = ['#fff', '#fcd34d', '#f59e0b', '#fbbf24'];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 4.5;
      stateRef.current.sparks.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 0.5,
        life: 0,
        maxLife: 20 + Math.random() * 30,
        size: 1 + Math.random() * 2.5,
        color: colors[Math.floor(Math.random() * colors.length)],
      });
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const handleResize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      stateRef.current.width = rect.width;
      stateRef.current.height = rect.height;
      initParticles(rect.width, rect.height);
    };

    handleResize();
    window.addEventListener('resize', handleResize);

    // Animation Loop
    let lastSparkTime = 0;

    const render = () => {
      const now = Date.now();
      const elapsed = (now - stateRef.current.startTime) / 1000;
      const w = stateRef.current.width;
      const h = stateRef.current.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);

      // Determine current timeline phase
      // 0 - 3s: intense vortex swirling
      // 3 - 6s: particles assemble and form petroglyphs on stone
      // 6 - 9s: stone carving glow and sparks
      // 9s+: petroglyphs weave into Kazakh carpet medallion
      let currentPhase: 'vortex' | 'forming' | 'carved' | 'carpet' = 'vortex';
      let phaseRatio = 0;

      if (elapsed < 3.0) {
        currentPhase = 'vortex';
        phaseRatio = elapsed / 3.0;
      } else if (elapsed < 6.0) {
        currentPhase = 'forming';
        phaseRatio = (elapsed - 3.0) / 3.0;
      } else if (elapsed < 9.0) {
        currentPhase = 'carved';
        phaseRatio = (elapsed - 6.0) / 3.0;
      } else {
        currentPhase = 'carpet';
        phaseRatio = Math.min(1, (elapsed - 9.0) / 2.5);
      }

      setPhase(currentPhase);
      setProgress(Math.min(100, Math.round((elapsed / 11) * 100)));

      const centerX = w / 2;
      const centerY = h / 2;

      // ── 1. Draw Ancient Stone Slab Surface ──
      const stoneGrad = ctx.createRadialGradient(centerX, centerY, 50, centerX, centerY, Math.max(w, h) * 0.6);
      stoneGrad.addColorStop(0, 'rgba(28, 38, 43, 0.7)');
      stoneGrad.addColorStop(0.6, 'rgba(18, 26, 30, 0.85)');
      stoneGrad.addColorStop(1, 'rgba(10, 16, 20, 0.95)');
      ctx.fillStyle = stoneGrad;

      // Rounded rock slab path
      const rx = 16, ry = 16, rw = w - 32, rh = h - 32, radius = 24;
      ctx.beginPath();
      ctx.moveTo(rx + radius, ry);
      ctx.lineTo(rx + rw - radius, ry);
      ctx.quadraticCurveTo(rx + rw, ry, rx + rw, ry + radius);
      ctx.lineTo(rx + rw, ry + rh - radius);
      ctx.quadraticCurveTo(rx + rw, ry + rh, rx + rw - radius, ry + rh);
      ctx.lineTo(rx + radius, ry + rh);
      ctx.quadraticCurveTo(rx, ry + rh, rx, ry + rh - radius);
      ctx.lineTo(rx, ry + radius);
      ctx.quadraticCurveTo(rx, ry, rx + radius, ry);
      ctx.closePath();
      ctx.fill();

      // Stone border with chiselled rock texture
      ctx.strokeStyle = 'rgba(217, 180, 110, 0.2)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Subtle rock relief fissures / cracks
      ctx.save();
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.lineWidth = 1;
      ctx.moveTo(centerX - 180, centerY - 120);
      ctx.lineTo(centerX - 110, centerY - 40);
      ctx.lineTo(centerX - 130, centerY + 80);
      ctx.moveTo(centerX + 140, centerY - 100);
      ctx.lineTo(centerX + 90, centerY + 30);
      ctx.lineTo(centerX + 160, centerY + 110);
      ctx.stroke();
      ctx.restore();

      // ── 2. Petroglyphs on the Stone Face (Emerging from vortex) ──
      const petroglyphOpacity = currentPhase === 'vortex'
        ? Math.max(0, (phaseRatio - 0.5) * 0.4)
        : currentPhase === 'forming'
        ? 0.2 + phaseRatio * 0.7
        : 0.95;

      if (petroglyphOpacity > 0.05) {
        ctx.save();
        ctx.globalAlpha = petroglyphOpacity;

        // Subtle glow aura behind rock carvings
        const auraGrad = ctx.createRadialGradient(centerX, centerY - 20, 20, centerX, centerY - 20, 160);
        auraGrad.addColorStop(0, 'rgba(242, 179, 36, 0.18)');
        auraGrad.addColorStop(0.7, 'rgba(242, 179, 36, 0.05)');
        auraGrad.addColorStop(1, 'rgba(242, 179, 36, 0)');
        ctx.fillStyle = auraGrad;
        ctx.fillRect(0, 0, w, h);

        // Center: Sun-headed deity (Тамгалы)
        const deityImg = imagesRef.current.sunDeity;
        if (deityImg) {
          const dW = 120;
          const dH = 175;
          const dX = centerX - dW / 2;
          const dY = centerY - dH / 2 - 20;

          // Glowing drop shadow for chiseled look
          ctx.shadowColor = '#f5c54c';
          ctx.shadowBlur = currentPhase === 'carved' ? 14 : 8;
          ctx.drawImage(deityImg, dX, dY, dW, dH);
          ctx.shadowBlur = 0;
        }

        // Left: Leaping Scythian Deer
        const deerImg = imagesRef.current.deer;
        if (deerImg) {
          const deerW = 135;
          const deerH = 95;
          const deerX = centerX - 195;
          const deerY = centerY + 25;
          ctx.shadowColor = '#f2b324';
          ctx.shadowBlur = 6;
          ctx.drawImage(deerImg, deerX, deerY, deerW, deerH);
          ctx.shadowBlur = 0;
        }

        // Right: Galloping Horse Archer
        const archerImg = imagesRef.current.horseArcher;
        if (archerImg) {
          const aW = 145;
          const aH = 115;
          const aX = centerX + 60;
          const aY = centerY + 15;
          ctx.shadowColor = '#f2b324';
          ctx.shadowBlur = 6;
          ctx.drawImage(archerImg, aX, aY, aW, aH);
          ctx.shadowBlur = 0;
        }

        ctx.restore();
      }

      // ── 3. Weaving into Carpet Masterpiece (Phase 4) ──
      if (currentPhase === 'carpet' || (currentPhase === 'carved' && phaseRatio > 0.6)) {
        const carpetRatio = currentPhase === 'carpet' ? phaseRatio : (phaseRatio - 0.6) / 0.4;
        const ornamentImg = imagesRef.current.carpetOrnament;

        if (ornamentImg && carpetRatio > 0) {
          ctx.save();
          ctx.globalAlpha = carpetRatio * 0.85;

          // Intricate woven halo behind carpet medallion
          const ornSize = 130 + carpetRatio * 15;
          const ornX = centerX - ornSize / 2;
          const ornY = centerY - ornSize / 2 - 20;

          // Golden woven threads radiating outward
          ctx.strokeStyle = `rgba(245, 197, 76, ${carpetRatio * 0.4})`;
          ctx.lineWidth = 1;
          for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
            const r1 = 80;
            const r2 = 130 + Math.sin(now * 0.003 + a * 2) * 10;
            ctx.beginPath();
            ctx.moveTo(centerX + Math.cos(a) * r1, centerY - 20 + Math.sin(a) * r1);
            ctx.lineTo(centerX + Math.cos(a) * r2, centerY - 20 + Math.sin(a) * r2);
            ctx.stroke();
          }

          ctx.shadowColor = '#f5c54c';
          ctx.shadowBlur = 18;
          ctx.drawImage(ornamentImg, ornX, ornY, ornSize, ornSize);
          ctx.restore();
        }
      }

      // ── 4. Dynamic Particle Vortex ──
      const vortexSpeed = currentPhase === 'vortex' ? 1.8 : currentPhase === 'forming' ? 1.0 : 0.4;
      const mouse = stateRef.current.mouse;

      stateRef.current.particles.forEach((p) => {
        // Orbit dynamics
        p.angle += p.speed * vortexSpeed;

        let targetDist = p.dist;
        if (currentPhase === 'forming') {
          // Pull into center contours
          targetDist = p.dist * (1 - phaseRatio * 0.5);
        } else if (currentPhase === 'carved') {
          targetDist = p.dist * 0.6 + Math.sin(now * 0.003 + p.angle * 3) * 15;
        }

        let px = centerX + Math.cos(p.angle) * targetDist;
        let py = centerY + Math.sin(p.angle) * (targetDist * 0.75); // Elliptical 3D perspective

        // Mouse gravity pull
        if (mouse.active) {
          const dx = mouse.x - px;
          const dy = mouse.y - py;
          const d = Math.hypot(dx, dy);
          if (d < 140) {
            const pull = (140 - d) / 140;
            px += (dx / d) * pull * 25;
            py += (dy / d) * pull * 25;
          }
        }

        p.x = px;
        p.y = py;

        // Draw particle with glow
        ctx.save();
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.alpha * (currentPhase === 'vortex' ? 0.9 : 0.6);
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 4;
        ctx.fill();
        ctx.restore();
      });

      // ── 5. Sparks and Chisel Embers ──
      if (currentPhase === 'carved' || currentPhase === 'forming') {
        if (now - lastSparkTime > 120) {
          lastSparkTime = now;
          // Spawn sparks at contour points
          const sx = centerX + (Math.random() - 0.5) * 220;
          const sy = centerY + (Math.random() - 0.5) * 160;
          addSparks(sx, sy, 4);
        }
      }

      // Update and draw sparks
      const remainingSparks: Spark[] = [];
      for (const s of stateRef.current.sparks) {
        s.x += s.vx;
        s.y += s.vy;
        s.vy += 0.08; // gravity
        s.life++;
        if (s.life < s.maxLife) {
          remainingSparks.push(s);
          const sparkAlpha = 1 - s.life / s.maxLife;
          ctx.save();
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
          ctx.fillStyle = s.color;
          ctx.globalAlpha = sparkAlpha;
          ctx.shadowColor = '#fbbf24';
          ctx.shadowBlur = 5;
          ctx.fill();
          ctx.restore();
        }
      }
      stateRef.current.sparks = remainingSparks;

      ctx.restore();
      animFrameRef.current = requestAnimationFrame(render);
    };

    animFrameRef.current = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener('resize', handleResize);
    };
  }, [initParticles]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    stateRef.current.mouse = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      active: true,
    };
  };

  const handleMouseLeave = () => {
    stateRef.current.mouse.active = false;
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    addSparks(e.clientX - rect.left, e.clientY - rect.top, 20);
  };

  const phaseLabels = {
    vortex: 'Степной вихрь времени',
    forming: 'Кристаллизация наскальных рисунков',
    carved: 'Высекание петроглифов на камне',
    carpet: 'Преемственность: Ковровый шедевр',
  };

  return (
    <div className={`relative w-full rounded-2xl overflow-hidden shadow-2xl ${className}`}>
      {/* Interactive Canvas */}
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleCanvasClick}
        className="w-full h-[360px] sm:h-[420px] lg:h-[480px] block cursor-crosshair bg-slate-950"
      />

      {/* Top Banner Status Bar */}
      <div className="absolute top-3 left-3 right-3 flex items-center justify-between pointer-events-none">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900/80 backdrop-blur-md border border-amber-500/20 text-xs text-amber-300 font-medium tracking-wide">
          <Sparkles className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
          <span>{phaseLabels[phase]}</span>
        </div>

        <button
          onClick={restartVortex}
          className="pointer-events-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 backdrop-blur-md border border-white/20 text-[11px] font-medium text-white transition-all shadow-sm"
          title="Запустить анимацию вихря заново"
        >
          <RotateCw className="w-3 h-3 text-amber-300" />
          <span className="hidden sm:inline">Перезапустить вихрь</span>
        </button>
      </div>

      {/* Bottom Progress Bar & Steppe Heritage Subtitle */}
      <div className="absolute bottom-3 inset-x-3 flex flex-col gap-1.5 pointer-events-none">
        <div className="flex items-center justify-between text-[11px] text-slate-300/80 px-1 font-body">
          <span>Петроглифы урочища Тамгалы (UNESCO)</span>
          <span className="text-amber-400 font-semibold">{progress}%</span>
        </div>
        <div className="w-full h-1 rounded-full bg-slate-800/80 backdrop-blur-sm overflow-hidden border border-white/5">
          <div
            className="h-full bg-gradient-to-r from-amber-600 via-amber-400 to-amber-200 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}
