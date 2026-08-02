import { useEffect, useRef, useState } from "react";
import * as Cesium from "cesium";

const DATA_ROOT = `${import.meta.env.BASE_URL}data/`;
const DATA = {
  overture: `${DATA_ROOT}overture_buildings.geojson`,
  osmBuildings: `${DATA_ROOT}osm_buildings.geojson`,
  osmStreets: `${DATA_ROOT}osm_streets.geojson`,
  amenities: `${DATA_ROOT}osm_amenities.geojson`,
  metadata: `${DATA_ROOT}source_metadata.json`,
};

const DATASET_COLORS = {
  OpenStreetMap: "#49b9ff",
  "Microsoft ML Buildings": "#ffb347",
  "Esri Community Maps": "#c792ea",
  fallback: "#f3f5f7",
};

function displaySource(value) {
  return value || "unknown upstream source";
}

function property(entity, name) {
  const field = entity.properties && entity.properties[name];
  return field ? field.getValue(Cesium.JulianDate.now()) : undefined;
}

export default function App() {
  const containerRef = useRef(null);
  const layersRef = useRef({});
  const terrainRef = useRef(null);
  const viewerRef = useRef(null);
  const [counts, setCounts] = useState(null);
  const [status, setStatus] = useState("Loading local data snapshot…");
  const [visible, setVisible] = useState({ overture: true, osmBuildings: true, osmStreets: true, amenities: false, terrain: true });

  useEffect(() => {
    let disposed = false;
    const viewer = new Cesium.Viewer(containerRef.current, {
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      infoBox: true,
      selectionIndicator: true,
      baseLayer: new Cesium.ImageryLayer(new Cesium.OpenStreetMapImageryProvider({ url: "https://tile.openstreetmap.org/" })),
    });
    viewerRef.current = viewer;
    viewer.scene.globe.enableLighting = true;
    viewer.scene.highDynamicRange = true;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(-96.8005, 32.7798, 1900),
      orientation: { heading: Cesium.Math.toRadians(-12), pitch: Cesium.Math.toRadians(-49), roll: 0 },
      duration: 0,
    });

    async function init() {
      try {
        const [metadata, overture, osmBuildings, osmStreets, amenities] = await Promise.all([
          fetch(DATA.metadata).then((response) => response.json()),
          Cesium.GeoJsonDataSource.load(DATA.overture),
          Cesium.GeoJsonDataSource.load(DATA.osmBuildings),
          Cesium.GeoJsonDataSource.load(DATA.osmStreets),
          Cesium.GeoJsonDataSource.load(DATA.amenities),
        ]);
        if (disposed) return;
        [overture, osmBuildings, osmStreets, amenities].forEach((layer) => viewer.dataSources.add(layer));
        layersRef.current = { overture, osmBuildings, osmStreets, amenities };

        overture.entities.values.forEach((entity) => {
          if (!entity.polygon) return;
          const source = displaySource(property(entity, "primary_source"));
          const height = Number(property(entity, "render_height_m")) || 8;
          entity.polygon.material = Cesium.Color.fromCssColorString(DATASET_COLORS[source] || DATASET_COLORS.fallback).withAlpha(0.76);
          entity.polygon.outline = true;
          entity.polygon.outlineColor = Cesium.Color.WHITE.withAlpha(0.32);
          entity.polygon.extrudedHeight = height;
          entity.polygon.height = 0;
          entity.polygon.perPositionHeight = false;
          entity.name = `Overture building · ${Math.round(height)} m`;
          entity.description = `<table class="cesium-infoBox-defaultTable"><tbody>
            <tr><th>Dataset</th><td>Overture Maps Buildings</td></tr>
            <tr><th>Primary source</th><td>${source}</td></tr>
            <tr><th>Height</th><td>${height} m</td></tr>
            <tr><th>Height provenance</th><td>${property(entity, "height_source") || "not supplied"}</td></tr>
            <tr><th>Overture ID</th><td>${property(entity, "overture_id") || "unknown"}</td></tr>
          </tbody></table>`;
        });

        osmBuildings.entities.values.forEach((entity) => {
          if (!entity.polygon) return;
          const height = Number(property(entity, "render_height_m")) || 7.5;
          entity.polygon.material = Cesium.Color.fromCssColorString("#1f78b4").withAlpha(0.12);
          entity.polygon.outline = true;
          entity.polygon.outlineColor = Cesium.Color.fromCssColorString("#78d4ff").withAlpha(0.95);
          entity.polygon.extrudedHeight = height + 0.25;
          entity.polygon.height = 0;
          entity.name = `Raw OSM building · ${Math.round(height)} m`;
          entity.description = `<table class="cesium-infoBox-defaultTable"><tbody>
            <tr><th>Dataset</th><td>Raw OSM API snapshot</td></tr>
            <tr><th>Height</th><td>${height} m</td></tr>
            <tr><th>Height provenance</th><td>${property(entity, "height_source") || "unknown"}</td></tr>
            <tr><th>OSM ID</th><td>${property(entity, "osm_id") || "unknown"}</td></tr>
          </tbody></table>`;
        });

        osmStreets.entities.values.forEach((entity) => {
          if (!entity.polyline) return;
          const kind = property(entity, "highway");
          const major = ["primary", "secondary", "tertiary"].includes(kind);
          entity.polyline.material = (major ? Cesium.Color.fromCssColorString("#f4cc70") : Cesium.Color.fromCssColorString("#d7e1e8")).withAlpha(major ? 0.92 : 0.46);
          entity.polyline.width = major ? 2.5 : 1.0;
          entity.polyline.clampToGround = true;
        });
        amenities.entities.values.forEach((entity) => {
          entity.point = new Cesium.PointGraphics({ pixelSize: 6, color: Cesium.Color.fromCssColorString("#ff6b9d"), outlineColor: Cesium.Color.WHITE, outlineWidth: 1 });
          entity.name = `OSM amenity · ${property(entity, "amenity") || "unknown"}`;
        });
        setCounts(metadata);
        setStatus(`Loaded ${metadata.feature_counts.overture_buildings.toLocaleString()} Overture buildings with source provenance.`);

        try {
          const naip = await Cesium.ArcGisMapServerImageryProvider.fromUrl(
            "https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer",
          );
          if (!disposed) {
            // Replace the temporary OSM base with downloadable, analysis-permitted US public imagery.
            viewer.imageryLayers.removeAll(true);
            viewer.imageryLayers.addImageryProvider(naip);
          }
        } catch (error) {
          if (!disposed) setStatus((previous) => `${previous} NAIP imagery unavailable; using OSM fallback.`);
        }

        try {
          terrainRef.current = await Cesium.ArcGISTiledElevationTerrainProvider.fromUrl(
            "https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer",
          );
          if (!disposed) viewer.terrainProvider = terrainRef.current;
        } catch (error) {
          if (!disposed) setStatus((previous) => `${previous} Public terrain unavailable: ${error.message}`);
        }
      } catch (error) {
        if (!disposed) setStatus(`Load failed: ${error.message}`);
      }
    }
    init();
    return () => { disposed = true; viewer.destroy(); };
  }, []);

  function changeLayer(name, nextValue) {
    setVisible((current) => ({ ...current, [name]: nextValue }));
    if (name === "terrain") {
      const viewer = viewerRef.current;
      if (viewer) viewer.terrainProvider = nextValue && terrainRef.current ? terrainRef.current : new Cesium.EllipsoidTerrainProvider();
    } else if (layersRef.current[name]) {
      layersRef.current[name].show = nextValue;
    }
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <p className="eyebrow">REUSABLE PUBLIC-DATA PIPELINE</p>
        <h1>Dallas Building<br /><em>Provenance Twin</em></h1>
        <p className="lede">不是某个城市政府的专属接口，而是 OSM 原始要素 × Overture Maps 融合建筑数据的可迁移样例。</p>
        <section className="metrics">
          <Metric label="Overture buildings" value={counts?.feature_counts.overture_buildings} />
          <Metric label="Raw OSM buildings" value={counts?.feature_counts.osm_buildings} />
          <Metric label="OSM streets" value={counts?.feature_counts.osm_streets} />
          <Metric label="OSM amenities" value={counts?.feature_counts.osm_amenities} />
        </section>
        <section><h2>Layers</h2>
          <Toggle label="Overture extruded buildings" checked={visible.overture} onChange={(v) => changeLayer("overture", v)} />
          <Toggle label="Raw OSM building outlines" checked={visible.osmBuildings} onChange={(v) => changeLayer("osmBuildings", v)} />
          <Toggle label="OSM street network" checked={visible.osmStreets} onChange={(v) => changeLayer("osmStreets", v)} />
          <Toggle label="OSM amenities" checked={visible.amenities} onChange={(v) => changeLayer("amenities", v)} />
          <Toggle label="Public terrain" checked={visible.terrain} onChange={(v) => changeLayer("terrain", v)} />
        </section>
        <section><h2>Imagery base</h2>
          <p className="small">USGS NAIP public orthophoto (usually 60 cm-class in Texas where available). It is aerial imagery, intentionally chosen over Google imagery so the same source can support CV and data export workflows.</p>
        </section>
        <section><h2>Provenance legend</h2>
          <p className="legend"><i className="dot osm" /> OpenStreetMap in Overture</p>
          <p className="legend"><i className="dot microsoft" /> Microsoft ML Buildings in Overture</p>
          <p className="legend"><i className="dot other" /> another Overture upstream source</p>
          <p className="small">Blue wireframes are the locally downloaded raw OSM snapshot. Click a building to inspect height and source provenance. Heights remain attributes/heuristics, not survey truth.</p>
        </section>
        <section className="sources"><h2>Data</h2>
          <a href="https://docs.overturemaps.org/guides/buildings/" target="_blank" rel="noreferrer">Overture Buildings · GeoParquet release</a>
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors · ODbL</a>
          <a href="https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer" target="_blank" rel="noreferrer">USGS / USDA NAIP public orthophoto</a>
        </section>
        <p className="status">{status}</p>
      </aside>
      <section className="map"><div ref={containerRef} className="cesium" /></section>
    </main>
  );
}

function Metric({ label, value }) { return <div><strong>{value == null ? "—" : value.toLocaleString()}</strong><span>{label}</span></div>; }
function Toggle({ label, checked, onChange }) { return <label className="toggle"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span>{label}</span></label>; }
