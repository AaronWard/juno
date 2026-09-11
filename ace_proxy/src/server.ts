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
import { midiManager } from "./midi";
import { modelManager } from "./modelManager";
import { router } from "./routes";

const app = express();
app.use(express.json({ limit: "10mb" }));

// Juno API
app.use("/api", router);

// Local audio: generated library files and user uploads
app.use("/library-audio", express.static(config.libraryDir, { fallthrough: true }));
app.use("/upload-audio", express.static(config.uploadDir, { fallthrough: true }));
// Transcribed / edited MIDI files (cache-busted with ?v= by the API)
app.use(
  "/midi-files",
  express.static(config.midiDir, {
    fallthrough: true,
    setHeaders: (res) => res.setHeader("Content-Type", "audio/midi"),
  })
);

// Built frontend + SPA fallback
const dist = config.webDist;
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get("*", (req, res, next) => {
    // Unknown /api/* routes must 404 as JSON, not return the SPA shell.
    if (req.path.startsWith("/api/")) return next();
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

app.use("/api", (_req, res) => res.status(404).json({ error: "Unknown API route" }));

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
  console.log(`[juno-proxy] LM backend: ${config.lmBackend} · LM: ${config.lmModel}`);
  modelManager.start();
  midiManager.start();
});
