# Juno — Design Document

Juno is a fully offline, self-hosted music generation workstation with a
Suno-style workflow, powered locally by ACE-Step 1.5 XL models. This document
is the authoritative UI/UX and data specification for the app. The backend
integration details live in `docs/ACE_STEP_INTEGRATION.md` and
`docs/API_MAPPING.md`.

---

## 1. Product Summary

- Juno reproduces the core Suno experience — Create, Library, Studio, Editor,
  Trash — as a local web app served from a single Docker container.
- All generation runs on the local GPU through the ACE-Step 1.5 API server
  (port 8001). The Juno web app and proxy run on port 3000.
- There are no accounts, credits, plans, payments, sharing servers, or
  telemetry. The profile is always "local user / Offline Mode".
- Exactly three model presets are exposed to users, all XL-class
  (see §6.2). The app assumes a 32 GB VRAM GPU.
- Everything the user makes is stored on host-mounted volumes: audio under
  `./outputs`, uploads under `./uploads`, library metadata under `./data`,
  model weights under `./models`.

## 2. App Shell

- Three-region layout: left sidebar, main routed page, persistent bottom
  player. The player is always visible on every page.
- Dark theme only; magenta accent `#ff4db8` (see §22 for tokens).
- The sidebar is collapsible; the collapsed state persists across sessions.
- Routes (hash-based): `/create` (default), `/library`, `/studio`,
  `/editor/:songId`, `/trash`, `/settings`.

## 3. Sidebar

- Top: JUNO wordmark logo and a collapse/expand toggle.
- Profile block: avatar circle, name "local user", subtitle "Offline Mode".
  Clicking opens Settings.
- Primary navigation: **Create**, **Studio**, **Library** — icon + label,
  active item highlighted with the accent color.
- A "More" item at the bottom exposes Settings and Trash.
- Explicitly EXCLUDED (cloud-service leftovers that must never appear):
  Upgrade to Pro, Home, Explore, Notifications, Earn Credits, Labs,
  Terms & Policies, or any billing/plan UI.

## 4. Bottom Player

Three columns:

1. **Track info** — cover thumbnail, title, subtitle (model preset or
   "Local upload"), inline error text when audio fails to load.
2. **Transport** — shuffle, previous, play/pause, next, repeat
   (none → all → one). Below: current time, seekable timeline, duration.
3. **Actions** — queue drawer toggle, like, dislike, comment (local notes),
   share/export (local export explanation), overflow menu (Open in Editor /
   Open in Studio), volume popover with slider + mute, track info modal.

States:

- **Empty**: "No song selected / Choose a song from Create or Library";
  all controls disabled.
- **Playing / paused**: play button swaps icon; the playing song row is
  highlighted everywhere it appears.
- **Loading**: "loading…" appended to the subtitle.
- **Error**: red inline error, playback controls remain usable for other
  songs.
- Real audio (`audioUrl` present) plays through an `<audio>` element; mock
  rows without audio use a simulated 1-second-tick clock so every state is
  demonstrable offline.

## 5. Create Page

- Two-column layout: the **Create Control Panel** (§6) on the left
  (~450 px), **Workspace Results** (§12) on the right. Stacks vertically on
  narrow screens.
- Breadcrumb above the results: `Workspaces › <active workspace name>` with
  a workspace switcher dropdown.
- A status hint appears when the ACE-Step backend is not "ok".

## 6. Create Control Panel

### 6.1 Modes

- **Simple**: a single large "Describe your song" textarea plus an
  Instrumental checkbox.
- **Advanced** (default): prompt field + Lyrics card (§7) + Styles card
  (§8) + More Options card (§9) + Song Title + Save To (§10) + Create
  button (§11).

### 6.2 Model selector

Dropdown at the top-right of the panel. EXACTLY three presets:

| Preset | ACE-Step DiT model | Steps | CFG | LM |
|---|---|---|---|---|
| **Juno XL Quality** (default) | `acestep-v15-xl-sft` | 50 | on | `acestep-5Hz-lm-4B` |
| **Juno XL Fast** | `acestep-v15-xl-turbo` | 8 | off (no-CFG path) | `acestep-5Hz-lm-4B` |
| **Juno XL Studio** | `acestep-v15-xl-base` | 50 | on | `acestep-5Hz-lm-4B` |

