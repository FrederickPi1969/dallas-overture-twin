import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import cesium from "vite-plugin-cesium";

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? "/dallas-overture-twin/" : "/",
  plugins: [react(), cesium()],
});
