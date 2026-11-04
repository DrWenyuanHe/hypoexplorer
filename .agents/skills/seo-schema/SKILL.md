---
name: seo-schema
description: >
  Detect, validate, or generate Schema.org JSON-LD for a supplied page or
  entity. Use only when structured data or rich-result markup is requested.
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



# Schema Markup Analysis & Generation

## Detection

1. Extract JSON-LD with `python scripts/seo_runtime.py run parse_html.py --url <url> --json`
   (or scan `<script type="application/ld+json">` in the page source). Flag any
   block without `@context` or `@type`: Google cannot attach it to an entity (a
   rating in such a block does not reach the Product).
2. Check for Microdata (`itemscope`, `itemprop`)
3. Check for RDFa (`typeof`, `property`)
4. Always recommend JSON-LD as primary format (Google's stated preference)

## Validation

- Check required properties per schema type
- Validate against Google's supported rich result types
- Test for common errors:
  - Missing @context
  - Invalid @type
  - Wrong data types
  - Placeholder text
  - Relative URLs (should be absolute)
  - Invalid date formats
- Flag deprecated types (see below)

## Schema Type Status (as of June 2026)

Read `../seo/references/schema-types.md` for the full list. Key rules:

### ACTIVE (recommend freely):
Organization, LocalBusiness, SoftwareApplication, WebApplication, Product (with Certification markup as of April 2025), ProductGroup, Offer, Service, Article, BlogPosting, NewsArticle, Review, AggregateRating, BreadcrumbList, WebSite, WebPage, Person, ProfilePage, ContactPage, VideoObject, ImageObject, Event, JobPosting, Course, DiscussionForumPosting

### VIDEO & SPECIALIZED (recommend freely):
BroadcastEvent, Clip, SeekToAction, SoftwareSourceCode

See `schema/templates.json` for ready-to-use JSON-LD templates for these types.

> **JSON-LD and JavaScript rendering:** Google supports structured data generated with JavaScript, but its "Generate structured data with JavaScript" guide (last updated 2025-12-10) warns that dynamically generated Product markup can make Shopping crawls less frequent and less reliable for fast-changing price and availability. For time-sensitive markup (especially Product, Offer), include JSON-LD in the initial server-rendered HTML.

### NO RICH RESULTS, KEEP IF USEFUL:
- **FAQPage**: Google retired FAQ rich results for ALL sites on May 7, 2026 (supersedes the Aug 2023 gov/health restriction). No Google SERP rich-result benefit; flag existing FAQPage at Info (not Critical) rather than removal. For genuine user Q&A pages, use **QAPage**.

### DEPRECATED (never recommend):
- **HowTo**: Rich results removed September 2023
- **SpecialAnnouncement**: Deprecated July 31, 2025
- **CourseInfo, EstimatedSalary, LearningVideo**: Retired June 2025
- **ClaimReview**: No Search rich result since June 2025. Google's Fact Check Explorer still uses the markup, so fact-checking publishers may keep it; never recommend it for SERP features
- **VehicleListing**: Retired from rich results June 2025
- **Practice Problem**: Deprecation notice 2025-11-05; tooling support removed starting January 2026; documentation removed 2026-01-06
- Search Console / Rich Results Test / appearance-filter support for CourseInfo, ClaimReview, EstimatedSalary, LearningVideo, SpecialAnnouncement, VehicleListing was removed 2025-09-09 (Search Console API through December 2025).

### Still supported (despite earlier phase-out notices):
- **Book Actions**: NOT deprecated. The June 2025 phase-out banner was removed on 2025-11-05 because a Search feature still uses the markup.

### Supported for Dataset Search only:
- **Dataset**: Not discontinued; consumed by Google Dataset Search, with no Google Search rich-result surface. Don't advise removal as if it were killed.

### Still supported (do not flag):
- QAPage (expanded comment-thread properties 2026-03-24), DiscussionForumPosting, Education Q&A (Quiz / `eduQuestionType=Flashcard`). For e-commerce, **hasAdultConsideration** (added 2026-05-20; value `https://schema.org/SexualContentConsideration`) is required for adult products. `Product.category` accepts `Text`, `CategoryCode`, or arrays mixing both.

## Generation

When generating schema for a page:
1. Identify page type from content analysis
2. Select appropriate schema type(s)
3. Generate valid JSON-LD with all required + recommended properties
4. Include only truthful, verifiable data. Use placeholders clearly marked for user to fill
5. Validate output before presenting
6. For review markup, reject fake reviews and undisclosed incentivized reviews.
   An incentive must be clearly and prominently disclosed on the page.

## Common Schema Templates

### Organization
```json
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "[Company Name]",
  "url": "[Website URL]",
  "logo": "[Logo URL]",
  "contactPoint": {
    "@type": "ContactPoint",
    "telephone": "[Phone]",
    "contactType": "customer service"
  },
  "sameAs": [
    "[Facebook URL]",
    "[LinkedIn URL]",
    "[Twitter URL]"
  ]
}
```

### LocalBusiness
```json
{
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "name": "[Business Name]",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "[Street]",
    "addressLocality": "[City]",
    "addressRegion": "[State]",
    "postalCode": "[ZIP]",
    "addressCountry": "US"
  },
  "telephone": "[Phone]",
  "openingHours": "Mo-Fr 09:00-17:00",
  "geo": {
    "@type": "GeoCoordinates",
    "latitude": "[Lat]",
    "longitude": "[Long]"
  }
}
```

### Article/BlogPosting
```json
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "[Title]",
  "author": {
    "@type": "Person",
    "name": "[Author Name]"
  },
  "datePublished": "[YYYY-MM-DD]",
  "dateModified": "[YYYY-MM-DD]",
  "image": "[Image URL]",
  "publisher": {
    "@type": "Organization",
    "name": "[Publisher]",
    "logo": {
      "@type": "ImageObject",
      "url": "[Logo URL]"
    }
  }
}
```

## Output

- `SCHEMA-REPORT.md`: detection and validation results
- `generated-schema.json`: ready-to-use JSON-LD snippets

### Validation Results
| Schema | Type | Status | Issues |
|--------|------|--------|--------|
| ... | ... | ✅/⚠️/❌ | ... |

### Recommendations
- Missing schema opportunities
- Validation fixes needed
- Generated code for implementation

## Error Handling

| Scenario | Action |
|----------|--------|
| URL unreachable | Report connection error with status code. Suggest verifying URL and checking if the page requires authentication. |
| No schema markup found | Report that no JSON-LD, Microdata, or RDFa was detected. Recommend appropriate schema types based on page content analysis. |
| Invalid JSON-LD syntax | Parse and report specific syntax errors (missing brackets, trailing commas, unquoted keys). Provide corrected JSON-LD output. |
| Deprecated schema type detected | Flag the deprecated type with its retirement date. Recommend the current replacement type or advise removal if no replacement exists. |
