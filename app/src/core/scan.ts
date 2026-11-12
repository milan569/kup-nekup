/**
 * Barcode reads are voted on before a lookup starts.
 *
 * A single decoded frame is not proof: a blurred or tilted code can decode
 * to a wrong value whose check digit still passes (two of thirteen digits off
 * by one bar width is enough). The same wrong value rarely comes back on the
 * next frame, the right one does, so a code counts only once it has been
 * read `needed` times in a row within `windowMs`. On the web the scanner
 * decodes a frame every 300 ms, so two reads cost at most a moment.
 */
export const SCAN_CONFIRMATIONS = 2;
export const SCAN_VOTE_WINDOW_MS = 1500;

export class ScanVoter {
  private data = "";
  private count = 0;
  private lastAt = 0;

  constructor(
    private readonly needed = SCAN_CONFIRMATIONS,
    private readonly windowMs = SCAN_VOTE_WINDOW_MS,
  ) {}

  /** Feeds one decoded value; true when it has just been confirmed (the voter then starts over). */
  read(data: string, now = Date.now()): boolean {
    if (data === this.data && now - this.lastAt <= this.windowMs) this.count += 1;
    else {
      this.data = data;
      this.count = 1;
    }
    this.lastAt = now;
    if (this.count < this.needed) return false;
    this.reset();
    return true;
  }

  reset(): void {
    this.data = "";
    this.count = 0;
    this.lastAt = 0;
  }
}
