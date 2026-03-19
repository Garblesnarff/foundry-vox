# Light Mode Material System

Complete CSS variable set for macOS-native light mode. Apple's light mode is cool-neutral — never warm, never cream.

## Variable Template

```css
html.light {
  /* Material layers */
  --bg: #ececec;                       /* Window background */
  --sidebar: rgba(228,228,230,.88);    /* Sidebar — cool gray with vibrancy */
  --sec: #f9f9fb;                      /* Cards — barely visible on white */
  --ter: #ededef;                      /* Toggle tracks, input backgrounds */
  --quat: #dcdcde;                     /* Deeper input wells */

  /* Interaction states */
  --hover: rgba(0,0,0,.04);
  --active: rgba(0,0,0,.06);

  /* Text hierarchy */
  --t1: rgba(0,0,0,.88);
  --t2: rgba(0,0,0,.52);
  --t3: rgba(0,0,0,.33);
  --t4: rgba(0,0,0,.16);

  /* Separators — stronger than dark mode */
  --sep: rgba(0,0,0,.08);
  --sep2: rgba(0,0,0,.14);

  /* Selection — system blue, darker for contrast */
  --sel-bg: rgba(0,88,208,.12);
  --sel-border: rgba(0,88,208,.25);

  /* System colors — darker variants for contrast on white */
  --red: #e5383b;
  --red-bg: rgba(229,56,59,.08);
  --green: #28a745;
  --green-bg: rgba(40,167,69,.10);
  --orange: #d48806;
  --purple: #8e44ad;
  --teal: #0a8993;

  /* Window chrome */
  --win-border: rgba(0,0,0,.18);
  --win-shadow: 0 0 0 .5px rgba(0,0,0,.12),
                0 24px 60px rgba(0,0,0,.1),
                0 8px 20px rgba(0,0,0,.06);
  --titlebar-bg: linear-gradient(180deg, rgba(244,244,246,.95), rgba(230,230,232,.98));
  --toolbar-bg: rgba(248,248,250,.85);
  --bottom-bg: rgba(242,242,244,.8);
  --tpanel-bg: rgba(250,250,252,.92);
}

html.light body { background: #d8d8da; }
```

## Key Principles

### Cool, never warm
Every gray in light mode should have a slight blue tint. Compare:
- WRONG: `#f5f5f0` (warm/yellow cast)
- WRONG: `#faf8f5` (cream tint)
- RIGHT: `#f9f9fb` (cool blue-gray)
- RIGHT: `#ececec` (neutral-cool)

If you hold the mockup next to a real macOS Notes window and yours looks "warmer," the whites are wrong.

### Cards are nearly invisible
`--sec: #f9f9fb` on `#ffffff` content background is approximately a 1.5% luminance difference. In isolation, you almost can't tell there's a card there. That's correct — the card becomes visible through its content, not its container. Compare this to dark mode where `#222222` on `#1e1e1e` is a similar ~2% difference.

### Separators are more important in light mode
Dark mode relies on luminance differences between panels (sidebar darker, content lighter). Light mode panels are closer in luminance, so explicit separator lines matter more. The transcript panel border-left should be `rgba(0,0,0,.16)` — stronger than the default `.14` separator.

### Glow opacity doubles
Every hover glow, border glow, and box-shadow in light mode needs approximately **2x the opacity** of its dark mode equivalent. Light backgrounds absorb glow; dark backgrounds amplify it.

Dark mode card hover: `box-shadow: 0 0 20px rgba(brand, .08)`
Light mode card hover: `box-shadow: 0 0 24px rgba(brand, .15)`

Dark mode radial glow: `rgba(brand, .08)` 
Light mode radial glow: `rgba(brand, .18)`

Dark mode border glow: `rgba(brand, .25)`
Light mode border glow: `rgba(brand, .35)`

### Avatar borders match their panel
Avatar circle borders should match the background they sit on:
- Dark sidebar: `border-color: rgba(40,40,40,.9)`
- Light sidebar: `border-color: rgba(228,228,230,.95)`
