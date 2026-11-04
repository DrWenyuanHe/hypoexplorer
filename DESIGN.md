---
name: HypoExplorer
description: A restrained, data-forward explorer for hypothalamic differential expression, where color almost always encodes a result.
colors:
  signal-orange: "#F28E2B"
  data-up: "#E45756"
  data-down: "#4C78A8"
  db-gobp: "#4C78A8"
  db-hallmark: "#B07AA1"
  db-kegg: "#59A14F"
  db-reactome: "#E45756"
  taxonomy-brown: "#9C755F"
  app-bg: "#faf8f5"
  panel: "#ffffff"
  text-primary: "#27251e"
  text-mono: "#3d3a34"
  text-muted: "#65625c"
  border: "#e7e3de"
  border-dark: "#d4cfc8"
  row-hover: "#f4f1ed"
  row-selected: "#ede8e2"
  chip-bg: "#FFF8F0"
  warning: "#D97706"
  warning-bg: "#FEF3C7"
typography:
  display:
    fontFamily: "Geist Mono, IBM Plex Mono, ui-monospace, monospace"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Hanken Grotesk, Source Sans 3, -apple-system, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Hanken Grotesk, Source Sans 3, -apple-system, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "Hanken Grotesk, Source Sans 3, -apple-system, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Hanken Grotesk, Source Sans 3, -apple-system, sans-serif"
    fontSize: "10px"
    fontWeight: 700
    letterSpacing: "0.12em"
  mono:
    fontFamily: "Geist Mono, IBM Plex Mono, ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 500
rounded:
  sm: "3px"
  md: "4px"
  lg: "6px"
  xl: "12px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "24px"
  "6": "32px"
components:
  button-primary:
    backgroundColor: "{colors.signal-orange}"
    textColor: "#ffffff"
    rounded: "{rounded.lg}"
    padding: "8px 12px"
  button-primary-hover:
    backgroundColor: "#e07a1e"
  button-default:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "4px 12px"
  input:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.lg}"
    padding: "8px 12px"
  card:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.lg}"
    padding: "16px"
  tab-active:
    textColor: "{colors.text-primary}"
    padding: "8px 16px"
  chip:
    backgroundColor: "{colors.row-selected}"
    textColor: "{colors.db-gobp}"
    rounded: "{rounded.md}"
    padding: "3px 9px"
---

# Design System: HypoExplorer

## 1. Overview

**Creative North Star: "The Lab Notebook"**

HypoExplorer reads like ink on paper. Near-white surfaces (`#faf8f5` page, `#ffffff` panels), warm hairline rules, and prose set in Hanken Grotesk. The data is the ink: every number, gene id, count, and p-value is set in Geist Mono so figures line up in columns and never hide inside running text. Color is rationed. It stays out of the chrome and appears only when it carries a result, a red point is up-regulated, a blue point is down-regulated, a single orange element is the thing you have selected right now.

The system is dense without being loud. It frames live scientific output (volcano plots, enrichment tables, QC panels) in the quietest possible chrome: a 44px topbar, a 232px navigator, a 4px accent strip that takes on the active population's color, and 1px borders doing the structural work that shadows would do in a flashier product. Nothing competes with the plot. The interface is a notebook margin, not a poster.

It explicitly rejects the dashboard-SaaS reflexes that scientific tools tend to drift into: gradient hero metrics, purple-to-blue washes, glassmorphism, identical icon-and-heading card grids, and color used for decoration. If an element is colored here, a reader should be able to say what that color means.

**Key Characteristics:**
- Ink-on-paper restraint: tinted near-whites, never `#000` or `#fff` for text.
- Color earns its place by encoding meaning (direction, group, pathway source, selection).
- Mono for every figure; Sans for every sentence.
- Flat at rest; depth appears only on hover, selection, and overlays.
- One accent (orange) per view, marking the single active thing.

## 2. Colors: The Result-Bearing Palette

A restrained neutral field carrying a small set of meaning-bearing accents. There are only a handful of hues, and each one says something.