No small-model presets appear anywhere in the UI. Hidden developer presets
may exist in code only (`web/src/data/modelPresets.ts` →
`HIDDEN_DEV_PRESETS`, `ace_proxy/src/config.ts`).

### 6.3 Attachment row (Advanced)

- **＋ Audio** — opens the Upload Audio modal (§18).
- **＋ Voice** — creates a local voice profile (name, gender label,
  description; optional source clip via ＋ Audio). No server training.
- **＋ Inspo** — picker listing recent songs and voices; selecting a song
  copies its styles/metadata and attaches its audio as
  `reference_audio_path`; selecting a voice sets the vocal-gender metadata.

## 7. Lyrics Card

### 7.1 Tabs

- **Write** — free-text lyric editor with the placeholder shown in §28,
  a section-tag inserter (¶ menu: `[Intro]`, `[Verse]`, `[Pre-Chorus]`,
  `[Chorus]`, `[Bridge]`, `[Breakdown]`, `[Outro]`, `[Instrumental]`,
  `[Drop]`, `[Solo]`), a ✨ local "improve" wand, and a ⤢ full-screen
  expand modal.
- **Prompt** — "Describe the lyrics you want..." textarea + a ✨ generate
  button producing local template lyrics into the Write tab.
- **Instrumental** — no lyric input; the request is sent with EMPTY lyrics
  and the resulting song is flagged Instrumental.

### 7.2 Mapping

Lyrics text maps 1:1 to ACE-Step `lyrics`. Instrumental sends `lyrics: ""`.

## 8. Styles Card

- Multi-line style input; typing a comma converts the preceding text into a
  removable **chip** (Enter also commits). Backspace on empty input removes
  the last chip.
- 🗂 opens saved style presets from the Library; ✨ locally enriches the
  chip set; ↻ adds random suggestions.
- Placeholder: `slow ambient, discordant, italian pop, dynamic
  instrumentation, urban`.
- **8.4 Mapping**: chips are joined with the prompt text into the single
  ACE-Step `prompt` string, and stored verbatim in local metadata for
  filtering and Reuse Prompt.

## 9. More Options Card

Collapsed by default. Contents:

- **Vocal Gender** — Male / Female segmented toggle (click again to clear).
  Stored as local metadata; may inform prompt construction.
- **Weirdness** — 0–100 slider, default 50%.
- **Style Influence** — 0–100 slider, default 50%.
- **Exclude** — free-text "Things to avoid: instruments, genres, moods,
  words...".

### 9.2 Mapping

- **Style Influence → CFG/guidance** where the model supports it
  (`guidance_scale`, mapped 0–100 → 1.0–15.0). DISABLED on Juno XL Fast
  because Turbo is the no-CFG path; the slider greys out with an
  explanation and the value is stored as metadata only.
- **Weirdness** is LOCAL metadata plus seed variation: weirdness > 75
  forces a random seed even when a fixed seed was provided. There is no
  native ACE-Step weirdness parameter.
- **Exclude** is local prompt construction: folded into the prompt as
  `avoid: …` until ACE-Step exposes a native negative field.

## 10. Song Title / Save To

- **♪ Song Title (Optional)** — text input; when empty, a title is
  generated (§28 title pool).
- **📁 Save to…** — workspace dropdown listing existing workspaces plus
  "＋ Create new workspace". The selection persists.

## 11. Create Button

Full-width accent button at the bottom of the panel.

States: **Create** (enabled once prompt, styles, or lyrics are non-empty)
→ **Submitting…** (spinner, disabled) → transient **✓ Created**
confirmation → back to Create. On failure the button returns to Create and
an inline error appears; the failed attempt is also documented as a failed
song row (§13, §27). When disabled, a hint explains why.

## 12. Workspace Results

- Right column of the Create page: the active workspace's songs, newest
  first, rendered as Song Rows (§13).
- **12.2 Toolbar**: search field, Filters dropdown showing an active count
  ("Filters (2)"), Sort dropdown (Newest First / Oldest First / Title A–Z /
  Most Played), View dropdown (List / Compact), quick pills
  **Liked · Public · Uploads**, and pagination rendered as `‹ 1 ›`.
- Empty state: "No songs here yet / Describe a song on the left and press
  Create."

## 13. Song Row

Layout: cover thumbnail (play/pause on hover, duration badge in the
corner) · body (title + badges, description line, action row) · overflow
menu (§14).

