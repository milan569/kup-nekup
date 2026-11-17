import { readJson, writeJson } from "./kv";

const KEY = "scanMode";

interface Stored {
  /** scan with single photos from the system camera instead of the live camera */
  photo?: boolean;
  /** the user answered the offer of that mode on the scan screen: do not show it again */
  offerDismissed?: boolean;
}

async function load(): Promise<Stored> {
  return (await readJson<Stored | null>(KEY, null)) ?? {};
}

/**
 * true = the scan screen takes single photos with the system camera instead
 * of running the live camera. Matters on the web only: an iPhone home-screen
 * app is asked for the camera at every launch, the system camera never asks.
 */
export async function loadPhotoScan(): Promise<boolean> {
  return (await load()).photo === true;
}

export async function savePhotoScan(photo: boolean): Promise<void> {
  await writeJson(KEY, { ...(await load()), photo });
}

/** true while the scan screen may still offer the prompt-free mode. */
export async function loadPhotoScanOffer(): Promise<boolean> {
  const stored = await load();
  return stored.photo !== true && stored.offerDismissed !== true;
}

export async function dismissPhotoScanOffer(): Promise<void> {
  await writeJson(KEY, { ...(await load()), offerDismissed: true });
}
