/** MIDI tab: turn audio into MIDI with MuScriptor, then play or edit it.
 *
 *  Left: every transcription (from Library songs via "Extract MIDI", or
 *  uploaded straight here). Right: the selected file with a shared
 *  transport and two views —
 *   ▶ Play — vertical falling-notes piano, optional A/B with the original
 *   ✎ Edit — horizontal piano roll with velocity lane, snap, undo/redo.
 *  Edits are saved as a separate file; the original transcription can be
 *  restored at any time.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useJuno } from "../App";
import { api, MidiItem } from "../lib/api";
import { Button } from "../components/Button";
import { Badge } from "../components/Badge";
import { Modal } from "../components/Modal";
import { Dropdown } from "../components/Dropdown";
import { FallingNotesView } from "../components/midi/FallingNotesView";
import { EditTool, PianoRollEditor } from "../components/midi/PianoRollEditor";
import { MidiDoc, MNote, MTrack, parseMidi, serializeMidi, SNAP_OPTIONS, SnapValue, TRACK_COLORS } from "../lib/midiModel";
import { MidiPlayer, renderOffline } from "../lib/midiSynth";
import { bufferToFile, downloadUrl } from "../lib/dsp";
import { fmtDuration, fmtRelative } from "../lib/format";

const ACCEPT = ".mp3,.wav,.m4a,.ogg,.flac";

const prettyInst = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export function MidiPage({ selectedId }: { selectedId?: string }) {
  const { midiItems, navigate, status, refreshMidi } = useJuno();
  const [newOpen, setNewOpen] = useState(false);
  const selected = midiItems.find((m) => m.id === selectedId) ?? null;

  useEffect(() => {
    void refreshMidi();
  }, [refreshMidi]);

  useEffect(() => {
    if (!selectedId && midiItems.length) navigate(`/midi/${midiItems[0].id}`);
  }, [selectedId, midiItems, navigate]);

  return (
    <div className="page midi-page">
      <div className="page-title-row">
        <div>
          <h1 className="page-title">MIDI</h1>
          <MidiEngineLine />
        </div>
        <Button variant="primary" onClick={() => setNewOpen(true)}>
          ＋ Transcribe audio
        </Button>
      </div>

      <div className="midi-layout">
        <aside className="midi-list" aria-label="Transcriptions">
          {midiItems.length === 0 && (
            <div className="empty-state">
              <h3>No MIDI yet</h3>
              <p>Upload audio here, or use ⋯ → Extract MIDI on any song.</p>
            </div>
          )}
          {midiItems.map((m) => (
            <MidiListItem key={m.id} item={m} active={m.id === selectedId} onOpen={() => navigate(`/midi/${m.id}`)} />
          ))}
        </aside>
        <section className="midi-main">
          {selected ? (
            <MidiWorkspace key={selected.id} item={selected} />
          ) : (
            <div className="empty-state">
              <h3>{midiItems.length ? "Pick a transcription" : "Turn a recording into notes"}</h3>
              <p>
                MuScriptor transcribes multi-instrument audio — piano, guitars, bass, strings, drums and more — into an
                editable MIDI file.
              </p>
              <Button variant="primary" onClick={() => setNewOpen(true)}>
                ＋ Transcribe audio
              </Button>
            </div>
          )}
        </section>
      </div>

      <TranscribeModal open={newOpen} onClose={() => setNewOpen(false)} defaultSize={status?.settings.midiModelSize || "medium"} />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function MidiEngineLine() {
  const { status, notify } = useJuno();
  const m = status?.midi;
  if (!m) return <span className="inline-hint">Checking the transcription engine…</span>;
  const text: Record<string, string> = {
    stopped: "MuScriptor is stopped — it starts automatically when you transcribe.",
    starting: `Starting MuScriptor (${m.wantedSize})… the first start downloads the model.`,
    ready: `MuScriptor ready (${m.modelSize || m.wantedSize}).`,
    transcribing: `Transcribing${m.queued ? ` · ${m.queued} waiting` : ""}…`,
    stopping: "Stopping MuScriptor…",
    error: "MuScriptor failed to start.",
  };
  return (
    <span className="inline-hint engine-line">
      <span className={`status-dot ${m.activity === "ready" || m.activity === "transcribing" ? "ok" : m.activity === "error" ? "bad" : m.activity === "stopped" ? "idle" : "warn"}`} />
      {text[m.activity]}
      {m.stopAt && m.activity === "ready" && ` Frees its VRAM at ${new Date(m.stopAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`}
      {m.activity === "ready" && (
        <button
          className="link-btn"
          onClick={() => api.stopMidiServer().catch((e) => notify(e.message, "error"))}
        >
          Stop now
        </button>
      )}
      {m.lastError && m.activity !== "transcribing" && <span className="inline-error"> {m.lastError.message}</span>}
    </span>
  );
}

function MidiListItem({ item, active, onOpen }: { item: MidiItem; active: boolean; onOpen: () => void }) {
  const { upsertMidi, notify } = useJuno();
  const running = item.status === "queued" || item.status === "starting" || item.status === "running";
  return (
    <div className={`midi-item${active ? " active" : ""}`}>
      <button className="midi-item-main" onClick={onOpen}>
        <span className="midi-item-title">{item.title}</span>
        <span className="midi-item-meta">
          {item.sourceSongId ? "From library" : "Uploaded"} · {item.modelSize}
          {item.status === "succeeded" &&
            ` · ${item.noteCount ?? 0} notes${item.durationSeconds ? ` · ${fmtDuration(item.durationSeconds)}` : ""}`}
          {item.edited && " · edited"}
        </span>
        {running && (
          <>
            <span className="progress-track" aria-hidden="true">
              <span
                className={`progress-fill${item.status !== "running" ? " indeterminate" : ""}`}
                style={{ width: `${Math.round((item.progress || 0) * 100)}%` }}
              />
            </span>
            <span className="midi-item-meta">
              {item.queuePosition > 1 ? `#${item.queuePosition} in queue` : item.stage || "Working…"}
            </span>
          </>
        )}
        {item.status === "failed" && <span className="inline-error midi-item-error">{item.error}</span>}
        {!running && item.status !== "failed" && <span className="midi-item-meta">{fmtRelative(item.createdAt)}</span>}
      </button>
      {item.status === "failed" && (
        <Button
          variant="ghost"
          onClick={() =>
            api
              .midiRetry(item.id)
              .then((r) => upsertMidi(r.item))
              .catch((e) => notify(e.message, "error"))
          }
        >
          Retry
        </Button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Transcribe dialog                                                   */
