/** Create control panel (DESIGN_DOC §6–11).
 *
 *  Changes:
 *  - Attached context is now VISIBLE: Cover source, Inspiration reference,
 *    and Voice each render as a removable chip above the Create button, so
 *    "Use in Create" from the Library is no longer invisible.
 *  - Cover mode: when a song's Cover action routed here, Create submits an
 *    ACE-Step "cover" task with the source audio attached — describe the
 *    NEW style in the prompt/styles (Suno-style cover flow).
 *  - "＋ Create new workspace" actually creates one (name modal, persisted
 *    to the proxy DB).
 *  - "＋ Voice" saves a real voice profile to the library DB and attaches
 *    it to the current creation.
 */
import React, { useEffect, useState } from "react";
import { useJuno } from "../App";
import { MODEL_PRESETS, PresetId, presetLabel } from "../data/modelPresets";
import { Button } from "./Button";
import { Dropdown } from "./Dropdown";
import { LyricsCard, LyricsMode } from "./LyricsCard";
import { StylesCard } from "./StylesCard";
import { MoreOptionsCard } from "./MoreOptionsCard";
import { UploadModal } from "./UploadModal";
import { Modal } from "./Modal";
import { ModelStatus } from "./ModelStatus";

type CreateStatus =
  | "idle"
  | "submitting"
  | "queued"
  | "running"
  | "succeeded"
  | "failed";

