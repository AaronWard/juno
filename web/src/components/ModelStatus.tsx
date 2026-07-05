import React, { useState } from "react";
import { useJuno } from "../App";
import { api } from "../lib/api";
import { MODEL_PRESETS, presetLabel } from "../data/modelPresets";
import { Button } from "./Button";
import { Modal } from "./Modal";

/** Backend status strip: Juno proxy + ACE-Step health, selected model,
 *  and a manual "Initialize model" action (POST /api/models/init). */
export function ModelStatus() {
  const { health, refreshHealth, selectedPreset } = useJuno();
  const [initState, setInitState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const aceOk = health?.aceStep === "ok";
  const junoOk = health?.juno === "ok";

  const initModel = async () => {
    setInitState("loading");
    setError(null);
    try {
      const res = await api.initModel(selectedPreset);
      if (!res.ok) throw new Error(res.error || "Initialization failed");
      setInitState("done");
      refreshHealth();
    } catch (e: any) {
      setInitState("error");
      setError(e?.message || "Model initialization failed");
    }
  };

  return (
    <div
      className="inline-hint"
      style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}
    >
      <span>
        <span className={`status-dot ${junoOk ? "ok" : "bad"}`} aria-hidden="true" />
        Juno {junoOk ? "ready" : "offline"}
      </span>
      <span>
        <span
          className={`status-dot ${aceOk ? "ok" : health ? "bad" : "warn"}`}
          aria-hidden="true"
        />
        ACE-Step {aceOk ? "ready" : health ? "unavailable" : "checking…"}
      </span>
      <span>{presetLabel(selectedPreset)}</span>
      <Button
        variant="ghost"
        onClick={initModel}
        loading={initState === "loading"}
        disabled={!aceOk}
        title={
          aceOk
            ? "Load the selected DiT + LM into VRAM"
            : "ACE-Step API is unavailable — model init disabled"
        }
      >
        {initState === "loading" ? "Initializing…" : "Initialize model"}
      </Button>
      <Modal
        title="Model initialization failed"
        open={initState === "error"}
        onClose={() => setInitState("idle")}
      >
        <p className="inline-error">{error}</p>
        <p className="inline-hint">
          Check that the model weights exist under /models (run
          scripts/verify_models.py) and that the GPU has free VRAM. Presets:{" "}
          {MODEL_PRESETS.map((p) => p.label).join(", ")}.
        </p>
      </Modal>
    </div>
  );
}
