/** Horizontal piano roll for EDITING a MIDI file.
 *
 *  Keyboard on the left, time to the right, velocity lane at the bottom.
 *   Select tool: click / shift-click / drag-box to select, drag to move
 *                (time + pitch), drag a note's right edge to resize,
 *                double-click empty space to add a note.
 *   Draw tool:   click-drag on empty space to draw a note.
 *   Anywhere:    right-click a note to delete it; drag bars in the velocity
 *                lane; click/drag the ruler to move the playhead.
 *   Wheel scrolls pitch, Shift+wheel scrolls time, Ctrl/⌘+wheel zooms time,
 *   Alt+wheel zooms pitch.
 *  Keys: Delete, ⌘/Ctrl+A, ↑/↓ transpose (Shift = octave), ←/→ nudge by
 *  grid, Q quantize, ⌘/Ctrl+D duplicate, Esc clear selection.
 */
import React, { useEffect, useRef, useState } from "react";
import {
  barBeat,
  beatLines,
  clamp,
  drumName,
  isBlackKey,
  MidiDoc,
  MNote,
  MTrack,
  newNoteId,
  noteName,
  snapStepSeconds,
  snapTime,
  SnapValue,
} from "../../lib/midiModel";
import { MidiPlayer } from "../../lib/midiSynth";

export type EditTool = "select" | "draw";

interface Props {
  doc: MidiDoc;
  notes: MNote[];
  tracks: MTrack[];
  hidden: Set<number>;
  activeTrack: number;
  player: MidiPlayer;
  snap: SnapValue;
  tool: EditTool;
  follow: boolean;
  selection: Set<number>;
  onSelection: (s: Set<number>) => void;
  /** Snapshot for undo — call before a mutation begins. */
  onBeginEdit: () => void;
  onNotes: (n: MNote[]) => void;
  onUndo: () => void;
  onRedo: () => void;
}

const KEYS_W = 64;
const RULER_H = 26;
const VEL_H = 64;

type Drag =
  | { kind: "move"; x0: number; y0: number; anchor: MNote; origin: Map<number, { start: number; pitch: number }>; copied: boolean }
  | { kind: "resize"; x0: number; anchor: MNote; origin: Map<number, number> }
  | { kind: "marquee"; x0: number; y0: number; x1: number; y1: number; base: Set<number> }
  | { kind: "draw"; id: number; t0: number }
  | { kind: "vel"; ids: number[] }
  | { kind: "seek" }
  | { kind: "pan"; x0: number; y0: number; t0: number; p0: number };

