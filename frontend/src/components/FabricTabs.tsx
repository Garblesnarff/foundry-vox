import { useCallback, useEffect, useRef } from "react";
import { Spring, SPRING_SNAPPY, SPRING_SOFT, SPRING_HEAVY } from "../lib/spring";

interface FabricTabsProps {
  views: Array<{ id: string; label: string }>;
  activeView: string;
  onViewChange: (id: string) => void;
}

export default function FabricTabs({ views, activeView, onViewChange }: FabricTabsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const rafId = useRef(0);
  const lastTime = useRef(0);
  const isRunning = useRef(false);

  // Mutable spring state — never triggers re-renders
  const springs = useRef({
    tiltX: new Spring(0, SPRING_SOFT),
    tiltY: new Spring(0, SPRING_SOFT),
    dentDepth: new Spring(0, SPRING_HEAVY),
    indicatorX: new Spring(0, SPRING_SNAPPY),
    indicatorW: new Spring(0, SPRING_SNAPPY),
    indicatorScale: new Spring(1, SPRING_SNAPPY),
    tabScales: views.map(() => new Spring(1, SPRING_HEAVY)),
  });

  const pointer = useRef({
    isDown: false,
    downIndex: -1,
    x: 0,
    y: 0,
    startX: 0,
    startY: 0,
  });

  // Measure a tab's position relative to the container
  const measureTab = useCallback((index: number) => {
    const container = containerRef.current;
    const tab = tabRefs.current[index];
    if (!container || !tab) return { left: 0, width: 0 };
    const cr = container.getBoundingClientRect();
    const tr = tab.getBoundingClientRect();
    return { left: tr.left - cr.left, width: tr.width };
  }, []);

  // Apply all spring values to DOM (no React re-render)
  const applyTransforms = useCallback(() => {
    const s = springs.current;
    const container = containerRef.current;
    const indicator = indicatorRef.current;
    if (!container) return;

    // 3D tilt on the whole container
    container.style.transform =
      `perspective(600px) rotateX(${s.tiltY.value}deg) rotateY(${s.tiltX.value}deg)`;

    // Dent shadow via CSS custom properties
    container.style.setProperty("--dent-depth", String(s.dentDepth.value));

    // Per-tab scale
    tabRefs.current.forEach((tab, i) => {
      if (tab && s.tabScales[i]) {
        tab.style.transform = `scale(${s.tabScales[i].value})`;
      }
    });

    // Indicator position + stretch
    if (indicator) {
      indicator.style.transform =
        `translateX(${s.indicatorX.value}px) scaleX(${s.indicatorScale.value})`;
      indicator.style.width = `${s.indicatorW.value}px`;
    }
  }, []);

  // Animation loop
  const loop = useCallback((now: number) => {
    const dt = lastTime.current === 0 ? 0.016 : (now - lastTime.current) / 1000;
    lastTime.current = now;
    const s = springs.current;

    let animating = false;
    animating = s.tiltX.tick(dt) || animating;
    animating = s.tiltY.tick(dt) || animating;
    animating = s.dentDepth.tick(dt) || animating;
    animating = s.indicatorX.tick(dt) || animating;
    animating = s.indicatorW.tick(dt) || animating;
    animating = s.indicatorScale.tick(dt) || animating;
    for (const ts of s.tabScales) {
      animating = ts.tick(dt) || animating;
    }

    applyTransforms();

    if (animating || pointer.current.isDown) {
      rafId.current = requestAnimationFrame(loop);
    } else {
      isRunning.current = false;
    }
  }, [applyTransforms]);

  const ensureLoop = useCallback(() => {
    if (!isRunning.current) {
      isRunning.current = true;
      lastTime.current = 0;
      rafId.current = requestAnimationFrame(loop);
    }
  }, [loop]);

  // Snap indicator to active tab on mount and when activeView changes
  useEffect(() => {
    const activeIndex = views.findIndex((v) => v.id === activeView);
    if (activeIndex < 0) return;

    function updateIndicator(snap: boolean) {
      const { left, width } = measureTab(activeIndex);
      if (width === 0) return; // not laid out yet
      const s = springs.current;
      const indicatorWidth = Math.max(16, width * 0.4);
      const centerX = left + width / 2 - indicatorWidth / 2;

      if (snap) {
        s.indicatorX.value = centerX;
        s.indicatorX.target = centerX;
        s.indicatorW.value = indicatorWidth;
        s.indicatorW.target = indicatorWidth;
        applyTransforms();
      } else {
        s.indicatorX.setTarget(centerX);
        s.indicatorW.setTarget(indicatorWidth);
        s.indicatorScale.value = 1;
        s.indicatorScale.setTarget(1);
        s.indicatorScale.velocity = 6;
        ensureLoop();
      }
    }

    // Snap on first mount, animate on subsequent changes
    const isFirstPosition = springs.current.indicatorW.value === 0;

    // Use rAF to ensure layout is settled
    const raf = requestAnimationFrame(() => {
      updateIndicator(isFirstPosition);
    });

    return () => cancelAnimationFrame(raf);
  }, [activeView, views, measureTab, applyTransforms, ensureLoop]);

  // Recalculate on resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      const activeIndex = views.findIndex((v) => v.id === activeView);
      if (activeIndex < 0) return;
      const { left, width } = measureTab(activeIndex);
      const indicatorWidth = Math.max(16, width * 0.4);
      const s = springs.current;
      s.indicatorX.value = left + width / 2 - indicatorWidth / 2;
      s.indicatorX.target = s.indicatorX.value;
      s.indicatorW.value = indicatorWidth;
      s.indicatorW.target = indicatorWidth;
      applyTransforms();
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [activeView, views, measureTab, applyTransforms]);

  // Cleanup
  useEffect(() => {
    return () => cancelAnimationFrame(rafId.current);
  }, []);

  // Pointer handlers
  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const rx = (e.clientX - rect.left) / rect.width - 0.5;  // -0.5 to 0.5
    const ry = (e.clientY - rect.top) / rect.height - 0.5;

    const s = springs.current;
    const intensity = pointer.current.isDown ? 6 : 3;
    s.tiltX.setTarget(rx * intensity);
    s.tiltY.setTarget(-ry * intensity);

    if (pointer.current.isDown) {
      const pctX = ((e.clientX - rect.left) / rect.width) * 100;
      const pctY = ((e.clientY - rect.top) / rect.height) * 100;
      container.style.setProperty("--dent-x", `${pctX}%`);
      container.style.setProperty("--dent-y", `${pctY}%`);
    }

    pointer.current.x = e.clientX;
    pointer.current.y = e.clientY;
    ensureLoop();
  }, [ensureLoop]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const container = containerRef.current;
    if (!container) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);

    pointer.current.isDown = true;
    pointer.current.startX = e.clientX;
    pointer.current.startY = e.clientY;

    const rect = container.getBoundingClientRect();
    container.style.setProperty("--dent-x", `${((e.clientX - rect.left) / rect.width) * 100}%`);
    container.style.setProperty("--dent-y", `${((e.clientY - rect.top) / rect.height) * 100}%`);

    const s = springs.current;
    s.dentDepth.setTarget(1);

    // Find which tab was pressed
    const pressedIndex = tabRefs.current.findIndex((tab) => tab?.contains(e.target as Node));
    pointer.current.downIndex = pressedIndex;

    if (pressedIndex >= 0) {
      // Cloth tension: pressed tab squishes, adjacent tabs pulled
      s.tabScales.forEach((ts, i) => {
        if (i === pressedIndex) {
          ts.setTarget(0.92);
        } else if (Math.abs(i - pressedIndex) === 1) {
          ts.setTarget(0.96);
        }
      });
    }

    ensureLoop();
  }, [ensureLoop]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    pointer.current.isDown = false;
    const s = springs.current;
    s.dentDepth.setTarget(0);
    s.tabScales.forEach((ts) => ts.setTarget(1));

    // If drag distance was small, treat as a click
    const dx = e.clientX - pointer.current.startX;
    const dy = e.clientY - pointer.current.startY;
    if (Math.sqrt(dx * dx + dy * dy) < 5 && pointer.current.downIndex >= 0) {
      const clicked = views[pointer.current.downIndex];
      if (clicked) onViewChange(clicked.id);
    }

    pointer.current.downIndex = -1;
    ensureLoop();
  }, [views, onViewChange, ensureLoop]);

  const handlePointerLeave = useCallback(() => {
    if (!pointer.current.isDown) {
      const s = springs.current;
      s.tiltX.setTarget(0);
      s.tiltY.setTarget(0);
      ensureLoop();
    }
  }, [ensureLoop]);

  const handlePointerEnter = useCallback(() => {
    ensureLoop();
  }, [ensureLoop]);

  return (
    <nav
      className="chrome-tabs fabric-tabs"
      ref={containerRef}
      onPointerEnter={handlePointerEnter}
      onPointerMove={handlePointerMove}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
    >
      {/* Procedural fabric noise overlay */}
      <svg className="fabric-noise-svg" aria-hidden="true">
        <defs>
          <filter id="fabricNoise" x="0%" y="0%" width="100%" height="100%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.65"
              numOctaves="4"
              stitchTiles="stitch"
            />
            <feColorMatrix type="saturate" values="0" />
          </filter>
        </defs>
        <rect width="100%" height="100%" filter="url(#fabricNoise)" />
      </svg>

      {views.map((item, i) => (
        <button
          key={item.id}
          ref={(el) => { tabRefs.current[i] = el; }}
          className={`chrome-tab fabric-tab ${activeView === item.id ? "active" : ""}`}
          onClick={() => onViewChange(item.id)}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onViewChange(item.id);
            }
          }}
        >
          {item.label}
        </button>
      ))}

      {/* Spring-animated active indicator */}
      <div className="fabric-indicator" ref={indicatorRef} />
    </nav>
  );
}
