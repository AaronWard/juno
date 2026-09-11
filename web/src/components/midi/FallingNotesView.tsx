/** Vertical "falling notes" piano (Synthesia-style) for PLAYING a MIDI file.
 *  Time runs top -> bottom into an 88-key keyboard; keys light up in the
 *  track's colour as notes hit them. Wheel zooms the look-ahead window,
 *  clicking a key auditions it. */
import React, { useEffect, useRef } from "react";
import { beatLines, isBlackKey, MidiDoc, MNote, MTrack, noteName } from "../../lib/midiModel";
import { MidiPlayer } from "../../lib/midiSynth";

interface Props {
  doc: MidiDoc;
  notes: MNote[];
  tracks: MTrack[];
  hidden: Set<number>;
  player: MidiPlayer;
  fitRange: boolean;
}

const LOW = 21;
const HIGH = 108;

export function FallingNotesView({ doc, notes, tracks, hidden, player, fitRange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const windowSec = useRef(4);
  const state = useRef({ notes, tracks, hidden, fitRange, doc });
  state.current = { notes, tracks, hidden, fitRange, doc };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    const colorOf = new Map<number, string>();

    const draw = () => {
      const { notes, tracks, hidden, fitRange, doc } = state.current;
      tracks.forEach((t) => colorOf.set(t.index, t.color));
      const dpr = window.devicePixelRatio || 1;
      const W = wrap.clientWidth;
      const H = wrap.clientHeight;
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        canvas.style.width = `${W}px`;
        canvas.style.height = `${H}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // key range
      let lo = LOW;
      let hi = HIGH;
      if (fitRange && notes.length) {
        const vis = notes.filter((n) => !hidden.has(n.track));
        if (vis.length) {
          lo = Math.max(LOW, Math.min(...vis.map((n) => n.pitch)) - 2);
          hi = Math.min(HIGH, Math.max(...vis.map((n) => n.pitch)) + 2);
          while (hi - lo < 24) {
            lo = Math.max(LOW, lo - 1);
            hi = Math.min(HIGH, hi + 1);
          }
        }
      }
      while (isBlackKey(lo)) lo--;
      while (isBlackKey(hi)) hi++;
      const whites: number[] = [];
      for (let p = lo; p <= hi; p++) if (!isBlackKey(p)) whites.push(p);
      const ww = W / whites.length;
      const keyH = Math.min(110, Math.max(60, H * 0.16));
      const rollH = H - keyH;
      const xOf = (p: number): [number, number] => {
        if (!isBlackKey(p)) {
          const i = whites.indexOf(p);
          return [i * ww, ww];
        }
        const i = whites.indexOf(p - 1);
        return [(i + 1) * ww - ww * 0.32, ww * 0.64];
      };

      const pos = player.position;
      const win = windowSec.current;
      const yOf = (t: number) => rollH - ((t - pos) / win) * rollH;

      // background + beat lines
      ctx.fillStyle = "#0b0c10";
      ctx.fillRect(0, 0, W, rollH);
      for (const b of beatLines(doc, pos, pos + win, 1)) {
        const y = yOf(b.t);
        ctx.fillStyle = b.bar ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.035)";
        ctx.fillRect(0, Math.round(y), W, 1);
      }
      // octave guides
      for (let p = lo; p <= hi; p++) {
        if (p % 12 === 0) {
          const [x] = xOf(p);
          ctx.fillStyle = "rgba(255,255,255,0.04)";
          ctx.fillRect(Math.round(x), 0, 1, rollH);
        }
      }

      const active = new Map<number, string>();
      for (const n of notes) {
        if (n.start > pos + win) break;
        if (n.start + n.dur < pos || hidden.has(n.track) || n.pitch < lo || n.pitch > hi) continue;
        const color = colorOf.get(n.track) || "#ff4db8";
        const y1 = yOf(n.start);
        const y0 = yOf(n.start + n.dur);
        const [x, w] = xOf(n.pitch);
        const playing = n.start <= pos && n.start + n.dur >= pos;
        if (playing) active.set(n.pitch, color);
        ctx.globalAlpha = 0.45 + 0.55 * n.vel;
        ctx.fillStyle = color;
        roundRect(ctx, x + 1, Math.max(-4, y0), w - 2, Math.min(rollH, y1) - Math.max(-4, y0), Math.min(5, w / 3));
        ctx.fill();
        if (playing) {
          ctx.globalAlpha = 0.9;
          ctx.fillStyle = "#fff";
          ctx.fillRect(x + 1, Math.min(rollH, y1) - 2, w - 2, 2);
        }
        ctx.globalAlpha = 1;
      }

      // hit line
      ctx.fillStyle = "rgba(255,77,184,0.55)";
      ctx.fillRect(0, rollH - 1, W, 2);

      // keyboard: whites then blacks
      for (const p of whites) {
        const [x, w] = xOf(p);
        ctx.fillStyle = active.get(p) || "#e9e9ee";
        ctx.fillRect(x + 0.5, rollH + 1, w - 1, keyH - 2);
        if (p % 12 === 0 && w > 14) {
          ctx.fillStyle = active.has(p) ? "#111" : "#8a8a96";
          ctx.font = "10px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(noteName(p), x + w / 2, rollH + keyH - 8);
        }
      }
      for (let p = lo; p <= hi; p++) {
        if (!isBlackKey(p)) continue;
        const [x, w] = xOf(p);
        const c = active.get(p);
        ctx.fillStyle = c || "#15161b";
        ctx.fillRect(x, rollH + 1, w, keyH * 0.62);
        if (c) {
          ctx.fillStyle = "rgba(0,0,0,0.25)";
          ctx.fillRect(x, rollH + 1 + keyH * 0.5, w, keyH * 0.12);
        }
      }
      (canvas as any)._geom = { xOf, rollH, keyH, lo, hi, whites, ww };
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [player]);

  const onWheel = (e: React.WheelEvent) => {
    windowSec.current = Math.max(1, Math.min(16, windowSec.current * (e.deltaY > 0 ? 1.12 : 0.89)));
  };

  const onClick = (e: React.MouseEvent) => {
    const g = (canvasRef.current as any)?._geom;
    if (!g) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (y < g.rollH) return;
    // black keys first (they sit on top)
    for (let p = g.lo; p <= g.hi; p++) {
      if (!isBlackKey(p)) continue;
      const [bx, bw] = g.xOf(p);
      if (x >= bx && x <= bx + bw && y <= g.rollH + g.keyH * 0.62) {
        void player.preview(p, state.current.tracks.find((t) => !t.drums));
        return;
      }
    }
    const i = Math.floor(x / g.ww);
    const p = g.whites[i];
    if (p != null) void player.preview(p, state.current.tracks.find((t) => !t.drums));
  };

  return (
    <div ref={wrapRef} className="midi-canvas-wrap" onWheel={onWheel}>
      <canvas ref={canvasRef} onClick={onClick} aria-label="Falling notes piano view" />
    </div>
  );
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
