import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: { "/api": "http://localhost:8787" },
    allowedHosts: [".loca.lt"], // localtunnel, for the Shopee OAuth redirect in dev
  },
});
