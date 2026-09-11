/** Upload handling: local audio files are saved under the host-mounted
 *  /uploads directory (Library uploads) or /uploads/midi-src (MIDI tab). */
import fs from "fs";
import path from "path";
import multer from "multer";
import { config } from "./config";

export const ALLOWED_EXT = [".mp3", ".wav", ".m4a", ".ogg", ".flac"];

function makeUpload(dir: () => string, allowed: string[], maxBytes: number) {
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(dir(), { recursive: true });
      cb(null, dir());
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const base =
        path
          .basename(file.originalname, ext)
          .replace(/[^a-zA-Z0-9-_ ]/g, "")
          .slice(0, 64) || "upload";
      cb(null, `${Date.now()}_${base}${ext}`);
    },
  });
  return multer({
    storage,
    limits: { fileSize: maxBytes },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (!allowed.includes(ext)) {
        cb(new Error(`Unsupported file type "${ext}". Supported: ${allowed.join(", ")}`));
        return;
      }
      cb(null, true);
    },
  });
}

export const upload = makeUpload(() => config.uploadDir, ALLOWED_EXT, 512 * 1024 * 1024);
export const midiSourceUpload = makeUpload(() => config.midiSourceDir, ALLOWED_EXT, 512 * 1024 * 1024);
