import { Platform } from "react-native";

/**
 * Web camera helpers for the scan screen (no-ops on native).
 *
 * Safari starts a getUserMedia stream at 640×480. A barcode at the distance
 * where the iPhone's main camera can still focus (15–20 cm) is then about
 * 120 px wide, little more than one pixel per bar: reads fail or come back
 * with wrong digits. Once the camera runs we ask the track for more:
 * 1920×1440 (the 4:3 format matches the portrait preview), continuous
 * autofocus, and, where the browser exposes it, a 2× zoom so the code fills
 * the frame from a distance the lens can handle. A browser that does not
 * know a constraint keeps what it had; nothing here throws.
 *
 * An iPhone home-screen web app has no macro mode: the browser cannot switch
 * to the ultra-wide lens the way the Camera app does, so the zoom plus the
 * distance hint on the screen is the replacement.
 */

export type ZoomRange = { min: number; max: number };
/** zoom applied when the camera supports it (clamped to its range) */
export const DEFAULT_ZOOM = 2;
const IDEAL_SIZE = { width: { ideal: 1920 }, height: { ideal: 1440 } };

type Capabilities = { zoom?: { min?: number; max?: number }; focusMode?: string[] };

function constraints(set: Record<string, unknown>): MediaTrackConstraints {
  return set as unknown as MediaTrackConstraints;
}

/** The preview element of the mounted CameraView (the only video on the page). */
export function cameraVideoElement(): HTMLVideoElement | null {
  if (Platform.OS !== "web" || typeof document === "undefined") return null;
  return document.querySelector("video");
}

function videoTrack(video: HTMLVideoElement | null): MediaStreamTrack | null {
  const stream = video?.srcObject;
  if (!stream || typeof MediaStream === "undefined" || !(stream instanceof MediaStream)) return null;
  return stream.getVideoTracks()[0] ?? null;
}

async function apply(track: MediaStreamTrack, set: MediaTrackConstraints): Promise<boolean> {
  try {
    await track.applyConstraints(set);
    return true;
  } catch {
    return false;
  }
}

function zoomRangeOf(track: MediaStreamTrack): ZoomRange | null {
  const caps = (track.getCapabilities?.() ?? {}) as Capabilities;
  const min = caps.zoom?.min;
  const max = caps.zoom?.max;
  if (typeof min !== "number" || typeof max !== "number" || !(max > min)) return null;
  return { min, max };
}

/** Applies the zoom clamped to the range; resolves with the value asked for. */
export async function setCameraZoom(video: HTMLVideoElement | null, zoom: number, range: ZoomRange): Promise<number> {
  const wanted = Math.min(range.max, Math.max(range.min, zoom));
  const track = videoTrack(video);
  if (!track) return wanted;
  await apply(track, constraints({ advanced: [{ zoom: wanted }] }));
  const settings = track.getSettings() as MediaTrackSettings & { zoom?: number };
  if (settings.zoom !== wanted) await apply(track, constraints({ zoom: wanted }));
  return wanted;
}

/** Resolution, autofocus and zoom for the running camera; returns the zoom range when there is one. */
export async function tuneCameraTrack(video: HTMLVideoElement | null, zoom: number): Promise<{ range: ZoomRange | null; zoom: number }> {
  const track = videoTrack(video);
  if (!track) return { range: null, zoom: 1 };
  await apply(track, constraints(IDEAL_SIZE));
  const caps = (track.getCapabilities?.() ?? {}) as Capabilities;
  if (caps.focusMode?.includes("continuous")) await apply(track, constraints({ advanced: [{ focusMode: "continuous" }] }));
  const range = zoomRangeOf(track);
  if (!range) return { range: null, zoom: 1 };
  return { range, zoom: await setCameraZoom(video, zoom, range) };
}

/** Calls back when the browser ends the camera track by itself (a capture failure); not when the view stops it. */
export function onCameraTrackEnded(video: HTMLVideoElement | null, onEnded: () => void): () => void {
  const track = videoTrack(video);
  if (!track) return () => undefined;
  track.addEventListener("ended", onEnded);
  return () => track.removeEventListener("ended", onEnded);
}

/**
 * After the web app comes back to the foreground: true when the stream still
 * runs (iOS mutes the track while the phone is locked and unmutes it shortly
 * after), false when the camera has to be mounted again.
 */
export async function cameraStreamAlive(video: HTMLVideoElement | null): Promise<boolean> {
  const track = videoTrack(video);
  if (!video || !track || track.readyState === "ended") return false;
  if (video.paused) {
    try {
      await video.play();
    } catch {
      return false;
    }
  }
  if (!track.muted) return true;
  return new Promise((resolve) => {
    const done = (alive: boolean) => {
      clearTimeout(timer);
      track.removeEventListener("unmute", onUnmute);
      resolve(alive);
    };
    const onUnmute = () => done(true);
    const timer = setTimeout(() => done(false), 2500);
    track.addEventListener("unmute", onUnmute);
  });
}

/** The CameraView mount error in one shape: native sends `{message}`, the web `{nativeEvent: DOMException}`. */
export function cameraMountError(event: unknown): { message: string; denied: boolean } {
  const raw = (event as { nativeEvent?: unknown } | null)?.nativeEvent ?? event;
  const err = raw as { name?: unknown; message?: unknown } | null;
  const name = typeof err?.name === "string" ? err.name : "";
  const message = typeof err?.message === "string" ? err.message : "";
  const denied = name === "NotAllowedError" || name === "PermissionDeniedError" || /permission|denied|not allowed/i.test(message);
  return { message, denied };
}
