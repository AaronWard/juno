/** Thin HTTP client for the local ACE-Step 1.5 API server.
 *
 * ACE-Step async workflow:
 *   1. POST /release_task   -> returns a task id
 *   2. POST /query_result   -> poll task status until done
 *   3. GET  /v1/audio?path= -> download generated audio
 */
import { config } from "./config";

const BASE = () => config.aceApiUrl.replace(/\/$/, "");

async function jsonFetch(
  url: string,
  init?: RequestInit,
  timeoutMs = 15000
): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();

    let body: any = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // Non-JSON body, keep raw text.
    }

    if (!res.ok) {
      const detail =
        typeof body === "object" && body ? JSON.stringify(body) : String(body);
      throw new Error(`ACE-Step ${res.status} ${res.statusText}: ${detail}`);
    }

    return body;
  } finally {
    clearTimeout(t);
  }
}

export const aceClient = {
  /** Health probe: prefer /health, fall back to /v1/models. */
  async health(): Promise<{ ok: boolean; via: string; detail?: string }> {
    try {
      await jsonFetch(`${BASE()}/health`, undefined, 5000);
      return { ok: true, via: "/health" };
    } catch (e1: any) {
      try {
        await jsonFetch(`${BASE()}/v1/models`, undefined, 5000);
        return { ok: true, via: "/v1/models" };
      } catch (e2: any) {
        return {
          ok: false,
          via: "none",
          detail: e2?.message || e1?.message,
        };
      }
    }
  },

  async models(): Promise<any> {
    return jsonFetch(`${BASE()}/v1/models`);
  },

  /** POST /v1/init — load/switch a DiT model plus LM into a slot. */
  async init(payload: Record<string, unknown>): Promise<any> {
    return jsonFetch(
      `${BASE()}/v1/init`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
      // Model init can take a while.
      10 * 60 * 1000
    );
  },

  /** POST /release_task — submit an async generation task. */
  async releaseTask(payload: Record<string, unknown>): Promise<any> {
    console.log(
      "[juno-proxy] ACE /release_task payload:",
      JSON.stringify({
        model: payload.model,
        task_type: payload.task_type,
        prompt: payload.prompt,
        lyrics: payload.lyrics,
        audio_duration: payload.audio_duration,
        inference_steps: payload.inference_steps,
        guidance_scale: payload.guidance_scale,
        shift: payload.shift,
        infer_method: payload.infer_method,
        use_adg: payload.use_adg,
        cfg_interval_start: payload.cfg_interval_start,
        cfg_interval_end: payload.cfg_interval_end,
        thinking: payload.thinking,
        lm_backend: config.lmBackend,
        batch_size: payload.batch_size,
        seed: payload.seed,
        use_random_seed: payload.use_random_seed,
      })
    );

    return jsonFetch(`${BASE()}/release_task`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  },

  /** POST /query_result — poll one or more task ids. */
  async queryResult(taskIds: string[]): Promise<any> {
    return jsonFetch(`${BASE()}/query_result`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task_id_list: taskIds }),
    });
  },

  /** GET /v1/audio?path=... — stream generated audio bytes. */
  async fetchAudio(path: string): Promise<Response> {
    const url = `${BASE()}/v1/audio?path=${encodeURIComponent(path)}`;
    const res = await fetch(url);

    if (!res.ok) {
      throw new Error(`ACE-Step audio fetch failed: ${res.status}`);
    }

    return res;
  },
};