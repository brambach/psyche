import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: { conditions: ["source"] },
  server: { port: 5173, proxy: { "/api": "http://localhost:8787" } },
});
