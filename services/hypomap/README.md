# HypoMap co-detection service

Generate the comparison index using the matching HypoMap exporter in the data repository. The service requires Python 3.11+ and NumPy. Keep the index on the service host.

```sh
python3 services/hypomap/comparison_service.py \
  --index-dir /path/to/private-comparison-index \
  --export-dir /path/to/atlas-export
```

For the local app, start offline Vite with `VITE_HYPOMAP_COEXPRESSION=1`.
Vite proxies the card's requests to the loopback service. The independent
`VITE_HYPOMAP_EXPRESSION=1` flag enables Spatial and By dataset.

Before enabling co-expression in a hosted build, provision the matching index
and route `/hypomap-preview-api/recommendations` and
`/hypomap-preview-api/compare` to the service's corresponding `/api/` endpoints.
The service binds loopback and returns aggregate counts. A hosted reverse proxy
owns request limits and health checks.
