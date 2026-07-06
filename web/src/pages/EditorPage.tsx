/** Editor page (DESIGN_DOC §21): single-song waveform editor — now REAL.
 *
 *  - The waveform is computed from the song's actual decoded audio (falls
 *    back to a deterministic mock only when the row has no audio yet).
 *  - Crop / Remove Section / Adjust Speed / Reverse render REAL audio via
 *    the Web Audio API and save the result as a new playable track.
 *  - Replace Section still submits an ACE-Step "repaint" task.
 *  - Download saves the audio through the browser.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useJuno } from "../App";
import { mockWaveform } from "../lib/audio";
import { fmtDuration } from "../lib/format";
import { Button } from "../components/Button";
import { Badge } from "../components/Badge";
import { Slider } from "../components/Slider";
import { Modal } from "../components/Modal";
import { Song } from "../data/mockSongs";
import { api } from "../lib/api";
import { presetLabel } from "../data/modelPresets";
import {
  bufferToFile,
  changeSpeed,
  computePeaks,
  cropBuffer,
  downloadUrl,
  loadBuffer,
  removeSection,
  reverseBuffer,
} from "../lib/dsp";

const BAR_COUNT = 120;

export function EditorPage({ songId }: { songId: string }) {
  const {
    songs,
    navigate,
    addSong,
    addHistoryEvent,
    generate,
    playSong,
    currentSong,
    isPlaying,
    togglePlay,
    patchSong,
  } = useJuno();
  const song = songs.find((s) => s.id === songId);

  const [sel, setSel] = useState<{ start: number; end: number } | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [speed, setSpeed] = useState(100);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replacePrompt, setReplacePrompt] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const waveRef = useRef<HTMLDivElement>(null);

  /* Decode the real audio: real waveform + true duration. */
  useEffect(() => {
    setBuffer(null);
    setPeaks(null);
    if (!song?.audioUrl) return;
    let cancelled = false;
    loadBuffer(song.audioUrl)
      .then((b) => {
        if (cancelled) return;
        setBuffer(b);
        setPeaks(computePeaks(b, BAR_COUNT));
        const real = Math.round(b.duration);
        if (real > 0 && song.durationSeconds !== real) {
          patchSong(song.id, { durationSeconds: real });
        }
      })
      .catch(() => {
        /* keep mock waveform */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song?.id, song?.audioUrl]);

  const mockBars = useMemo(() => mockWaveform(songId, BAR_COUNT), [songId]);
  const bars = peaks ?? mockBars;

  const duration = buffer?.duration ?? song?.durationSeconds ?? 0;

  const sections = useMemo(() => {
    if (!song?.lyrics || !duration) return [] as { tag: string; at: number }[];
    const tags = [...song.lyrics.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);
    const unique = tags.filter((t, i) => tags.indexOf(t) === i);
    return unique.map((tag, i) => ({
      tag,
      at: Math.round(((i + 0.5) / unique.length) * duration),
    }));
  }, [song?.lyrics, duration]);

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

  const hasAudio = !!song.audioUrl && !!buffer;

  const posFromEvent = (e: React.MouseEvent): number => {
    const el = waveRef.current;
    if (!el || !duration) return 0;
    const rect = el.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    return Math.round(frac * duration);
  };

  /** Render a REAL derivative and save it as a playable track. */
  const renderLocal = async (
    label: string,
    type: Song["type"],
    fn: (b: AudioBuffer) => AudioBuffer | Promise<AudioBuffer>
  ) => {
    if (!buffer) {
      setNotice("This song has no decodable audio yet.");
      return;
    }
    setBusy(label);
    setNotice(null);
    try {
      const out = await fn(buffer);
      const title = `${song.title} (${label})`;
      const res = await api.upload(bufferToFile(out, title), {
        title,
        type,
        description: `${label} of "${song.title}" — processed locally in the Editor`,
        sourceSongId: song.id,
        workspaceId: song.workspaceId,
        durationSeconds: Math.round(out.duration),
        styles: song.styles,
        lyrics: song.lyrics,
      });
      addSong(res.asset);
      addHistoryEvent(`Editor: ${label} "${song.title}"`);
      setNotice(`Created "${title}" — it is playable in the workspace now.`);
    } catch (e: any) {
      setNotice(`${label} failed: ${e?.message || e}`);
    } finally {
      setBusy(null);
    }
  };

  const download = () => {
    if (!song.audioUrl) return;
    const rawExt = song.audioUrl.split("?")[0].split(".").pop() || "wav";
    const ext = rawExt.length <= 5 ? rawExt : "wav";
    downloadUrl(song.audioUrl, `${song.title}.${ext}`);
    addHistoryEvent(`Downloaded "${song.title}"`);
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
            {fmtDuration(duration)} ·{" "}
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
          <Button disabled={!song.audioUrl} onClick={download}>
            ⬇ Download
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
      {!song.audioUrl && (
        <p className="inline-hint" role="status">
          This song has no audio yet — editing actions are disabled until a
          generation finishes or audio is uploaded.
        </p>
      )}

      {/* waveform */}
      <div
        className="waveform"
        ref={waveRef}
        role="slider"
        aria-label="Waveform selection"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
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
          const at = duration ? (i / BAR_COUNT) * duration : 0;
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
            style={{ left: `${duration ? (s.at / duration) * 100 : 0}%` }}
            title={`[${s.tag}] at ${fmtDuration(s.at)}`}
          >
            {s.tag}
          </span>
        ))}
      </div>
      <p className="inline-hint">
        {peaks
          ? "Waveform computed from the actual audio. "
          : song.audioUrl
            ? "Decoding audio… "
            : ""}
        {sel && selLen > 0
          ? `Selection ${fmtDuration(sel.start)} – ${fmtDuration(sel.end)} (${fmtDuration(selLen)})`
          : "Drag across the waveform to select a region."}
      </p>

      <div className="editor-columns">
        {/* actions */}
        <div className="card" style={{ display: "grid", gap: 8 }}>
          <strong>Section actions</strong>
          <Button
            disabled={!hasAudio || !sel || selLen < 1}
            loading={busy === "Cropped"}
            onClick={() =>
              sel && renderLocal("Cropped", "cropped", (b) => cropBuffer(b, sel.start, sel.end))
            }
          >
            ✂ Crop to selection <span className="inline-hint">(local, real render)</span>
          </Button>
          <Button
            disabled={!hasAudio || !sel || selLen < 1}
            loading={busy === "Section removed"}
            onClick={() =>
              sel &&
              renderLocal("Section removed", "cropped", (b) =>
                removeSection(b, sel.start, sel.end)
              )
            }
          >
            ⌫ Remove Section <span className="inline-hint">(local, real render)</span>
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
            disabled={!hasAudio}
            loading={busy === `${(speed / 100).toFixed(2)}x`}
            onClick={() =>
              renderLocal(`${(speed / 100).toFixed(2)}x`, "remix", (b) =>
                changeSpeed(b, speed / 100)
              )
            }
          >
            🕒 Create speed-adjusted version
          </Button>
          <Button
            disabled={!hasAudio}
            loading={busy === "Reversed"}
            onClick={() => renderLocal("Reversed", "reversed", reverseBuffer)}
          >
            ↺ Reverse (local, real render)
          </Button>
          <p className="inline-hint">
            Local actions decode the audio, process it in the browser and
            save a new WAV to your library. Speed changes shift pitch
            (resample-style).
          </p>
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
                    duration: Math.round(duration),
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
