/** Three-dot "Remix / Edit" menu for a song row (DESIGN_DOC §14).
 *
 *  Every item says what it does in its tooltip, and ⓘ at the top of the
 *  menu opens a full explanation of all options (which ones call the AI,
 *  which run locally, and what gets created).
 *
 *  ACE-Step backed:  Cover (cover), Extend (repaint past the end = outpaint),
 *                    Replace Section (repaint), Mashup smoothing (cover of the mix)
 *  MuScriptor:       Extract MIDI
 *  Local (browser):  Reverse, Adjust Speed, Crop, Remove Section, Sample, Mashup mix
 *  Metadata only:    Reuse Prompt, Use as Inspiration (form prefill)
 */
import React, { useState } from "react";
import { useJuno } from "../App";
import { Song } from "../data/mockSongs";
import { Dropdown } from "./Dropdown";
import { Modal } from "./Modal";
import { Button } from "./Button";
import { Slider } from "./Slider";
import { Badge } from "./Badge";
import { PlaylistMenuSection } from "./PlaylistMenuSection";
import { api } from "../lib/api";
import { fmtDuration } from "../lib/format";
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

type ModalKind = null | "extend" | "mashup" | "crop" | "remove" | "replace" | "speed" | "export" | "delete" | "help";

type Kind = "AI" | "MIDI" | "Local" | "Form" | "File";
const HELP: { name: string; kind: Kind; what: string }[] = [
  { name: "Open in Studio", kind: "Form", what: "Opens the multitrack Studio with this song placed as a clip, so you can mark a region and repaint or extend it in context." },
  { name: "Open in Editor", kind: "Form", what: "Waveform editor for this one song. Drag across the waveform to select a range, then crop it, cut it out, or regenerate just that part." },
  { name: "Cover", kind: "AI", what: "Keeps this song's melody, structure and lyrics and re-performs it in a new style. You describe the new style on the Create page; ACE-Step (task \"cover\") makes a new row. The original is untouched." },
  { name: "Extend", kind: "AI", what: "Continues the song past its end. ACE-Step regenerates from the \"extend from\" point and outpaints extra seconds (a repaint that runs beyond the last sample), blending into what came before. Creates a new, longer row labelled Extended." },
  { name: "Mashup", kind: "AI", what: "Blends this song with a second one. \"Mix only\" crossfades the two recordings in your browser at the chosen ratio. \"Mix + smooth with ACE-Step\" then runs that mix through a cover pass so it plays as one coherent track." },
  { name: "Sample this song", kind: "Local", what: "Finds the loudest 10-second stretch and saves it as a short clip. No AI involved. Samples show up in Library → Hooks." },
  { name: "Use as Inspiration", kind: "Form", what: "Opens Create with this song attached as a style reference (its sound and feel, via ACE-Step reference audio) and its style chips copied. Unlike Cover it does not keep the melody — you get a new song that belongs next to this one." },
  { name: "Extract MIDI", kind: "MIDI", what: "Transcribes the audio into notes for every instrument MuScriptor detects (piano, guitars, bass, strings, drums…). The result opens in the MIDI tab, where you can play and edit it; a 🎹 link appears on this row." },
  { name: "Reverse", kind: "Local", what: "Plays the whole song backwards. Rendered in your browser and saved as a new track." },
  { name: "Adjust Speed", kind: "Local", what: "Makes a faster or slower version (0.5×–2×). Pitch moves with speed, like a turntable. Saved as a new track." },
  { name: "Reuse Prompt", kind: "Form", what: "Copies this song's prompt, styles, lyrics and sliders back into Create so you can tweak and generate again. No audio is attached." },
  { name: "Playlists", kind: "Form", what: "Tick a playlist to add or remove this song. Create playlists in Library → Playlists." },
  { name: "Crop", kind: "Local", what: "Keeps only the range you choose and saves it as a new track." },
  { name: "Remove Section", kind: "Local", what: "Cuts the chosen range out and joins the parts before and after it. Saved as a new track." },
  { name: "Replace Section", kind: "AI", what: "Regenerates only the chosen range from a new prompt or lyrics (ACE-Step repaint). Everything outside the range stays identical. Creates a new row." },
  { name: "Download", kind: "File", what: "Saves the audio file to your computer through the browser." },
  { name: "Export", kind: "File", what: "Writes a JSON manifest (all metadata plus the audio file name) to ./outputs/exports on the host." },
  { name: "Move to Trash / Delete Forever", kind: "File", what: "Trash keeps the song restorable for 14 days. Delete Forever removes the library entry now; the audio file stays on disk." },
];
const KIND_LABEL: Record<Kind, { label: string; tone: "accent" | "success" | "default" | "warning" }> = {
  AI: { label: "ACE-Step", tone: "accent" },
  MIDI: { label: "MuScriptor", tone: "warning" },
  Local: { label: "Local", tone: "success" },
  Form: { label: "Opens a page", tone: "default" },
  File: { label: "File", tone: "default" },
};
const tip = (name: string) => HELP.find((h) => h.name === name)?.what;

