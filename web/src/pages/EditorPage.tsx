/** Editor page (DESIGN_DOC §21): single-song waveform editor.
 *  Waveform with drag selection, section markers derived from lyrics tags,
 *  and actions: Crop / Remove Section (local), Replace Section (ACE-Step
 *  repaint), Adjust Speed / Reverse (local), Export. */
import React, { useMemo, useRef, useState } from "react";
import { useJuno } from "../App";
import { mockWaveform } from "../lib/audio";
import { fmtDuration } from "../lib/format";
import { Button } from "../components/Button";
import { Badge } from "../components/Badge";
import { Slider } from "../components/Slider";
import { Modal } from "../components/Modal";
import { newId } from "../lib/ids";
import { Song } from "../data/mockSongs";
import { api } from "../lib/api";
import { presetLabel } from "../data/modelPresets";

const BAR_COUNT = 120;

export function EditorPage({ songId }: { songId: string }) {
  const { songs, navigate, addSong, addHistoryEvent, generate, playSong, currentSong, isPlaying, togglePlay } = useJuno();
  const song = songs.find((s) => s.id === songId);

  const [sel, setSel] = useState<{ start: number; end: number } | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [speed, setSpeed] = useState(100);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replacePrompt, setReplacePrompt] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const waveRef = useRef<HTMLDivElement>(null);

  const bars = useMemo(() => mockWaveform(songId, BAR_COUNT), [songId]);

  const sections = useMemo(() => {
    if (!song?.lyrics) return [] as { tag: string; at: number }[];
    const tags = [...song.lyrics.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);
    const unique = tags.filter((t, i) => tags.indexOf(t) === i);
    return unique.map((tag, i) => ({
      tag,
      at: Math.round(((i + 0.5) / unique.length) * (song.durationSeconds || 1)),
    }));
  }, [song]);

  if (!song) {
    return (
      <div className="page">
        <div className="empty-state">
          <h3>Song not found</h3>
          <p>It may have been permanently deleted.</p>
          <Button onClick={() => navigate("/library")}>Back to Library</Button>
        </div>
      </div>
    );
  }

  const posFromEvent = (e: React.MouseEvent): number => {
    const el = waveRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    return Math.round(frac * song.durationSeconds);
  };

  const derivative = (type: Song["type"], suffix: string, duration: number) => {
    const now = new Date().toISOString();
    const copy: Song = {
      ...song,
      id: newId("song"),
      title: `${song.title} (${suffix})`,
      type,
      durationSeconds: Math.max(1, Math.round(duration)),
      sourceSongId: song.id,
      liked: false,
      disliked: false,
      public: false,
      playCount: 0,
      commentCount: 0,
      createdAt: now,
      updatedAt: now,
      generationStatus: "idle",
    };
    addSong(copy);
    addHistoryEvent(`Editor: ${suffix} "${song.title}"`);
    setNotice(`Created "${copy.title}" in the workspace.`);
  };

  const selLen = sel ? sel.end - sel.start : 0;

  return (
    <div className="page">
      <div className="breadcrumb">
        <button className="btn btn-ghost" onClick={() => navigate("/library")}>Library</button>
        <span aria-hidden="true">›</span>
        <strong>Editor</strong>
      </div>

      <div className="page-title-row">
        <div>
          <h1 className="page-title">{song.title}</h1>
          <span className="inline-hint">
            <Badge tone="accent">{presetLabel(song.model)}</Badge>{" "}
            {fmtDuration(song.durationSeconds)} ·{" "}
            {song.metadata.instrumental ? "Instrumental" : "Vocal"} ·{" "}
            {song.styles.join(", ") || "no styles"}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button
            onClick={() =>
              currentSong?.id === song.id ? togglePlay() : playSong(song.id, [song.id])
            }
          >
            {currentSong?.id === song.id && isPlaying ? "⏸ Pause" : "▶ Play"}
          </Button>
          <Button
            variant="primary"
            loading={busy === "export"}
            onClick={async () => {
              setBusy("export");
              try {
                const res = await api.exportSongs([song.id]);
                setNotice(`Exported to ${res.savedTo}`);
                addHistoryEvent(`Exported "${song.title}"`);
              } catch (e: any) {
                setNotice(`Export failed: ${e?.message || e}`);
              } finally {
                setBusy(null);
              }
            }}
          >
            Export
          </Button>
        </div>
      </div>

      {notice && <p className="inline-hint" role="status">{notice}</p>}

      {/* waveform */}
      <div
        className="waveform"
        ref={waveRef}
        role="slider"
        aria-label="Waveform selection"
        aria-valuemin={0}
        aria-valuemax={song.durationSeconds}
        aria-valuenow={sel?.start ?? 0}
        tabIndex={0}
        onMouseDown={(e) => {
          const p = posFromEvent(e);
          setDragFrom(p);
          setSel({ start: p, end: p });
        }}
        onMouseMove={(e) => {
          if (dragFrom == null) return;
          const p = posFromEvent(e);
          setSel({ start: Math.min(dragFrom, p), end: Math.max(dragFrom, p) });
        }}
        onMouseUp={() => setDragFrom(null)}
        onMouseLeave={() => setDragFrom(null)}
      >
        {bars.map((h, i) => {
          const at = (i / BAR_COUNT) * song.durationSeconds;
          const inSel = sel && at >= sel.start && at <= sel.end;
          return (
            <span
              key={i}
              className={`wave-bar${inSel ? " in-sel" : ""}`}
              style={{ height: `${Math.round(h * 100)}%` }}
            />
          );
        })}
        {sections.map((s) => (
          <span
            key={s.tag}
            className="wave-marker"
            style={{ left: `${(s.at / song.durationSeconds) * 100}%` }}
            title={`[${s.tag}] at ${fmtDuration(s.at)}`}
          >
            {s.tag}
          </span>
        ))}
      </div>
      <p className="inline-hint">
        {sel && selLen > 0
          ? `Selection ${fmtDuration(sel.start)} – ${fmtDuration(sel.end)} (${fmtDuration(selLen)})`
          : "Drag across the waveform to select a region."}
      </p>

      <div className="editor-columns">
        {/* actions */}
        <div className="card" style={{ display: "grid", gap: 8 }}>
          <strong>Section actions</strong>
          <Button
            disabled={!sel || selLen < 1}
            onClick={() => sel && derivative("cropped", "Cropped", selLen)}
          >
            ✂ Crop to selection <span className="inline-hint">(local)</span>
          </Button>
          <Button
            disabled={!sel || selLen < 1}
            onClick={() =>
              sel && derivative("cropped", "Section removed", song.durationSeconds - selLen)
            }
          >
            ⌫ Remove Section <span className="inline-hint">(local)</span>
          </Button>
          <Button
            disabled={!sel || selLen < 1}
            onClick={() => setReplaceOpen(true)}
          >
            ♻ Replace Section <span className="inline-hint">(ACE-Step repaint)</span>
          </Button>

          <strong style={{ marginTop: 8 }}>Whole-song actions</strong>
          <Slider label="Speed" value={speed} min={50} max={200} onChange={setSpeed} formatValue={(v) => `${(v / 100).toFixed(2)}x`} />
          <Button
            onClick={() =>
              derivative("remix", `${(speed / 100).toFixed(2)}x`, song.durationSeconds / (speed / 100))
            }
          >
            🕒 Create speed-adjusted version
          </Button>
          <Button onClick={() => derivative("reversed", "Reversed", song.durationSeconds)}>
            ↺ Reverse (local)
          </Button>
        </div>

        {/* lyrics panel */}
        <div className="card">
          <strong>Lyrics</strong>
          {song.metadata.instrumental ? (
            <p className="inline-hint">Instrumental track — no lyrics.</p>
          ) : song.lyrics ? (
            <pre className="asset-lyrics" style={{ maxHeight: 320, overflow: "auto" }}>
              {song.lyrics}
            </pre>
          ) : (
            <p className="inline-hint">No lyrics stored for this song.</p>
          )}
        </div>
      </div>

      <Modal
        title="Replace section"
        open={replaceOpen}
        onClose={() => setReplaceOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setReplaceOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              loading={busy === "replace"}
              onClick={async () => {
                if (!sel) return;
                setBusy("replace");
                try {
                  await generate({
                    taskType: "repaint",
                    model: "juno-xl-studio",
                    title: `${song.title} (Replace)`,
                    prompt: replacePrompt || song.description,
                    styles: song.styles,
                    duration: song.durationSeconds,
                    srcAudioPath: song.localAudioPath,
                    repaintStart: sel.start,
                    repaintEnd: sel.end,
                    sourceSongId: song.id,
                  } as any);
                  setNotice("Repaint task submitted — result appears as a new row.");
                  setReplaceOpen(false);
                } catch (e: any) {
                  setNotice(`Repaint failed: ${e?.message || e}`);
                  setReplaceOpen(false);
                } finally {
                  setBusy(null);
                }
              }}
            >
              Replace
            </Button>
          </>
        }
      >
        <p className="inline-hint">
          Region {sel ? `${fmtDuration(sel.start)} – ${fmtDuration(sel.end)}` : "—"} is
          regenerated by ACE-Step (task_type "repaint") using Juno XL Studio.
        </p>
        <label className="field-label" htmlFor="editor-replace">Replacement prompt</label>
        <textarea
          id="editor-replace"
          className="text-area"
          value={replacePrompt}
          onChange={(e) => setReplacePrompt(e.target.value)}
          placeholder="e.g. strip drums, keep pad, add distant choir"
        />
      </Modal>
    </div>
  );
}
