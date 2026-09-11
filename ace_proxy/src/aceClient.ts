/** Thin HTTP client for the local ACE-Step 1.5 API server.
 *
 * ACE-Step async workflow:
 *   1. POST /release_task   -> returns a task id
 *   2. POST /query_result   -> poll task status until done
 *   3. GET  /v1/audio?path= -> download generated audio
 *
 * IMPORTANT: ACE-Step wraps every reply as {data, code, error}. Failures such
 * as a /v1/init that ran out of VRAM come back as HTTP 200 with code 500 —
 * they must be treated as errors, not successes.
 */
import { config } from "./config";

const BASE = () => config.aceApiUrl.replace(/\/$/, "");

async function jsonFetch(url: string, init?: RequestInit, timeoutMs = 15000): Promise<any> {
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
        typeof body === "object" && body
          ? body.error || body.detail || JSON.stringify(body)
          : String(body);
      throw new Error(`ACE-Step ${res.status}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
    }
    if (body && typeof body === "object" && typeof body.code === "number" && body.code >= 400) {
      throw new Error(body.error || `ACE-Step error code ${body.code}`);
    }
    return body;
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error(`ACE-Step timed out after ${Math.round(timeoutMs / 1000)}s`);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

/** Unwrap the {data: …} envelope. */
const dataOf = (body: any) => (body && typeof body === "object" && "data" in body ? body.data : body);

export interface AceHealth {
  ok: boolean;
  via: string;
  detail?: string;
  modelsInitialized?: boolean;
  loadedModel?: string | null;
  llmInitialized?: boolean;
  loadedLmModel?: string | null;
}

export const aceClient = {
  /** Health probe. ACE-Step's /health also reports which DiT/LM are loaded. */
  async health(timeoutMs = 4000): Promise<AceHealth> {
    try {
      const d = dataOf(await jsonFetch(`${BASE()}/health`, undefined, timeoutMs)) || {};
      return {
        ok: true,
        via: "/health",
        modelsInitialized: !!d.models_initialized,
        loadedModel: d.models_initialized ? d.loaded_model || null : null,
        llmInitialized: !!d.llm_initialized,
        loadedLmModel: d.loaded_lm_model || null,
      };
    } catch (e: any) {
      return { ok: false, via: "none", detail: e?.message || String(e) };
    }
  },

  async models(): Promise<any> {
    return dataOf(await jsonFetch(`${BASE()}/v1/models`));
  },

  async stats(): Promise<any> {
    return dataOf(await jsonFetch(`${BASE()}/v1/stats`, undefined, 4000));
  },

  /** POST /v1/init — load/switch the slot-1 DiT (and optionally the LM).
   *  Accepted fields: model, slot, init_llm, lm_model_path. The LM backend
   *  comes from ACESTEP_LM_BACKEND in ACE-Step's own environment. */
  async init(payload: { model: string; slot?: number; init_llm?: boolean; lm_model_path?: string }): Promise<any> {
    return dataOf(
      await jsonFetch(
        `${BASE()}/v1/init`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slot: 1, ...payload }),
        },
        config.initTimeoutMs
      )
    );
  },

  /** POST /release_task — submit an async generation task. */
  async releaseTask(payload: Record<string, unknown>): Promise<any> {
    const { lyrics, prompt, ...rest } = payload as any;
    console.log(
      "[juno-proxy] ACE /release_task:",
      JSON.stringify({ ...rest, prompt: String(prompt || "").slice(0, 120), lyricsChars: String(lyrics || "").length })
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
    if (!res.ok) throw new Error(`ACE-Step audio fetch failed: ${res.status}`);
    return res;
  },
};
