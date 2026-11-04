# Product

## Register

product

## Users

**Primary: bench researchers in obesity and neuroendocrinology**. They arrive mid-investigation, usually with one gene or pathway already in mind (POMC, AGRP, LEPR, IGF1), wanting to know whether and how it changes in the obese hypothalamus and in which cell populations. They are domain-fluent, they trust precision, and they have low tolerance for ambiguity about what a number means or where it came from. Their job to be done: "show me my gene's obese-vs-normal behavior at single-population resolution, and let me trust it enough to cite it."

**Secondary:** readers arriving from a citation, who judge the resource's credibility in their first minute and for whom rigor and provenance matter most.

## Product Purpose

HypoExplorer is a browser for obese-versus-normal differential expression in the hypothalamus. It re-analyzes Lei et al., Cell Metab 2024 (macaque snRNA-seq, 60 cell populations) and replicates the signal against mouse high-fat-diet bulk datasets. It exposes per-population differential expression (volcano plots, per-gene bars), pathway enrichment (FGSEA across GO:BP, Hallmark, KEGG, Reactome), cross-population comparison, and quality control.

It exists to turn a published atlas into something a researcher can interrogate gene by gene in seconds. Success means a tool that labs actually use and cite, credible enough to sit beside HypoMap, where any result is one click from its method and its source, and where the fastest path to "how does my gene change" is the obvious one.

## Brand Personality

**Three words: authoritative, reference-grade, exact.** The voice of a careful methods section, not a pitch deck. Confidence comes from precision and traceability, never from persuasion. The product is information-rich and comprehensive, but never cramped: it carries density of data, not density of clutter. The emotional goal is that a researcher can trust a number here and cite it without re-checking it elsewhere.

## Anti-references

- **Generic SaaS dashboards.** Gradient hero metrics, glassmorphism, identical icon-and-heading card grids, purple-to-blue washes. The reflex this tool exists to avoid.
- **Legacy bioinformatics UIs** (UCSC Genome Browser, Ensembl). Grey-on-grey, cramped tables, no visual hierarchy, credible data made hostile to read. Keep their rigor, reject their ergonomics.
- **Consumer and marketing flash.** Scroll-driven animations, playful illustrations, emoji, mascot energy. Anything that trades scientific trust for delight.
- **Over-minimal and sparse.** Minimalism that hides data or makes researchers hunt for it. If removing an element costs information, keep the element.

The standing tension to hold: be reference-grade dense without becoming a legacy-tool clutter. The resolution is always hierarchy, not removal.

## Design Principles

1. **Provenance is one click away.** Every number traces to its method, its contrast, and its source dataset. QC, Methodology, and Data Sources are first-class destinations, never buried. Trust is earned by transparency.
2. **The result before the chrome.** The fastest path to "how does my gene change" wins. Optimize the lookup; let navigation, selectors, and settings recede until needed.
3. **Dense with data, not with noise.** Reference-grade information density is a feature. Clutter is not. Earn density through hierarchy, grouping, and restraint, never by cramming. When a screen feels heavy, reorganize before you remove.
4. **Color is a claim.** Every color encodes a result (direction, group, pathway source, population identity) and must survive colorblind reading. A color that cannot be named should be a neutral. (This principle is enforced visually in DESIGN.md.)
5. **Replicate, do not assert.** Show how a finding holds up: across populations, across species, and under QC caveats. The tool makes its own limitations visible (under-powered designs are flagged, not hidden) rather than presenting every result as equally solid.

## Accessibility & Inclusion

Target **WCAG 2.1 AA** contrast across text and controls. Because hue encodes meaning here (red is up and Obese, blue is down and Normal, plus roughly 60 categorical population colors), **never rely on color alone**: pair every color-coded result with shape, text, position, or a label (for example the existing under-powered-design warning triangle and explicit direction in volcano and table cells). Honor `prefers-reduced-motion` (already wired into the global stylesheet). Keyboard focus is always visible; the orange focus ring is never removed. Mono figures and AA-contrast labels keep dense tables legible at a glance.
