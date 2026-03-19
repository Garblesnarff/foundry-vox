import { useEffect, useRef } from "react";
import { Spring, SPRING_SOFT, SPRING_HEAVY } from "../lib/spring";

type VisualizerState = "idle" | "warming" | "generating" | "complete";

interface ForgeVisualizerProps {
  state: VisualizerState;
  color: string;
  progress: number; // 0–100
}

const BAR_COUNT = 48;
const BAR_GAP = 3;
const BAR_RADIUS = 3;

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

export default function ForgeVisualizer({ state, color, progress }: ForgeVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafId = useRef(0);
  const barSprings = useRef<Spring[]>([]);
  const opacitySprings = useRef<Spring[]>([]);
  const prevState = useRef<VisualizerState>("idle");
  const startTime = useRef(0);
  const burstTime = useRef(0);

  // Initialize springs once
  if (barSprings.current.length === 0) {
    for (let i = 0; i < BAR_COUNT; i++) {
      barSprings.current.push(new Spring(0.15, { ...SPRING_SOFT, damping: 10 + Math.random() * 4 }));
      opacitySprings.current.push(new Spring(0.35, SPRING_SOFT));
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    startTime.current = performance.now();

    // Detect state transition to "complete" for burst effect
    if (state === "complete" && prevState.current === "generating") {
      burstTime.current = performance.now();
    }
    prevState.current = state;

    let running = true;

    function resize() {
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx!.scale(dpr, dpr);
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    function computeTargets(now: number) {
      const t = (now - startTime.current) / 1000;
      const bars = barSprings.current;
      const opacs = opacitySprings.current;

      for (let i = 0; i < BAR_COUNT; i++) {
        const phase = (i / BAR_COUNT) * Math.PI * 2;
        let targetH = 0;
        let targetO = 0;

        switch (state) {
          case "idle": {
            // Gentle ambient sine wave, low height, slow drift
            targetH = 0.12 + 0.06 * Math.sin(t * 0.8 + phase);
            targetO = 0.35;
            break;
          }
          case "warming": {
            // Wave pattern building intensity, each bar phase-offset
            const wave = Math.sin(t * 1.6 + phase * 0.7);
            const ramp = Math.min(1, t / 4); // ramp up over 4 seconds
            targetH = 0.15 + 0.25 * ramp * (0.5 + 0.5 * wave);
            targetO = 0.45 + 0.2 * ramp;
            break;
          }
          case "generating": {
            // Full intensity — simulated frequency pattern following progress
            const prog = progress / 100;
            const freq = 2 + prog * 3;
            const amplitude = 0.3 + 0.5 * (0.5 + 0.5 * Math.sin(t * freq + phase));
            // Add some randomness via deterministic noise
            const noise = Math.sin(i * 13.37 + t * 4.7) * 0.15;
            targetH = Math.max(0.1, amplitude + noise);
            targetO = 0.7 + 0.2 * Math.sin(t * 2 + phase);
            break;
          }
          case "complete": {
            // Burst then settle
            const elapsed = (now - burstTime.current) / 1000;
            if (elapsed < 0.8) {
              // Burst: bars peak high
              const burstIntensity = Math.max(0, 1 - elapsed / 0.8);
              targetH = 0.3 + 0.6 * burstIntensity * Math.sin(phase + elapsed * 8);
              targetO = 0.5 + 0.4 * burstIntensity;
            } else {
              // Settle to satisfied resting state
              targetH = 0.18 + 0.08 * Math.sin(t * 0.6 + phase);
              targetO = 0.4;
            }
            break;
          }
        }

        bars[i].setTarget(targetH);
        opacs[i].setTarget(targetO);
      }
    }

    function draw(now: number) {
      if (!running || !canvas || !ctx) return;

      const w = canvas.getBoundingClientRect().width;
      const h = canvas.getBoundingClientRect().height;
      ctx.clearRect(0, 0, w, h);

      computeTargets(now);

      const dt = 0.016; // fixed step for consistent feel
      const bars = barSprings.current;
      const opacs = opacitySprings.current;

      const barWidth = Math.max(2, (w - BAR_GAP * (BAR_COUNT - 1)) / BAR_COUNT);
      const [cr, cg, cb] = hexToRgb(color || "#e8a849");

      // Idle/complete uses muted base color; generating uses voice accent
      const isActive = state === "generating" || state === "warming";

      for (let i = 0; i < BAR_COUNT; i++) {
        bars[i].tick(dt);
        opacs[i].tick(dt);

        const barH = Math.max(2, bars[i].value * h);
        const x = i * (barWidth + BAR_GAP);
        const y = h - barH;
        const opacity = opacs[i].value;

        if (isActive) {
          ctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, ${opacity})`;
        } else {
          // Muted neutral tone for idle/complete
          ctx.fillStyle = `rgba(${Math.round(cr * 0.5 + 58)}, ${Math.round(cg * 0.5 + 53)}, ${Math.round(cb * 0.5 + 48)}, ${opacity * 0.7})`;
        }

        // Rounded rect
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barH, BAR_RADIUS);
        ctx.fill();

        // Top highlight on active bars
        if (isActive && bars[i].value > 0.3) {
          ctx.fillStyle = `rgba(255, 255, 255, ${opacity * 0.12})`;
          ctx.beginPath();
          ctx.roundRect(x, y, barWidth, Math.min(barH, 4), BAR_RADIUS);
          ctx.fill();
        }
      }

      rafId.current = requestAnimationFrame(draw);
    }

    rafId.current = requestAnimationFrame(draw);

    return () => {
      running = false;
      cancelAnimationFrame(rafId.current);
      ro.disconnect();
    };
  }, [state, color, progress]);

  return (
    <canvas
      ref={canvasRef}
      className="forge-visualizer"
      style={{ width: "100%", height: "124px", display: "block" }}
    />
  );
}
