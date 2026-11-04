# HypoExplorer brand assets

Concept A (hypothalamic focus) is the approved identity. Blue brain contours and a coral hypothalamic focus accompany the charcoal/blue wordmark.

## Files

| Directory | Use |
| --- | --- |
| [source](source/) | Retained original concept and standalone artwork produced with imagegen. Keep these masters intact. |
| [exports](exports/) | Transparent PNG full logo, text-only wordmark, brain-only symbol, and multi-size ICO for future projects. |
| [fonts](fonts/) | Manrope variable TTF, its SIL Open Font License, and typography specimen. |
| [Website assets](../public/brand/v1/) | Header logo, browser icons, Apple touch icon, 192/512 px app icons, and shared header CSS. |

Run `pnpm run build:brand` to regenerate raster exports and delivery sizes from the retained masters. This performs trimming, sizing and encoding without redrawing the artwork. The full website logo is derived directly from the approved original concept. The separate brain and wordmark masters were extracted with imagegen. Assets are PNG/ICO raster artwork, not editable vector files.

## Typography

The approved logo's lettering is generated artwork, not an identified typeface. Use **hypoexplorer-wordmark.png** when the exact visual identity is required. Do not claim that the artwork was set in Manrope.

For future editable brand typesetting, use **Manrope ExtraBold, weight 800**, with `letter-spacing: -0.035em` and mixed-case `HypoExplorer`. The variable font supports weights 200–800. This is a companion choice with similar geometric forms, not an exact reconstruction of the image lettering.

The Manrope font and license are retained locally from [Google Fonts' Manrope distribution](https://github.com/google/fonts/tree/main/ofl/manrope), retrieved 2026-09-16. See [the specimen](fonts/specimen.html) and [font provenance](fonts/provenance.json).

### Interface typography

The explorer, public documents and standalone tracker set all text in **Hanken Grotesk**: body text, controls and compact interface labels at weights 400–700, and page and section headings at **weight 600** with `letter-spacing: -0.01em`. Headings are distinguished by weight and size, not by a second family. Hanken Grotesk is the closest open-licence match to the calm interface grotesk of search tools such as Perplexity (whose own typeface is proprietary); it replaced Source Serif 4 headings and Source Sans 3 body text on 2026-09-30.

Hanken Grotesk has no Greek or Cyrillic. It also lacks a few symbols the interface uses, such as some arrows. **Source Sans 3** therefore stays second in the stack and supplies those characters, for example the α in TNF-α; its Unicode-range subsets download only when such characters appear on a page, which in practice includes its Latin subset (about 28 KB) on most views.

Explicit gene symbols, accessions, numerical readouts and counts are set in **Geist Mono** (weights 400–600), the monospace companion to the grotesk; it replaced IBM Plex Mono on 2026-09-30, and IBM Plex Mono stays second in the stack for any glyph Geist Mono lacks. Geist Mono is served from `public/fonts/geist-mono/` with its SIL Open Font License and [provenance](../public/fonts/geist-mono/provenance.json); the shared stack is `--font-mono` in `public/fonts/typography.css` and `FONT_MONO` in `src/styles/constants.ts`. The approved raster logo is unchanged, and Manrope remains the companion face for brand lettering only; do not use Manrope or Hanken Grotesk to redraw the logo.

Shared CSS stacks and heading defaults live in `public/fonts/typography.css`; React inline styles use `FONT_HEADING` and `FONT_SANS` from `src/styles/constants.ts`. Hanken Grotesk subsets are served locally from `public/fonts/hanken/`, retrieved from Google Fonts on 2026-09-30, with the SIL Open Font License and a source URL/SHA-256 record in [its provenance](../public/fonts/hanken/provenance.json). The Source Sans 3 fallback subsets remain in `public/fonts/source/` with [their provenance](../public/fonts/source/provenance.json). All font-face declarations use `font-display: swap` and Unicode ranges so the browser requests only the subsets it needs.

The standalone tracker bundles the same Geist Mono, Hanken Grotesk and Source font files through Vite and ships their license copies from `dataset-tracker/public/licenses/`.

## Palette and usage

| Role | Color |
| --- | --- |
| Main blue / Explorer | `#4C78A8` |
| Dark blue | `#2F5D8A` |
| Hypo / charcoal | `#1A202C` |
| Hypothalamic focus | `#E45756` |

These are the logo's colours and stay fixed. The interface around the logo uses a separate set of warm neutrals, adopted on 2026-09-30 after Perplexity's surfaces:

| Interface role | Color |
| --- | --- |
| Page background | `#FAF8F5` |
| Panels | `#FFFFFF` |
| Text | `#27251E` |
| Muted text | `#65625C` |
| Hairline / edge | `#E7E3DE` / `#D4CFC8` |

The logo's charcoal (`#1A202C`) is not the interface text colour. The full list and usage rules are in [DESIGN.md](../DESIGN.md).

Use the full logo on white or a very light surface; the warm page background qualifies. Preserve its aspect ratio and clear space; keep the brain and lettering together in website headers. Use the brain alone for favicons and app icons. The exported header includes its own small transparent inset and renders at 200 × 45 CSS pixels.

All app headers use `src/common/BrandLink.tsx`; public documents share its asset identity through `src/common/brand.ts`. The logo links to `/#/` (the home page), and plain in-app clicks use the existing router callback. Browser modifier-click behavior remains native.

New revisions should use a new delivery directory and favicon version so installed apps and browser caches can distinguish them.

## Imagegen extraction prompts

Brain: extract the existing brain symbol from the approved HypoExplorer logo, preserving its geometry, blue contour, interior curves, coral hypothalamus dot, proportions and color; remove lettering and place the symbol on a transparent square with clear padding.

Wordmark: extract the existing HypoExplorer lettering, removing the brain and preserving spelling, capitalization, letterforms, spacing, charcoal Hypo and blue Explorer, on a transparent landscape canvas.