- Badges: model preset (accent), type (Cover/Upload/Remix/…), Instrumental,
  Public, Processing (warning), Failed (danger), Trashed (danger).
- Action row: like ♥, dislike 👎, comment 💬 (with count), share ↗ (toggles
  the local "public" flag), Retry on failed rows. Library rows also show a
  play count.
- States: default, hover, **playing** (accent left edge + tinted
  background), **selected**, **liked**, **processing** (spinner thumb,
  disabled play), **failed** (error text replaces the description),
  **trashed** (dimmed, only in Trash).

## 14. Song Overflow Menu (⋯)

All items — none carry Pro/paywall badges:

1. **Open in Studio** (with a "New" badge)
2. **Open in Editor**
3. **Cover** — modal with a "new style" prompt → ACE-Step `cover`
4. **Extend** — extend-from slider + optional continuation → ACE-Step
   `complete` where supported
5. **Mashup** — second-source picker + blend slider → ACE-Step `lego`
   where supported
6. **Sample this song** — local sample extraction (creates a short
   derivative row)
7. **Use as Inspiration** — copies styles/metadata into the Create form and
   attaches the source audio as `reference_audio_path`
8. **Reverse** — local audio processing
9. **Adjust Speed** — 0.5x–2.0x slider + preserve-pitch checkbox, local
10. **Reuse Prompt** — copies prompt, styles, lyrics, and options back into
    the Create form
11. **Crop** — start/end range, local
12. **Remove Section** — start/end range, local
13. **Replace Section** — start/end range + replacement prompt → ACE-Step
    `repaint` with `repainting_start` / `repainting_end`
14. **Export** — writes a JSON manifest (plus audio reference) to
    `./outputs/exports`

### 14.2 Backend routing

ACE-Step-backed: Cover (`cover`), Replace Section (`repaint`), Extend
(`complete`), Mashup (`lego`), plus Create (`text2music`) and Extract
(`extract`). Local-only: Reverse, Adjust Speed, Crop, Remove Section,
Sample. Metadata-only: Reuse Prompt, Use as Inspiration. When ACE-Step is
unreachable, ACE-backed actions create a documented local placeholder or
failed row instead of silently doing nothing.

## 15. Library Page

Header row: "Library" title, **＋ Audio** button (opens §18), and a
**🗑 Trash** button navigating to `/trash`. Below: the tab row (§16) and the
per-tab toolbar (§17) and content.

## 16. Library Tabs

Eleven tabs, in this order:

**Songs · Playlists · Workspaces · Studio Projects · Voices · Lyrics ·
Styles · Cover Art · Hooks · Liked Hooks · History**

- Songs: song rows with play counts and all §13 states.
- Playlists / Workspaces / Studio Projects: card grid with cover, name,
  counts, and an Open action (workspaces switch the active workspace and
  navigate to Create).
- Voices: voice cards with gender badge and "Use in Create".
- Lyrics: saved lyric docs with a preview and "Use in Create".
- Styles: saved style presets as chip sets with like and "Use in Create".
- Cover Art: art grid (locally generated gradients).
- Hooks / Liked Hooks: short clips with a like toggle; Liked Hooks shows an
  empty state until something is liked.
- History: reverse-chronological event list (generations, uploads, trash
  operations, exports…).

## 17. Library Toolbar

Same pattern as §12.2, adapted per tab: search, Filters (count), Sort
(name-based tabs use Newest/Oldest/Name A–Z), View (Songs only), quick
pills (Songs only), pagination `‹ 1 ›`.

## 18. + Audio Flow (Upload)

- Modal with a drag-and-drop zone and a "Choose file" picker.
- Supported: **MP3, WAV, M4A, OGG, FLAC**; anything else shows an inline
  unsupported-type error.
- Import POSTs to `/api/upload`; the file lands in the host-mounted
  `/uploads` directory and a Song row of type `upload` is added to the
  active workspace. If the proxy is unreachable, a session-only local
  asset (blob URL) keeps the flow usable and says so.

## 19. Trash

- Breadcrumb `Library › Trash`; toolbar with search, type filter
  (Songs / Uploads), sort.
- Each row: Restore and Delete Forever (confirmation modal).
- **Empty Trash** button with a confirmation modal stating the count.
- Deleting forever removes library entries; audio files under `./outputs`
  remain on disk.

## 20. Studio

