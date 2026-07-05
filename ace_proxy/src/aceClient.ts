/** Thin HTTP client for the local ACE-Step 1.5 API server.
 *
 * ACE-Step async workflow (see docs/ACE_STEP_INTEGRATION.md):
 *   1. POST /release_task   -> returns a task id
 *   2. POST /query_result   -> poll task status until done
 *   3. GET  /v1/audio?path= -> download generated audio
 *
 * The Juno frontend never talks to this API directly — everything goes
 * through the routes in routes.ts.
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
      /* non-JSON body, keep text */
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
        return { ok: false, via: "none", detail: e2?.message || e1?.message };
      }
    }
  },

  async models(): Promise<any> {
    return jsonFetch(`${BASE()}/v1/models`);
  },

  /** POST /v1/init — load/switch a DiT model (+ LM) into a slot. */
  async init(payload: Record<string, unknown>): Promise<any> {
    return jsonFetch(
      `${BASE()}/v1/init`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
      // model init can take a while (weights load into VRAM)
      10 * 60 * 1000
    );
  },

  /** POST /release_task — submit an async generation task. */
  async releaseTask(payload: Record<string, unknown>): Promise<any> {
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
