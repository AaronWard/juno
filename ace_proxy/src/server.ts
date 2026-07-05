/** Juno web/proxy server.
 *
 *  - Serves the built React frontend (web/dist) on port 3000.
 *  - Exposes the Juno API under /api (see routes.ts).
 *  - Serves generated audio from /outputs/library and uploads from /uploads
 *    so the browser can play local files directly.
 */
import express from "express";
import fs from "fs";
import path from "path";
import { config } from "./config";
import { router } from "./routes";

const app = express();
app.use(express.json({ limit: "10mb" }));

// Juno API
app.use("/api", router);

// Local audio: generated library files and user uploads
app.use("/library-audio", express.static(config.libraryDir, { fallthrough: true }));
app.use("/upload-audio", express.static(config.uploadDir, { fallthrough: true }));

// Built frontend + SPA fallback
const dist = config.webDist;
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(dist, "index.html"));
  });
} else {
  app.get("*", (_req, res) => {
    res
      .status(503)
      .send(
        "Juno frontend build not found. Run `npm run build` in web/ or use Docker."
      );
  });
}

// Central error handler (uploads, JSON parse errors, etc.)
app.use(
  (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("[juno-proxy]", err?.message || err);
    res.status(400).json({ error: err?.message || "Request failed" });
  }
);

app.listen(config.webPort, "0.0.0.0", () => {
  console.log(`[juno-proxy] listening on http://0.0.0.0:${config.webPort}`);
  console.log(`[juno-proxy] ACE-Step API: ${config.aceApiUrl}`);
  console.log(`[juno-proxy] outputs: ${config.outputDir}`);
  console.log(`[juno-proxy] uploads: ${config.uploadDir}`);
  console.log(`[juno-proxy] data: ${config.dataDir}`);
});