- Toolbar: project name, Undo, Redo, Save, Export.
- Left: track heads (Vocals / Drums / Bass / Music) with Mute / Solo /
  Lock and a volume slider.
- Center: timeline with a time ruler, positioned clips (click to select;
  locked tracks are not clickable), and a highlighted selected region.
- Right: inspector — selected clip start/length/delete, region start/end,
  and generation actions: **Generate section** (`text2music`),
  **Repaint region** (`repaint`), **Extend arrangement** (`complete`) —
  all submitted with the **Juno XL Studio** preset. Results land as rows
  in the active workspace.
- Undo/redo covers clip edits. Saving/exporting is local.

## 21. Editor (`/editor/:songId`)

- Breadcrumb `Library › Editor`; header with title, preset badge,
  duration, styles; Play and Export buttons.
- Waveform (deterministic mock bars keyed on the song id) with mouse-drag
  region selection and section markers derived from `[Tag]` lines in the
  lyrics.
- Section actions: **Crop to selection** (local), **Remove Section**
  (local), **Replace Section** (ACE-Step `repaint` with the selected
  range).
- Whole-song actions: speed slider + create version (local), Reverse
  (local).
- Lyrics panel: full lyrics, or "Instrumental track — no lyrics."
- Unknown song id → not-found empty state with a Back to Library action.

## 22. Visual Design Tokens

Dark theme, defined in `web/src/styles/tokens.css`:

```css
:root {
  --color-bg-app: #0f0f13;
  --color-bg-panel: #16161c;
  --color-bg-card: #1c1c24;
  --color-bg-elevated: #22222c;
  --color-bg-hover: #26262f;

  --color-border-subtle: #26262f;
  --color-border-strong: #34343f;

  --color-text-primary: #f2f2f5;
  --color-text-secondary: #b6b6c2;
  --color-text-muted: #7c7c8a;

  --color-accent: #ff4db8;
  --color-accent-hover: #ff69c4;
  --color-accent-muted: #59274a;

  --color-success: #3ddc97;
  --color-warning: #ffb84d;
  --color-danger: #ff5c5c;

  --radius-pill: 999px;
  --radius-card: 14px;
  --radius-input: 10px;

  --font-family-base: -apple-system, BlinkMacSystemFont, "Segoe UI",
    Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-size-body: 14px;
  --font-size-small: 12.5px;
  --font-size-tiny: 11px;

  --sidebar-width: 232px;
  --sidebar-width-collapsed: 68px;
  --bottom-player-height: 84px;
  --create-panel-width: 450px;
}
```

Buttons and chips are pill-shaped; cards use `--radius-card`; the accent is
reserved for primary actions, active states, and the playing indicator.
Reduced-motion preferences disable transitions.

## 23. Components

Reusable component inventory (all under `web/src/components/`):

Sidebar, BottomPlayer, QueueDrawer, CreatePanel, LyricsCard, StylesCard,
MoreOptionsCard, SongRow, SongOverflowMenu, LibraryTabs, Toolbar, Modal,
Button (primary/secondary/ghost/icon/pill/danger, loading state), Badge,
Dropdown (keyboard navigable), Slider, UploadModal, ModelStatus (backend +
per-preset status with an Initialize action), plus pages under
`web/src/pages/`.

## 24. Data Model

### 24.1 Song

```ts
type PresetName = "juno-xl-quality" | "juno-xl-fast" | "juno-xl-studio";
type AceModelName =
  | "acestep-v15-xl-sft"
  | "acestep-v15-xl-turbo"
  | "acestep-v15-xl-base";

interface Song {
  id: string;
  title: string;
  description: string;
  lyrics?: string;
  styles: string[];
  model: PresetName;
  aceModel: AceModelName;
  type:
    | "song" | "upload" | "cover" | "remix" | "extended"
    | "mashup" | "sample" | "reversed" | "cropped" | "replacement";
  durationSeconds: number;
  coverArtUrl?: string;
  audioUrl?: string;
  localAudioPath?: string;
  workspaceId?: string;
  playlistIds: string[];
  liked: boolean;
  disliked: boolean;
  public: boolean;      // local flag only — nothing is ever uploaded
  playCount: number;
  commentCount: number;
  createdAt: string;
  updatedAt: string;
  sourceSongId?: string;
  aceTaskId?: string;
  generationStatus?: "idle" | "queued" | "running" | "succeeded" | "failed";
  generationError?: string;
  trashed?: boolean;
  metadata: {
    vocalGender?: "male" | "female" | "none";
    weirdness: number;        // 0–100
    styleInfluence: number;   // 0–100
    instrumental: boolean;
    bpm?: number;
    key?: string;
    timeSignature?: string;
    seed?: number;
    taskType?: "text2music" | "cover" | "repaint" | "lego" | "extract" | "complete";
  };
}
```

