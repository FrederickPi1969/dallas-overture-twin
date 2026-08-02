#!/usr/bin/env python3
"""Create the Dallas public-data snapshot used by the React/Cesium front end.

It intentionally combines two portable sources rather than a Dallas-only portal:
1. A raw OSM API bbox snapshot for tagged buildings, streets and amenities.
2. Overture Maps Buildings, queried from public GeoParquet with DuckDB.

Run with the project's data venv:
    .data-venv/bin/python scripts/download_dallas_data.py
"""

from __future__ import annotations

import datetime as dt
import json
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

import duckdb


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "data"
# Compact Downtown Dallas / Arts District study area: west, south, east, north.
BBOX = (-96.8060, 32.7750, -96.7950, 32.7840)
OSM_MAP_API = "https://api.openstreetmap.org/api/0.6/map"
OVERTURE_RELEASE = "2026-06-17.0"
OVERTURE_PATH = f"s3://overturemaps-us-west-2/release/{OVERTURE_RELEASE}/theme=buildings/type=building/*"
UA = "GIS-Learn-Dallas-Overture-Twin/1.0 (research demo)"


def request_xml(url: str) -> ET.Element:
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60) as response:
        return ET.parse(response).getroot()


def feature_collection(features: list[dict[str, Any]]) -> dict[str, Any]:
    return {"type": "FeatureCollection", "features": features}


def polygon(coords: list[list[float]]) -> dict[str, Any] | None:
    if len(coords) < 3:
        return None
    if coords[0] != coords[-1]:
        coords.append(coords[0])
    return {"type": "Polygon", "coordinates": [coords]}


def parse_length(value: str | None) -> float | None:
    if not value:
        return None
    raw = value.strip().lower().replace(",", "")
    try:
        return float(raw)
    except ValueError:
        number = "".join(ch for ch in raw if ch.isdigit() or ch in ".-")
        try:
            meters = float(number)
        except ValueError:
            return None
        return meters * 0.3048 if "ft" in raw or "feet" in raw else meters


def render_height(tags: dict[str, str], default: float = 7.5) -> tuple[float, str]:
    height = parse_length(tags.get("height"))
    if height and 2.0 <= height <= 500.0:
        return round(height, 2), "osm:height"
    try:
        levels = float(tags.get("building:levels", ""))
        if 1 <= levels <= 120:
            return round(levels * 3.2, 2), "osm:building:levels × 3.2m"
    except ValueError:
        pass
    return default, "heuristic (not surveyed)"


def download_osm() -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    west, south, east, north = BBOX
    root = request_xml(f"{OSM_MAP_API}?{urllib.parse.urlencode({'bbox': f'{west},{south},{east},{north}'})}")
    nodes = {node.attrib["id"]: [float(node.attrib["lon"]), float(node.attrib["lat"])] for node in root.findall("node")}
    buildings, streets, amenities = [], [], []
    for node in root.findall("node"):
        tags = {tag.attrib["k"]: tag.attrib["v"] for tag in node.findall("tag")}
        if "amenity" in tags:
            amenities.append({"type": "Feature", "properties": {"osm_id": int(node.attrib["id"]), **tags}, "geometry": {"type": "Point", "coordinates": nodes[node.attrib["id"]]}})
    street_kinds = {"primary", "secondary", "tertiary", "residential", "living_street", "service", "footway", "cycleway"}
    for way in root.findall("way"):
        tags = {tag.attrib["k"]: tag.attrib["v"] for tag in way.findall("tag")}
        coords = [nodes[nd.attrib["ref"]] for nd in way.findall("nd") if nd.attrib["ref"] in nodes]
        if "building" in tags:
            geometry = polygon(coords)
            if geometry:
                height, provenance = render_height(tags)
                buildings.append({"type": "Feature", "properties": {"osm_id": int(way.attrib["id"]), **tags, "render_height_m": height, "height_source": provenance}, "geometry": geometry})
        if tags.get("highway") in street_kinds and len(coords) >= 2:
            streets.append({"type": "Feature", "properties": {"osm_id": int(way.attrib["id"]), **tags}, "geometry": {"type": "LineString", "coordinates": coords}})
    return feature_collection(buildings), feature_collection(streets), feature_collection(amenities)


def download_overture() -> dict[str, Any]:
    west, south, east, north = BBOX
    con = duckdb.connect()
    for statement in ("INSTALL httpfs", "LOAD httpfs", "INSTALL spatial", "LOAD spatial", "SET s3_region='us-west-2'"):
        con.execute(statement)
    rows = con.execute(
        f"""
        SELECT id, height, sources[1].dataset AS primary_source, ST_AsGeoJSON(geometry) AS geometry_json
        FROM read_parquet('{OVERTURE_PATH}', filename=true, hive_partitioning=1)
        WHERE bbox.xmin > {west} AND bbox.xmax < {east}
          AND bbox.ymin > {south} AND bbox.ymax < {north}
        """
    ).fetchall()
    features = []
    for identifier, height, source, geometry_json in rows:
        render = float(height) if height is not None and 2.0 <= float(height) <= 500.0 else 8.0
        provenance = "overture:height" if height is not None else "heuristic (Overture height absent)"
        features.append({"type": "Feature", "properties": {"overture_id": identifier, "primary_source": source or "unknown", "render_height_m": round(render, 2), "height_source": provenance}, "geometry": json.loads(geometry_json)})
    return feature_collection(features)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    osm_buildings, osm_streets, osm_amenities = download_osm()
    overture_buildings = download_overture()
    files = {"osm_buildings.geojson": osm_buildings, "osm_streets.geojson": osm_streets,
             "osm_amenities.geojson": osm_amenities, "overture_buildings.geojson": overture_buildings}
    for name, payload in files.items():
        (OUT / name).write_text(json.dumps(payload, separators=(",", ":")) + "\n")
    west, south, east, north = BBOX
    metadata = {
        "generated_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
        "study_area_wgs84": {"west": west, "south": south, "east": east, "north": north},
        "feature_counts": {"osm_buildings": len(osm_buildings["features"]), "osm_streets": len(osm_streets["features"]), "osm_amenities": len(osm_amenities["features"]), "overture_buildings": len(overture_buildings["features"])},
        "sources": [
            {"name": "OpenStreetMap API map snapshot", "url": OSM_MAP_API, "license": "ODbL; attribute OpenStreetMap contributors"},
            {"name": "Overture Maps Buildings", "url": "https://docs.overturemaps.org/guides/buildings/", "release": OVERTURE_RELEASE, "format": "GeoParquet queried remotely with DuckDB"},
        ],
        "limitations": [
            "This is a compact Downtown Dallas snapshot, not a citywide download.",
            "Building height is used only when supplied by source data; otherwise a visibly labelled display heuristic is used.",
            "Overture upstream provenance is a property, not an accuracy guarantee or surveyed geometry certification.",
        ],
    }
    (OUT / "source_metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
    print(json.dumps(metadata, indent=2))


if __name__ == "__main__":
    main()
