import React from "react";
import { useJuno } from "../App";
import { MODEL_PRESETS } from "../data/modelPresets";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { ModelStatus } from "../components/ModelStatus";

const PATHS: [string, string][] = [
  ["Model weights", "./models (host) → /models (container)"],
  ["Generated audio", "./outputs/library (host) → /outputs/library"],
  ["Exports", "./outputs/exports (host) → /outputs/exports"],
  ["MIDI files", "./outputs/midi (host) → /outputs/midi"],
  ["Uploads", "./uploads (host) → /uploads"],
  ["Library database", "./data/juno-db.json (host) → /data"],
  ["Hugging Face cache", "./hf-cache (host) → /root/.cache/huggingface"],
];

export function SettingsPage() {
  const { health, refreshHealth, volume, setVolume, status, saveSettings } = useJuno();
  const settings = status?.settings;

  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <h1 className="page-title">Settings</h1>

      <div className="card" style={{ marginBottom: 14 }}>
        <strong>Profile</strong>
        <p className="inline-hint" style={{ margin: "6px 0 0" }}>
          local user · Offline Mode. No accounts, credits, plans or telemetry —
          everything runs on this machine.
        </p>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <strong>Backend health</strong>
          <Button variant="ghost" onClick={refreshHealth}>Refresh</Button>
        </div>
        <p style={{ margin: "8px 0 0" }}>
          Juno proxy:{" "}
          <Badge tone={health?.juno === "ok" ? "success" : "danger"}>
            {health?.juno || "connecting…"}
          </Badge>{" "}
          ACE-Step API:{" "}
          <Badge tone={health?.aceStep === "ok" ? "success" : "danger"}>
            {health?.aceStep || "connecting…"}
          </Badge>
        </p>
        <p className="inline-hint">
          Ports: web/proxy 3000 · ACE-Step 8001 · MuScriptor 8002 (internal). See
          docs/TROUBLESHOOTING.md if either stays unavailable.
        </p>
        <ModelStatus />
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <strong>Model loading</strong>
        <p className="inline-hint" style={{ margin: "6px 0 12px" }}>
          Juno keeps one XL model in VRAM and swaps it automatically when a song
          needs a different preset — queued songs wait, nothing falls back to the
          wrong model.
        </p>
        {settings ? (
          <div className="settings-grid">
            <label htmlFor="set-ace-idle">Unload ACE-Step after</label>
            <select
              id="set-ace-idle"
              className="text-input compact"
              value={settings.aceIdleUnloadMinutes}
              onChange={(e) => saveSettings({ aceIdleUnloadMinutes: Number(e.target.value) })}
            >
              {[0, 5, 10, 15, 30, 60, 120].map((m) => (
                <option key={m} value={m}>{m === 0 ? "Never" : `${m} idle minutes`}</option>
              ))}
            </select>

            <label htmlFor="set-preload">Preload on preset change</label>
            <label className="check">
              <input
                id="set-preload"
                type="checkbox"
                checked={settings.preloadOnSelect}
                onChange={(e) => saveSettings({ preloadOnSelect: e.target.checked })}
              />
              Start loading a preset as soon as you pick it in Create (only when idle)
            </label>

            <label htmlFor="set-midi-idle">Stop MuScriptor after</label>
            <select
              id="set-midi-idle"
              className="text-input compact"
              value={settings.midiIdleStopMinutes}
              onChange={(e) => saveSettings({ midiIdleStopMinutes: Number(e.target.value) })}
            >
              {[0, 2, 5, 10, 30, 60].map((m) => (
                <option key={m} value={m}>{m === 0 ? "Never" : `${m} idle minutes`}</option>
              ))}
            </select>

            <label htmlFor="set-midi-size">Default MIDI model</label>
            <select
              id="set-midi-size"
              className="text-input compact"
              value={settings.midiModelSize}
              onChange={(e) => saveSettings({ midiModelSize: e.target.value as any })}
            >
              <option value="small">Small (103M) — fastest</option>
              <option value="medium">Medium (307M) — balanced</option>
              <option value="large">Large (1.4B) — most accurate</option>
            </select>
          </div>
        ) : (
          <p className="inline-hint">Settings load once the Juno proxy responds.</p>
        )}
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <strong>Model presets</strong>
        <table className="settings-table">
          <thead>
            <tr>
              <th>Preset</th><th>ACE-Step model</th><th>Steps</th><th>CFG</th><th>LM</th>
            </tr>
          </thead>
          <tbody>
            {MODEL_PRESETS.map((p) => (
              <tr key={p.id}>
                <td>{p.label}{p.id === "juno-xl-quality" && " (default)"}</td>
                <td>{p.aceModel}</td>
                <td>{p.inferenceSteps}</td>
                <td>{p.cfgEnabled ? "on" : "off"}</td>
                <td>acestep-5Hz-lm-4B</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="inline-hint">
          All three presets are XL-class (~9 GB each) and share one GPU slot with
          the 4B LM. Extract / Lego / Complete only exist on the base model, so
          those tasks always run on Juno XL Studio.
        </p>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <strong>Storage paths</strong>
        <table className="settings-table">
          <tbody>
            {PATHS.map(([k, v]) => (
              <tr key={k}>
                <td>{k}</td>
                <td><code>{v}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <strong>Preferences</strong>
        <div style={{ marginTop: 10, maxWidth: 360 }}>
          <label className="field-label" htmlFor="pref-volume">Default volume</label>
          <input
            id="pref-volume"
            type="range"
            className="slider"
            min={0}
            max={100}
            value={Math.round(volume * 100)}
            onChange={(e) => setVolume(Number(e.target.value) / 100)}
          />
        </div>
        <p className="inline-hint">
          Sidebar state, selected preset, workspace and volume persist in this
          browser's localStorage under the "juno:" prefix.
        </p>
      </div>
    </div>
  );
}
