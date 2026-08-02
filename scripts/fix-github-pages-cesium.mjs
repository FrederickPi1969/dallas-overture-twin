import { existsSync, renameSync, rmSync } from "node:fs";
import { resolve } from "node:path";

// vite-plugin-cesium follows Vite's `base` while copying files, which places
// them under dist/dallas-overture-twin/cesium. GitHub Pages already removes
// that URL prefix when mapping to the uploaded artifact, so Cesium must live
// directly at dist/cesium.
const nestedCesium = resolve("dist/dallas-overture-twin/cesium");
const publicCesium = resolve("dist/cesium");

if (existsSync(nestedCesium)) {
  rmSync(publicCesium, { recursive: true, force: true });
  renameSync(nestedCesium, publicCesium);
}
