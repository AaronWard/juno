/** Live engine status: which model is loaded, what ACE-Step is doing, VRAM,
 *  and Load / Unload controls. Driven by the store's auto-polled /api/status,
 *  so it never needs a page refresh. `compact` is the one-line sidebar form. */
import React, { useEffect, useState } from "react";
import { useJuno } from "../App";
import { MODEL_PRESETS, presetLabel } from "../data/modelPresets";
import { Button } from "./Button";
import { Modal } from "./Modal";

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function elapsed(since?: string) {
  if (!since) return "";
  const s = Math.max(0, Math.round((Date.now() - new Date(since).getTime()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function useTicker(active: boolean) {
  const [, setT] = useState(0);
  useEffect(() => {
    if (!active) return;
    const i = setInterval(() => setT((t) => t + 1), 1000);
    return () => clearInterval(i);
  }, [active]);
}

export function ModelStatus({ compact = false }: { compact?: boolean }) {
  const { status, selectedPreset, loadModel, unloadModels, navigate } = useJuno();
  const [confirmForce, setConfirmForce] = useState(false);
  const [unloading, setUnloading] = useState(false);
  const a = status?.ace;
  useTicker(!!a?.busy);

  if (!status || !a) {
    return (
      <div className={compact ? "engine-mini" : "engine-card"}>
        <span className="status-dot bad" aria-hidden="true" />
        <span>Juno proxy is not responding</span>
      </div>
    );
  }

  const tone =
    a.activity === "ready" || a.activity === "generating"
      ? "ok"
      : a.activity === "offline"
        ? "bad"
        : a.activity === "idle"
          ? "idle"
          : "warn";
  const selectedLabel = presetLabel(selectedPreset);
  const text: Record<string, string> = {
    offline: "ACE-Step is offline",
    starting: "Starting ACE-Step…",
    idle: "No model loaded",
    loading: `Loading ${a.busy?.label || "model"}… ${elapsed(a.busy?.since)}`,
    ready: `${a.loadedLabel} ready`,
    generating: `Generating with ${a.loadedLabel}${a.waitingTasks ? ` · ${a.waitingTasks} waiting` : ""}`,
    unloading: "Unloading models…",
  };
  const vram = status.vram;
  const vramPct = vram ? Math.round((vram.usedMb / vram.totalMb) * 100) : 0;
  const vramText = vram ? `${(vram.usedMb / 1024).toFixed(1)} / ${(vram.totalMb / 1024).toFixed(0)} GB` : "";
  // The fill is vramPct% of the track, so a background this many percent of the
  // FILL spans exactly the full track — the ramp then reads the same at every
  // width, instead of being squashed into the filled part.
  const vramFill = {
    width: `${vramPct}%`,
    backgroundSize: `${vramPct > 0 ? (10000 / vramPct).toFixed(2) : 100}% 100%`,
  };

  if (compact) {
    const m = status.midi;
    return (
      // Hovering expands into the full card (idle-unload time, VRAM, Load /
      // Unload). The Create panel used to render a second copy of that card;
      // this is the single place it lives now.
      <div className="engine-mini-wrap">
      <button className="engine-mini" onClick={() => navigate("/settings")} title="Engines — hover for details, click for Settings">
        <span className="engine-mini-row">
          <span className={`status-dot ${tone}`} aria-hidden="true" />
          <span className="engine-mini-text">{a.activity === "ready" ? a.loadedLabel?.replace("Juno ", "") : text[a.activity]}</span>
        </span>
        {(m.activity === "transcribing" || m.activity === "starting") && (
          <span className="engine-mini-row">
            <span className="status-dot warn" aria-hidden="true" />
            <span className="engine-mini-text">{m.activity === "starting" ? "MuScriptor starting…" : "Transcribing MIDI…"}</span>
          </span>
        )}
        {vram && (
          <span className="vram-bar" title={`VRAM ${vramText}`}>
            <span style={vramFill} />
          </span>
        )}
      </button>
        <div className="engine-mini-pop" role="group" aria-label="Engine details">
          <ModelStatus />
        </div>
      </div>
    );
  }

  const canLoad =
    a.reachable && (a.activity === "idle" || a.activity === "ready") && a.loadedPreset !== selectedPreset;
  const canUnload = a.reachable && !!a.loadedModel && a.activity !== "unloading" && a.activity !== "loading";

  const unload = async (force: boolean) => {
    setConfirmForce(false);
    setUnloading(true);
    await unloadModels(force);
    setUnloading(false);
  };

  return (
    <div className="engine-card">
      <div className="engine-row">
        <span className={`status-dot ${tone}`} aria-hidden="true" />
        <strong>{text[a.activity]}</strong>
        {a.llmLoaded && a.loadedModel && <span className="inline-hint">+ {status.lmModel} ({status.lmBackend})</span>}
      </div>

      {a.activity === "idle" && (
        <p className="inline-hint engine-note">
          Your next Create loads {selectedLabel} automatically (about a minute the first time).
        </p>
      )}
      {a.activity === "loading" && (
        <p className="inline-hint engine-note">Queued songs start as soon as the model is in VRAM.</p>
      )}
      {a.activity === "offline" && a.detail && <p className="inline-hint engine-note">{a.detail}</p>}
      {a.idleUnloadAt && a.activity === "ready" && (
        <p className="inline-hint engine-note">Frees VRAM automatically at {clock(a.idleUnloadAt)} if unused.</p>
      )}
      {a.lastError && Date.now() - new Date(a.lastError.at).getTime() < 15 * 60000 && (
        <p className="inline-error engine-note">{a.lastError.message}</p>
      )}

      {vram && (
        <div className="vram" title={vram.name}>
          <span className="inline-hint">VRAM</span>
          <span className="vram-bar wide">
            <span style={vramFill} />
          </span>
          <span className="inline-hint">{vramText}</span>
        </div>
      )}

      <div className="engine-actions">
        {canLoad && (
          <Button variant="ghost" onClick={() => loadModel(selectedPreset)} title="Load the selected preset into VRAM now">
            Load {selectedLabel}
          </Button>
        )}
        {(canUnload || a.activity === "generating") && (
          <Button
            variant="ghost"
            loading={unloading}
            onClick={() => (a.activity === "generating" ? setConfirmForce(true) : unload(false))}
            title="Restart ACE-Step to hand all of its VRAM back"
          >
            Unload (free VRAM)
          </Button>
        )}
      </div>

      <Modal
        title="Stop the running generation?"
        open={confirmForce}
        onClose={() => setConfirmForce(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmForce(false)}>Keep generating</Button>
            <Button variant="danger" onClick={() => unload(true)}>Unload anyway</Button>
          </>
        }
      >
        <p>
          ACE-Step is generating right now. Unloading restarts it and the current song fails — you can press Retry on
          its row afterwards.
        </p>
        <p className="inline-hint">Presets: {MODEL_PRESETS.map((p) => p.label).join(", ")}.</p>
      </Modal>
    </div>
  );
}