export function PianoRollEditor(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const P = useRef(props);
  P.current = props;
  const view = useRef({ scrollT: 0, topPitch: 84, pxPerSec: 60, keyH: 12, inited: false });
  const drag = useRef<Drag | null>(null);
  const lastDur = useRef<number>(0);
  const hoverRef = useRef<{ x: number; y: number } | null>(null);
  const [status, setStatus] = useState("");

  /* ------------------------------ geometry ------------------------------ */
  const geo = () => {
    const wrap = wrapRef.current!;
    const W = wrap.clientWidth;
    const H = wrap.clientHeight;
    const gridH = H - RULER_H - VEL_H;
    const v = view.current;
    return {
      W,
      H,
      gridH,
      x: (t: number) => KEYS_W + (t - v.scrollT) * v.pxPerSec,
      y: (p: number) => RULER_H + (v.topPitch - p) * v.keyH,
      t: (x: number) => v.scrollT + (x - KEYS_W) / v.pxPerSec,
      p: (y: number) => v.topPitch - Math.floor((y - RULER_H) / v.keyH),
    };
  };

  const fitView = () => {
    const { notes, doc } = P.current;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const v = view.current;
    const W = wrap.clientWidth - KEYS_W;
    const gridH = wrap.clientHeight - RULER_H - VEL_H;
    const pitches = notes.map((n) => n.pitch);
    const hi = pitches.length ? Math.max(...pitches) : 72;
    const lo = pitches.length ? Math.min(...pitches) : 48;
    v.keyH = clamp(Math.floor(gridH / Math.max(24, hi - lo + 6)), 6, 18);
    v.topPitch = clamp(hi + 3, Math.ceil(gridH / v.keyH), 127);
    v.pxPerSec = clamp(W / Math.min(Math.max(doc.duration, 4), 30), 8, 800);
    v.scrollT = 0;
  };

  /* ------------------------------ drawing ------------------------------ */
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    const draw = () => {
      const { notes, tracks, hidden, activeTrack, doc, selection, player, follow } = P.current;
      const g = geo();
      const v = view.current;
      if (!v.inited && g.W > 0) {
        fitView();
        v.inited = true;
      }
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(g.W * dpr) || canvas.height !== Math.round(g.H * dpr)) {
        canvas.width = Math.round(g.W * dpr);
        canvas.height = Math.round(g.H * dpr);
        canvas.style.width = `${g.W}px`;
        canvas.style.height = `${g.H}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const pos = player.position;
      if (follow && player.playing) {
        const px = g.x(pos);
        if (px > g.W * 0.85 || px < KEYS_W) v.scrollT = Math.max(0, pos - ((g.W - KEYS_W) * 0.1) / v.pxPerSec);
      }
      const t0 = v.scrollT;
      const t1 = g.t(g.W);
      const rows = Math.ceil(g.gridH / v.keyH) + 1;
      const activeDrums = tracks.find((t) => t.index === activeTrack)?.drums;

      // rows
      for (let i = 0; i < rows; i++) {
        const p = v.topPitch - i;
        const y = RULER_H + i * v.keyH;
        ctx.fillStyle = isBlackKey(p) ? "#101116" : "#15161c";
        ctx.fillRect(KEYS_W, y, g.W - KEYS_W, v.keyH);
        if (p % 12 === 0) {
          ctx.fillStyle = "rgba(255,255,255,0.07)";
          ctx.fillRect(KEYS_W, y + v.keyH - 1, g.W - KEYS_W, 1);
        }
      }
      // beat grid
      const pxPerBeat = v.pxPerSec * (60 / doc.bpm);
      const sub = pxPerBeat > 90 ? 4 : pxPerBeat > 40 ? 2 : 1;
      for (const b of beatLines(doc, t0, t1, sub)) {
        const x = Math.round(g.x(b.t)) + 0.5;
        ctx.fillStyle = b.bar ? "rgba(255,255,255,0.16)" : b.beat ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.03)";
        ctx.fillRect(x, RULER_H, 1, g.gridH);
      }

      // notes: inactive tracks first (dimmed), active on top
      const colorOf = new Map(tracks.map((t) => [t.index, t.color]));
      const drawNotes = (active: boolean) => {
        for (const n of notes) {
          if (hidden.has(n.track) || (n.track === activeTrack) !== active) continue;
          if (n.start > t1) break;
          if (n.start + n.dur < t0) continue;
          const y = g.y(n.pitch);
          if (y < RULER_H - v.keyH || y > RULER_H + g.gridH) continue;
          const x = g.x(n.start);
          const w = Math.max(2, n.dur * v.pxPerSec);
          const sel = selection.has(n.id);
          ctx.globalAlpha = active ? 0.55 + 0.45 * n.vel : 0.22;
          ctx.fillStyle = colorOf.get(n.track) || "#ff4db8";
          ctx.fillRect(x, y + 1, w, v.keyH - 2);
          ctx.globalAlpha = 1;
          if (sel) {
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 1.5;
            ctx.strokeRect(x + 0.5, y + 1.5, w - 1, v.keyH - 3);
          } else if (active && w > 6) {
            ctx.fillStyle = "rgba(0,0,0,0.35)";
            ctx.fillRect(x + w - 2, y + 1, 2, v.keyH - 2);
          }
        }
      };
      drawNotes(false);
      drawNotes(true);

      // marquee
      const d = drag.current;
      if (d?.kind === "marquee") {
        ctx.strokeStyle = "rgba(255,77,184,0.9)";
        ctx.fillStyle = "rgba(255,77,184,0.12)";
        const x = Math.min(d.x0, d.x1);
        const y = Math.min(d.y0, d.y1);
        ctx.fillRect(x, y, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
        ctx.strokeRect(x + 0.5, y + 0.5, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
      }

      // hover row highlight
      const h = hoverRef.current;
      if (h && h.y > RULER_H && h.y < RULER_H + g.gridH && h.x > KEYS_W) {
        const p = g.p(h.y);
        ctx.fillStyle = "rgba(255,255,255,0.035)";
        ctx.fillRect(KEYS_W, g.y(p), g.W - KEYS_W, v.keyH);
      }

      // velocity lane
      const vy = RULER_H + g.gridH;
      ctx.fillStyle = "#0d0e12";
      ctx.fillRect(KEYS_W, vy, g.W - KEYS_W, VEL_H);
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fillRect(KEYS_W, vy, g.W - KEYS_W, 1);
      for (const n of notes) {
        if (n.track !== activeTrack || hidden.has(n.track)) continue;
        if (n.start > t1) break;
        if (n.start < t0) continue;
        const x = g.x(n.start);
        const bh = (VEL_H - 10) * n.vel;
        ctx.fillStyle = selection.has(n.id) ? "#ffffff" : colorOf.get(n.track) || "#ff4db8";
        ctx.fillRect(x, vy + VEL_H - 4 - bh, 3, bh);
        ctx.fillRect(x - 2, vy + VEL_H - 4 - bh, 7, 2);
      }

      // ruler
      ctx.fillStyle = "#111217";
      ctx.fillRect(KEYS_W, 0, g.W - KEYS_W, RULER_H);
      ctx.font = "11px sans-serif";
      ctx.textAlign = "left";
      for (const b of beatLines(doc, t0, t1, 1)) {
        if (!b.bar) continue;
        const x = Math.round(g.x(b.t));
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        ctx.fillRect(x, RULER_H - 8, 1, 8);
        if (pxPerBeat * doc.beatsPerBar > 26) {
          ctx.fillStyle = "#9a9aa8";
          ctx.fillText(barBeat(doc, b.t).split(".")[0], x + 3, 15);
        }
      }

      // playhead
      const px = g.x(pos);
      if (px >= KEYS_W) {
        ctx.fillStyle = "#ff4db8";
        ctx.fillRect(Math.round(px), 0, 2, g.H);
        ctx.beginPath();
        ctx.moveTo(px - 5, 0);
        ctx.lineTo(px + 7, 0);
        ctx.lineTo(px + 1, 8);
        ctx.fill();
      }

      // keyboard
      for (let i = 0; i < rows; i++) {
        const p = v.topPitch - i;
        const y = RULER_H + i * v.keyH;
        if (y > RULER_H + g.gridH) break;
        const black = isBlackKey(p);
        ctx.fillStyle = black ? "#1a1b21" : "#e4e4ea";
        ctx.fillRect(0, y, black ? KEYS_W * 0.62 : KEYS_W, v.keyH);
        if (black) {
          ctx.fillStyle = "#cfcfd6";
          ctx.fillRect(KEYS_W * 0.62, y, KEYS_W * 0.38, v.keyH);
        }
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        ctx.fillRect(0, y + v.keyH - 1, KEYS_W, 1);
        const label = activeDrums ? (v.keyH >= 10 ? drumName(p) : "") : p % 12 === 0 ? noteName(p) : "";
        if (label && v.keyH >= 8) {
          ctx.fillStyle = activeDrums ? (black ? "#cfcfd6" : "#333") : "#555";
          ctx.font = `${Math.min(10, v.keyH - 2)}px sans-serif`;
          ctx.textAlign = "right";
          ctx.fillText(label, KEYS_W - 4, y + v.keyH - 3);
        }
      }
      ctx.fillStyle = "#08090c";
      ctx.fillRect(0, 0, KEYS_W, RULER_H);
      ctx.fillRect(0, vy, KEYS_W, VEL_H);
      ctx.fillStyle = "#73757f";
      ctx.font = "10px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("Velocity", 6, vy + 16);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------------------------ helpers ------------------------------ */
  const hitNote = (x: number, y: number): { note: MNote; edge: boolean } | null => {
    const { notes, hidden, activeTrack } = P.current;
    const g = geo();
    const v = view.current;
    let found: { note: MNote; edge: boolean } | null = null;
    for (const n of notes) {
      if (hidden.has(n.track)) continue;
      const nx = g.x(n.start);
      if (nx > x) break;
      const ny = g.y(n.pitch);
      const w = Math.max(2, n.dur * v.pxPerSec);
      if (x >= nx && x <= nx + w + 2 && y >= ny && y <= ny + v.keyH) {
        // prefer active-track notes when overlapping
        if (!found || n.track === activeTrack) found = { note: n, edge: x >= nx + w - 6 && w > 10 };
      }
    }
    return found;
  };

  const localXY = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const trackOf = (i: number) => P.current.tracks.find((t) => t.index === i);

  const describe = (x: number, y: number) => {
    const g = geo();
    const { doc, selection, activeTrack } = P.current;
    if (y < RULER_H || x < KEYS_W) return;
    const hit = hitNote(x, y);
    const drums = trackOf(activeTrack)?.drums;
    if (hit) {
      const n = hit.note;
      setStatus(
        `${drums ? drumName(n.pitch) : noteName(n.pitch)} · bar ${barBeat(doc, n.start)} · ${n.dur.toFixed(2)}s · vel ${Math.round(n.vel * 127)} · ${trackOf(n.track)?.name || ""}` +
          (selection.size ? ` — ${selection.size} selected` : "")
      );
    } else if (y < RULER_H + g.gridH) {
      const p = g.p(y);
      setStatus(`${drums ? drumName(p) : noteName(p)} · bar ${barBeat(doc, g.t(x))}` + (selection.size ? ` — ${selection.size} selected` : ""));
    }
  };

  /* ------------------------------ mouse ------------------------------ */
  const onMouseDown = (e: React.MouseEvent) => {
    wrapRef.current?.focus();
    const { x, y } = localXY(e);
    const g = geo();
    const { notes, selection, onSelection, onBeginEdit, onNotes, doc, snap, tool, activeTrack, player } = P.current;
    const v = view.current;

    if (e.button === 1) {
      drag.current = { kind: "pan", x0: x, y0: y, t0: v.scrollT, p0: v.topPitch };
      return;
    }
    if (y < RULER_H && x > KEYS_W) {
      player.seek(Math.max(0, g.t(x)));
      drag.current = { kind: "seek" };
      return;
    }
    if (x < KEYS_W) {
      if (y > RULER_H && y < RULER_H + g.gridH) void player.preview(g.p(y), trackOf(activeTrack));
      return;
    }
    // velocity lane
    if (y > RULER_H + g.gridH) {
      let best: MNote | null = null;
      let bestDx = 7;
      for (const n of notes) {
        if (n.track !== activeTrack) continue;
        const dx = Math.abs(g.x(n.start) + 1 - x);
        if (dx < bestDx || (dx === bestDx && selection.has(n.id))) {
          best = n;
          bestDx = dx;
        }
      }
      if (best) {
        onBeginEdit();
        const ids = selection.has(best.id) ? [...selection] : [best.id];
        drag.current = { kind: "vel", ids };
        applyVel(y, ids);
      }
      return;
    }

    const hit = hitNote(x, y);
    if (e.button === 2) {
      if (hit) {
        onBeginEdit();
        const del = selection.has(hit.note.id) ? selection : new Set([hit.note.id]);
        onNotes(notes.filter((n) => !del.has(n.id)));
        onSelection(new Set());
      }
      return;
    }

    if (hit) {
      const n = hit.note;
      let sel = selection;
      if (e.shiftKey) {
        sel = new Set(selection);
        sel.has(n.id) ? sel.delete(n.id) : sel.add(n.id);
        onSelection(sel);
        return;
      }
      if (!sel.has(n.id)) {
        sel = new Set([n.id]);
        onSelection(sel);
      }
      onBeginEdit();
      lastDur.current = n.dur;
      if (hit.edge) {
        drag.current = { kind: "resize", x0: x, anchor: n, origin: new Map(notes.filter((m) => sel.has(m.id)).map((m) => [m.id, m.dur])) };
      } else {
        let working = notes;
        let copied = false;
        if (e.altKey) {
          // Alt-drag duplicates the selection and drags the copies.
          const copies = notes.filter((m) => sel.has(m.id)).map((m) => ({ ...m, id: newNoteId() }));
          working = [...notes, ...copies].sort((a, b) => a.start - b.start);
          const copyIds = new Set(copies.map((c) => c.id));
          onNotes(working);
          onSelection(copyIds);
          sel = copyIds;
          copied = true;
        }
        const selected = working.filter((m) => sel.has(m.id));
        const anchor = selected.find((m) => m.start === n.start && m.pitch === n.pitch) || selected[0];
        drag.current = {
          kind: "move",
          x0: x,
          y0: y,
          anchor,
          origin: new Map(selected.map((m) => [m.id, { start: m.start, pitch: m.pitch }])),
          copied,
        };
        if (!trackOf(n.track)?.drums) void player.preview(n.pitch, trackOf(n.track), n.vel);
      }
      return;
    }

    if (tool === "draw") {
      onBeginEdit();
      const start = snapTime(doc, g.t(x), snap === "off" ? "off" : snap);
      const drums = trackOf(activeTrack)?.drums;
      const dur = drums ? 0.1 : lastDur.current || snapStepSeconds(doc, start, snap === "off" ? "1/8" : snap);
      const note: MNote = { id: newNoteId(), track: activeTrack, pitch: g.p(y), start, dur, vel: 0.8 };
      onNotes([...notes, note].sort((a, b) => a.start - b.start));
      onSelection(new Set([note.id]));
      drag.current = drums ? null : { kind: "draw", id: note.id, t0: start };
      void player.preview(note.pitch, trackOf(activeTrack));
      return;
    }

    drag.current = { kind: "marquee", x0: x, y0: y, x1: x, y1: y, base: e.shiftKey ? new Set(selection) : new Set() };
    if (!e.shiftKey) onSelection(new Set());
  };

  const applyVel = (y: number, ids: number[]) => {
    const g = geo();
    const vy = RULER_H + g.gridH;
    const vel = clamp((vy + VEL_H - 4 - y) / (VEL_H - 10), 0.02, 1);
    const set = new Set(ids);
    P.current.onNotes(P.current.notes.map((n) => (set.has(n.id) ? { ...n, vel } : n)));
    setStatus(`Velocity ${Math.round(vel * 127)} (${ids.length} note${ids.length === 1 ? "" : "s"})`);
  };

  const onMouseMove = (e: React.MouseEvent) => {
    const { x, y } = localXY(e);
    hoverRef.current = { x, y };
    const d = drag.current;
    const g = geo();
    const { notes, doc, snap, onNotes, player, selection, onSelection } = P.current;
    const v = view.current;
    if (!d) {
      const hit = x > KEYS_W && y > RULER_H && y < RULER_H + g.gridH ? hitNote(x, y) : null;
      canvasRef.current!.style.cursor = hit ? (hit.edge ? "ew-resize" : "grab") : y < RULER_H ? "pointer" : P.current.tool === "draw" ? "crosshair" : "default";
      describe(x, y);
      return;
    }
    if (d.kind === "pan") {
      v.scrollT = Math.max(0, d.t0 - (x - d.x0) / v.pxPerSec);
      v.topPitch = clamp(Math.round(d.p0 + (y - d.y0) / v.keyH), 10, 127);
    } else if (d.kind === "seek") {
      player.seek(Math.max(0, g.t(x)));
    } else if (d.kind === "vel") {
      applyVel(y, d.ids);
    } else if (d.kind === "marquee") {
      d.x1 = x;
      d.y1 = y;
      const ta = g.t(Math.min(d.x0, x));
      const tb = g.t(Math.max(d.x0, x));
      const pa = g.p(Math.max(d.y0, y));
      const pb = g.p(Math.min(d.y0, y));
      const sel = new Set(d.base);
      for (const n of notes) {
        if (P.current.hidden.has(n.track) || n.track !== P.current.activeTrack) continue;
        if (n.start <= tb && n.start + n.dur >= ta && n.pitch >= pa && n.pitch <= pb) sel.add(n.id);
      }
      if (sel.size !== selection.size || [...sel].some((id) => !selection.has(id))) onSelection(sel);
    } else if (d.kind === "move") {
      const dt = (x - d.x0) / v.pxPerSec;
      const a = d.origin.get(d.anchor.id)!;
      const newStart = snap === "off" ? Math.max(0, a.start + dt) : snapTime(doc, a.start + dt, snap);
      let delta = newStart - a.start;
      const minStart = Math.min(...[...d.origin.values()].map((o) => o.start));
      if (minStart + delta < 0) delta = -minStart;
      const dp = Math.round((d.y0 - y) / v.keyH);
      onNotes(
        notes.map((n) => {
          const o = d.origin.get(n.id);
          return o ? { ...n, start: o.start + delta, pitch: clamp(o.pitch + dp, 0, 127) } : n;
        })
      );
    } else if (d.kind === "resize") {
      const dt = (x - d.x0) / v.pxPerSec;
      const a = d.anchor;
      const origDur = d.origin.get(a.id)!;
      const end = snap === "off" ? a.start + origDur + dt : snapTime(doc, a.start + origDur + dt, snap);
      const minDur = 0.02;
      const newDur = Math.max(minDur, end - a.start);
      const ddur = newDur - origDur;
      onNotes(notes.map((n) => (d.origin.has(n.id) ? { ...n, dur: Math.max(minDur, d.origin.get(n.id)! + ddur) } : n)));
      lastDur.current = newDur;
    } else if (d.kind === "draw") {
      const t = g.t(x);
      const end = snap === "off" ? t : snapTime(doc, t, snap);
      const dur = Math.max(snap === "off" ? 0.03 : snapStepSeconds(doc, d.t0, snap), end - d.t0);
      lastDur.current = dur;
      onNotes(notes.map((n) => (n.id === d.id ? { ...n, dur } : n)));
    }
  };

  const endDrag = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.kind === "move") {
      // keep notes sorted for playback/culling
      P.current.onNotes([...P.current.notes].sort((a, b) => a.start - b.start));
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const { x, y } = localXY(e);
    const g = geo();
    if (x < KEYS_W || y < RULER_H || y > RULER_H + g.gridH || hitNote(x, y) || P.current.tool === "draw") return;
    const { doc, snap, activeTrack, notes, onBeginEdit, onNotes, onSelection, player } = P.current;
    onBeginEdit();
    const start = snapTime(doc, g.t(x), snap);
    const drums = trackOf(activeTrack)?.drums;
    const note: MNote = {
      id: newNoteId(),
      track: activeTrack,
      pitch: g.p(y),
      start,
      dur: drums ? 0.1 : lastDur.current || snapStepSeconds(doc, start, snap === "off" ? "1/8" : snap),
      vel: 0.8,
    };
    onNotes([...notes, note].sort((a, b) => a.start - b.start));
    onSelection(new Set([note.id]));
    void player.preview(note.pitch, trackOf(activeTrack));
  };

  const onWheel = (e: React.WheelEvent) => {
    const v = view.current;
    const { x } = localXY(e);
    const g = geo();
    if (e.ctrlKey || e.metaKey) {
      const anchorT = g.t(Math.max(KEYS_W, x));
      v.pxPerSec = clamp(v.pxPerSec * (e.deltaY > 0 ? 0.88 : 1.14), 4, 2000);
      v.scrollT = Math.max(0, anchorT - (Math.max(KEYS_W, x) - KEYS_W) / v.pxPerSec);
    } else if (e.altKey) {
      v.keyH = clamp(v.keyH + (e.deltaY > 0 ? -1 : 1), 5, 28);
    } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      v.scrollT = Math.max(0, v.scrollT + d / v.pxPerSec);
    } else {
      v.topPitch = clamp(v.topPitch - Math.sign(e.deltaY) * Math.max(1, Math.round(Math.abs(e.deltaY) / 30)), Math.ceil(g.gridH / v.keyH), 127);
    }
  };

  /* ------------------------------ keyboard ------------------------------ */
  const onKeyDown = (e: React.KeyboardEvent) => {
    const { notes, selection, onSelection, onBeginEdit, onNotes, doc, snap, activeTrack, onUndo, onRedo } = P.current;
    const mod = e.ctrlKey || e.metaKey;
    const sel = selection;
    const edit = (fn: (n: MNote) => MNote) => {
      if (!sel.size) return;
      onBeginEdit();
      onNotes(notes.map((n) => (sel.has(n.id) ? fn(n) : n)).sort((a, b) => a.start - b.start));
    };
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      e.shiftKey ? onRedo() : onUndo();
    } else if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      onRedo();
    } else if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      onSelection(new Set(notes.filter((n) => n.track === activeTrack).map((n) => n.id)));
    } else if (mod && e.key.toLowerCase() === "d") {
      e.preventDefault();
      if (!sel.size) return;
      onBeginEdit();
      const chosen = notes.filter((n) => sel.has(n.id));
      const span = Math.max(...chosen.map((n) => n.start + n.dur)) - Math.min(...chosen.map((n) => n.start));
      const copies = chosen.map((n) => ({ ...n, id: newNoteId(), start: snapTime(doc, n.start + span, snap) }));
      onNotes([...notes, ...copies].sort((a, b) => a.start - b.start));
      onSelection(new Set(copies.map((c) => c.id)));
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      if (!sel.size) return;
      onBeginEdit();
      onNotes(notes.filter((n) => !sel.has(n.id)));
      onSelection(new Set());
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const d = (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 12 : 1);
      edit((n) => ({ ...n, pitch: clamp(n.pitch + d, 0, 127) }));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const sign = e.key === "ArrowRight" ? 1 : -1;
      edit((n) => ({ ...n, start: Math.max(0, n.start + sign * snapStepSeconds(doc, n.start, snap)) }));
    } else if (e.key.toLowerCase() === "q" && !mod) {
      e.preventDefault();
      const s = snap === "off" ? "1/16" : snap;
      edit((n) => {
        const start = snapTime(doc, n.start, s);
        const end = snapTime(doc, n.start + n.dur, s);
        return { ...n, start, dur: Math.max(snapStepSeconds(doc, start, s), end - start) };
      });
    } else if (e.key === "Escape") {
      onSelection(new Set());
    }
  };

  const zoom = (f: number) => {
    const v = view.current;
    v.pxPerSec = clamp(v.pxPerSec * f, 4, 2000);
  };

  return (
    <div className="roll-shell">
      <div
        ref={wrapRef}
        className="midi-canvas-wrap roll"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onWheel={onWheel}
        aria-label="Piano roll editor"
      >
        <canvas
          ref={canvasRef}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={endDrag}
          onMouseLeave={() => {
            endDrag();
            hoverRef.current = null;
          }}
          onDoubleClick={onDoubleClick}
          onContextMenu={(e) => e.preventDefault()}
        />
        <div className="roll-zoom" onMouseDown={(e) => e.stopPropagation()}>
          <button className="btn btn-icon" title="Zoom out (Ctrl+wheel)" onClick={() => zoom(0.7)}>−</button>
          <button className="btn btn-icon" title="Zoom in (Ctrl+wheel)" onClick={() => zoom(1.4)}>+</button>
          <button className="btn btn-icon" title="Fit to notes" onClick={fitView}>⤢</button>
        </div>
      </div>
      <div className="roll-status" aria-live="polite">
        {status || "Double-click to add a note · drag to move · drag the right edge to resize · right-click to delete"}
      </div>
    </div>
  );
}