### Primary
- **Signal Orange** (`#F28E2B`): The one voice. Marks the single active or selected element in any view, the chosen population, the active tab underline, the primary action button, the input focus ring. It never decorates and never appears twice as a selection in the same frame.

### Secondary (the direction pair)
- **Up Red** (`#E45756`): Up-regulated genes, positive logFC and NES, and the Obese arm of every contrast. Appears on volcano points, summary tables, pathway NES cells, and group dots.
- **Down Blue** (`#4C78A8`): Down-regulated genes, the Normal baseline arm, and the calm structural accent (selectors, links, neutral emphasis). The same blue doubles as the GO:BP pathway-database hue.

### Tertiary (the categorical and pathway palette)
- **Hallmark Purple** (`#B07AA1`), **KEGG Green** (`#59A14F`): Pathway-database identity colors, alongside GO:BP blue (`#4C78A8`) and Reactome red (`#E45756`). This four-color set tags where an enrichment result came from.
- **Taxonomy Brown** (`#9C755F`): The fifth voice, used for non-neuronal and cross-model contexts and as the closing stop of the brand ribbon.
- **The Population Palette**: Cell-population dots use a generated per-dataset palette (a curated head plus HSL-spaced remainder), roughly 60 hues. These are categorical identity, not semantic, and are generated at preprocess time, not hand-authored here.

### Neutral
- **Ink** (`#27251e`, text-primary): Primary text. The darkest value in the system; the system never reaches pure black.
- **Graphite** (`#3d3a34`, text-mono): Secondary text and mono figures at rest.
- **Stone** (`#65625c`, text-muted): Labels, captions, secondary metadata, the quiet voice.
- **Page** (`#faf8f5`) and **Panel** (`#ffffff`): The two-tone surface system. Page is the canvas; panels and the sidebar sit a half-step lighter or framed against it.
- **Hairline** (`#e7e3de`, border) and **Edge** (`#d4cfc8`, border-dark): 1px structural rules and control outlines.
- **Row Hover** (`#f4f1ed`) and **Row Selected** (`#ede8e2`): Navigator and table row states, warm neutral tints that stay clear of the up-red and down-blue result colours.

### Utility
- **Warning Amber** (`#D97706` on `#FEF3C7`): The single caution slot, reserved for under-powered QC designs (a group with n below 3). Used as a small triangle, never as a fill.
- **Chip Cream** (`#FFF8F0`): A barely-there warm tint for selected-gene chips, the only place the orange family touches a surface.

### Named Rules
**The One Voice Rule.** Signal Orange marks at most one active element per view. Its rarity is the signal; a second orange selection in frame means the design is lying about what is active.

**The Meaning-Only Color Rule.** Red is up and Obese. Blue is down and Normal. These bindings are absolute and centralized in one module (`src/styles/constants.js`). Color is never chosen for looks; if you cannot name what a color encodes, it should be a neutral.

## 3. Typography

**Heading Font:** Hanken Grotesk, weight 600, tracking -0.01em
**Body / Control Font:** Hanken Grotesk (with Source Sans 3, `-apple-system`, `BlinkMacSystemFont`, sans-serif fallback)
**Figure / Mono Font:** Geist Mono (with IBM Plex Mono, `ui-monospace`, monospace fallback)

**Character:** One grotesk carries headings, prose, navigation, controls and compact table labels, so the interface reads as a quiet instrument rather than a publication; headings separate by weight and size, not by a second family. Hanken Grotesk was chosen as the closest open-licence match to the calm grotesk used by search tools such as Perplexity. It has no Greek or Cyrillic and lacks a few symbols such as some arrows, so Source Sans 3 follows it in the stack and supplies those characters, such as the α in TNF-α. Geist Mono, the monospace companion to that grotesk, keeps gene symbols and numerical readouts legible and aligned; IBM Plex Mono stays second in its stack for any glyph it lacks. Shared CSS stacks live in `public/fonts/typography.css`; inline React styles use `FONT_HEADING`, `FONT_SANS` and `FONT_MONO` from `src/styles/constants.ts`. Body text sits at 13px, smaller than consumer defaults, because the reader is scanning tables and plots, not reading paragraphs.

