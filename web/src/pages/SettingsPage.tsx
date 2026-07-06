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
  ["Uploads", "./uploads (host) → /uploads"],
  ["Library database", "./data/juno-db.json (host) → /data"],
  ["Hugging Face cache", "./hf-cache (host) → /root/.cache/huggingface"],
];

export function SettingsPage() {
  const { health, refreshHealth, volume, setVolume } = useJuno();

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
          Ports: web/proxy 3000 · ACE-Step 8001. See docs/TROUBLESHOOTING.md if
          either stays unavailable.
        </p>
        <ModelStatus />
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
          All three presets are XL-class and sized for a 32 GB GPU. Presets
          share one GPU slot: switching hot-swaps the loaded model.
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
