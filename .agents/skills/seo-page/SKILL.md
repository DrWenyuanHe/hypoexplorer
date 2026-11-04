---
name: seo-page
description: >
  Analyze one supplied URL across on-page, content, technical metadata, schema,
  images, and performance. Use only for a single-page review.
user-invocable: true
argument-hint: "[url]"
license: MIT
metadata:
  author: AgriciDaniel
  version: "2.4.2"
  category: seo
---

## Project installation (Codex)

This copy belongs only to this repository. Run commands from the project root.
Use `$seo` or `$seo-<name>` in Codex; `/seo ...` below is upstream command notation.
Shared upstream files are in `vendor/claude-seo/`; in those files resolve
`${CLAUDE_PLUGIN_ROOT}` to that directory and run tools through
`python scripts/seo_runtime.py` (the project-local managed-runtime launcher).
Use native available tools; agent prompt files are supporting references, not
registered Claude agents. Optional MCP extensions need separately configured
services. Installing these skills does not set up runtime dependencies or accounts.
See `docs/seo-tooling.md` for updates and explicit runtime setup.

### SEO session update check

At the start of an SEO session, run `python scripts/seo_skills.py check` once,
including implicit skill selection. A session covers the requested SEO task and
its related follow-ups through delivery. Delegated sub-skills share that check's
result; pass it to them so they do not repeat the check or prompt.

Complete the requested SEO work with the installed skills. An available update
must not interrupt the task or trigger a prompt before the deliverable is complete.

- If `update_available` is false, no update prompt is needed.
- If true, after delivering the requested SEO work, show the installed version,
  latest tag, and comparison link. Ask once whether to install the update for
  future sessions or keep the installed version. Wait for the answer before
  installing; the completed SEO work does not depend on this choice. Never treat
  silence or an earlier session's approval as consent to this update.
- If approved, run the exact pinned `update_command` from the check. After it
  succeeds, reread the relevant installed SKILL.md files. If declined, keep the
  installed version; check again at the start of the next SEO session.
- If the check fails, complete the task with the installed skills and briefly
  report at the end that update availability could not be verified. Do not claim
  they are current or attempt an automatic repair. If an approved update fails,
  stop and inspect its receipt before using potentially incomplete files.

An explicit user request to update the skills can be handled immediately. The
check is read-only; installing an available update still requires authorization.
This does not authorize runtime setup or changes outside this project's SEO
installation.



# Single Page Analysis

## What to Analyze

### On-Page SEO
- Title tag: 50-60 characters, includes primary keyword, unique
- Meta description: 150-160 characters, compelling, includes keyword
- Meta description is not a restatement of the title: run
  `python scripts/seo_runtime.py run metadata_template.py --title "<title>" --description "<desc>" --json`
  (heuristic, deterministic string comparison). A description that opens by
  repeating its own title and closes on a stock CTA ("Try it free now.",
  "Start free!") is templated metadata, the shape bulk generation jobs produce
  site-wide, and duplicated or templated metadata is a documented
  content-quality problem regardless of how original the body copy is
- H1: exactly one, matches page intent, includes keyword
- H2-H6: logical hierarchy (no skipped levels), descriptive
- URL: short, descriptive, hyphenated, no parameters
- Internal links: sufficient, relevant anchor text, no orphan pages
- External links: to authoritative sources, reasonable count

### Content Quality
- Word count vs page type minimums (see quality-gates.md)
- Readability: Flesch Reading Ease score, grade level
- Keyword density: natural (1-3%), semantic variations present
- E-E-A-T signals: author bio, credentials, first-hand experience markers
- Content freshness: publication date, last updated date

### Technical Elements
- Canonical tag: present, self-referencing or correct
- Meta robots: index/follow unless intentionally blocked
- Open Graph: og:title, og:description, og:image, og:url
- Twitter Card: twitter:card, twitter:title, twitter:description
- Hreflang: if multi-language, correct implementation

### Schema Markup
- Detect all types (JSON-LD preferred)
- Validate required properties
- Identify missing opportunities
- Never recommend HowTo (deprecated) or FAQ for rich results (retired May 2026); existing FAQPage need not be removed, use QAPage for genuine Q&A

### Images
- Alt text: present, descriptive, includes keywords where natural
- File size: flag >200KB (warning), >500KB (critical)
- Format: recommend WebP/AVIF over JPEG/PNG
- Dimensions: width/height set for CLS prevention
- Lazy loading: report `lazy_method` per image (native | perfmatters | ewww | js-generic | none). Do not flag "not lazy-loaded" when JS lazy-loaders (Perfmatters, EWWW, lazysizes) are detected, they intentionally strip the native `loading="lazy"` attribute and use `data-src` placeholders

### Core Web Vitals (reference only, not measurable from HTML alone)
- Flag potential LCP issues (huge hero images, render-blocking resources)
- Flag potential INP issues (heavy JS, no async/defer)
- Flag potential CLS issues (missing image dimensions, injected content)

## Output

### Page Score Card
```
Overall Score: XX/100

On-Page SEO:     XX/100  ████████░░
Content Quality: XX/100  ██████████
Technical:       XX/100  ███████░░░
Schema:          XX/100  █████░░░░░
Images:          XX/100  ████████░░
```

### Issues Found
Organized by priority: Critical -> High -> Medium -> Low

### Recommendations
Specific, actionable improvements with expected impact

### Schema Suggestions
Ready-to-use JSON-LD code for detected opportunities

## DataForSEO Integration (Optional)

If DataForSEO MCP tools are available, use `serp_organic_live_advanced` for real SERP positions and `backlinks_summary` for backlink data and spam scores.

## Error Handling

| Scenario | Action |
|----------|--------|
| URL unreachable (DNS failure, connection refused) | Report the error clearly. Do not guess page content. Suggest the user verify the URL and try again. |
| Page requires authentication (401/403) | Report that the page is behind authentication. Suggest the user provide the rendered HTML directly or a publicly accessible URL. |
| JavaScript-rendered content (empty body in HTML) | Note that key content may be rendered client-side. Analyze the available HTML and flag that results may be incomplete. Suggest using a browser-rendered snapshot if available. |
