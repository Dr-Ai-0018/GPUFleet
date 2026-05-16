import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = env.VITE_API_TARGET || "http://127.0.0.1:8011";
  return {
    base: "/console/",
    plugins: [react()],
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            three: ["three", "@react-three/fiber", "@react-three/drei"],
            motion: ["motion"],
          },
        },
      },
    },
    server: {
      port: 5173,
      host: "127.0.0.1",
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: false,
        },
      },
    },
  };
});
