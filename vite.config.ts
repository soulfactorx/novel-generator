import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { readFileSync } from "node:fs";

const version = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version as string;

export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: { target: "es2022", outDir: "dist" },
  test: { environment: "node" },
});
