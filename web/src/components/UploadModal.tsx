import React, { useRef, useState } from "react";
import { Modal } from "./Modal";
import { Button } from "./Button";
import { api } from "../lib/api";
import { useJuno } from "../App";
import { Song } from "../data/mockSongs";
import { newId } from "../lib/ids";

const ACCEPT = ".mp3,.wav,.m4a,.ogg,.flac";

/** Upload Audio modal (DESIGN_DOC §18): drag & drop or file picker.
 *  Files are POSTed to /api/upload (stored under host-mounted /uploads).
 *  If the proxy is unreachable, a local blob-URL asset keeps the flow
 *  working for the session. */
export function UploadModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { addSong, addHistoryEvent, activeWorkspaceId } = useJuno();
  const [file, setFile] = useState<File | null>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const validate = (f: File): string | null => {
    const ok = ACCEPT.split(",").some((ext) => f.name.toLowerCase().endsWith(ext));
    return ok ? null : `Unsupported file type. Supported: MP3, WAV, M4A, OGG, FLAC`;
  };

  const pick = (f: File | null) => {
    if (!f) return;
    const v = validate(f);
    setErr(v);
    setFile(v ? null : f);
  };

  const doImport = async () => {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await api.upload(file);
      addSong({ ...res.asset, workspaceId: activeWorkspaceId });
      addHistoryEvent(`Uploaded "${file.name}"`);
      setFile(null);
      onClose();
    } catch (e: any) {
      // Proxy offline: session-only local asset with a blob URL.
      try {
        const url = URL.createObjectURL(file);
        const now = new Date().toISOString();
        const asset: Song = {
          id: newId("upl"),
          title: file.name.replace(/\.[^.]+$/, ""),
          description: "Uploaded audio (session-only — proxy unreachable)",
          styles: [],
          model: "juno-xl-quality",
          aceModel: "acestep-v15-xl-sft",
          type: "upload",
          durationSeconds: 0,
          audioUrl: url,
          playlistIds: [],
          workspaceId: activeWorkspaceId,
          liked: false,
          disliked: false,
          public: false,
          playCount: 0,
          commentCount: 0,
          createdAt: now,
          updatedAt: now,
          generationStatus: "idle",
          metadata: { weirdness: 50, styleInfluence: 50, instrumental: false },
        };
        addSong(asset);
        setErr(`Upload service unavailable (${e?.message || e}) — imported for this session only.`);
        setFile(null);
      } catch {
        setErr(`Upload failed: ${e?.message || e}`);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Upload Audio"
      open={open}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!file} loading={busy} onClick={doImport}>
            Import
          </Button>
        </>
      }
    >
      <div
        className={`dropzone${over ? " over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          pick(e.dataTransfer.files?.[0] ?? null);
        }}
      >
        <p>Drag and drop audio here</p>
        <p>or</p>
        <Button onClick={() => inputRef.current?.click()}>Choose file</Button>
        <p className="inline-hint" style={{ marginTop: 10 }}>
          Supported: MP3, WAV, M4A, OGG, FLAC
        </p>
        {file && <p>{file.name}</p>}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          hidden
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
        />
      </div>
      {err && <p className="inline-error">{err}</p>}
    </Modal>
  );
}
