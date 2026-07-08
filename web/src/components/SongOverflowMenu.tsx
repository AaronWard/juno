/** Three-dot song action menu (DESIGN_DOC §14), rebuilt around REAL
 *  functionality (behaviors modeled on Suno's remix/edit menu):
 *
 *  ACE-Step-backed:
 *    - Replace Section -> "repaint", Extend -> "complete",
 *      Mashup -> "lego" (with a real local audio-mix fallback).
 *  Prefill flows (no modal round-trips):
 *    - Cover: attaches the source audio to the Create form and switches it
 *      into Cover mode — you describe the NEW style there, exactly like
 *      Suno's cover flow (reimagine the same song in a different style).
 *    - Use as Inspiration: attaches the audio as a style/audio reference
 *      and copies the style chips; it no longer dumps "Uploaded audio"
 *      into the prompt.
 *  REAL local audio processing (Web Audio API, rendered to WAV and saved
 *  as a playable library track):
 *    - Reverse, Adjust Speed, Crop, Remove Section, Sample this song
 *      (loudest 10 s window), local Mashup mix.
 *  Housekeeping:
 *    - Download (browser download of the audio file),
 *      Move to Trash, Delete Forever, Export manifest.
 */
import React, { useState } from "react";
import { useJuno } from "../App";
import { Song } from "../data/mockSongs";
import { Dropdown } from "./Dropdown";
import { Modal } from "./Modal";
import { Button } from "./Button";
import { Slider } from "./Slider";
import { PlaylistMenuSection } from "./PlaylistMenuSection";
import { api } from "../lib/api";
import {
  bufferToFile,
  changeSpeed,
  cropBuffer,
  downloadUrl,
  extractSample,
  loadBuffer,
  mixBuffers,
  removeSection,
  reverseBuffer,
} from "../lib/dsp";

type ModalKind =
  | null
  | "extend"
  | "mashup"
  | "crop"
  | "remove"
  | "replace"
  | "speed"
  | "export"
  | "delete";

