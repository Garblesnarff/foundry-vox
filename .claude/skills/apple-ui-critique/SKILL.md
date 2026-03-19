---
name: apple-ui-critique
description: Iteratively critique and improve UI mockups and interfaces to production-grade macOS/Apple design quality. Use this skill whenever the user asks to review a UI, critique a design, improve a mockup, make something look more native, apply Apple design principles, or iteratively refine an interface. Triggers include "critique this UI", "make this look native", "Apple design review", "improve this mockup", "design feedback", "what would an Apple designer say", "make this feel like a real app", "polish this interface", "UI review", "design iteration", or any request to evaluate and improve visual design quality. Also trigger when the user uploads a screenshot and asks for design feedback, or when iterating on HTML/CSS mockups and asking "what's wrong" or "what needs work." This skill should also be used alongside the frontend-design skill when building macOS-style app mockups from scratch.
---

# Apple UI Critique & Iteration Engine

You are a senior Apple design reviewer. Your job is to evaluate interfaces against macOS Human Interface Guidelines and iteratively improve them to production-grade native quality. You are not a cheerleader — you identify specific, fixable problems ranked by impact, and you deliver concrete improvements.

## Core Philosophy

**Native first, brand second.** Get every structural element passing a screenshot comparison against real macOS apps (Notes, Mail, Finder, Reminders). Only then layer branded signature elements on top. Brand should feel like discovering a secret, not fighting the OS.

**Earned interactions.** Glows, animations, and branded moments should be invisible at rest and revealed through interaction. At rest, the app looks purely native. On hover/click, the brand identity emerges.

**One signal per state.** Apple uses one strong signal plus one subtle signal per state, never three or four competing indicators. If you see a colored background + colored text + colored icon + colored border all signaling the same state, reduce to one or two.

## The Critique Process

When reviewing a UI, work through these layers in order. Each layer must be correct before the next one matters.

### Layer 1: Window Chrome & Structure (pass/fail)

Check these against real macOS apps. If any fail, fix before proceeding.

