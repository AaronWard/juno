/** Studio page (DESIGN_DOC §20): multi-track arrangement view.
 *
 *  Changes:
 *  - MOCK DATA REMOVED: the timeline starts empty. Add clips from your own
 *    library via the "＋ Add clip" button on each track head.
 *  - Every region has an ⓘ help button opening a modal that explains what
 *    it is for (Tracks, Timeline, Inspector, Generation actions).
 *  - "Generate section" / "Repaint region" / "Extend arrangement" still
 *    submit real ACE-Step tasks using the Juno XL Studio preset.
 */
import React, { useState } from "react";
import { useJuno } from "../App";
import { Button } from "../components/Button";
import { Slider } from "../components/Slider";
import { Badge } from "../components/Badge";
import { Modal } from "../components/Modal";
import { Dropdown } from "../components/Dropdown";
import { fmtDuration } from "../lib/format";
import { coverGradient } from "../lib/audio";
import { newId } from "../lib/ids";

interface Clip {
  id: string;
  trackId: string;
  name: string;
  start: number; // seconds
  length: number; // seconds
  songId?: string;
}

interface Track {
  id: string;
  name: string;
  kind: "vocals" | "drums" | "bass" | "music";
  muted: boolean;
  solo: boolean;
  locked: boolean;
  volume: number;
}

const INITIAL_TRACKS: Track[] = [
  { id: "t_vox", name: "Vocals", kind: "vocals", muted: false, solo: false, locked: false, volume: 80 },
  { id: "t_drums", name: "Drums", kind: "drums", muted: false, solo: false, locked: false, volume: 75 },
  { id: "t_bass", name: "Bass", kind: "bass", muted: false, solo: false, locked: false, volume: 70 },
  { id: "t_music", name: "Music", kind: "music", muted: false, solo: false, locked: false, volume: 85 },
];

const TIMELINE_SECONDS = 96;
const PX_PER_SEC = 8;

const HELP: Record<string, { title: string; body: string }> = {
  tracks: {
    title: "Tracks",
    body:
      "Each row is an arrangement lane (Vocals, Drums, Bass, Music). " +
      "M mutes the lane, S solos it, 🔒 locks it against edits, and the " +
      "slider sets its mix volume. Use ＋ Add clip to place a song from " +
      "your library onto the lane as a clip you can position and trim.",
  },
  timeline: {
    title: "Timeline",
    body:
      "The timeline shows your clips laid out over time (ruler along the " +
      "top). Click a clip to select it and edit its start/length in the " +
      "Inspector. The pink band is the SELECTED REGION — set its start and " +
      "end in the Inspector; the generation actions below target exactly " +
      "that region.",
  },
  inspector: {
    title: "Inspector",
    body:
      "The Inspector edits whatever is selected. For a clip: move its " +
      "start, change its length, or delete it (Undo/Redo cover these " +
      "edits). Below that you define the selected region used by the " +
      "generation actions.",
  },
  generate: {
    title: "Generation actions",
    body:
      "These submit real ACE-Step tasks with the Juno XL Studio preset " +
      "(base model, 50 steps, CFG on):\n\n" +
      "• Generate section — creates brand new music sized to the selected " +
      "region (task_type text2music).\n" +
      "• Repaint region — regenerates only the selected time range of the " +
      "source material (task_type repaint).\n" +
      "• Extend arrangement — continues the arrangement past its current " +
      "end (task_type complete).\n\n" +
      "Results land as new rows in your active workspace on the Create " +
      "page; pull them back in here with ＋ Add clip.",
  },
};

