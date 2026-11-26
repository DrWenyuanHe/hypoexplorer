# HypoMap co-detection service

`pnpm run build:hypomap` writes the comparison index next to the browser export it
matches (`data/hypomap/build/<tag>/comparison-index/`; see
[the atlas runbook](../../data/hypomap/README.md)). The service requires Python 3.11+
and NumPy. Keep the index on the service host.

```sh
python3 services/hypomap/comparison_service.py \
  --index-dir /path/to/private-comparison-index \
  --export-dir /path/to/atlas-export
```

Add `--processed-dir /path/to/processed` to also re-verify the index against
the processed source files it was built from.

For the local app, start offline Vite with `VITE_HYPOMAP_COEXPRESSION=1`.
Vite proxies the card's requests to the loopback service. The independent
`VITE_HYPOMAP_EXPRESSION=1` flag enables Spatial and By dataset.

Before enabling co-expression in a hosted build, provision the matching index
and route `/hypomap-preview-api/recommendations` and
`/hypomap-preview-api/compare` to the service's corresponding `/api/` endpoints.
The service binds loopback and returns aggregate counts. A hosted reverse proxy
owns request limits and health checks.

The browser reaches the service only through `src/search/hypomap/codetection.ts`.
Both responses carry `source_export_manifest_sha256`, and the client shows nothing
unless it equals `manifestSha256` in `hypomap-release.json`: the ranking's gene
positions index the static export's search index, so a service built from
another export would name the wrong genes. A comparison names every selected
dataset, either measured or listed in `unsupported` with each gene's feature
state; the client keeps unsupported datasets visible and out of the pooled
counts. `codetection_wire.json` pins this wire on both sides:
`test_comparison_service.py` serves its index and requires the golden responses,
and `src/__tests__/hypomapCodetection.test.ts` feeds them to the client.

```sh
cd services/hypomap && python -m unittest test_comparison_service
```