export function SongOverflowMenu({ song }: { song: Song }) {
  const { navigate, generate, addSong, songs, setPrefill, addHistoryEvent, selectedPreset, trashSong, deleteForever, extractMidi, midiItems, notify } =
    useJuno();
  const [modal, setModal] = useState<ModalKind>(null);
  const [text, setText] = useState("");
  const dur = Math.max(1, Math.round(song.durationSeconds || 0) || 30);
  const [rangeStart, setRangeStart] = useState(0);
  const [rangeEnd, setRangeEnd] = useState(Math.min(30, dur));
  const [extendFrom, setExtendFrom] = useState(Math.max(0, dur - 10));
  const [extendBy, setExtendBy] = useState(30);
  const [speed, setSpeed] = useState(100);
  const [secondSourceId, setSecondSourceId] = useState("");
  const [blend, setBlend] = useState(50);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const hasAudio = !!song.audioUrl;
  const hasFile = !!song.localAudioPath;
  const midiRunning = midiItems.some((m) => m.sourceSongId === song.id && ["queued", "starting", "running"].includes(m.status));

  const open = (m: ModalKind) => {
    setErr(null);
    setText("");
    if (m === "extend") setExtendFrom(Math.max(0, dur - 10));
    if (m === "crop" || m === "remove" || m === "replace") {
      setRangeStart(0);
      setRangeEnd(Math.min(30, dur));
    }
    setModal(m);
  };
  const close = () => {
    setModal(null);
    setErr(null);
    setText("");
    setBusy(false);
  };

  /** Render a REAL local derivative: decode -> process -> WAV -> save. */
  const renderLocal = async (label: string, type: Song["type"], fn: (b: AudioBuffer) => AudioBuffer | Promise<AudioBuffer>) => {
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

  const submitAceTask = async (taskType: string, extra: Record<string, unknown>, label: string) => {
    setBusy(true);
    setErr(null);
    try {
      await generate({
        taskType,
        model: selectedPreset,
        title: `${song.title} (${label})`,
        prompt: text || song.description,
        styles: song.styles,
        lyrics: song.lyrics,
        instrumental: song.metadata.instrumental,
        duration: dur,
        srcAudioPath: song.localAudioPath,
        sourceSongId: song.id,
        workspaceId: song.workspaceId,
        ...extra,
      } as any);
      close();
    } catch (e: any) {
      setErr(`${e?.message || e}`);
      setBusy(false);
    }
  };

  const startCover = () => {
    setPrefill({
      taskType: "cover",
      srcAudioPath: song.localAudioPath,
      coverOfTitle: song.title,
      sourceSongId: song.id,
      lyrics: song.lyrics,
      instrumental: song.metadata.instrumental,
      title: `${song.title} (Cover)`,
      styles: [],
    });
    navigate("/create");
  };

  const useAsInspiration = () => {
    setPrefill({
      styles: song.styles,
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

  /** Local crossfade mix of the two songs; returns the saved row. */
  const mixTwo = async (): Promise<Song | null> => {
    const second = songs.find((s) => s.id === secondSourceId);
    if (!second) return null;
    if (!song.audioUrl || !second.audioUrl) throw new Error("Both songs need audio for a mashup.");
    const [a, b] = await Promise.all([loadBuffer(song.audioUrl), loadBuffer(second.audioUrl)]);
    const out = mixBuffers(a, b, blend);
    const title = `${song.title} × ${second.title}`;
    const res = await api.upload(bufferToFile(out, title), {
      title,
      type: "mashup",
      description: `Mix of "${song.title}" and "${second.title}" (${blend}% blend)`,
      sourceSongId: song.id,
      workspaceId: song.workspaceId,
      durationSeconds: Math.round(out.duration),
      styles: [...new Set([...song.styles, ...second.styles])],
    });
    addSong(res.asset);
    addHistoryEvent(`Mashup: "${song.title}" × "${second.title}"`);
    return res.asset;
  };

  const mashup = async (smooth: boolean) => {
    setBusy(true);
    setErr(null);
    try {
      const mixed = await mixTwo();
      if (!mixed) return;
      if (smooth && mixed.localAudioPath) {
        const second = songs.find((s) => s.id === secondSourceId);
        await generate({
          taskType: "cover",
          model: selectedPreset,
          title: `${mixed.title} (blended)`,
          prompt: text || [song.description, second?.description].filter(Boolean).join(" meets "),
          styles: mixed.styles,
          instrumental: song.metadata.instrumental && !!second?.metadata.instrumental,
          duration: mixed.durationSeconds || dur,
          srcAudioPath: mixed.localAudioPath,
          coverStrength: 0.6,
          songType: "mashup",
          sourceSongId: song.id,
          workspaceId: song.workspaceId,
        });
      }
      close();
    } catch (e: any) {
      setErr(`Mashup failed: ${e?.message || e}`);
      setBusy(false);
    }
  };

  const download = () => {
    if (!song.audioUrl) return;
    const rawExt = song.audioUrl.split("?")[0].split(".").pop() || "wav";
    const ext = rawExt.length <= 5 ? rawExt : "wav";
    downloadUrl(song.audioUrl, `${song.title}.${ext}`);
    addHistoryEvent(`Downloaded "${song.title}"`);
  };

  const needsAudio = hasAudio ? undefined : " (needs audio)";
  const needsFile = hasFile ? "" : " (needs audio)";
  const extendWindow = dur + extendBy - extendFrom;

  return (
    <>
      <Dropdown triggerClass="btn btn-icon" ariaLabel={`More actions for ${song.title}`} trigger={<>⋯</>}>
        <div className="menu-label menu-label-row">
          <span>♪ Remix / Edit</span>
          <button className="btn btn-icon menu-help" aria-label="What do these options do?" title="What do these options do?" onClick={() => open("help")}>
            ⓘ
          </button>
        </div>
        <button className="menu-item" title={tip("Open in Studio")} onClick={() => navigate(`/studio?song=${song.id}`)}>
          Open in Studio <span className="badge badge-accent">New</span>
        </button>
        <button className="menu-item" title={tip("Open in Editor")} onClick={() => navigate(`/editor/${song.id}`)}>
          Open in Editor
        </button>
        <button className="menu-item" disabled={!hasFile} title={tip("Cover")} onClick={startCover}>
          Cover{needsFile}
        </button>
        <button className="menu-item" disabled={!hasFile} title={tip("Extend")} onClick={() => open("extend")}>
          Extend{needsFile}
        </button>
        <button className="menu-item" disabled={!hasAudio} title={tip("Mashup")} onClick={() => open("mashup")}>
          Mashup{needsAudio}
        </button>
        <button className="menu-item" disabled={!hasAudio} title={tip("Sample this song")} onClick={() => renderLocal("Sample", "sample", (b) => extractSample(b, 10))}>
          Sample this song{needsAudio}
        </button>
        <button className="menu-item" title={tip("Use as Inspiration")} onClick={useAsInspiration}>
          Use as Inspiration
        </button>
        <button
          className="menu-item"
          disabled={!hasFile || midiRunning}
          title={tip("Extract MIDI")}
          onClick={() => void extractMidi(song.id)}
        >
          🎹 Extract MIDI{midiRunning ? " (running…)" : needsFile}
        </button>
        <button className="menu-item" disabled={!hasAudio} title={tip("Reverse")} onClick={() => renderLocal("Reversed", "reversed", reverseBuffer)}>
          Reverse{needsAudio}
        </button>
        <button className="menu-item" disabled={!hasAudio} title={tip("Adjust Speed")} onClick={() => open("speed")}>
          Adjust Speed{needsAudio}
        </button>
        <div className="menu-divider" />
        <button
          className="menu-item"
          title={tip("Reuse Prompt")}
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
        <button className="menu-item" disabled={!hasAudio} title={tip("Crop")} onClick={() => open("crop")}>
          Crop{needsAudio}
        </button>
        <button className="menu-item" disabled={!hasAudio} title={tip("Remove Section")} onClick={() => open("remove")}>
          Remove Section{needsAudio}
        </button>
        <button className="menu-item" disabled={!hasFile} title={tip("Replace Section")} onClick={() => open("replace")}>
          Replace Section{needsFile}
        </button>
        <div className="menu-divider" />
        <button className="menu-item" disabled={!hasAudio} title={tip("Download")} onClick={download}>
          ⬇ Download{needsAudio}
        </button>
        <button className="menu-item" title={tip("Export")} onClick={() => open("export")}>
          Export
        </button>
        <div className="menu-divider" />
        {!song.trashed && (
          <button className="menu-item" onClick={() => trashSong(song.id)}>
            🗑 Move to Trash
          </button>
        )}
        <button className="menu-item" onClick={() => open("delete")}>
          Delete Forever
        </button>
      </Dropdown>

      {/* What each option does */}
      <Modal title="Remix / Edit options" open={modal === "help"} onClose={close}>
        <div className="help-list">
          {HELP.map((h) => (
            <div key={h.name} className="help-item">
              <div className="help-item-head">
                <strong>{h.name}</strong>
                <Badge tone={KIND_LABEL[h.kind].tone}>{KIND_LABEL[h.kind].label}</Badge>
              </div>
              <p>{h.what}</p>
            </div>
          ))}
        </div>
        <p className="inline-hint">
          ACE-Step options run on your GPU with the preset selected on the Create page (Extend, Cover and Replace work on
          every preset). Local options never call a model. Every option that makes audio creates a new row — the
          original is never overwritten.
        </p>
      </Modal>

      {/* Extend — ACE-Step repaint past the end (outpainting) */}
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
                  "repaint",
                  {
                    repaintStart: extendFrom,
                    repaintEnd: dur + extendBy,
                    duration: dur + extendBy,
                    songType: "extended",
                  },
                  "Extended"
                )
              }
            >
              Extend
            </Button>
          </>
        }
      >
        <Slider label="Extend from" value={extendFrom} min={0} max={dur} onChange={setExtendFrom} formatValue={(v) => fmtDuration(v)} />
        <Slider label="Add" value={extendBy} min={10} max={90} step={5} onChange={setExtendBy} formatValue={(v) => `${v}s`} />
        <p className="inline-hint">
          Everything before {fmtDuration(extendFrom)} is kept. From there, ACE-Step writes new music until{" "}
          {fmtDuration(dur + extendBy)} — the new song is {fmtDuration(dur + extendBy)} long.
          {extendWindow > 90 && " Heads up: regenerating more than ~90 s at once gets less coherent; move “Extend from” later."}
        </p>
        <label className="field-label" htmlFor="extend-cont" style={{ marginTop: 10 }}>
          Direction for the new part (optional)
        </label>
        <textarea
          id="extend-cont"
          className="text-area"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. build into a final chorus with brass and choir"
        />
        {err && <p className="inline-error">{err}</p>}
      </Modal>

      {/* Mashup — local mix, optionally smoothed by an ACE cover pass */}
      <Modal
        title="Mashup"
        open={modal === "mashup"}
        onClose={close}
        footer={
          <>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button loading={busy} disabled={!secondSourceId} onClick={() => mashup(false)}>
              Mix only
            </Button>
            <Button variant="primary" loading={busy} disabled={!secondSourceId || !hasFile} onClick={() => mashup(true)}>
              Mix + smooth with ACE-Step
            </Button>
          </>
        }
      >
        <label className="field-label" htmlFor="mashup-src">Second song</label>
        <select id="mashup-src" className="text-input" value={secondSourceId} onChange={(e) => setSecondSourceId(e.target.value)}>
          <option value="">Pick a song…</option>
          {songs
            .filter((s) => s.id !== song.id && !s.trashed && s.audioUrl)
            .map((s) => (
              <option key={s.id} value={s.id}>{s.title}</option>
            ))}
        </select>
        <div style={{ marginTop: 12 }}>
          <Slider label="Blend" value={blend} onChange={setBlend} formatValue={(v) => `${100 - v}/${v}`} />
        </div>
        <label className="field-label" htmlFor="mashup-prompt" style={{ marginTop: 10 }}>
          Style for the smoothed version (optional)
        </label>
        <input id="mashup-prompt" className="text-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. one cohesive synthwave track" />
        <p className="inline-hint">
          "Mix only" layers the two recordings. "Mix + smooth" also sends that mix through ACE-Step (cover, 60% strength)
          so rhythm and harmony are re-performed as one song — you get both rows.
        </p>
        {err && <p className="inline-error">{err}</p>}
      </Modal>

      {/* Replace Section — ACE-Step repaint */}
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
              disabled={rangeEnd - rangeStart < 3}
              onClick={() => submitAceTask("repaint", { repaintStart: rangeStart, repaintEnd: rangeEnd, songType: "replacement" }, "Replace")}
            >
              Replace
            </Button>
          </>
        }
      >
        <Slider label="Start" value={rangeStart} min={0} max={dur} onChange={(v) => setRangeStart(Math.min(v, rangeEnd))} formatValue={(v) => fmtDuration(v)} />
        <Slider label="End" value={rangeEnd} min={0} max={dur} onChange={(v) => setRangeEnd(Math.max(v, rangeStart))} formatValue={(v) => fmtDuration(v)} />
        <label className="field-label" htmlFor="replace-prompt" style={{ marginTop: 10 }}>
          What should happen in this part?
        </label>
        <textarea id="replace-prompt" className="text-area" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. strip the drums, add a piano break" />
        <p className="inline-hint">Pick at least 3 seconds. Only this range changes; ACE-Step blends the edges.</p>
        {err && <p className="inline-error">{err}</p>}
      </Modal>

      {/* Crop */}
      <Modal
        title={`Crop "${song.title}"`}
        open={modal === "crop"}
        onClose={close}
        footer={
          <>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={() => renderLocal("Cropped", "cropped", (b) => cropBuffer(b, rangeStart, rangeEnd))}>
              Save cropped version
            </Button>
          </>
        }
      >
        <Slider label="Start" value={rangeStart} min={0} max={dur} onChange={(v) => setRangeStart(Math.min(v, rangeEnd))} formatValue={(v) => fmtDuration(v)} />
        <Slider label="End" value={rangeEnd} min={0} max={dur} onChange={(v) => setRangeEnd(Math.max(v, rangeStart))} formatValue={(v) => fmtDuration(v)} />
        <p className="inline-hint">Keeps only this range, rendered to a new WAV in your browser.</p>
        {err && <p className="inline-error">{err}</p>}
      </Modal>

      {/* Remove Section */}
      <Modal
        title={`Remove section from "${song.title}"`}
        open={modal === "remove"}
        onClose={close}
        footer={
          <>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={() => renderLocal("Section removed", "cropped", (b) => removeSection(b, rangeStart, rangeEnd))}>
              Save new version
            </Button>
          </>
        }
      >
        <Slider label="Start" value={rangeStart} min={0} max={dur} onChange={(v) => setRangeStart(Math.min(v, rangeEnd))} formatValue={(v) => fmtDuration(v)} />
        <Slider label="End" value={rangeEnd} min={0} max={dur} onChange={(v) => setRangeEnd(Math.max(v, rangeStart))} formatValue={(v) => fmtDuration(v)} />
        <p className="inline-hint">The range is cut out and the parts before and after are joined.</p>
        {err && <p className="inline-error">{err}</p>}
      </Modal>

      {/* Adjust Speed */}
      <Modal
        title={`Adjust speed of "${song.title}"`}
        open={modal === "speed"}
        onClose={close}
        footer={
          <>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={() => renderLocal(`${(speed / 100).toFixed(2)}x`, "remix", (b) => changeSpeed(b, speed / 100))}>
              Create version
            </Button>
          </>
        }
      >
        <Slider label="Speed" value={speed} min={50} max={200} onChange={setSpeed} formatValue={(v) => `${(v / 100).toFixed(2)}x`} />
        <p className="inline-hint">Pitch moves with speed, like a turntable.</p>
        {err && <p className="inline-error">{err}</p>}
      </Modal>

      {/* Delete Forever */}
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
        <p>This permanently removes the library entry. "Move to Trash" keeps it restorable for 14 days instead.</p>
      </Modal>

      {/* Export */}
      <Modal
        title={`Export "${song.title}"`}
        open={modal === "export"}
        onClose={close}
        footer={
          <>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            {hasAudio && <Button onClick={download}>⬇ Download audio</Button>}
            <Button
              variant="primary"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const res = await api.exportSongs([song.id]);
                  addHistoryEvent(`Exported "${song.title}" to ${res.savedTo}`);
                  notify(`Manifest written to ${res.savedTo}`, "success");
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
          "Download audio" saves the file through your browser. "Export manifest" writes a JSON manifest (and the audio
          file name) into ./outputs/exports on the host.
        </p>
        {err && <p className="inline-error">{err}</p>}
      </Modal>
    </>
  );
}