### Hierarchy
- **Display** (Mono, 28px, 700, line-height 1, tracking -0.02em): The hero readout, the active population id or metric at the top of the main column. The one place a number gets large.
- **Headline** (Sans, weight 600, tracking -0.01em): Page and prose section headings, using each view's existing size and spacing. The approved logo remains raster artwork.
- **Title** (Sans, 13px, 600): Tab labels, compact card labels, table headers and active navigator rows. Prose headings and study-card titles use the heading stack; gene and accession headings retain Mono where already explicit.
- **Body** (Sans, 13px, 400, line-height 1.5): Default running text and descriptions. Cap measure at 65 to 75ch for any long-form prose (methodology, acknowledgements).
- **Label** (Sans, 10px, 700, tracking 0.12em, UPPERCASE): Section eyebrows in the navigator and panels. The quietest, most-tracked type in the system.
- **Mono** (Mono, 12px, 400 to 500): Every gene id, count, p-value, logFC, breadcrumb, and dataset slug.

### Named Rules
**The Numbers Are Mono Rule.** If it is a figure (id, count, statistic, coordinate), it is Geist Mono. Numbers never sit in Sans, so columns of data always align.

**The Quiet Label Rule.** Section labels are 10px, 700 weight, 0.12em tracked, uppercase, and muted slate. They orient without shouting. A label that competes with its content is too loud.

## 4. Elevation

The system is flat by default. Surfaces are defined by 1px borders and the two-tone page/panel relationship, not by drop shadows. Depth is a response to state, not a resting decoration: a card lifts when you hover it, an overlay floats above the work. Three shadow steps exist, and they escalate with intent.

### Shadow Vocabulary
- **Resting lift** (`box-shadow: 0 1px 4px rgba(0, 0, 0, 0.10)`): The hairline shadow under cards and panels. Barely there; it separates a surface from the page without announcing itself.
- **Hover / active lift** (`box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12)`): The response when a tile or card is hovered or becomes active, usually paired with a 2px upward translate.
- **Overlay** (`box-shadow: 0 12px 48px rgba(0, 0, 0, 0.25)`): Modals and the update prompt only. The one place the system goes genuinely dark and deep, because it is taking over the screen.
- **Accent glow** (`box-shadow: 0 2px 6px rgba(242, 142, 43, 0.3)`): The soft orange halo under the primary action button, the single shadow that carries color.

### Named Rules
**The Flat-By-Default Rule.** Surfaces are flat at rest with a hairline border and at most the resting lift. Shadows deepen only in response to hover, selection, or an overlay taking the screen. If a static surface needs a heavy shadow to read, the border or the spacing is wrong.

**The Thick Edge Means State Rule.** The only edges thicker than 1px encode state, never decoration: the 4px top accent strip carries the active population's color, and the 3px left border on the active navigator row carries the selection. There are no decorative side stripes anywhere else.

## 5. Components

Quiet chrome around live data. Controls are small, bordered, and rectangular with gently rounded corners; states are conveyed by tint and a single accent rather than by heavy fills.

### Buttons
- **Shape:** Gently rounded (`6px` primary, `4px` default).
- **Primary:** Signal Orange fill (`#F28E2B`), white text, `8px 12px` padding, with the orange accent glow. Used once per view for the dominant action (Compare, Retry).
- **Default / Ghost:** White or transparent fill, `#27251e` text, 1px `#d4cfc8` edge, `4px 12px` padding. The everyday control (Changelog, table toggles).
- **Hover / Focus:** Default buttons warm to Row Hover (`#f4f1ed`); primary darkens to `#e07a1e`. Focus is always a 2px Signal Orange outline at `-2px`/`1px` offset, never removed.