export function CreatePanel() {
  const {
    health,
    selectedPreset,
    setSelectedPreset,
    generate,
    workspaces,
    activeWorkspaceId,
    setActiveWorkspaceId,
    addWorkspace,
    addVoice,
    prefill,
    setPrefill,
    voices,
    songs,
  } = useJuno();

  const [advanced, setAdvanced] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [chips, setChips] = useState<string[]>([]);
  const [lyricsMode, setLyricsMode] = useState<LyricsMode>("write");
  const [lyrics, setLyrics] = useState("");
  const [vocalGender, setVocalGender] = useState<"male" | "female" | "none">("none");
  const [weirdness, setWeirdness] = useState(50);
  const [styleInfluence, setStyleInfluence] = useState(50);
  const [exclude, setExclude] = useState("");
  const [title, setTitle] = useState("");

  /* Attached context (all visible as removable chips) */
  const [referenceAudioPath, setReferenceAudioPath] = useState<string | undefined>();
  const [inspirationTitle, setInspirationTitle] = useState<string | undefined>();
  const [coverSource, setCoverSource] = useState<{ path: string; title: string } | undefined>();
  const [attachedVoice, setAttachedVoice] = useState<string | undefined>();
  const [sourceSongId, setSourceSongId] = useState<string | undefined>();

  const [status, setStatus] = useState<CreateStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voiceName, setVoiceName] = useState("");
  const [voiceDesc, setVoiceDesc] = useState("");
  const [voiceGender, setVoiceGender] = useState<"male" | "female" | "none">("none");
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [wsOpen, setWsOpen] = useState(false);
  const [wsName, setWsName] = useState("");
  const [wsBusy, setWsBusy] = useState(false);

  const preset = MODEL_PRESETS.find((p) => p.id === selectedPreset)!;
  const aceOk = health?.aceStep === "ok";
  const instrumental = lyricsMode === "instrumental";

  /* Reuse Prompt / Use as Inspiration / Cover / Voice prefill */
  useEffect(() => {
    if (!prefill) return;
    if (prefill.prompt != null) setPrompt(prefill.prompt);
    if (prefill.styles) setChips(prefill.styles);
    if (prefill.lyrics != null) setLyrics(prefill.lyrics);
    if (prefill.instrumental) setLyricsMode("instrumental");
    if (prefill.vocalGender) setVocalGender(prefill.vocalGender);
    if (prefill.weirdness != null) setWeirdness(prefill.weirdness);
    if (prefill.styleInfluence != null) setStyleInfluence(prefill.styleInfluence);
    if (prefill.title) setTitle(prefill.title);
    setReferenceAudioPath(prefill.referenceAudioPath);
    setInspirationTitle(
      prefill.referenceAudioPath ? prefill.inspirationTitle || "attached audio" : undefined
    );
    setCoverSource(
      prefill.taskType === "cover" && prefill.srcAudioPath
        ? { path: prefill.srcAudioPath, title: prefill.coverOfTitle || "source audio" }
        : undefined
    );
    if (prefill.voiceName) setAttachedVoice(prefill.voiceName);
    setSourceSongId(prefill.sourceSongId);
    setPrefill(null);
  }, [prefill, setPrefill]);

  const canCreate =
    status !== "submitting" &&
    (prompt.trim().length > 0 || chips.length > 0 || lyrics.trim().length > 0);

  const disabledReason = !canCreate
    ? status === "submitting"
      ? "Generation in progress"
      : coverSource
        ? "Describe the new style for this cover (prompt or style chips)"
        : "Describe your song or add styles or lyrics first"
    : !aceOk
      ? "ACE-Step is offline — a failed row will document the attempt"
      : undefined;

  const create = async () => {
    setStatus("submitting");
    setError(null);
    try {
      await generate({
        taskType: coverSource ? "cover" : "text2music",
        model: selectedPreset,
        prompt,
        styles: chips,
        lyrics: instrumental ? "" : lyrics,
        instrumental,
        vocalGender: vocalGender === "none" ? undefined : vocalGender,
        weirdness,
        styleInfluence,
        exclude: exclude || undefined,
        title: title || undefined,
        workspaceId: activeWorkspaceId,
        duration: 120,
        srcAudioPath: coverSource?.path,
        referenceAudioPath,
        sourceSongId,
      });
      setStatus("succeeded");
      setTimeout(() => setStatus("idle"), 2500);
    } catch (e: any) {
      setStatus("failed");
      setError(e?.message || "Generation failed");
    }
  };

  const saveVoice = async () => {
    setVoiceBusy(true);
    try {
      const v = await addVoice({
        name: voiceName.trim(),
        gender: voiceGender,
        description: voiceDesc || undefined,
      });
      setAttachedVoice(v.name);
      if (voiceGender !== "none") setVocalGender(voiceGender);
      setVoiceName("");
      setVoiceDesc("");
      setVoiceOpen(false);
    } finally {
      setVoiceBusy(false);
    }
  };

  const saveWorkspace = async () => {
    const name = wsName.trim();
    if (!name) return;
    setWsBusy(true);
    try {
      await addWorkspace(name);
      setWsName("");
      setWsOpen(false);
    } finally {
      setWsBusy(false);
    }
  };

  const statusLabel: Record<CreateStatus, string> = {
    idle: coverSource ? "Create Cover" : "Create",
    submitting: "Submitting…",
    queued: "Queued…",
    running: "Generating…",
    succeeded: "✓ Created",
    failed: coverSource ? "Create Cover" : "Create",
  };

  return (
    <section className="create-panel" aria-label="Create song">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <div className="segmented" role="tablist" aria-label="Create mode">
          <button
            role="tab"
            aria-selected={!advanced}
            className={!advanced ? "active" : ""}
            onClick={() => setAdvanced(false)}
          >
            Simple
          </button>
          <button
            role="tab"
            aria-selected={advanced}
            className={advanced ? "active" : ""}
            onClick={() => setAdvanced(true)}
          >
            Advanced
          </button>
        </div>

        <Dropdown
          ariaLabel="Model preset"
          trigger={<>{presetLabel(selectedPreset)} ▾</>}
          items={MODEL_PRESETS.map((p) => ({
            id: p.id,
            label: (
              <span>
                {p.label}
                <span className="inline-hint" style={{ display: "block" }}>
                  {p.description} · {p.aceModel}
                </span>
              </span>
            ),
            selected: p.id === selectedPreset,
            onSelect: () => setSelectedPreset(p.id as PresetId),
          }))}
        />
      </div>

      {advanced && (
        <div style={{ display: "flex", gap: 8 }}>
          <Button onClick={() => setUploadOpen(true)}>＋ Audio</Button>
          <Button onClick={() => setVoiceOpen(true)}>＋ Voice</Button>
          <Dropdown
            ariaLabel="Inspiration picker"
            triggerClass="btn"
            trigger={<>＋ Inspo</>}
            items={[
              ...songs
                .filter((s) => !s.trashed)
                .slice(0, 6)
                .map((s) => ({
                  id: s.id,
                  label: `♪ ${s.title}`,
                  onSelect: () => {
                    setChips((c) => [...new Set([...c, ...s.styles])]);
                    if (s.metadata.vocalGender) setVocalGender(s.metadata.vocalGender);
                    setWeirdness(s.metadata.weirdness);
                    setStyleInfluence(s.metadata.styleInfluence);
                    setReferenceAudioPath(s.localAudioPath);
                    setInspirationTitle(s.title);
                    setSourceSongId(s.id);
                  },
                })),
              ...voices.map((v) => ({
                id: v.id,
                label: `🎙 ${v.name}`,
                onSelect: () => {
                  setAttachedVoice(v.name);
                  setVocalGender((v.gender as any) || "none");
                },
              })),
            ]}
          />
        </div>
      )}

      {coverSource && (
        <div className="attach-chip" role="status">
          <span>
            ♻ Cover of <strong>“{coverSource.title}”</strong> — describe the
            new style below.
          </span>
          <button className="btn btn-ghost" onClick={() => setCoverSource(undefined)}>
            Remove
          </button>
        </div>
      )}
      {inspirationTitle && (
        <div className="attach-chip" role="status">
          <span>
            ✨ Inspiration: <strong>“{inspirationTitle}”</strong>
            {referenceAudioPath ? " (audio attached as reference)" : " (styles copied)"}
          </span>
          <button
            className="btn btn-ghost"
            onClick={() => {
              setInspirationTitle(undefined);
              setReferenceAudioPath(undefined);
            }}
          >
            Remove
          </button>
        </div>
      )}
      {attachedVoice && (
        <div className="attach-chip" role="status">
          <span>
            🎙 Voice: <strong>{attachedVoice}</strong>
            {vocalGender !== "none" ? ` (${vocalGender})` : ""}
          </span>
          <button className="btn btn-ghost" onClick={() => setAttachedVoice(undefined)}>
            Remove
          </button>
        </div>
      )}

      <div>
        <label className="field-label" htmlFor="create-prompt">
          {coverSource ? "New style" : advanced ? "Prompt" : "Describe your song"}
        </label>
        <textarea
          id="create-prompt"
          className="text-area"
          style={{ minHeight: advanced ? 72 : 140 }}
          placeholder={
            coverSource
              ? "e.g. icy synthwave, half-time drums, wide chorus"
              : "Describe the song you want to create..."
          }
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        {!advanced && (
          <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
            <input
              type="checkbox"
              checked={instrumental}
              onChange={(e) => setLyricsMode(e.target.checked ? "instrumental" : "write")}
            />
            Instrumental
          </label>
        )}
      </div>

      {advanced && (
        <>
          <LyricsCard mode={lyricsMode} onMode={setLyricsMode} lyrics={lyrics} onLyrics={setLyrics} />
          <StylesCard chips={chips} onChips={setChips} />
          <MoreOptionsCard
            vocalGender={vocalGender}
            onVocalGender={setVocalGender}
            weirdness={weirdness}
            onWeirdness={setWeirdness}
            styleInfluence={styleInfluence}
            onStyleInfluence={setStyleInfluence}
            exclude={exclude}
            onExclude={setExclude}
            cfgDisabled={!preset.cfgEnabled}
          />
          <div>
            <label className="field-label" htmlFor="song-title">♪ Song Title (Optional)</label>
            <input
              id="song-title"
              className="text-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Leave empty for a generated title"
            />
          </div>
          <div className="slider-row" style={{ gridTemplateColumns: "110px 1fr" }}>
            <span className="field-label" style={{ marginBottom: 0 }}>📁 Save to…</span>
            <Dropdown
              align="left"
              ariaLabel="Workspace selector"
              trigger={<>{workspaces.find((w) => w.id === activeWorkspaceId)?.name || "My Workspace"} ▾</>}
              items={[
                ...workspaces.map((w) => ({
                  id: w.id,
                  label: w.name,
                  selected: w.id === activeWorkspaceId,
                  onSelect: () => setActiveWorkspaceId(w.id),
                })),
                {
                  id: "new",
                  label: "＋ Create new workspace",
                  onSelect: () => setWsOpen(true),
                },
              ]}
            />
          </div>
        </>
      )}

      <Button
        variant="primary"
        large
        loading={status === "submitting"}
        disabled={!canCreate}
        onClick={create}
        title={disabledReason}
      >
        {statusLabel[status]}
      </Button>
      {disabledReason && <p className="inline-hint">{disabledReason}</p>}
      {error && <p className="inline-error">{error}</p>}
      {status === "succeeded" && (
        <p className="inline-hint" style={{ color: "var(--color-success)" }}>
          Task submitted — the new row is at the top of the workspace and will
          update as ACE-Step reports progress.
        </p>
      )}

      <ModelStatus />

      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} />

      <Modal
        title="New workspace"
        open={wsOpen}
        onClose={() => setWsOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setWsOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={wsBusy} disabled={!wsName.trim()} onClick={saveWorkspace}>
              Create workspace
            </Button>
          </>
        }
      >
        <label className="field-label" htmlFor="ws-name">Workspace name</label>
        <input
          id="ws-name"
          className="text-input"
          value={wsName}
          onChange={(e) => setWsName(e.target.value)}
          placeholder="e.g. Film Sketches"
          onKeyDown={(e) => e.key === "Enter" && saveWorkspace()}
        />
        <p className="inline-hint" style={{ marginTop: 8 }}>
          Workspaces group songs on the Create page and are saved to the
          local library database.
        </p>
      </Modal>

      <Modal
        title="New voice profile"
        open={voiceOpen}
        onClose={() => setVoiceOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setVoiceOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              loading={voiceBusy}
              disabled={!voiceName.trim()}
              onClick={saveVoice}
            >
              Save
            </Button>
          </>
        }
      >
        <div style={{ display: "grid", gap: 10 }}>
          <div>
            <label className="field-label" htmlFor="voice-name">Voice name</label>
            <input id="voice-name" className="text-input" value={voiceName} onChange={(e) => setVoiceName(e.target.value)} />
          </div>
          <div>
            <label className="field-label" htmlFor="voice-gender">Gender label (metadata only)</label>
            <select id="voice-gender" className="text-input" value={voiceGender} onChange={(e) => setVoiceGender(e.target.value as any)}>
              <option value="none">None</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="voice-desc">Description</label>
            <textarea id="voice-desc" className="text-area" style={{ minHeight: 60 }} value={voiceDesc} onChange={(e) => setVoiceDesc(e.target.value)} />
          </div>
          <p className="inline-hint">
            Saved to your library (Voices tab) and attached to this creation.
            Offline profile — no verification or server-side training.
          </p>
        </div>
      </Modal>
    </section>
  );
}
