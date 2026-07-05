import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev-mode proxy so `npm run dev` in web/ can talk to a locally running
// ace_proxy (port 3000) without CORS. In production the proxy serves dist/.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:3000",
      "/library-audio": "http://127.0.0.1:3000",
      "/upload-audio": "http://127.0.0.1:3000"
    }
  },
  build: { outDir: "dist" }
});