/* ------------------------------------------------------------------ */

function TranscribeModal({ open, onClose, defaultSize }: { open: boolean; onClose: () => void; defaultSize: string }) {
  const { songs, midiInstruments, upsertMidi, navigate } = useJuno();
  const [source, setSource] = useState<"upload" | "library">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [songId, setSongId] = useState("");
  const [size, setSize] = useState(defaultSize);
  const [instruments, setInstruments] = useState<string[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setSize(defaultSize);
      setErr(null);
    }
  }, [open, defaultSize]);

  const withAudio = songs.filter((s) => !s.trashed && s.localAudioPath);
  const pick = (f: File | null) => {
    if (!f) return;
    const ok = ACCEPT.split(",").some((ext) => f.name.toLowerCase().endsWith(ext));
    setErr(ok ? null : "Unsupported file type. Use MP3, WAV, M4A, OGG or FLAC.");
    setFile(ok ? f : null);
  };

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const opts = { instruments, modelSize: size };
      const res = source === "upload" && file ? await api.midiFromFile(file, opts) : await api.midiFromSong(songId, opts);
      upsertMidi(res.item);
      navigate(`/midi/${res.item.id}`);
      setFile(null);
      setSongId("");
      onClose();
    } catch (e: any) {
      setErr(e?.message || "Could not start the transcription");
    } finally {
      setBusy(false);
    }
  };

  const ready = source === "upload" ? !!file : !!songId;

  return (
    <Modal
      title="Transcribe audio to MIDI"
      open={open}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!ready} loading={busy} onClick={submit}>
            Transcribe
          </Button>
        </>
      }
    >
      <div style={{ display: "grid", gap: 14 }}>
        <div className="segmented" role="tablist" aria-label="Audio source">
          <button role="tab" aria-selected={source === "upload"} className={source === "upload" ? "active" : ""} onClick={() => setSource("upload")}>
            Upload a file
          </button>
          <button role="tab" aria-selected={source === "library"} className={source === "library" ? "active" : ""} onClick={() => setSource("library")}>
            From your library
          </button>
        </div>

        {source === "upload" ? (
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
            <p>{file ? file.name : "Drag and drop audio here"}</p>
            <Button onClick={() => inputRef.current?.click()}>{file ? "Choose another file" : "Choose file"}</Button>
            <p className="inline-hint" style={{ marginTop: 10 }}>
              MP3, WAV, M4A, OGG or FLAC, up to 15 minutes. Uploads here stay in the MIDI tab and don't clutter your
              Library.
            </p>
            <input ref={inputRef} type="file" accept={ACCEPT} hidden onChange={(e) => pick(e.target.files?.[0] ?? null)} />
          </div>
        ) : (
          <div>
            <label className="field-label" htmlFor="midi-song">Song</label>
            <select id="midi-song" className="text-input" value={songId} onChange={(e) => setSongId(e.target.value)}>
              <option value="">Pick a song…</option>
              {withAudio.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                  {s.durationSeconds ? ` (${fmtDuration(s.durationSeconds)})` : ""}
                </option>
              ))}
            </select>
            {!withAudio.length && <p className="inline-hint">No songs with audio yet.</p>}
          </div>
        )}

        <div>
          <span className="field-label">Model</span>
          <div className="segmented" role="radiogroup" aria-label="MuScriptor model size">
            {["small", "medium", "large"].map((s) => (
              <button key={s} role="radio" aria-checked={size === s} className={size === s ? "active" : ""} onClick={() => setSize(s)}>
                {s === "small" ? "Small · fastest" : s === "medium" ? "Medium · balanced" : "Large · most accurate"}
              </button>
            ))}
          </div>
          <p className="inline-hint">
            Switching size restarts MuScriptor (and downloads that model the first time). You need to accept the
            model licence on Hugging Face once.
          </p>
        </div>

        <div>
          <span className="field-label">Instruments</span>
          <div className="chip-row wrap">
            <button className={`chip${instruments.length === 0 ? " selected" : ""}`} onClick={() => setInstruments([])}>
              Detect automatically
            </button>
            {midiInstruments.map((i) => (
              <button
                key={i}
                className={`chip${instruments.includes(i) ? " selected" : ""}`}
                onClick={() => setInstruments((cur) => (cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i]))}
              >
                {prettyInst(i)}
              </button>
            ))}
          </div>
          <p className="inline-hint">
            Picking instruments is a hard filter: anything else is left out. Useful for pulling just the bass or just
            the piano out of a full mix.
          </p>
        </div>
        {err && <p className="inline-error">{err}</p>}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Workspace (player + editor)                                         */