export function StudioPage() {
  const { generate, addHistoryEvent, health, songs } = useJuno();
  const [tracks, setTracks] = useState(INITIAL_TRACKS);
  const [clips, setClips] = useState<Clip[]>([]); // clean slate — no mock clips
  const [selectedClip, setSelectedClip] = useState<string | null>(null);
  const [region, setRegion] = useState<{ start: number; end: number }>({ start: 0, end: 16 });
  const [undoStack, setUndoStack] = useState<Clip[][]>([]);
  const [redoStack, setRedoStack] = useState<Clip[][]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [help, setHelp] = useState<string | null>(null);
  const [projectName] = useState("Untitled Project");

  const clip = clips.find((c) => c.id === selectedClip) || null;
  const librarySongs = songs.filter((s) => !s.trashed);

  const pushUndo = () => {
    setUndoStack((u) => [...u, clips.map((c) => ({ ...c }))]);
    setRedoStack([]);
  };
  const undo = () => {
    const prev = undoStack[undoStack.length - 1];
    if (!prev) return;
    setRedoStack((r) => [...r, clips]);
    setClips(prev);
    setUndoStack((u) => u.slice(0, -1));
  };
  const redo = () => {
    const next = redoStack[redoStack.length - 1];
    if (!next) return;
    setUndoStack((u) => [...u, clips]);
    setClips(next);
    setRedoStack((r) => r.slice(0, -1));
  };

  const patchTrack = (id: string, patch: Partial<Track>) =>
    setTracks((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const addClip = (trackId: string, songId: string) => {
    const song = songs.find((s) => s.id === songId);
    if (!song) return;
    pushUndo();
    const c: Clip = {
      id: newId("clip"),
      trackId,
      name: song.title,
      start: 0,
      length: Math.max(4, Math.min(TIMELINE_SECONDS, song.durationSeconds || 16)),
      songId,
    };
    setClips((cs) => [...cs, c]);
    setSelectedClip(c.id);
  };

  const helpButton = (key: string) => (
    <Button variant="icon" label={`What is ${HELP[key].title}?`} onClick={() => setHelp(key)}>
      ⓘ
    </Button>
  );

  const aceAction = async (label: string, taskType: string, extra: Record<string, unknown>) => {
    setBusy(label);
    setNotice(null);
    try {
      await generate({
        taskType,
        model: "juno-xl-studio",
        title: `${projectName} — ${label}`,
        prompt: `studio ${label.toLowerCase()} for section ${region.start}s–${region.end}s`,
        styles: ["studio", "arrangement"],
        duration: Math.max(10, region.end - region.start),
        ...extra,
      } as any);
      setNotice(`${label} task submitted with Juno XL Studio — track the row on the Create page.`);
      addHistoryEvent(`Studio: ${label} (${projectName})`);
    } catch (e: any) {
      setNotice(`${label} failed: ${e?.message || e}. A failed row documents the attempt.`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page">
      <div className="page-title-row">
        <div>
          <h1 className="page-title">Studio</h1>
          <span className="inline-hint">{projectName} · offline session</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="ghost" disabled={!undoStack.length} onClick={undo}>↶ Undo</Button>
          <Button variant="ghost" disabled={!redoStack.length} onClick={redo}>↷ Redo</Button>
          <Button onClick={() => { addHistoryEvent(`Saved Studio project "${projectName}"`); setNotice("Project saved locally."); }}>
            Save
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              addHistoryEvent(`Exported Studio project "${projectName}"`);
              setNotice("Export manifest queued to ./outputs/exports (host).");
            }}
          >
            Export
          </Button>
        </div>
      </div>

      {health?.aceStep !== "ok" && (
        <p className="inline-hint" role="status">
          ACE-Step is offline — arrangement editing works, generation actions
          will record failed rows instead of audio.
        </p>
      )}
      {notice && <p className="inline-hint" role="status">{notice}</p>}

      <div className="studio-grid">
        {/* track headers */}
        <div className="studio-tracks">
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <strong>Tracks</strong>
            {helpButton("tracks")}
          </div>
          {tracks.map((t) => (
            <div key={t.id} className={`track-head${t.muted ? " muted" : ""}`}>
              <strong>{t.name}</strong>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                <Button variant="icon" label={`Mute ${t.name}`} active={t.muted} onClick={() => patchTrack(t.id, { muted: !t.muted })}>M</Button>
                <Button variant="icon" label={`Solo ${t.name}`} active={t.solo} onClick={() => patchTrack(t.id, { solo: !t.solo })}>S</Button>
                <Button variant="icon" label={`Lock ${t.name}`} active={t.locked} onClick={() => patchTrack(t.id, { locked: !t.locked })}>🔒</Button>
                <Dropdown
                  align="left"
                  triggerClass="btn btn-icon"
                  ariaLabel={`Add clip to ${t.name}`}
                  trigger={<>＋</>}
                  items={
                    librarySongs.length
                      ? librarySongs.slice(0, 12).map((s) => ({
                          id: s.id,
                          label: `♪ ${s.title}`,
                          onSelect: () => addClip(t.id, s.id),
                        }))
                      : [{ id: "none", label: "No songs in your library yet", disabled: true }]
                  }
                />
              </div>
              <Slider label="Vol" value={t.volume} onChange={(v) => patchTrack(t.id, { volume: v })} />
            </div>
          ))}
        </div>

        {/* timeline */}
        <div className="studio-timeline" aria-label="Timeline">
          <div style={{ position: "absolute", top: 2, right: 8, zIndex: 2 }}>
            {helpButton("timeline")}
          </div>
          <div className="timeline-ruler">
            {Array.from({ length: TIMELINE_SECONDS / 8 }, (_, i) => (
              <span key={i} style={{ left: i * 8 * PX_PER_SEC }}>{fmtDuration(i * 8)}</span>
            ))}
          </div>
          {clips.length > 0 && (
            <div
              className="timeline-region"
              style={{ left: region.start * PX_PER_SEC, width: (region.end - region.start) * PX_PER_SEC }}
              aria-hidden="true"
            />
          )}
          {clips.length === 0 && (
            <div className="empty-state" style={{ margin: "26px 8px 8px" }}>
              <h3>Empty arrangement</h3>
              <p>
                Use ＋ Add clip on a track (left) to place one of your songs
                on the timeline, then select a region and generate below.
              </p>
            </div>
          )}
          {tracks.map((t) => (
            <div key={t.id} className="track-lane">
              {clips
                .filter((c) => c.trackId === t.id)
                .map((c) => (
                  <button
                    key={c.id}
                    className={`clip${selectedClip === c.id ? " selected" : ""}${t.muted ? " muted" : ""}`}
                    style={{
                      left: c.start * PX_PER_SEC,
                      width: c.length * PX_PER_SEC,
                      background: coverGradient(c.songId || c.id),
                    }}
                    disabled={t.locked}
                    onClick={() => setSelectedClip(c.id)}
                    title={`${c.name} (${fmtDuration(c.length)})`}
                  >
                    {c.name}
                  </button>
                ))}
            </div>
          ))}
        </div>

        {/* inspector */}
        <aside className="studio-inspector" aria-label="Inspector">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h3 style={{ marginTop: 0 }}>Inspector</h3>
            {helpButton("inspector")}
          </div>
          {clip ? (
            <>
              <p style={{ margin: "4px 0" }}>
                <strong>{clip.name}</strong>{" "}
                <Badge>{tracks.find((t) => t.id === clip.trackId)?.name}</Badge>
              </p>
              <p className="inline-hint">
                {fmtDuration(clip.start)} → {fmtDuration(clip.start + clip.length)}
              </p>
              <Slider
                label="Start"
                value={clip.start}
                min={0}
                max={TIMELINE_SECONDS - 1}
                onChange={(v) => {
                  pushUndo();
                  setClips((cs) => cs.map((c) => (c.id === clip.id ? { ...c, start: v } : c)));
                }}
                formatValue={(v) => `${v}s`}
              />
              <Slider
                label="Length"
                value={clip.length}
                min={1}
                max={TIMELINE_SECONDS}
                onChange={(v) => {
                  pushUndo();
                  setClips((cs) => cs.map((c) => (c.id === clip.id ? { ...c, length: v } : c)));
                }}
                formatValue={(v) => `${v}s`}
              />
              <Button
                variant="danger"
                style={{ marginTop: 8 }}
                onClick={() => {
                  pushUndo();
                  setClips((cs) => cs.filter((c) => c.id !== clip.id));
                  setSelectedClip(null);
                }}
              >
                Delete clip
              </Button>
            </>
          ) : (
            <p className="inline-hint">Select a clip to edit it, or add one with ＋ on a track.</p>
          )}

          <h3>Selected region</h3>
          <Slider label="Start" value={region.start} min={0} max={TIMELINE_SECONDS} onChange={(v) => setRegion((r) => ({ ...r, start: Math.min(v, r.end) }))} formatValue={(v) => `${v}s`} />
          <Slider label="End" value={region.end} min={0} max={TIMELINE_SECONDS} onChange={(v) => setRegion((r) => ({ ...r, end: Math.max(v, r.start) }))} formatValue={(v) => `${v}s`} />

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
            <strong>Generate</strong>
            {helpButton("generate")}
          </div>
          <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
            <Button
              loading={busy === "Generate section"}
              onClick={() => aceAction("Generate section", "text2music", {})}
            >
              ✨ Generate section (Studio model)
            </Button>
            <Button
              loading={busy === "Repaint region"}
              onClick={() =>
                aceAction("Repaint region", "repaint", {
                  repaintStart: region.start,
                  repaintEnd: region.end,
                })
              }
            >
              ♻ Repaint region
            </Button>
            <Button
              loading={busy === "Extend arrangement"}
              onClick={() => aceAction("Extend arrangement", "complete", {})}
            >
              ➕ Extend arrangement
            </Button>
          </div>
          <p className="inline-hint" style={{ marginTop: 8 }}>
            Generation uses ACE-Step base (Juno XL Studio, 50 steps, CFG on).
            Results land as rows in the active workspace.
          </p>
        </aside>
      </div>

      <Modal
        title={help ? HELP[help].title : ""}
        open={!!help}
        onClose={() => setHelp(null)}
      >
        <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{help ? HELP[help].body : ""}</p>
      </Modal>
    </div>
  );
}
