# Full-dataset agent export

`pnpm run build:agent-export` writes one ZIP holding every registered dataset's
results as plain CSV and JSON. A visitor can unpack it and point a local AI
agent (Claude Code, Codex and others) at the folder. The archive carries its own
`README.md` (schemas and interpretation rules), `AGENTS.md`, `CLAUDE.md`,
`LICENSE-DATA.md` and `manifest.json`, so an agent needs neither the app nor
this repository.

## What it reads and writes

- **Reads** the published bundles under `public/datasets/` through the strict
  contrast rules in `src/data/rawTrack.ts` (the same ones the query index
  uses), plus the registry (`src/data/datasets.ts`), quality decisions,
  upstream-processing records, `data/seo/studySources.json`,
  `data/nomenclature/nomenclature.tsv` and `CITATION.cff`.
- **Writes** `dist-export/hypoexplorer-data-v<version>.zip` and its `.sha256`
  (git-ignored). It never writes under `public/` and does not touch the bundle
  pipeline, the query index or the R2 data host.
- Values carry the bundles' rounding. The archive README points to the
  full-precision tables in `data/raw/results/` and `geo_replication/`.

The archive and the column contracts live in
[`scripts/build_agent_export.mts`](../scripts/build_agent_export.mts) and
[`scripts/lib/agentExport.mts`](../scripts/lib/agentExport.mts). The contract
test is `src/__tests__/agentExport.test.ts`.

## Options

| Option | Effect |
| --- | --- |
| `--datasets a,b` | Build a subset; the archive is named `-subset` and its README says so. |
| `--out <dir>` | Output directory (default `dist-export/`). Existing archives are never overwritten. |
| `--unpacked` | Also write the unpacked folder next to the ZIP. |
| `--no-zip` | Skip the ZIP (use with `--unpacked`). |
| `--kegg full\|stats\|omit` | KEGG rows: `full` (default) keeps leading edges; `stats` keeps NES/p/padj/size but empties `leading_edge`; `omit` drops KEGG rows. |

## Reproducibility

Entries are written in a fixed order with a fixed timestamp. `manifest.json`
records the SHA-256 of every file's uncompressed bytes together with the source
commit, so the same commit and options give the same manifest. With the same
Node/zlib build they also give the same ZIP bytes, and the contract test checks
this. A full build reads about 1.1 GB of bundles and takes about 1.5 minutes.

## Licensing decisions (2026-11-02)

- HypoExplorer's contributions are CC BY 4.0, as in [REUSE.md](../REUSE.md).
  Source studies, gene sets and nomenclature keep their own terms, which
  `LICENSE-DATA.md` lists.
- **KEGG.** All `KEGG_*` pathways are MSigDB KEGG_LEGACY sets, which MSigDB
  provides under license to the Broad Institute and conditions on keeping the
  Kanehisa copyright notice. The owner chose to ship them in full with that
  notice, because the site already serves the same leading edges publicly.
  KEGG is excluded from the CC BY grant. If Kanehisa or a reviewer objects,
  rebuild with `--kegg stats` or `--kegg omit`.

## Publishing on Zenodo

The archive carries the full analysis tables that the public source repository
leaves out, so it is deposited on Zenodo directly rather than through a GitHub release. These are operator steps; nothing in the
repository uploads.

1. Build from a clean, committed tree: `pnpm run build:agent-export`. Confirm
   `manifest.json` has `"source_dirty": false`.
2. Create a new Zenodo upload (type *Dataset*). Attach the ZIP and its
   `.sha256`. Use the title "HypoExplorer data export v<version>", list Wenyuan He as
   creator and choose the license **Creative Commons Attribution 4.0**. In the
   description, say that the KEGG gene sets and the source studies carry
   separate terms (copy the "Gene-set collections" section of
   `LICENSE-DATA.md`). Optionally reserve the DOI before publishing.
3. Publish, then set `DATA_EXPORT_DOI` in `src/data/siteInfo.ts` to the
   **concept** DOI (it resolves to the latest version). The methods page
   (`/methods/#full-dataset`) then links it. Rebuild and deploy the site.
4. For a new data release, add a new version to the same Zenodo record so the
   concept DOI stays stable.

No WAF, rate-limit or spend-guard change is needed, because the archive is not
served from `data.hypoexplorer.com`.
