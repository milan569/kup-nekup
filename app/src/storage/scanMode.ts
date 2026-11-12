import { readJson, writeJson } from "./kv";

const KEY = "scanMode";

/**
 * true = the scan screen takes single photos with the system camera instead
 * of running the live camera. Matters on the web only: an iPhone home-screen
 * app is asked for the camera at every launch, the system camera never asks.
 */
export async function loadPhotoScan(): Promise<boolean> {
  const stored = await readJson<{ photo?: boolean } | null>(KEY, null);
  return stored?.photo === true;
}

export async function savePhotoScan(photo: boolean): Promise<void> {
  await writeJson(KEY, { photo });
}
