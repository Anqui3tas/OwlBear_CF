import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react()],
    assetsInclude: ["**/*.bin", "**/*.dds", "**/*.glb"],
    resolve: {
      alias: {
        events: "events",
        fs: path.resolve(__dirname, "src/shims/empty.ts"),
        path: "path-browserify",
      },
    },
    build: {
      outDir: "build",
    },
    define: {
      __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? ""),
      __BROKER_URL__: JSON.stringify(
        env.VITE_BROKER_URL ?? env.REACT_APP_BROKER_URL ?? ""
      ),
      __MAINTENANCE__: JSON.stringify(
        env.VITE_MAINTENANCE ?? env.REACT_APP_MAINTENANCE ?? "false"
      ),
    },
  };
});
