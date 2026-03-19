# Dark Mode Material System

Complete CSS variable set for macOS-native dark mode. These values are derived from inspecting real macOS apps (Notes, Mail, Finder, Xcode) and iteratively calibrating against screenshots.

## Variable Template

```css
:root {
  /* Material layers — darkest to lightest */
  --bg: #1e1e1e;              /* Window background */
  --sidebar: #1a1a1c;         /* Sidebar — MUST be darker than --bg */
  --sec: #222222;             /* Cards/elevated — barely visible */
  --ter: #323232;             /* Toggle tracks, input backgrounds */
  --quat: #3a3a3a;            /* Deeper input wells */

  /* Interaction states */
  --hover: rgba(255,255,255,.06);
  --active: rgba(255,255,255,.08);

  /* Text hierarchy — always rgba for proper blending */
  --t1: rgba(255,255,255,.92);   /* Primary — headings, active text */
  --t2: rgba(255,255,255,.55);   /* Secondary — body, descriptions */
  --t3: rgba(255,255,255,.35);   /* Tertiary — metadata, timestamps */
  --t4: rgba(255,255,255,.2);    /* Quaternary — placeholders, disabled */

  /* Separators */
  --sep: rgba(255,255,255,.08);    /* Default */
  --sep2: rgba(255,255,255,.12);   /* Strong — sidebar border, panel dividers */

  /* Selection — always system blue */
  --sel-bg: rgba(59,130,246,.22);
  --sel-border: rgba(59,130,246,.35);

  /* System colors */
  --red: #ff453a;
  --red-bg: rgba(255,69,58,.12);
  --green: #32d74b;
  --green-bg: rgba(50,215,75,.12);
  --orange: #ff9f0a;
  --purple: #bf5af2;
  --teal: #64d2ff;
  --blue: #4a9eff;

  /* Window chrome */
  --win-border: rgba(255,255,255,.12);
  --win-shadow: 0 0 0 .5px rgba(0,0,0,.8),
                0 24px 80px rgba(0,0,0,.6),
                0 8px 24px rgba(0,0,0,.4);
  --titlebar-bg: linear-gradient(180deg, rgba(50,50,50,.9), rgba(40,40,40,.95));
  --toolbar-bg: rgba(35,35,35,.8);
  --bottom-bg: rgba(35,35,35,.6);
}

body { background: #0d0d0d; }
```

## Key Principles

### Sidebar must be darker
The sidebar at `#1a1a1c` against window at `#1e1e1e` creates ~2.5% luminance difference. This sounds tiny but is clearly visible and matches how Finder, Mail, and Notes render their sidebars. If sidebar equals window background, the app reads as "web" not "native."

### Cards are zones, not boxes
`--sec: #222222` is only ~2% lighter than `#1e1e1e`. Cards should feel like subtle regions, not floating rectangles. No visible borders at rest — borders appear only on hover as an interaction reward.

### Text uses rgba, never hex
Hex values for text don't blend correctly against varying backgrounds. `rgba(255,255,255,.55)` adapts naturally to sidebar vs content vs card backgrounds. Four opacity stops create the full hierarchy.

### Separators are near-invisible
`.08` opacity means separators are felt, not seen. Strong separators at `.12` for major structural dividers (sidebar border, panel splits). Never use `.2` or above — that's a visible line, not a separator.
