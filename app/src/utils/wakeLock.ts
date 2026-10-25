/**
 * Keeps the screen on while a long AI request runs. iOS suspends a web app
 * the moment the screen locks, which kills the request (and Anthropic still
 * bills it). Safari 16.4+ honours the Screen Wake Lock API; elsewhere this
 * is a no-op.
 */
interface Sentinel {
  release(): Promise<void>;
  addEventListener?(type: "release", fn: () => void): void;
}

let sentinel: Sentinel | null = null;
let holders = 0;

async function acquire(): Promise<void> {
  if (sentinel) return;
  const nav = typeof navigator !== "undefined" ? (navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<Sentinel> } }) : undefined;
  if (!nav?.wakeLock) return;
  try {
    const s = await nav.wakeLock.request("screen");
    s.addEventListener?.("release", () => {
      if (sentinel === s) sentinel = null;
    });
    sentinel = s;
  } catch {
    sentinel = null; // denied (low battery, background tab): nothing to do
  }
}

function release(): void {
  const s = sentinel;
  sentinel = null;
  s?.release().catch(() => undefined);
}

export async function withWakeLock<T>(fn: () => Promise<T>): Promise<T> {
  holders++;
  if (holders === 1) await acquire();
  try {
    return await fn();
  } finally {
    holders = Math.max(0, holders - 1);
    if (holders === 0) release();
  }
}