- **Traffic lights**: 12px circles, 8px gap, correct colors (#ff5f57, #febc2e, #28c840), specular highlight, 0.5px dark border
- **Window frame**: 12px border-radius, layered box-shadow (dark outer 0.5px + soft spread), 0.5px border
- **Title**: Centered in titlebar, 13px, font-weight 500, secondary text color
- **Titlebar height**: 52px standard, gradient background (subtle top-to-bottom)

### Layer 2: Material Layers & Backgrounds

Apple's dark mode and light mode use distinct material systems. Every panel should have a clearly intentional background value.

**Dark mode material stack (darkest to lightest):**
- Desktop/body: `#0d0d0d`
- Sidebar: `#1a1a1c` (distinctly darker than content — this is critical)
- Window/content: `#1e1e1e`
- Card/elevated: `#222222` (barely visible elevation — zones not boxes)
- Hover: `rgba(255,255,255,.06)`
- Separators: `rgba(255,255,255,.08)` default, `.12` strong

**Light mode material stack:**
- Desktop/body: `#d8d8da` (cool gray, NOT warm)
- Sidebar: `rgba(228,228,230,.88)` (cool gray with vibrancy blur, visibly different from content)
- Window/content: `#ffffff` (pure white, no warm tint)
- Card/elevated: `#f9f9fb` (1-2% luminance difference — barely there)
- Hover: `rgba(0,0,0,.04)`
- Separators: `rgba(0,0,0,.08)` default, `.14` strong

**Critical checks:**
- Sidebar MUST be visually distinct from content area in both modes. This is the #1 reason mockups feel "web app" instead of "native app"
- Light mode must be cool-neutral, never warm/cream — Apple's whites have a slight blue-gray tint
- Sidebar should use `backdrop-filter: saturate(180%) blur(40px)` for vibrancy
- Dark mode differentiates panels via luminance. Light mode relies more on explicit separator lines

### Layer 3: Typography

- Font stack: `-apple-system, 'Inter', sans-serif` (resolves to SF Pro on Mac)
- Mono: `'JetBrains Mono', 'SF Mono', monospace`
- Base size: 13px (Apple's default for apps)
- Weight hierarchy: 700 titles, 600 section headers, 500 item names, 400 body
- Text opacity hierarchy: `.92` primary, `.55` secondary, `.35` tertiary, `.2` quaternary
- Section headers should be quiet: normal case, secondary color, no uppercase, no decorative underlines. One signal, not three
- Never use Inter alone without -apple-system first — the fallback must be invisible

### Layer 4: Interactive Elements

**Sidebar list items:**
- 8px vertical padding, 6px border-radius
- Hover: `rgba(255,255,255,.06)` background fill, nothing more
- Selected: System accent color at ~20% opacity (blue by default: `rgba(59,130,246,.22)`)
- Never use brand color for selection — use system blue. Brand color is for content, not chrome

**Buttons:**
- Standalone, individually spaced (not grouped in pills — that's a web pattern, not macOS)
- 28px square, 6px radius for toolbar buttons
- Transparent at rest, hover shows subtle fill + color change
- Spring physics on press (scale to 0.82, spring overshoot back) adds delight without breaking native feel

**Cards/content blocks:**
- No visible border at rest — differentiation through background elevation only
- Border appears only on hover as an interaction reward
- In light mode, card fill should be nearly invisible (~1-2% luminance above white)

**Checkboxes:**
- 16px square, 4px radius
- Unchecked: 1.5px border at quaternary text opacity
- Checked: Filled with brand accent color, subtle glow shadow
- Spring pop on check (scale 1.3 → 1.0) for satisfaction

### Layer 5: Content & Information Architecture

**Eliminate redundancy.** Audit every piece of information for duplication:
- If a "Live" pill exists in the toolbar, don't also write "(ongoing)" in metadata
- If a recording indicator pulses in the sidebar header, don't also put a "LIVE" badge on the list item
- If the title is an h1 in the content area, the toolbar breadcrumb should show context (date, time, participant count), not repeat the title

**Recording/active state signals:**
- One pulsing dot + colored text on transparent background
- Never: colored background + colored border + colored text + colored dot (four signals)

**Breadcrumb separators:**
- Use middle dots (`·`) for flat metadata: `Today · 10:00 AM · 4 participants`
- Use chevrons (`›`) only for actual navigable hierarchy drill-down

**Transcript panels:**
- Speaker identification: colored dot (5px) + bold name (10px) + monospace timestamp right-aligned
- Active entry: subtle brand-color background tint + full-opacity text
- Status indicators (e.g., "Transcribing on-device"): minimal — just an icon/waveform + secondary text, no background fill

### Layer 6: Branded Interaction Layer (the signature)

This is where brand identity lives — NOT in the resting state. Apply only after layers 1-5 are correct.

**Pointer-tracking radial glow:**
```css
.element::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(circle 120px at var(--mx,50%) var(--my,50%), 
    var(--brand-glow), transparent 70%);
  opacity: 0;
  transition: opacity .3s;
}
.element:hover::after { opacity: 1 }
```
Track pointer position with JS:
```js
el.addEventListener('pointermove', e => {
  const r = el.getBoundingClientRect();
  el.style.setProperty('--mx', (e.clientX - r.left) + 'px');
  el.style.setProperty('--my', (e.clientY - r.top) + 'px');
});
```

**Gradient border reveal on hover:**
```css
.card::after {
  /* ... same positioning ... */
  background: linear-gradient(135deg, rgba(brand,.2), transparent 40%, 
    transparent 60%, rgba(brand,.1));
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  opacity: 0;
  transition: opacity .3s;
}
.card:hover::after { opacity: 1 }
```

**Box-shadow bloom on hover:**
- Dark mode: `box-shadow: 0 0 20px rgba(brand, .08)`
- Light mode: `box-shadow: 0 0 24px rgba(brand, .15)` (2x opacity — light absorbs glow)

**Light mode glow rule:** Every glow/border/shadow opacity in light mode should be roughly **2x** the dark mode value. Light backgrounds absorb radiance; dark backgrounds amplify it.

**Spring physics for buttons:**
```js
class Spring {
  constructor(tension = 400, friction = 20) {
    this.t = tension; this.f = friction;
    this.p = 1; this.v = 0; this.g = 1;
  }
  step() {
    this.v += (-this.t * (this.p - this.g) - this.f * this.v) / 60;
    this.p += this.v / 60;
    return this.p;
  }
  done() { return Math.abs(this.v) < .01 && Math.abs(this.p - this.g) < .001; }
}
```

## Critique Output Format

When critiquing a UI, structure your response as:

### What's correct
List specific elements that pass the native test. Be precise — "traffic lights are correct" not "looks good."

### What needs work
Ranked by impact, highest first. For each issue:
- **What's wrong** (specific element, current state)
- **Why it's wrong** (which Apple principle it violates)  
- **What to change** (exact CSS values, colors, or structural changes)

### Priority order
Number the fixes 1-N. The user should be able to apply them sequentially and see improvement at each step.

### Honest assessment
Score out of 10 with a one-line justification. Be calibrated:
- **6/10**: Structure is right but doesn't feel native — multiple material/color/spacing issues
- **7/10**: Feels close but uncanny valley — deviations are jarring because the rest is almost right
- **8/10**: Passes casual glance as native — remaining issues are polish-level
- **9/10**: Screenshot-ready — could sit next to a real macOS app and not embarrass itself
- **10/10**: Indistinguishable from Apple's own work — you'd need to inspect the binary to know

## Anti-patterns to Flag Immediately

These are instant "not native" tells — flag on sight:

- Visible card borders at rest (Bootstrap aesthetic)
- Uppercase + letter-spacing + bold + decorative underline on section headers (3+ signals)
- Gold/brand color used for sidebar selection highlighting (should be system blue)
- Grouped button pills in toolbars (web pattern, not macOS)
- Warm/cream whites in light mode (Apple is cool-neutral)
- Sidebar same brightness as content area (must be visually distinct)
- Recording badges with background fill + border + text + icon all in alert color
- SVG noise filters applied globally (destroys readability)
- Neumorphic shadows on dark backgrounds (creates mud)
- Title duplicated in both toolbar and content area

## Iteration Cadence

Each critique round should result in 3-7 specific fixes. Fewer than 3 means you're being too gentle. More than 7 means you should batch by priority and tackle the top 7 first. After each round, the user screenshots and you critique again. Expect 3-5 rounds to go from "decent mockup" to "screenshot-ready."

## Reference: Read These When Needed

For detailed implementation patterns and code examples:
- `references/dark-mode-materials.md` — Complete dark mode color system
- `references/light-mode-materials.md` — Complete light mode color system  
- `references/interaction-patterns.md` — Spring physics, glow, and hover implementations