/* ------------------------------------------------------------------ */

const SHORTCUTS: [string, string][] = [
  ["Space", "Play / pause"],
  ["Double-click", "Add a note (Select tool)"],
  ["Drag", "Move notes · drag the right edge to resize"],
  ["Alt + drag", "Duplicate and move"],
  ["Right-click", "Delete a note"],
  ["Shift + click / box", "Add to the selection"],
  ["⌘/Ctrl + A", "Select every note on the active track"],
  ["↑ / ↓", "Transpose a semitone (Shift = octave)"],
  ["← / →", "Nudge by one grid step"],
  ["Q", "Quantize the selection to the grid"],
  ["⌘/Ctrl + D", "Duplicate the selection after itself"],
  ["⌘/Ctrl + Z / Shift+Z", "Undo / redo"],
  ["Wheel", "Scroll pitch · Shift = time · Ctrl/⌘ = zoom time · Alt = zoom pitch"],
];

function MidiWorkspace({ item }: { item: MidiItem }) {
  const { upsertMidi, removeMidi, navigate, notify, addSong, songs, activeWorkspaceId } = useJuno();
  const player = useMemo(() => new MidiPlayer(), []);
  useEffect(() => () => player.dispose(), [player]);

  const [doc, setDoc] = useState<MidiDoc | null>(null);
  const [notes, setNotes] = useState<MNote[]>([]);
  const [tracks, setTracks] = useState<MTrack[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [view, setView] = useState<"play" | "edit">("play");
  const [tool, setTool] = useState<EditTool>("select");
  const [snap, setSnap] = useState<SnapValue>("1/16");
  const [follow, setFollow] = useState(true);
  const [fitRange, setFitRange] = useState(true);
  const [selection, setSelection] = useState<Set<number>>(new Set());
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const [muted, setMuted] = useState<Set<number>>(new Set());
  const [soloed, setSoloed] = useState<Set<number>>(new Set());
  const [activeTrack, setActiveTrack] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [midiVol, setMidiVol] = useState(0.9);
  const [audioOn, setAudioOn] = useState(false);
  const [audioVol, setAudioVol] = useState(0.7);
  const [audioState, setAudioState] = useState<"none" | "loading" | "ready" | "error">("none");
  const [busy, setBusy] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(item.title);

  const ready = item.status === "succeeded" && !!item.midiUrl;
  const undo = useRef<MNote[][]>([]);
  const redo = useRef<MNote[][]>([]);
  const notesRef = useRef(notes);
  notesRef.current = notes;

  /* load the file */
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setLoadErr(null);
    fetch(item.midiUrl!)
      .then((r) => {
        if (!r.ok) throw new Error(`Could not load the MIDI file (${r.status})`);
        return r.arrayBuffer();
      })
      .then((buf) => {
        if (cancelled) return;
        const d = parseMidi(buf);
        setDoc(d);
        setNotes(d.notes);
        setTracks(d.tracks);
        setActiveTrack(d.tracks.find((t) => t.noteCount > 0 && !t.drums)?.index ?? d.tracks[0]?.index ?? 0);
        undo.current = [];
        redo.current = [];
        setDirty(false);
        setSelection(new Set());
      })
      .catch((e) => !cancelled && setLoadErr(e.message));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, ready, reloadToken]);

  /* keep the player in sync */
  const contentEnd = useMemo(() => Math.max(doc?.duration ?? 0, ...notes.map((n) => n.start + n.dur), 1), [notes, doc]);
  useEffect(() => {
    player.setContent(notes, tracks, contentEnd);
  }, [player, notes, tracks, contentEnd]);
  useEffect(() => player.setMuteSolo(muted, soloed), [player, muted, soloed]);
  useEffect(() => player.setMidiVolume(midiVol), [player, midiVol]);
  useEffect(() => player.setAudioVolume(audioOn ? audioVol : 0), [player, audioOn, audioVol]);
  useEffect(() => {
    player.onEnd = () => setPlaying(false);
  }, [player]);

  /* original audio for A/B */
  useEffect(() => {
    if (!audioOn || audioState !== "none" || !item.sourceAudioUrl) return;
    setAudioState("loading");
    fetch(item.sourceAudioUrl)
      .then((r) => r.arrayBuffer())
      .then((b) => player.ctx.decodeAudioData(b))
      .then((buf) => {
        player.setAudio(buf);
        setAudioState("ready");
        if (player.playing) player.seek(player.position);
      })
      .catch(() => setAudioState("error"));
  }, [audioOn, audioState, item.sourceAudioUrl, player]);

  const togglePlay = useCallback(() => {
    if (player.playing) {
      player.pause();
      setPlaying(false);
    } else {
      void player.play();
      setPlaying(true);
    }
  }, [player]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.code !== "Space" || /INPUT|TEXTAREA|SELECT/.test(t.tagName)) return;
      e.preventDefault();
      togglePlay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay]);

  /* unsaved-changes guard */
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  /* editing */
  const beginEdit = useCallback(() => {
    undo.current.push(notesRef.current);
    if (undo.current.length > 200) undo.current.shift();
    redo.current = [];
    setDirty(true);
  }, []);
  const doUndo = useCallback(() => {
    const prev = undo.current.pop();
    if (!prev) return;
    redo.current.push(notesRef.current);
    setNotes(prev);
    setDirty(true);
  }, []);
  const doRedo = useCallback(() => {
    const next = redo.current.pop();
    if (!next) return;
    undo.current.push(notesRef.current);
    setNotes(next);
    setDirty(true);
  }, []);

  const toggleIn = (set: Set<number>, i: number) => {
    const n = new Set(set);
    n.has(i) ? n.delete(i) : n.add(i);
    return n;
  };

  const addTrack = () => {
    const index = Math.max(-1, ...tracks.map((t) => t.index)) + 1;
    const used = new Set(tracks.map((t) => t.channel));
    let channel = 0;
    while (used.has(channel) || channel === 9) channel++;
    setTracks((t) => [
      ...t,
      { index, name: `New track ${index + 1}`, program: 0, channel: Math.min(channel, 15), drums: false, color: TRACK_COLORS[index % TRACK_COLORS.length], noteCount: 0 },
    ]);
    setActiveTrack(index);
    setView("edit");
    setTool("draw");
  };

  const currentBytes = () => (doc ? serializeMidi(doc, notes) : new Uint8Array());

  const save = async () => {
    if (!doc) return;
    setBusy("save");
    try {
      const res = await api.midiSave(item.id, currentBytes(), notes.length);
      upsertMidi(res.item);
      setDirty(false);
      notify("Edits saved. The original transcription is kept — use Revert to go back.", "success");
    } catch (e: any) {
      notify(e?.message || "Save failed", "error");
    } finally {
      setBusy(null);
    }
  };

  const revert = async () => {
    if (!window.confirm("Discard your edits and go back to the original transcription?")) return;
    try {
      const res = await api.midiRevert(item.id);
      upsertMidi(res.item);
      setReloadToken((t) => t + 1);
    } catch (e: any) {
      notify(e?.message || "Revert failed", "error");
    }
  };

  const download = (which: "current" | "quantized") => {
    const safe = item.title.replace(/[\\/:*?"<>|]/g, "_");
    if (which === "quantized" && item.quantizedMidiUrl) {
      downloadUrl(item.quantizedMidiUrl, `${safe} (quantized).mid`);
      return;
    }
    const url = URL.createObjectURL(new Blob([currentBytes() as BlobPart], { type: "audio/midi" }));
    downloadUrl(url, `${safe}.mid`);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const renderWav = async () => {
    setBusy("render");
    try {
      const audible = (i: number) => (soloed.size ? soloed.has(i) : !muted.has(i));
      const buf = await renderOffline(notes, tracks, contentEnd, (i) => !audible(i));
      const t = `${item.title} (MIDI render)`;
      const src = songs.find((s) => s.id === item.sourceSongId);
      const res = await api.upload(bufferToFile(buf, t), {
        title: t,
        type: "remix",
        description: `Synth render of the MIDI transcription of "${item.title}"`,
        sourceSongId: item.sourceSongId,
        workspaceId: src?.workspaceId || activeWorkspaceId,
        durationSeconds: Math.round(buf.duration),
      });
      addSong(res.asset);
      notify(`Rendered "${t}" to your library.`, "success");
    } catch (e: any) {
      notify(e?.message || "Render failed", "error");
    } finally {
      setBusy(null);
    }
  };

  const doDelete = async () => {
    await api.midiDelete(item.id).catch(() => {});
    removeMidi(item.id);
    setConfirmDelete(false);
    navigate("/midi");
  };

  const rename = async () => {
    setRenaming(false);
    const t = title.trim();
    if (!t || t === item.title) return setTitle(item.title);
    const res = await api.midiRename(item.id, t).catch(() => null);
    if (res) upsertMidi(res.item);
  };

  /* ------------------------------ render ------------------------------ */
  if (!ready) {
    const running = ["queued", "starting", "running"].includes(item.status);
    return (
      <div className="midi-pending">
        <h2 className="midi-title">{item.title}</h2>
        {running ? (
          <>
            <p>{item.queuePosition > 1 ? `Waiting — #${item.queuePosition} in the queue.` : item.stage || "Working…"}</p>
            <span className="progress-track big" aria-hidden="true">
              <span className={`progress-fill${item.status !== "running" ? " indeterminate" : ""}`} style={{ width: `${Math.round(item.progress * 100)}%` }} />
            </span>
            <p className="inline-hint">
              Audio is split into 5-second chunks; the bar moves as each chunk is transcribed. You can leave this page —
              it keeps running.
            </p>
          </>
        ) : (
          <>
            <p className="inline-error">{item.error || "Transcription failed."}</p>
            <div style={{ display: "flex", gap: 8 }}>
              <Button onClick={() => api.midiRetry(item.id).then((r) => upsertMidi(r.item))}>Retry</Button>
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>Delete</Button>
            </div>
          </>
        )}
        <DeleteModal open={confirmDelete} title={item.title} onCancel={() => setConfirmDelete(false)} onConfirm={doDelete} />
      </div>
    );
  }

  if (loadErr) return <p className="inline-error">{loadErr}</p>;
  if (!doc) return <p className="inline-hint">Loading MIDI…</p>;

  const counts = new Map<number, number>();
  for (const n of notes) counts.set(n.track, (counts.get(n.track) || 0) + 1);
  const selCount = selection.size;
  const selVel = selCount ? notes.filter((n) => selection.has(n.id)).reduce((a, n) => a + n.vel, 0) / selCount : 0;

  return (
    <div className="midi-workspace">
      <div className="midi-head">
        <div style={{ minWidth: 0 }}>
          {renaming ? (
            <input
              className="text-input midi-title-input"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={rename}
              onKeyDown={(e) => e.key === "Enter" && rename()}
            />
          ) : (
            <h2 className="midi-title" title="Click to rename" onClick={() => setRenaming(true)}>
              {item.title}
            </h2>
          )}
          <div className="midi-badges">
            <Badge tone="accent">MuScriptor {item.modelSize}</Badge>
            {doc.bpm && <Badge>{doc.bpm} BPM · {doc.beatsPerBar}/4</Badge>}
            <Badge>{notes.length} notes</Badge>
            {item.edited && <Badge tone="warning">Edited</Badge>}
            {dirty && <Badge tone="danger">Unsaved changes</Badge>}
          </div>
        </div>
        <div className="midi-actions">
          <Button variant="primary" disabled={!dirty} loading={busy === "save"} onClick={save}>
            Save edits
          </Button>
          <Dropdown
            ariaLabel="More MIDI actions"
            trigger={<>More ▾</>}
            items={[
              { id: "dl", label: "⬇ Download .mid", onSelect: () => download("current") },
              ...(item.quantizedMidiUrl
                ? [{ id: "dlq", label: "⬇ Download quantized .mid (snapped to the beat — best for notation)", onSelect: () => download("quantized") }]
                : []),
              { id: "render", label: busy === "render" ? "Rendering…" : "♪ Render to WAV → Library", disabled: !!busy, onSelect: renderWav },
              ...(item.edited || dirty ? [{ id: "revert", label: "↺ Revert to original transcription", onSelect: revert }] : []),
              { id: "src", label: "Open source song", disabled: !item.sourceSongId, onSelect: () => navigate(`/editor/${item.sourceSongId}`) },
              { id: "del", label: "🗑 Delete", onSelect: () => setConfirmDelete(true) },
            ]}
          />
        </div>
      </div>

      <div className="midi-transport">
        <Button variant="icon" label={playing ? "Pause (Space)" : "Play (Space)"} onClick={togglePlay} style={{ fontSize: 16 }}>
          {playing ? "⏸" : "▶"}
        </Button>
        <Button
          variant="icon"
          label="Back to start"
          onClick={() => {
            player.stop();
            setPlaying(false);
          }}
        >
          ⏮
        </Button>
        <PositionBar player={player} duration={contentEnd} />
        <label className="mini-slider" title="MIDI synth volume">
          🎹
          <input type="range" min={0} max={100} value={Math.round(midiVol * 100)} onChange={(e) => setMidiVol(Number(e.target.value) / 100)} aria-label="MIDI volume" />
        </label>
        <label className={`mini-slider${item.sourceAudioUrl ? "" : " disabled"}`} title="Play the original recording underneath to compare">
          <input type="checkbox" checked={audioOn} disabled={!item.sourceAudioUrl} onChange={(e) => setAudioOn(e.target.checked)} />
          Original
          <input type="range" min={0} max={100} value={Math.round(audioVol * 100)} disabled={!audioOn} onChange={(e) => setAudioVol(Number(e.target.value) / 100)} aria-label="Original audio volume" />
          {audioState === "loading" && <span className="spinner" aria-hidden="true" />}
          {audioState === "error" && <span className="inline-error">!</span>}
        </label>
        <div className="segmented" role="tablist" aria-label="View">
          <button role="tab" aria-selected={view === "play"} className={view === "play" ? "active" : ""} onClick={() => setView("play")}>
            ▶ Play
          </button>
          <button role="tab" aria-selected={view === "edit"} className={view === "edit" ? "active" : ""} onClick={() => setView("edit")}>
            ✎ Edit
          </button>
        </div>
      </div>

      <div className="track-strip" aria-label="Tracks">
        {tracks.map((t) => (
          <div
            key={t.index}
            className={`track-chip${activeTrack === t.index ? " active" : ""}${hidden.has(t.index) ? " hidden" : ""}`}
            style={{ "--track-color": t.color } as React.CSSProperties}
          >
            <button className="track-chip-name" onClick={() => setActiveTrack(t.index)} title="Make this the track you edit and draw on">
              <span className="track-dot" />
              {t.name}
              <span className="track-count">{counts.get(t.index) || 0}</span>
            </button>
            <button className={`tbtn${muted.has(t.index) ? " on" : ""}`} title="Mute" onClick={() => setMuted((m) => toggleIn(m, t.index))}>M</button>
            <button className={`tbtn${soloed.has(t.index) ? " on" : ""}`} title="Solo" onClick={() => setSoloed((s) => toggleIn(s, t.index))}>S</button>
            <button className={`tbtn${hidden.has(t.index) ? " on" : ""}`} title={hidden.has(t.index) ? "Show" : "Hide"} onClick={() => setHidden((h) => toggleIn(h, t.index))}>
              {hidden.has(t.index) ? "◌" : "●"}
            </button>
          </div>
        ))}
        <button className="chip" onClick={addTrack} title="Add an empty track to draw on">＋ Track</button>
      </div>

      {view === "edit" && (
        <div className="edit-toolbar">
          <div className="segmented" role="radiogroup" aria-label="Tool">
            <button role="radio" aria-checked={tool === "select"} className={tool === "select" ? "active" : ""} onClick={() => setTool("select")} title="Select, move and resize notes">
              ⬚ Select
            </button>
            <button role="radio" aria-checked={tool === "draw"} className={tool === "draw" ? "active" : ""} onClick={() => setTool("draw")} title="Click-drag to draw notes on the active track">
              ✎ Draw
            </button>
          </div>
          <select className="text-input compact" value={snap} onChange={(e) => setSnap(e.target.value as SnapValue)} aria-label="Snap to grid">
            {SNAP_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
          <Button variant="ghost" disabled={!undo.current.length} onClick={doUndo} title="Undo (⌘/Ctrl+Z)">↶</Button>
          <Button variant="ghost" disabled={!redo.current.length} onClick={doRedo} title="Redo (⌘/Ctrl+Shift+Z)">↷</Button>
          <label className="check">
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow playhead
          </label>
          {selCount > 0 && (
            <label className="mini-slider" title="Velocity of the selected notes">
              Velocity
              <input
                type="range"
                min={1}
                max={127}
                value={Math.round(selVel * 127)}
                onPointerDown={beginEdit}
                onChange={(e) => {
                  const v = Number(e.target.value) / 127;
                  setNotes((ns) => ns.map((n) => (selection.has(n.id) ? { ...n, vel: v } : n)));
                }}
                aria-label="Selected note velocity"
              />
              <span className="slider-value">{Math.round(selVel * 127)}</span>
            </label>
          )}
          {selCount > 0 && <span className="inline-hint">{selCount} selected</span>}
          <Button variant="icon" label="Editing shortcuts" onClick={() => setHelpOpen(true)}>ⓘ</Button>
        </div>
      )}
      {view === "play" && (
        <div className="edit-toolbar">
          <label className="check">
            <input type="checkbox" checked={fitRange} onChange={(e) => setFitRange(e.target.checked)} /> Fit keyboard to the notes
          </label>
          <span className="inline-hint">Scroll to change how far ahead you see · click a key to hear it</span>
        </div>
      )}

      <div className="midi-view">
        {view === "play" ? (
          <FallingNotesView doc={doc} notes={notes} tracks={tracks} hidden={hidden} player={player} fitRange={fitRange} />
        ) : (
          <PianoRollEditor
            doc={doc}
            notes={notes}
            tracks={tracks}
            hidden={hidden}
            activeTrack={activeTrack}
            player={player}
            snap={snap}
            tool={tool}
            follow={follow}
            selection={selection}
            onSelection={setSelection}
            onBeginEdit={beginEdit}
            onNotes={setNotes}
            onUndo={doUndo}
            onRedo={doRedo}
          />
        )}
      </div>

      <Modal title="Piano roll shortcuts" open={helpOpen} onClose={() => setHelpOpen(false)}>
        <table className="settings-table">
          <tbody>
            {SHORTCUTS.map(([k, v]) => (
              <tr key={k}>
                <td style={{ whiteSpace: "nowrap" }}><strong>{k}</strong></td>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="inline-hint">New notes go on the active track (click a track name). The synth is a light preview — download the .mid for your DAW.</p>
      </Modal>
      <DeleteModal open={confirmDelete} title={item.title} onCancel={() => setConfirmDelete(false)} onConfirm={doDelete} />
    </div>
  );
}

function DeleteModal({ open, title, onCancel, onConfirm }: { open: boolean; title: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Modal
      title={`Delete "${title}"?`}
      open={open}
      onClose={onCancel}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant="danger" onClick={onConfirm}>Delete MIDI</Button>
        </>
      }
    >
      <p>This removes the transcription and any edits. The source song stays in your library.</p>
    </Modal>
  );
}

/** Time readout + seek bar, refreshed from the player clock. */
function PositionBar({ player, duration }: { player: MidiPlayer; duration: number }) {
  const [pos, setPos] = useState(0);
  const dragging = useRef(false);
  useEffect(() => {
    const t = setInterval(() => !dragging.current && setPos(player.position), 100);
    return () => clearInterval(t);
  }, [player]);
  return (
    <div className="position-bar">
      <span className="player-time">{fmtDuration(pos)}</span>
      <input
        className="player-timeline"
        type="range"
        min={0}
        max={Math.max(1, duration)}
        step={0.05}
        value={Math.min(pos, duration)}
        onPointerDown={() => (dragging.current = true)}
        onPointerUp={() => (dragging.current = false)}
        onChange={(e) => {
          const v = Number(e.target.value);
          setPos(v);
          player.seek(v);
        }}
        aria-label="Seek"
      />
      <span className="player-time">{fmtDuration(duration)}</span>
    </div>
  );
}