export function SongOverflowMenu({ song }: { song: Song }) {
  const {
    navigate,
    generate,
    addSong,
    songs,
    setPrefill,
    addHistoryEvent,
    selectedPreset,
    trashSong,
    deleteForever,
  } = useJuno();
  const [modal, setModal] = useState<ModalKind>(null);
  const [text, setText] = useState("");
  const [rangeStart, setRangeStart] = useState(0);
  const [rangeEnd, setRangeEnd] = useState(Math.max(1, Math.min(30, song.durationSeconds || 30)));
  const [speed, setSpeed] = useState(100);
  const [secondSourceId, setSecondSourceId] = useState("");
  const [blend, setBlend] = useState(50);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const hasAudio = !!song.audioUrl;
  const maxDur = Math.max(1, song.durationSeconds || 30);

  const close = () => {
    setModal(null);
    setErr(null);
    setText("");
    setBusy(false);
  };

  /** Render a REAL local derivative: decode -> process -> WAV -> save. */
  const renderLocal = async (
    label: string,
    type: Song["type"],
    fn: (b: AudioBuffer) => AudioBuffer | Promise<AudioBuffer>
  ) => {
    if (!song.audioUrl) {
      setErr("This song has no audio yet — generate or upload audio first.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const buf = await loadBuffer(song.audioUrl);
      const out = await fn(buf);
      const title = `${song.title} (${label})`;
      const res = await api.upload(bufferToFile(out, title), {
        title,
        type,
        description: `${label} of "${song.title}" — processed locally`,
        sourceSongId: song.id,
        workspaceId: song.workspaceId,
        durationSeconds: Math.round(out.duration),
        styles: song.styles,
        lyrics: song.lyrics,
      });
      addSong(res.asset);
      addHistoryEvent(`${label}: "${song.title}"`);
      close();
    } catch (e: any) {
      setErr(`${label} failed: ${e?.message || e}`);
      setBusy(false);
    }
  };

  const submitAceTask = async (
    taskType: string,
    extra: Record<string, unknown>,
    label: string
  ) => {
    setBusy(true);
    setErr(null);
    try {
      await generate({
        taskType,
        model: selectedPreset,
        title: `${song.title} (${label})`,
        prompt: text || song.description,
        styles: song.styles,
        duration: song.durationSeconds || 120,
        srcAudioPath: song.localAudioPath,
        sourceSongId: song.id,
        ...extra,
      } as any);
      close();
    } catch (e: any) {
      setErr(`ACE-Step unavailable (${e?.message || e}). A failed row documents the attempt.`);
      setBusy(false);
    }
  };

  /* --- Suno-style Cover: prefill Create with the source audio ------- */
  const startCover = () => {
    if (!song.localAudioPath) {
      setErr(null);
      setModal("export"); // reuse a modal? no — inline hint instead
      return;
    }
    setPrefill({
      taskType: "cover",
      srcAudioPath: song.localAudioPath,
      coverOfTitle: song.title,
      sourceSongId: song.id,
      lyrics: song.lyrics,
      instrumental: song.metadata.instrumental,
      title: `${song.title} (Cover)`,
      styles: [], // the user describes the NEW style in Create
    });
    navigate("/create");
  };

  /* --- Use as Inspiration: reference audio + styles, clean prompt --- */
  const useAsInspiration = () => {
    setPrefill({
      styles: song.styles,
      // Only reuse the prompt for generated songs; "Uploaded audio" is noise.
      prompt: song.type === "upload" ? undefined : song.description || undefined,
      vocalGender: song.metadata.vocalGender,
      weirdness: song.metadata.weirdness,
      styleInfluence: song.metadata.styleInfluence,
      instrumental: song.metadata.instrumental,
      referenceAudioPath: song.localAudioPath,
      inspirationTitle: song.title,
      sourceSongId: song.id,
    });
    navigate("/create");
  };

  const localMashup = async () => {
    const second = songs.find((s) => s.id === secondSourceId);
    if (!second) return;
    if (!song.audioUrl || !second.audioUrl) {
      setErr("Both songs need audio for a local mashup mix.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const [a, b] = await Promise.all([
        loadBuffer(song.audioUrl),
        loadBuffer(second.audioUrl),
      ]);
      const out = mixBuffers(a, b, blend);
      const title = `${song.title} × ${second.title}`;
      const res = await api.upload(bufferToFile(out, title), {
        title,
        type: "mashup",
        description: `Local mashup mix of "${song.title}" and "${second.title}" (${blend}% blend)`,
        sourceSongId: song.id,
        workspaceId: song.workspaceId,
        durationSeconds: Math.round(out.duration),
        styles: [...new Set([...song.styles, ...second.styles])],
      });
      addSong(res.asset);
      addHistoryEvent(`Mashup: "${song.title}" × "${second.title}"`);
      close();
    } catch (e: any) {
      setErr(`Mashup failed: ${e?.message || e}`);
      setBusy(false);
    }
  };

  const aceMashup = async () => {
    const second = songs.find((s) => s.id === secondSourceId);
    if (!second) return;
    setBusy(true);
    setErr(null);
    try {
      await generate({
        taskType: "lego",
        model: selectedPreset,
        title: `${song.title} × ${second.title}`,
        prompt: text || `mashup of ${song.title} and ${second.title}`,
        styles: [...new Set([...song.styles, ...second.styles])],
        duration: song.durationSeconds || 120,
        srcAudioPath: song.localAudioPath,
        referenceAudioPath: second.localAudioPath,
        weirdness: blend,
        sourceSongId: song.id,
      } as any);
      close();
    } catch (e: any) {
      // ACE lego not available -> fall back to the REAL local mix.
      setErr(null);
      await localMashup();
    }
  };

  const download = () => {
    if (!song.audioUrl) return;
    const rawExt = song.audioUrl.split("?")[0].split(".").pop() || "wav";
    const ext = rawExt.length <= 5 ? rawExt : "wav";
    downloadUrl(song.audioUrl, `${song.title}.${ext}`);
    addHistoryEvent(`Downloaded "${song.title}"`);
  };

  const disabledHint = hasAudio ? undefined : " (needs audio)";

  return (
    <>
      <Dropdown
        triggerClass="btn btn-icon"
        ariaLabel={`More actions for ${song.title}`}
        trigger={<>⋯</>}
      >
        <div className="menu-label">♪ Remix / Edit</div>
        <button className="menu-item" onClick={() => navigate("/studio")}>
          Open in Studio <span className="badge badge-accent">New</span>
        </button>
        <button className="menu-item" onClick={() => navigate(`/editor/${song.id}`)}>
          Open in Editor
        </button>
        <button
          className="menu-item"
          disabled={!song.localAudioPath}
          title={song.localAudioPath ? "Reimagine this song in a new style" : "Needs a locally stored audio file"}
          onClick={startCover}
        >
          Cover{song.localAudioPath ? "" : " (needs audio)"}
        </button>
        <button className="menu-item" onClick={() => setModal("extend")}>Extend</button>
        <button className="menu-item" disabled={!hasAudio} onClick={() => setModal("mashup")}>
          Mashup{disabledHint}
        </button>
        <button
          className="menu-item"
          disabled={!hasAudio}
          onClick={() =>
            renderLocal("Sample", "sample", (b) => extractSample(b, 10))
          }
        >
          Sample this song{disabledHint}
        </button>
        <button className="menu-item" onClick={useAsInspiration}>
          Use as Inspiration
        </button>
        <button
          className="menu-item"
          disabled={!hasAudio}
          onClick={() => renderLocal("Reversed", "reversed", reverseBuffer)}
        >
          Reverse{disabledHint}
        </button>
        <button className="menu-item" disabled={!hasAudio} onClick={() => setModal("speed")}>
          Adjust Speed{disabledHint}
        </button>
        <div className="menu-divider" />
        <button
          className="menu-item"
          onClick={() => {
            setPrefill({
              prompt: song.description,
              styles: song.styles,
              lyrics: song.lyrics,
              instrumental: song.metadata.instrumental,
              vocalGender: song.metadata.vocalGender,
              weirdness: song.metadata.weirdness,
              styleInfluence: song.metadata.styleInfluence,
              title: song.title,
            });
            navigate("/create");
          }}
        >
          Reuse Prompt
        </button>
        <PlaylistMenuSection song={song} />
        <div className="menu-divider" />
        <button className="menu-item" disabled={!hasAudio} onClick={() => setModal("crop")}>
          Crop{disabledHint}
        </button>
        <button className="menu-item" disabled={!hasAudio} onClick={() => setModal("remove")}>
          Remove Section{disabledHint}
        </button>
        <button className="menu-item" onClick={() => setModal("replace")}>Replace Section</button>
        <div className="menu-divider" />
        <button className="menu-item" disabled={!hasAudio} onClick={download}>
          ⬇ Download{disabledHint}
        </button>
        <button className="menu-item" onClick={() => setModal("export")}>Export</button>
        <div className="menu-divider" />
        {!song.trashed && (
          <button className="menu-item" onClick={() => trashSong(song.id)}>
            🗑 Move to Trash
          </button>
        )}
        <button className="menu-item" onClick={() => setModal("delete")}>
          Delete Forever
        </button>
      </Dropdown>

      {/* Extend — ACE-Step task_type: complete */}
      <Modal
        title={`Extend "${song.title}"`}
        open={modal === "extend"}
        onClose={close}
        footer={
          <>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button
              variant="primary"
              loading={busy}
              onClick={() =>
                submitAceTask(
                  "complete",
                  { duration: (song.durationSeconds || 120) + 60 },
                  "Extended"
                )
              }
            >
              Extend
            </Button>
          </>
        }
      >
        <Slider
          label="Extend from"
          value={rangeStart}
          min={0}
          max={maxDur}
          onChange={setRangeStart}
          formatValue={(v) => `${v}s`}
        />
        <label className="field-label" htmlFor="extend-cont" style={{ marginTop: 10 }}>
          Optional continuation (lyrics or style)
        </label>
        <textarea
          id="extend-cont"
          className="text-area"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="[Bridge]&#10;Carry the theme into brass and choir"
        />
        {err && <p className="inline-error">{err}</p>}
      </Modal>

      {/* Mashup — ACE-Step "lego", real local mix as fallback */}
      <Modal
        title="Mashup"
        open={modal === "mashup"}
        onClose={close}
        footer={
          <>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button
              loading={busy}
              disabled={!secondSourceId}
              onClick={localMashup}
              title="Blend the two audio files locally (real audio mix)"
            >
              Local mix
            </Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={!secondSourceId}
              onClick={aceMashup}
              title="Ask ACE-Step to regenerate a mashup; falls back to the local mix"
            >
              Create Mashup
            </Button>
          </>
        }
      >
        <label className="field-label" htmlFor="mashup-src">Second source</label>
        <select
          id="mashup-src"
          className="text-input"
          value={secondSourceId}
          onChange={(e) => setSecondSourceId(e.target.value)}
        >
          <option value="">Pick a song…</option>
          {songs
            .filter((s) => s.id !== song.id && !s.trashed && s.audioUrl)
            .map((s) => (
              <option key={s.id} value={s.id}>{s.title}</option>
            ))}
        </select>
        <div style={{ marginTop: 12 }}>
          <Slider label="Blend ratio" value={blend} onChange={setBlend} />
        </div>
        <p className="inline-hint">
          "Create Mashup" submits ACE-Step task_type "lego"; if the backend
          rejects it, the two tracks are blended locally instead (a real
          audio mix at the chosen ratio) — never a placeholder row.
        </p>
        {err && <p className="inline-error">{err}</p>}
      </Modal>

      {/* Replace Section — ACE-Step task_type: repaint */}
      <Modal
        title={`Replace section of "${song.title}"`}
        open={modal === "replace"}
        onClose={close}
        footer={
          <>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button
              variant="primary"
              loading={busy}
              onClick={() =>
                submitAceTask(
                  "repaint",
                  { repaintStart: rangeStart, repaintEnd: rangeEnd },
                  "Replace"
                )
              }
            >
              Replace
            </Button>
          </>
        }
      >
        <Slider label="Start" value={rangeStart} min={0} max={maxDur} onChange={(v) => setRangeStart(Math.min(v, rangeEnd))} formatValue={(v) => `${v}s`} />
        <Slider label="End" value={rangeEnd} min={0} max={maxDur} onChange={(v) => setRangeEnd(Math.max(v, rangeStart))} formatValue={(v) => `${v}s`} />
        <label className="field-label" htmlFor="replace-prompt" style={{ marginTop: 10 }}>
          Replacement prompt / lyrics / style
        </label>
        <textarea
          id="replace-prompt"
          className="text-area"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {err && <p className="inline-error">{err}</p>}
      </Modal>

      {/* Crop — REAL local audio processing */}
      <Modal
        title={`Crop "${song.title}"`}
        open={modal === "crop"}
        onClose={close}
        footer={
          <>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button
              variant="primary"
              loading={busy}
              onClick={() =>
                renderLocal("Cropped", "cropped", (b) =>
                  cropBuffer(b, rangeStart, rangeEnd)
                )
              }
            >
              Save cropped version
            </Button>
          </>
        }
      >
        <Slider label="Start" value={rangeStart} min={0} max={maxDur} onChange={(v) => setRangeStart(Math.min(v, rangeEnd))} formatValue={(v) => `${v}s`} />
        <Slider label="End" value={rangeEnd} min={0} max={maxDur} onChange={(v) => setRangeEnd(Math.max(v, rangeStart))} formatValue={(v) => `${v}s`} />
        <p className="inline-hint">Local audio processing — the crop is rendered to a new WAV.</p>
        {err && <p className="inline-error">{err}</p>}
      </Modal>

      {/* Remove Section — REAL local audio processing */}
      <Modal
        title={`Remove section from "${song.title}"`}
        open={modal === "remove"}
        onClose={close}
        footer={
          <>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button
              variant="primary"
              loading={busy}
              onClick={() =>
                renderLocal("Section removed", "cropped", (b) =>
                  removeSection(b, rangeStart, rangeEnd)
                )
              }
            >
              Save new version
            </Button>
          </>
        }
      >
        <Slider label="Start" value={rangeStart} min={0} max={maxDur} onChange={(v) => setRangeStart(Math.min(v, rangeEnd))} formatValue={(v) => `${v}s`} />
        <Slider label="End" value={rangeEnd} min={0} max={maxDur} onChange={(v) => setRangeEnd(Math.max(v, rangeStart))} formatValue={(v) => `${v}s`} />
        <p className="inline-hint">The selected region is cut out and the remainder is joined — real audio, no placeholder.</p>
        {err && <p className="inline-error">{err}</p>}
      </Modal>

      {/* Adjust Speed — REAL local audio processing */}
      <Modal
        title={`Adjust speed of "${song.title}"`}
        open={modal === "speed"}
        onClose={close}
        footer={
          <>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button
              variant="primary"
              loading={busy}
              onClick={() =>
                renderLocal(`${(speed / 100).toFixed(2)}x`, "remix", (b) =>
                  changeSpeed(b, speed / 100)
                )
              }
            >
              Create version
            </Button>
          </>
        }
      >
        <Slider
          label="Speed"
          value={speed}
          min={50}
          max={200}
          onChange={setSpeed}
          formatValue={(v) => `${(v / 100).toFixed(2)}x`}
        />
        <p className="inline-hint">
          Rendered as a real speed change. Note: pitch shifts with speed
          (pitch-preserving time-stretch is not available in the offline
          build).
        </p>
        {err && <p className="inline-error">{err}</p>}
      </Modal>

      {/* Delete Forever confirmation */}
      <Modal
        title={`Delete "${song.title}" forever?`}
        open={modal === "delete"}
        onClose={close}
        footer={
          <>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                deleteForever(song.id);
                close();
              }}
            >
              Delete Forever
            </Button>
          </>
        }
      >
        <p>
          This permanently removes the library entry. Tip: "Move to Trash"
          keeps it restorable for 14 days instead.
        </p>
      </Modal>

      {/* Export */}
      <Modal
        title={`Export "${song.title}"`}
        open={modal === "export"}
        onClose={close}
        footer={
          <>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            {hasAudio && (
              <Button onClick={download}>⬇ Download audio</Button>
            )}
            <Button
              variant="primary"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const res = await api.exportSongs([song.id]);
                  setErr(null);
                  addHistoryEvent(`Exported "${song.title}" to ${res.savedTo}`);
                  close();
                } catch (e: any) {
                  setErr(`Export failed: ${e?.message || e}`);
                  setBusy(false);
                }
              }}
            >
              Export manifest
            </Button>
          </>
        }
      >
        <p className="inline-hint">
          "Download audio" saves the file through your browser. "Export
          manifest" writes a JSON manifest (and audio reference) into
          ./outputs/exports on the host.
        </p>
        {err && <p className="inline-error">{err}</p>}
      </Modal>
    </>
  );
}
