/** Upload handling: local audio files are saved under the host-mounted
 *  /uploads directory and registered as Library records. */
import fs from "fs";
import path from "path";
import multer from "multer";
import { config } from "./config";

export const ALLOWED_EXT = [".mp3", ".wav", ".m4a", ".ogg", ".flac"];

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdirSync(config.uploadDir, { recursive: true });
    cb(null, config.uploadDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const base = path
      .basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9-_ ]/g, "")
      .slice(0, 64) || "upload";
    cb(null, `${Date.now()}_${base}${ext}`);
  },
});

export const upload = multer({
  storage,
  limits: { fileSize: 512 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      cb(new Error(`Unsupported file type "${ext}". Supported: ${ALLOWED_EXT.join(", ")}`));
      return;
    }
    cb(null, true);
  },
});
