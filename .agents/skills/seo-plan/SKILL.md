---
name: seo-plan
description: >
  Strategic SEO planning for new or existing websites. Industry-specific
  templates, competitive analysis, content strategy, and implementation
  roadmap. Use when user says "SEO plan", "SEO strategy", "SEO planning",
  "content strategy", "keyword strategy", "content calendar",
  "site architecture", or "SEO roadmap".
user-invocable: true
argument-hint: "[business-type]"
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



# Strategic SEO Planning

## Process

### 1. Discovery
- Business type, target audience, competitors, goals
- Current site assessment (if exists)
- Budget and timeline constraints
- Key performance indicators (KPIs)

### 2. Competitive Analysis
- Identify top 5 competitors
- Analyze their content strategy, schema usage, technical setup
- Identify keyword gaps and content opportunities
- Assess their E-E-A-T signals
- Estimate their domain authority

### 3. Architecture Design
- Load industry template from `assets/` directory
- Design URL hierarchy and content pillars
- Plan internal linking strategy
- Sitemap structure with quality gates applied
- Information architecture for user journeys

### 4. Content Strategy
- Content gaps vs competitors
- Page types and estimated counts
- Blog/resource topics and publishing cadence
- E-E-A-T building plan (author bios, credentials, experience signals)
- Content calendar with priorities

### 5. Technical Foundation
- Hosting and performance requirements
- Schema markup plan per page type
- Core Web Vitals baseline targets
- AI search readiness requirements
- Mobile-first considerations

### 6. Implementation Roadmap (4 phases)

#### Phase 1: Foundation (weeks 1-4)
- Technical setup and infrastructure
- Core pages (home, about, contact, main services)
- Essential schema implementation
- Analytics and tracking setup

#### Phase 2: Expansion (weeks 5-12)
- Content creation for primary pages
- Blog launch with initial posts
- Internal linking structure
- Local SEO setup (if applicable)

#### Phase 3: Scale (weeks 13-24)
- Advanced content development
- Link building and outreach
- GEO optimization
- Performance optimization

#### Phase 4: Authority (months 7-12)
- Thought leadership content
- PR and media mentions
- Advanced schema implementation
- Continuous optimization

## Industry Templates

Load from `assets/` directory:
- `saas.md`: SaaS/software companies
- `local-service.md`: Local service businesses
- `ecommerce.md`: E-commerce stores
- `publisher.md`: Content publishers/media
- `agency.md`: Agencies and consultancies
- `generic.md`: General business template

## Output

### Deliverables
- `SEO-STRATEGY.md`: Complete strategic plan
- `COMPETITOR-ANALYSIS.md`: Competitive insights
- `CONTENT-CALENDAR.md`: Content roadmap
- `IMPLEMENTATION-ROADMAP.md`: Phased action plan
- `SITE-STRUCTURE.md`: URL hierarchy and architecture

### KPI Targets
| Metric | Baseline | 3 Month | 6 Month | 12 Month |
|--------|----------|---------|---------|----------|
| Organic Traffic | ... | ... | ... | ... |
| Keyword Rankings | ... | ... | ... | ... |
| Domain Authority | ... | ... | ... | ... |
| Indexed Pages | ... | ... | ... | ... |
| Core Web Vitals | ... | ... | ... | ... |

### Success Criteria
- Clear, measurable goals per phase
- Resource requirements defined
- Dependencies identified
- Risk mitigation strategies

## DataForSEO Integration (Optional)

If DataForSEO MCP tools are available, use `dataforseo_labs_google_competitors_domain` and `dataforseo_labs_google_domain_intersection` for real competitive intelligence, `dataforseo_labs_bulk_traffic_estimation` for traffic estimates, `kw_data_google_ads_search_volume` and `dataforseo_labs_bulk_keyword_difficulty` for keyword research, and `business_data_business_listings_search` for local business data.

## Error Handling

| Scenario | Action |
|----------|--------|
| Unrecognized business type | Fall back to `generic.md` template. Inform user that no industry-specific template was found and proceed with the general business template. |
| No website URL provided | Proceed with new-site planning mode. Skip current site assessment and competitive gap analysis that require a live URL. |
| Industry template not found | Check `assets/` directory for available templates. If the requested template file is missing, use `generic.md` and note the missing template in output. |
