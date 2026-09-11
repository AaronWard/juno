/** Tiny wrapper around `supervisorctl` for process lifecycle control. */
import { execFile } from "child_process";

export function supervisorctl(args: string[], timeoutMs = 120000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("supervisorctl", args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      const out = `${stdout || ""}${stderr || ""}`.trim();
      // `supervisorctl start` of an already-running program exits non-zero
      // with "already started" — that is success for our purposes.
      if (err && !/already started|not running|RUNNING|STOPPED/i.test(out)) {
        reject(new Error(out || err.message));
        return;
      }
      resolve(out);
    });
  });
}

/** RUNNING | STARTING | STOPPED | FATAL | BACKOFF | EXITED | UNKNOWN */
export async function programState(name: string): Promise<string> {
  try {
    const out = await supervisorctl(["status", name], 10000);
    const m = out.match(/\b(RUNNING|STARTING|STOPPED|STOPPING|FATAL|BACKOFF|EXITED|UNKNOWN)\b/);
    return m ? m[1] : "UNKNOWN";
  } catch {
    return "UNKNOWN";
  }
}

/** Query GPU memory via nvidia-smi (null when unavailable). */
export function gpuMemory(): Promise<{ usedMb: number; totalMb: number; name?: string } | null> {
  return new Promise((resolve) => {
    execFile(
      "nvidia-smi",
      ["--query-gpu=memory.used,memory.total,name", "--format=csv,noheader,nounits"],
      { timeout: 4000 },
      (err, stdout) => {
        if (err || !stdout) return resolve(null);
        const [used, total, ...name] = stdout.trim().split("\n")[0].split(",").map((s) => s.trim());
        const u = Number(used);
        const t = Number(total);
        resolve(Number.isFinite(u) && Number.isFinite(t) ? { usedMb: u, totalMb: t, name: name.join(",") } : null);
      }
    );
  });
}
