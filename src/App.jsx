import { useEffect, useRef, useState } from "react";
import * as Cesium from "cesium";

const DATA_ROOT = `${import.meta.env.BASE_URL}data/`;
const DATA = {
  overture: `${DATA_ROOT}overture_buildings.geojson`,
  metadata: `${DATA_ROOT}source_metadata.json`,
};

const FIXED_CAMERA = {
  destination: Cesium.Cartesian3.fromDegrees(-96.8005, 32.7798, 1900),
  orientation: { heading: Cesium.Math.toRadians(-12), pitch: Cesium.Math.toRadians(-49), roll: 0 },
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
  const imageryRef = useRef(null);
  const viewerRef = useRef(null);
  const [counts, setCounts] = useState(null);
  const [status, setStatus] = useState("Loading local data snapshot…");
  const [visible, setVisible] = useState({ naip: false });

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
      requestRenderMode: true,
      maximumRenderTimeChange: Infinity,
      baseLayer: new Cesium.ImageryLayer(new Cesium.OpenStreetMapImageryProvider({ url: "https://tile.openstreetmap.org/" })),
    });
    viewerRef.current = viewer;
    const controls = viewer.scene.screenSpaceCameraController;
    // Preserve normal mouse/trackpad navigation, but eliminate all post-input drift.
    controls.enableInputs = true;
    controls.enableRotate = true;
    controls.enableTranslate = true;
    controls.enableZoom = true;
    controls.enableTilt = true;
    controls.enableLook = true;
    controls.inertiaSpin = 0;
    controls.inertiaTranslate = 0;
    controls.inertiaZoom = 0;
    viewer.camera.setView(FIXED_CAMERA);

    async function init() {
      try {
        const [metadata, overture] = await Promise.all([
          fetch(DATA.metadata).then((response) => response.json()),
          Cesium.GeoJsonDataSource.load(DATA.overture),
        ]);
        if (disposed) return;
        viewer.dataSources.add(overture);

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

        setCounts(metadata);
        setStatus(`Fixed camera · ${metadata.feature_counts.overture_buildings.toLocaleString()} Overture buildings · lightweight render mode.`);
        viewer.scene.requestRender();
      } catch (error) {
        if (!disposed) setStatus(`Load failed: ${error.message}`);
      }
    }
    init();
    return () => {
      disposed = true;
      viewer.destroy();
    };
  }, []);

  function toggleNaip(nextValue) {
    setVisible({ naip: nextValue });
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (nextValue && !imageryRef.current) {
      imageryRef.current = viewer.imageryLayers.addImageryProvider(new Cesium.WebMapServiceImageryProvider({
        url: "https://imagery.nationalmap.gov/arcgis/services/USGSNAIPImagery/ImageServer/WMSServer",
        layers: "USGSNAIPImagery",
        parameters: { service: "WMS", version: "1.3.0", format: "image/png", transparent: false },
        crs: "EPSG:3857",
      }));
    } else if (imageryRef.current) {
      imageryRef.current.show = nextValue;
    }
    viewer.scene.requestRender();
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <p className="eyebrow">REUSABLE PUBLIC-DATA PIPELINE</p>
        <h1>Dallas Building<br /><em>Provenance Twin</em></h1>
        <p className="lede">固定镜头的 Downtown Dallas 约 1 × 1 km study area：OSM 原始要素 × Overture Maps 融合建筑数据。</p>
        <section className="metrics">
          <Metric label="Overture buildings" value={counts?.feature_counts.overture_buildings} />
          <Metric label="Raw OSM buildings" value={counts?.feature_counts.osm_buildings} />
          <Metric label="OSM streets" value={counts?.feature_counts.osm_streets} />
          <Metric label="OSM amenities" value={counts?.feature_counts.osm_amenities} />
        </section>
        <section><h2>View mode</h2>
          <p className="small">Camera starts framed on the study area. Mouse and trackpad navigation remain enabled, but all Cesium inertial drift is set to zero. The OSM counts above are provenance metadata, not live scene entities.</p>
          <Toggle label="USGS NAIP aerial imagery (on-demand)" checked={visible.naip} onChange={toggleNaip} />
        </section>
        <section><h2>Imagery base</h2>
          <p className="small">Stable default: OSM base. Turn on USGS NAIP only when examining rooftops; it is public, high-resolution aerial imagery and is intentionally opt-in to keep the fixed scene responsive.</p>
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
