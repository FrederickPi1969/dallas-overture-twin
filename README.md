# Dallas Building Provenance Twin

Independent React + Vite + Cesium front end demonstrating a portable city-data
pattern, not a Dallas-only government portal integration.

## Sources

- Raw OpenStreetMap API snapshot: tagged building outlines, streets, amenities.
- Overture Maps Buildings release `2026-06-17.0`: remotely filtered GeoParquet
  with DuckDB. Each displayed Overture footprint retains its primary source.
- Optional Esri World Elevation terrain in Cesium.

## Refresh the local data bundle

```bash
.data-venv/bin/python scripts/download_dallas_data.py
```

The first Overture run downloads DuckDB `httpfs` and `spatial` extensions. The
query retrieves only the configured Dallas bounding box, not a statewide file.

## Run the front end

```bash
npm install
npm run dev
```

The layer controls compare Overture's fused buildings to the raw OSM snapshot.
Extrusion heights are labelled as source-supplied or heuristic; this is not a
survey-grade city model.
