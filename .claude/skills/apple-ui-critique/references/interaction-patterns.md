# Interaction Patterns

Implementation patterns for branded interactions that feel native. The rule: invisible at rest, revealed through interaction.

## Spring Physics Engine

A minimal spring simulation for button press/release. Tension controls snap speed, friction controls overshoot damping.

```javascript
class Spring {
  constructor(tension = 400, friction = 20) {
    this.t = tension;
    this.f = friction;
    this.p = 1;     // position (current scale)
    this.v = 0;     // velocity
    this.g = 1;     // goal (target scale)
  }
  step() {
    this.v += (-this.t * (this.p - this.g) - this.f * this.v) / 60;
    this.p += this.v / 60;
    return this.p;
  }
  done() {
    return Math.abs(this.v) < 0.01 && Math.abs(this.p - this.g) < 0.001;
  }
}
```

### Apply to buttons

```javascript
document.querySelectorAll('.btn').forEach(btn => {
  const s = new Spring(400, 20);
  let raf = false;
  function run() {
    s.step();
    btn.style.transform = `scale(${s.p})`;
    if (!s.done()) requestAnimationFrame(run); else raf = false;
  }
  function kick() { if (!raf) { raf = true; requestAnimationFrame(run); } }
  btn.addEventListener('pointerdown', () => { s.g = 0.82; kick(); });
  btn.addEventListener('pointerup', () => { s.g = 1; kick(); });
  btn.addEventListener('pointerleave', () => { s.g = 1; kick(); });
});
```

**Tuning guide:**
- Toolbar buttons: tension 400, friction 20, target 0.82 — snappy, noticeable
- Checkboxes: scale to 1.3 on check, spring back — satisfying pop
- Cards: target 0.997 — barely perceptible squish, adds physicality
- Large elements: tension 200, friction 16 — slower, more dramatic

### Apply to checkboxes

```javascript
function toggleCB(el) {
  const cb = el.querySelector('.checkbox');
  const wasOff = cb.classList.contains('cb-off');
  cb.classList.toggle('cb-off', !wasOff);
  cb.classList.toggle('cb-on', wasOff);
  if (wasOff) {
    cb.style.transform = 'scale(1.3)';
    setTimeout(() => cb.style.transform = 'scale(1)', 150);
  }
}
```

## Pointer-Tracking Radial Glow

A warm radial gradient that follows the cursor within an element. CSS handles the rendering; JS updates the position variables.

### CSS

```css
.glow-element {
  position: relative;
  overflow: hidden;
}

.glow-element::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(
    circle 120px at var(--mx, 50%) var(--my, 50%),
    var(--brand-glow),
    transparent 70%
  );
  opacity: 0;
  transition: opacity 0.3s;
}

.glow-element:hover::after {
  opacity: 1;
}
```

### JavaScript

```javascript
document.querySelectorAll('[data-glow]').forEach(el => {
  el.addEventListener('pointermove', e => {
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    el.style.setProperty('--my', (e.clientY - r.top) + 'px');
  });
});
```

### Sizing guide
- Cards (large): `circle 120px` — broad, gentle pool
- Sidebar items: `circle 80px` — tighter focus
- Transcript entries: `circle 60px` — subtle, compact
- Toolbar buttons: use box-shadow glow instead (too small for radial)

## Gradient Border Reveal

A gold gradient border that fades in on hover using CSS mask compositing. Invisible at rest, appears as a premium edge highlight on interaction.

```css
.card::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 8px;
  padding: 1px;
  pointer-events: none;
  background: linear-gradient(
    135deg,
    rgba(var(--brand-rgb), 0.2),
    transparent 40%,
    transparent 60%,
    rgba(var(--brand-rgb), 0.1)
  );
  -webkit-mask: linear-gradient(#fff 0 0) content-box,
               linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  opacity: 0;
  transition: opacity 0.3s;
}

.card:hover::after {
  opacity: 1;
}
```

**Light mode override:**
```css
html.light .card::after {
  background: linear-gradient(
    135deg,
    rgba(var(--brand-rgb), 0.3),  /* 1.5x dark mode */
    transparent 40%,
    transparent 60%,
    rgba(var(--brand-rgb), 0.15)
  );
}
```

## Box-Shadow Bloom

Subtle glow aura on hover. The key: it must be invisible at rest.

```css
.card {
  box-shadow: none;
  transition: box-shadow 0.25s;
}

.card:hover {
  box-shadow: 0 0 20px var(--brand-glow);
}
```

**Light mode override:**
```css
html.light .card:hover {
  box-shadow: 0 0 24px rgba(var(--brand-rgb), 0.15),
              0 2px 8px rgba(var(--brand-rgb), 0.08);
}
```

## Theme Toggle

macOS-style toggle switch with spring animation on the thumb.

### CSS

```css
.toggle-track {
  width: 36px;
  height: 20px;
  border-radius: 10px;
  padding: 2px;
  background: var(--ter);
  border: 0.5px solid var(--sep2);
  cursor: pointer;
  display: flex;
  align-items: center;
}

.toggle-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--t1);
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1),
              background 0.3s;
  box-shadow: 0 1px 3px rgba(0,0,0,0.3);
}

html.light .toggle-thumb {
  transform: translateX(16px);
  background: var(--brand-color);
}
```

### JavaScript

```javascript
document.getElementById('themeToggle').addEventListener('click', () => {
  document.documentElement.classList.toggle('light');
});
```

## Smooth Theme Transitions

Apply to all themed elements so mode switching feels like a single coordinated transform:

```css
.sidebar, .toolbar, .card, .act, .item, .notes,
.tpanel, .toggle-track, .bottom {
  transition: background 0.4s, border-color 0.4s,
              box-shadow 0.4s, color 0.4s;
}
```

## Combining Patterns

On a single card element, you typically layer three effects:
1. **::before** — pointer-tracking radial glow (warmth)
2. **::after** — gradient border reveal (edge definition)
3. **:hover style** — box-shadow bloom + border-color + text brightening

All three are invisible at rest. On hover, they activate together, creating a rich "the card comes alive" moment. This is the signature interaction pattern — native at rest, branded on interaction.
