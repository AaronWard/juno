/** "Unload models (free VRAM)" button for the Settings → Backend health
 *  card. Calls POST /api/models/unload, which restarts the ACE-Step
 *  process via supervisord; models lazy-load again on the next task.
 */
import React, { useState } from "react";
import { api } from "../lib/api";
import { useJuno } from "../App";

export function UnloadModelsButton() {
  const { refreshHealth } = useJuno();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const unload = async () => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await api.unloadModels();
      setNotice(
        "ACE-Step restarted — VRAM freed. Models lazy-load again on the next generation (or via Initialize model)."
      );
      setTimeout(refreshHealth, 3000);
    } catch (e: any) {
      setNotice(`Unload failed: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 10 }}>
      <button
        className="btn"
        onClick={unload}
        disabled={busy}
        style={{ borderColor: "rgba(220,80,80,.6)", color: "#e07070" }}
      >
        {busy ? "Unloading…" : "Unload models (free VRAM)"}
      </button>
      {notice && (
        <p style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>{notice}</p>
      )}
    </div>
  );
}
