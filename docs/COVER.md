# Cover: diagnosis and design

Verified against ACE-Step 1.5 commit `ca1e85f` (the commit pinned in the
Dockerfile) and MuScriptor 0.3.0. Everything below comes from the current
source, not from older docs — where the popular community guide disagrees
with the code, the code is quoted.

## 1. Why Juno's covers didn't sound like the source

ACE-Step exposes **two independent cover knobs** over HTTP. Juno sent
neither, so both sat at their API defaults:

| Parameter | API default | What the source says it does |
|---|---|---|
| `cover_noise_strength` | **0.0** | `# 0=pure noise (no cover), 1=closest to src audio` (`inference.py`). Upstream's own UI calls it *"Cover Strength (Melody Retention)"*: "0 = no melody retention (pure style transfer from your caption). 0.1–0.25 = recommended range with SFT model." |
| `audio_cover_strength` | 1.0 | Upstream UI calls it *"LM Codes Strength"*: the fraction of DiT denoising steps conditioned on the source's semantic codes rather than text-only. Below 1.0 the model builds a second, non-cover text encoding over silence latents and blends the two velocities (`conditioning_text.py`, `service_generate_execute.py`). |

So every Juno cover ran with **melody retention switched off**. The only
thing tying the output to the source was the coarse semantic-code scaffold,
which carries section/energy shape but not the tune. "Sounds like an
unrelated remix" is the exact expected behaviour of `cover_noise_strength=0`.

Three further bugs compounded it:

2. **Duration was hard-coded to 120 s.** `CreatePanel` sent `duration: 120`
   for every generation, covers included. The source's codes are laid against
   the requested duration, so covering a 2:30 song at 120 s truncated and
   re-timed the structure. Now the proxy overrides the duration with the
   source song's own length.
3. **Covers ran on whichever preset was selected — usually Turbo.** Upstream's
   melody-retention guidance is explicitly "recommended range *with SFT
   model*". Juno now warns when you start a cover on Juno XL Fast.
4. **`cover-nofsq` was never reachable.** It conditions on the source's raw
   latents instead of FSQ-quantized codes — a second, independent fidelity
   path, and a free experiment.

One more correction: Juno's Mashup "smooth" pass sent `coverStrength: 0.6`
believing it meant fidelity. It actually reduces the fraction of
source-conditioned steps. Left at 0.6 deliberately (blending wants freedom),
but now via an explicitly-named passthrough.

### Note on the community guide (#398)

