/** Three-dot song action menu (DESIGN_DOC §14). No Pro badges.
 *
 *  ACE-Step-backed actions submit real tasks through /api/generate:
 *    Cover -> task_type "cover", Replace Section -> "repaint",
 *    Extend -> "complete", Mashup -> "lego".
 *  Local-only actions (Reverse, Adjust Speed, Crop, Remove Section, Sample,
 *  Reuse Prompt) create local derivative rows / form state. See
 *  docs/API_MAPPING.md.
 */
import React, { useState } from "react";
import { useJuno } from "../App";
import { Song } from "../data/mockSongs";
import { Dropdown } from "./Dropdown";
import { Modal } from "./Modal";
import { Button } from "./Button";
import { Slider } from "./Slider";
import { newId } from "../lib/ids";
import { api } from "../lib/api";

type ModalKind =
  | null
  | "cover"
  | "extend"
  | "mashup"
  | "crop"
  | "remove"
  | "replace"
  | "speed"
  | "export";

export function SongOverflowMenu({ song }: { song: Song }) {
  const {
    navigate,
    generate,
    addSong,
    songs,
    setPrefill,
    addHistoryEvent,
    selectedPreset,
  } = useJuno();
  const [modal, setModal] = useState<ModalKind>(null);
  const [text, setText] = useState("");
  const [rangeStart, setRangeStart] = useState(0);
  const [rangeEnd, setRangeEnd] = useState(Math.min(30, song.durationSeconds));
  const [speed, setSpeed] = useState(100);
  const [preservePitch, setPreservePitch] = useState(true);
  const [secondSourceId, setSecondSourceId] = useState("");
  const [blend, setBlend] = useState(50);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const close = () => {
    setModal(null);
    setErr(null);
    setText("");
  };

  /** Local derivative row for offline-safe actions. */
  const localDerivative = (
    type: Song["type"],
    titleSuffix: string,
    duration = song.durationSeconds,
    description = song.description
  ) => {
    const now = new Date().toISOString();
    const copy: Song = {
      ...song,
      id: newId("song"),
      title: `${song.title} (${titleSuffix})`,
      type,
      durationSeconds: duration,
      description,
      sourceSongId: song.id,
      liked: false,
      disliked: false,
      public: false,
      playCount: 0,
      commentCount: 0,
      createdAt: now,
      updatedAt: now,
      generationStatus: "idle",
      audioUrl: song.audioUrl, // local processing TODO: real DSP render
    };
    addSong(copy);
    addHistoryEvent(`${titleSuffix} "${song.title}"`);
  };

  const submitAceTask = async (
    taskType: string,
    extra: Record<string, unknown>,
    fallbackType: Song["type"],
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
        duration: song.durationSeconds,
        srcAudioPath: song.localAudioPath,
        sourceSongId: song.id,
        ...extra,
      } as any);
      close();
    } catch (e: any) {
      // ACE-Step offline: keep the workflow alive with a local placeholder.
      localDerivative(fallbackType, label);
      setErr(
        `ACE-Step unavailable (${e?.message || e}). Created a local placeholder instead.`
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dropdown
        triggerClass="btn btn-icon"
        ariaLabel={`More actions for ${song.title}`}
        trigger={<>⋯</>}
      >
        <div className="menu-label">♪ Remix/Edit</div>
        <button className="menu-item" onClick={() => navigate("/studio")}>
          Open in Studio <span className="badge badge-accent">New</span>
        </button>
        <button className="menu-item" onClick={() => navigate(`/editor/${song.id}`)}>
          Open in Editor
        </button>
        <button className="menu-item" onClick={() => setModal("cover")}>Cover</button>
        <button className="menu-item" onClick={() => setModal("extend")}>Extend</button>
        <button className="menu-item" onClick={() => setModal("mashup")}>Mashup</button>
        <button
          className="menu-item"
          onClick={() => {
            // Local sample extraction (local-only per DESIGN_DOC §14.2).
            localDerivative("sample", "Sample", Math.min(12, song.durationSeconds));
          }}
        >
          Sample this song
        </button>
        <button
          className="menu-item"
          onClick={() => {
            // Copy metadata into the Create form + reference audio if present.
            setPrefill({
              styles: song.styles,
              prompt: song.description,
              vocalGender: song.metadata.vocalGender,
              weirdness: song.metadata.weirdness,
              styleInfluence: song.metadata.styleInfluence,
              instrumental: song.metadata.instrumental,
              referenceAudioPath: song.localAudioPath,
              sourceSongId: song.id,
            });
            navigate("/create");
          }}
        >
          Use as Inspiration
        </button>
        <button
          className="menu-item"
          onClick={() => localDerivative("reversed", "Reversed")}
        >
          Reverse
        </button>
        <button className="menu-item" onClick={() => setModal("speed")}>Adjust Speed</button>
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
        <div className="menu-divider" />
        <button className="menu-item" onClick={() => setModal("crop")}>Crop</button>
        <button className="menu-item" onClick={() => setModal("remove")}>Remove Section</button>
        <button className="menu-item" onClick={() => setModal("replace")}>Replace Section</button>
        <div className="menu-divider" />
        <button className="menu-item" onClick={() => setModal("export")}>Export</button>
      </Dropdown>

      {/* Cover — ACE-Step task_type: cover */}
      <Modal
        title={`Cover "${song.title}"`}
        open={modal === "cover"}
        onClose={close}
        footer={
          <>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button
              variant="primary"
              loading={busy}
              onClick={() => submitAceTask("cover", {}, "cover", "Cover")}
            >
              Create Cover
            </Button>
          </>
        }
      >
        <label className="field-label" htmlFor="cover-style">New style</label>
        <textarea
          id="cover-style"
          className="text-area"
          placeholder="e.g. icy synthwave, half-time drums, wide chorus"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {err && <p className="inline-error">{err}</p>}
      </Modal>

      {/* Extend — ACE-Step task_type: complete (where supported) */}
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
                  { duration: song.durationSeconds + 60 },
                  "extended",
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
          max={song.durationSeconds}
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
        <p className="inline-hint">
          Uses ACE-Step "complete" where supported; otherwise a local
          placeholder row is created (documented TODO).
        </p>
        {err && <p className="inline-error">{err}</p>}
      </Modal>

      {/* Mashup — ACE-Step task_type: lego (where supported) */}
      <Modal
        title="Mashup"
        open={modal === "mashup"}
        onClose={close}
        footer={
          <>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={!secondSourceId}
              onClick={() =>
                submitAceTask(
                  "lego",
                  {
                    referenceAudioPath: songs.find((s) => s.id === secondSourceId)
                      ?.localAudioPath,
                    weirdness: blend,
                  },
                  "mashup",
                  "Mashup"
                )
              }
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
            .filter((s) => s.id !== song.id && !s.trashed)
            .map((s) => (
              <option key={s.id} value={s.id}>{s.title}</option>
            ))}
        </select>
        <div style={{ marginTop: 12 }}>
          <Slider label="Blend ratio" value={blend} onChange={setBlend} />
        </div>
        <p className="inline-hint">
          Uses ACE-Step "lego" where supported; otherwise a local placeholder
          row is created (documented TODO).
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
                  "replacement",
                  "Replace"
                )
              }
            >
              Replace
            </Button>
          </>
        }
      >
        <Slider
          label="Start"
          value={rangeStart}
          min={0}
          max={song.durationSeconds}
          onChange={(v) => setRangeStart(Math.min(v, rangeEnd))}
          formatValue={(v) => `${v}s`}
        />
        <Slider
          label="End"
          value={rangeEnd}
          min={0}
          max={song.durationSeconds}
          onChange={(v) => setRangeEnd(Math.max(v, rangeStart))}
          formatValue={(v) => `${v}s`}
        />
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

      {/* Crop — local audio processing */}
      <Modal
        title={`Crop "${song.title}"`}
        open={modal === "crop"}
        onClose={close}
        footer={
          <>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                localDerivative("cropped", "Cropped", Math.max(1, rangeEnd - rangeStart));
                close();
              }}
            >
              Save cropped version
            </Button>
          </>
        }
      >
        <Slider label="Start" value={rangeStart} min={0} max={song.durationSeconds} onChange={(v) => setRangeStart(Math.min(v, rangeEnd))} formatValue={(v) => `${v}s`} />
        <Slider label="End" value={rangeEnd} min={0} max={song.durationSeconds} onChange={(v) => setRangeEnd(Math.max(v, rangeStart))} formatValue={(v) => `${v}s`} />
        <p className="inline-hint">Local audio processing — no model call.</p>
      </Modal>

      {/* Remove Section — local audio processing */}
      <Modal
        title={`Remove section from "${song.title}"`}
        open={modal === "remove"}
        onClose={close}
        footer={
          <>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                localDerivative(
                  "cropped",
                  "Section removed",
                  Math.max(1, song.durationSeconds - (rangeEnd - rangeStart))
                );
                close();
              }}
            >
              Save new version
            </Button>
          </>
        }
      >
        <Slider label="Start" value={rangeStart} min={0} max={song.durationSeconds} onChange={(v) => setRangeStart(Math.min(v, rangeEnd))} formatValue={(v) => `${v}s`} />
        <Slider label="End" value={rangeEnd} min={0} max={song.durationSeconds} onChange={(v) => setRangeEnd(Math.max(v, rangeStart))} formatValue={(v) => `${v}s`} />
        <p className="inline-hint">Preview skips the selected region. Local audio processing only.</p>
      </Modal>

      {/* Adjust Speed — local audio processing */}
      <Modal
        title={`Adjust speed of "${song.title}"`}
        open={modal === "speed"}
        onClose={close}
        footer={
          <>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                localDerivative(
                  "remix",
                  `${(speed / 100).toFixed(2)}x`,
                  Math.round(song.durationSeconds / (speed / 100))
                );
                close();
              }}
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
        <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
          <input
            type="checkbox"
            checked={preservePitch}
            onChange={(e) => setPreservePitch(e.target.checked)}
          />
          Preserve pitch
        </label>
      </Modal>

      {/* Export */}
      <Modal
        title={`Export "${song.title}"`}
        open={modal === "export"}
        onClose={close}
        footer={
          <>
            <Button variant="ghost" onClick={close}>Cancel</Button>
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
                } finally {
                  setBusy(false);
                }
              }}
            >
              Export locally
            </Button>
          </>
        }
      >
        <p className="inline-hint">
          Writes a JSON manifest (and audio reference) into ./outputs/exports
          on the host. No cloud involved.
        </p>
        {err && <p className="inline-error">{err}</p>}
      </Modal>
    </>
  );
}