### Chips
- **Gene chip:** Row Selected background (`#ede8e2`), down-blue text, `4px` radius, `3px 9px` padding, mono. Selected genes carry the warm Chip Cream (`#FFF8F0`) variant.
- **Group / contrast pill:** A small colored dot (Normal blue or Obese red) plus a mono count, in a faint tinted pill with a 12px radius. The hero's "3 Normal vs 3 Obese" readout.

### Cards / Containers
- **Corner Style:** `6px` (lg) for cards, up to `12px` (xl) for hero containers.
- **Background:** Panel white (`#ffffff`) on the page (`#faf8f5`).
- **Shadow Strategy:** Resting lift at rest, hover lift plus a 2px translate on interactive cards (see Elevation).
- **Border:** 1px Hairline (`#e7e3de`), darkening to Edge (`#d4cfc8`) on hover.
- **Internal Padding:** `16px` (spacing 4) standard; `24px` (spacing 5) for generous panels.

### Inputs / Fields
- **Style:** Panel-white fill, 1px Hairline or Edge border, `6px` radius, mono or sans depending on content.
- **Focus:** Border shifts to Signal Orange with a soft orange ring (`box-shadow: 0 0 0 3px rgba(242, 142, 43, 0.15)`). No glow on blur.
- **Search variants:** A leading magnifier glyph and an optional trailing clear control; the navigator filter and gene search share this pattern.

### Navigation
- **Topbar:** 44px tall, panel-white, 1px bottom hairline. Wordmark left (Hypo in ink, Explorer in Signal Orange), a mono breadcrumb of dataset / population / view, utilities right.
- **Tabs:** Underline tabs. Inactive is muted slate; active is ink text with a 2px Signal Orange bottom border and 600 weight. Hover warms the label and adds a 2% wash.
- **Sidebar navigator:** A scrollable list of population rows, each a colored dot, a mono id, and a truncated marker label. The active row carries Row Selected fill and a 3px Signal Orange left border.

### Signature: The Accent Strip
A 4px horizontal bar at the top of the main column that takes on the active population's color, or a five-stop gradient (`#4C78A8` to `#59A14F` to `#E45756` to `#B07AA1` to `#9C755F`) in Compare mode. It is the app's one piece of pure color-as-identity and its strongest brand signal.

## 6. Do's and Don'ts

### Do:
- **Do** bind color to meaning: Up Red (`#E45756`) for up-regulated and Obese, Down Blue (`#4C78A8`) for down-regulated and Normal, the four database hues for pathway source.
- **Do** reserve Signal Orange (`#F28E2B`) for exactly one active or selected element per view.
- **Do** set every number, id, and statistic in Geist Mono so figures align in columns.
- **Do** define surfaces with 1px hairline borders and keep them flat at rest; let shadows deepen only on hover, selection, and overlays.
- **Do** let the 4px accent strip carry the active population's color as the primary brand moment.
- **Do** tint neutrals toward the warm off-white family (after Perplexity's surfaces); the darkest text is Ink (`#27251e`), never black.

### Don't:
- **Don't** use `#000` or `#fff` for text or chrome. The system bottoms out at `#27251e` on `#faf8f5` / `#ffffff`.
- **Don't** introduce a second saturated accent or use color decoratively. If you cannot name what a color encodes, make it a neutral.
- **Don't** use `border-left` or `border-right` greater than 1px as a decorative stripe on cards or callouts. The only thick edges in the system encode state (the 4px top strip, the 3px active-row border).
- **Don't** reach for gradient hero metrics, purple-to-blue washes, glassmorphism, or identical icon-and-heading card grids. These are the dashboard-SaaS reflexes this tool exists to avoid.
- **Don't** animate layout properties or add bounce. Transitions are 120ms / 200ms on the standard ease (`cubic-bezier(0.4, 0, 0.2, 1)`), respecting `prefers-reduced-motion`.
- **Don't** let chrome compete with the plot. When in doubt, remove a border, mute a label, or drop a color before adding one.