Discussion #398 is the most-linked Cover tutorial and is right about workflow,
but it describes `audio_cover_strength` as *the* fidelity control ("My cover
sounds nothing like the source → increase toward 0.7–0.9"). In the current
code that parameter defaults to 1.0 already — following that advice changes
nothing, because the knob that was actually at zero is `cover_noise_strength`,
which the guide never mentions. That is very likely why the advice doesn't
reproduce for people, and the same thread contains an unanswered report of
noise and distortion at higher cover strength (consistent with the *other*
parameter being pushed too far).

## 2. The controls Juno now exposes

Only two sliders, because only two independent mechanisms exist over HTTP.

```
Source Fidelity   → cover_noise_strength   0 .. 0.5   (default 45 → 0.23)
Style Influence   → audio_cover_strength   1.0 .. 0.35 (INVERSE; default 50 → 0.68)
[x] Condition on raw source audio → task_type cover-nofsq
```

- **Source Fidelity** is capped at 0.5, not 1.0. Upstream warns that high
  values "keep the tune but may resist style changes", and there is a user
  report of pure noise above ~0.07 on some setups. The default lands at 0.23,
  the top of upstream's recommended 0.1–0.25 band.
- **Style Influence** is inverted and floored at 0.35 so a cover can never
  decay into pure text2music — the failure mode you were seeing.
- **Variation is deliberately not a third slider.** The real variation
  mechanism (`retake_variance` / `retake_seed`) exists in `inference.py` but
  is **not exposed by the HTTP API**, and neither is `flow_edit_morph`. The
  existing Weirdness slider already forces a random seed, which is the only
  variation lever actually available. Adding a "Variation" slider would have
  been a fake knob.

### The one that got away: flow-edit morphing

`flow_edit_morph` (upstream issue #1156) is the mechanism that most closely
matches what you're asking for. It integrates
`V_delta = V_tar(target caption) − V_src(source caption)` over a
`[n_min, n_max]` window on top of a cover — i.e. it *moves* the source toward
the new caption instead of regenerating against it, which is exactly
"same composition, new style". It's reachable from the Python API and the
Gradio UI, but `release_task` has no field for it.

Getting it into Juno needs one of: a small upstream patch adding the fields to
`ReleaseTaskRequest` (about a dozen lines, and worth upstreaming), or a
sidecar that calls `generate_music()` in-process. **This is my top
recommendation for the next iteration** — ahead of any MIDI work.

## 3. Composition vs. style: can ACE-Step separate them?

Partially, and not cleanly. The two knobs are not orthogonal: both ultimately
trade source adherence against caption adherence, just at different points
(latent seed vs. conditioning steps). There is no parameter that says "keep
the notes, change the instruments". Expect:

- **Section timing and energy arc:** well preserved (that's what the codes carry).
- **Chord movement:** moderately preserved at fidelity ≥ 0.2.
- **Melody:** the weak point, and the thing `cover_noise_strength` buys you.
- **Instrumentation:** fully controllable by caption.

A maintainer-adjacent framing in the discussions — that Cover sits between a
strict cover and a remix — matches what the code does. For "a piano solo of
this song on a Steinway", a pure ACE-Step cover will get you the *form* and
often the *harmony*, but melodic drift is likely on dense sources.

## 4. Verdict on the hybrid architectures you proposed

**MuScriptor → symbolic backbone → render → ACE-Step: yes, worth building,
and it is the right answer for "Faithful Cover".** The reasoning:

- The transcription Juno already produces is per-instrument, with pitch,
  timing, velocity and a beat grid — enough to *be* the composition backbone.
  I verified the structure survives a round-trip through Juno's editor.
- A neutral render strips exactly what fights the target style: the original
  production, timbre and drum kit. Feeding a clean piano/synth reduction into
  Cover means the semantic codes describe the *composition* rather than a
  hardstyle mix, which should let a low Style Influence pull hard toward jazz
  without the source dragging it back. Your hardstyle → jazz example is the
  strongest case for this.
- It also makes fidelity *deterministic* where it matters: the notes are
  literally the original's notes.

Two honest caveats. First, **transcription is not arrangement** — you flagged
this and you're right. Assigning every detected note to a piano gives an
unplayable, muddy reduction; a real implementation needs voice reduction
(melody → top voice, bass → root motion, inner voices → chord tones),
density limits, and per-style instrument mapping. That's a meaningful chunk of
music-theory code, not a weekend. Second, MuScriptor's melody extraction from
dense electronic material is the least reliable case, which is the same
material the hybrid is most attractive for. That needs measuring before
committing.

**Stem separation (bs-roformer): worth testing, cheap, but secondary.**
Removing drums and attenuating bass before Cover is a one-step preprocessing
experiment that directly tests "does production information fight the target
style?". It preserves the real melody (unlike transcription, which can
mis-transcribe it). I'd run it *before* building the MIDI arranger, because
it's a fraction of the work and may capture much of the benefit.

**AMT-APC: relevant as method, not as a component.** It's piano-cover
specific and trained for that; its transferable idea is conditioning a
symbolic model on a *style token* so arrangement is learned rather than
rule-based. If the rule-based arranger disappoints, that's the direction —
but it implies training, which is a different scale of project.

**Deterministic render with ACE-Step skipped entirely:** keep this as an
explicit output option. For "solo piano", a good symbolic reduction plus a
sampled piano will beat a generative cover on fidelity every time, and it's
reproducible. It loses vocals and performance realism — so it's a mode, not
the default.

## 5. On the Reimagine / Faithful split

The evidence supports it, but not as two independent UIs — as **two ends of
one control**, which is what we now have. Today Source Fidelity + Style
Influence covers the whole continuum in one code path. Once flow-edit or the
MIDI backbone lands, they'd become a genuinely different pipeline, and *then*
a mode switch earns its place. Shipping the split before the second pipeline
exists would be two labels for one mechanism.

## 6. Experiment matrix

Nothing below has been run: this container has no GPU, so §1's parameter
findings are source-verified but the *audible* results are not. Run this
before investing in the MIDI arranger.

**Sources** (one each): simple melodic (solo vocal + guitar), dense
electronic/hardstyle, vocal pop, acoustic. **Targets**: solo piano, jazz trio,
EDM, orchestral, acoustic guitar.

**Arms:**

| # | Arm | Cost |
|---|---|---|
| A | Old Juno (fidelity 0, 120 s) — the baseline you have | — |
| B | New defaults (fidelity 45, style 50, SFT, source duration) | free |
| C | Fidelity sweep 0.1 / 0.25 / 0.4 at fixed style | free |
| D | Style sweep 25 / 50 / 85 at fidelity 0.25 | free |
| E | `cover-nofsq` vs FSQ at the best C/D point | free |
| F | Turbo vs SFT vs Base at the best point | free |
| G | Stem-separated source (drums removed) → B | ~1 day |
| H | MuScriptor → naive piano render → Cover | ~2 days |
| I | MuScriptor → arranged reduction → Cover | ~1–2 weeks |
| J | Flow-edit morph (needs the upstream patch) | ~2 days |

**Score each 1–5, separately:** melody match, chord match, timing/structure
match, target-style convincingness, audio quality. Scoring them separately is
the point — it tells you *which* axis a given arm buys, and a single "is it
good" rating would hide exactly the trade-off we're trying to control.

Decision rule: if B–F reach melody ≥ 3 with style ≥ 4, the parameter fix was
sufficient and the MIDI route is optional polish. If melody stays ≤ 2 on
dense sources, run G; if G doesn't move it, build H before I.

## 7. What shipped now

- `cover_noise_strength` and `audio_cover_strength` sent on every cover, from
  two honest sliders.
- Cover runs at the source song's duration.
- `cover-nofsq` reachable via a checkbox.
- SFT recommendation surfaced when covering on Turbo.
- Mashup's cover-strength passthrough given its correct meaning.