### 24.2 Other records

```ts
interface Workspace { id: string; name: string; songIds: string[]; createdAt: string; updatedAt: string; }
interface Playlist  { id: string; name: string; songIds: string[]; coverArtUrl?: string; createdAt: string; updatedAt: string; }
interface Voice     { id: string; name: string; sourceAudioId?: string; description?: string; gender?: "male" | "female" | "none"; createdAt: string; updatedAt: string; }
interface StylePreset { id: string; name: string; styles: string[]; description?: string; liked: boolean; createdAt: string; updatedAt: string; }

interface GenerationTask {
  id: string;
  aceTaskId: string;
  songId: string;
  status: "queued" | "running" | "succeeded" | "failed";
  model: PresetName;
  aceModel: AceModelName;
  requestPayload: unknown;
  resultAudioPath?: string;
  localAudioPath?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}
```

## 25. Offline Storage

- Library metadata lives in a single JSON database managed by the proxy at
  `/data/juno-db.json` (host `./data/juno-db.json`) — chosen over
  browser-side IndexedDB so the library survives browser resets and is
  visible to the export pipeline.
- Generated audio is copied by the proxy into `/outputs/library`; uploads
  live in `/uploads`; exports in `/outputs/exports`.
- Lightweight UI preferences (sidebar collapsed, selected preset, active
  workspace, volume) persist in `localStorage` under the `juno:` prefix.
- The frontend boots from mock data and merges the proxy library when
  reachable, so the whole UI is explorable with no backend at all.

## 26. Required Pages

`/create` (default), `/library` (11 tabs), `/studio`, `/editor/:songId`,
`/trash`, `/settings`. Settings covers profile (offline), backend health,
the preset table, storage paths, and preferences.

## 27. Required UI States

Every state below must be reachable in the shipped build (mock data covers
them before the first real generation):

- Player: empty / playing / paused / loading / error.
- Song row: default / hover / playing / selected / liked / processing /
  failed / trashed.
- Create button: disabled-with-reason / enabled / submitting / success /
  failure.
- Backend: Juno ok + ACE-Step ok · ACE-Step offline (banner; generation
  attempts produce documented failed rows) · model downloaded-but-not-
  initialized (ModelStatus offers "Initialize model").
- Library: populated tabs (≥ 8 songs incl. ≥ 2 covers, ≥ 1 instrumental,
  ≥ 1 upload, 1 processing, 1 failed; 2 workspaces; 2 playlists; 2 voices;
  3 lyric docs; 3 style presets; 4 cover art; 3 hooks; history events) and
  empty states (Liked Hooks before any like, empty Trash, empty search
  results).

## 28. Copy Requirements Summary

- Profile: `local user` / `Offline Mode`.
- Player empty state: `No song selected` / `Choose a song from Create or
  Library`.
- Lyrics Write placeholder:
  `[Verse]` / `This is where you write your rhymes` /
  `or give Juno a try` / (blank) / `[Chorus]` /
  `Songs feel more structured` / `with sections like these`.
- Lyrics Prompt placeholder: `Describe the lyrics you want...`.
- Styles placeholder: `slow ambient, discordant, italian pop, dynamic
  instrumentation, urban`.
- Exclude placeholder: `Things to avoid: instruments, genres, moods,
  words...`.
- Prompt placeholder: `Describe the song you want to create...`.
- Song title field label: `♪ Song Title (Optional)`; Save-to label:
  `📁 Save to…`.
- Upload modal: `Upload Audio`, `Drag and drop audio here`, `or`,
  `Choose file`, `Supported: MP3, WAV, M4A, OGG, FLAC`, `Import`.
- Generated-title pool (used when the title is left empty): God's Promise,
  Late Signal, Soft Static, The Long Horizon, Night Choir, Glass Weather,
  Slow Bloom, Neon Prayer.
- Forbidden copy anywhere in the UI: Upgrade, Pro, credits, plans,
  billing, Explore, Earn Credits, Labs, Terms & Policies, notifications.
