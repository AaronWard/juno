/** Upload handling: local audio files are saved under the host-mounted
 *  /uploads directory (Library uploads) or /uploads/midi-src (MIDI tab). */
import fs from "fs";
import path from "path";
import multer from "multer";
import { config } from "./config";

export const ALLOWED_EXT = [".mp3", ".wav", ".m4a", ".ogg", ".flac"];

/** Recover the real UTF-8 filename from a multipart upload.
 *
 *  RFC 7578 leaves the encoding of a `filename` parameter unspecified and
 *  busboy (under multer) decodes it as latin-1. Browsers send UTF-8 bytes, so
 *  `file.originalname` arrives mojibake'd for any non-ASCII name — a Mandarin
 *  title came through as "è©é é  Sa Dingdingã". Re-interpreting those
 *  latin-1 code points as UTF-8 bytes restores the original string.
 *
 *  Only applied when the round-trip is lossless and actually changes something,
 *  so a genuinely latin-1 name is never mangled. */
export function decodeUploadName(originalname: string): string {
  try {
    const bytes = Buffer.from(originalname, "latin1");
    const decoded = bytes.toString("utf8");
    // A failed decode leaves U+FFFD replacement characters — keep the original.
    if (decoded.includes("\uFFFD")) return originalname;
    // Re-encoding must reproduce the exact same bytes for this to be a real
    // UTF-8-read-as-latin-1 case.
    if (!Buffer.from(decoded, "utf8").equals(bytes)) return originalname;
    return decoded;
  } catch {
    return originalname;
  }
}

function makeUpload(dir: () => string, allowed: string[], maxBytes: number) {
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(dir(), { recursive: true });
      cb(null, dir());
    },
    filename: (_req, file, cb) => {
      const clean = decodeUploadName(file.originalname);
      const ext = path.extname(clean).toLowerCase();
      const base =
        path
          .basename(clean, ext)
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
