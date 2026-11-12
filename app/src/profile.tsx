import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { EMPTY_PROFILE, type Tone, type UserProfile } from "./api/types";
import { setClaudeApiKey } from "./api/client";
import { clearClaudeKey, loadClaudeKey, saveClaudeKey } from "./storage/claudeKey";
import { loadProfile, saveProfile } from "./storage/profile";
import { loadPhotoScan, savePhotoScan } from "./storage/scanMode";
import { loadSpend } from "./storage/spend";

interface ProfileContextValue {
  ready: boolean;
  hasProfile: boolean;
  profile: UserProfile;
  updateProfile: (patch: Partial<UserProfile>) => Promise<void>;
  replaceProfile: (profile: UserProfile) => Promise<void>;
  /** the stored Claude API key ("" = none); AI features need it */
  claudeKey: string;
  hasClaudeKey: boolean;
  setClaudeKey: (key: string) => Promise<void>;
  /** scan with single photos from the system camera instead of the live camera (web: no permission prompt) */
  photoScan: boolean;
  setPhotoScan: (photo: boolean) => Promise<void>;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [hasProfile, setHasProfile] = useState(false);
  const [profile, setProfile] = useState<UserProfile>(EMPTY_PROFILE);
  const [claudeKey, setKeyState] = useState("");
  const [photoScan, setPhotoScanState] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [stored, key, photo] = await Promise.all([loadProfile(), loadClaudeKey(), loadPhotoScan(), loadSpend()]);
      if (cancelled) return;
      setPhotoScanState(photo);
      setClaudeApiKey(key);
      setKeyState(key);
      if (stored) {
        setProfile(stored);
        setHasProfile(true);
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const replaceProfile = useCallback(async (next: UserProfile) => {
    setProfile(next);
    setHasProfile(true);
    await saveProfile(next);
  }, []);

  const updateProfile = useCallback(
    async (patch: Partial<UserProfile>) => {
      await replaceProfile({ ...profile, ...patch });
    },
    [profile, replaceProfile],
  );

  const setClaudeKey = useCallback(async (key: string) => {
    const k = key.trim();
    setClaudeApiKey(k);
    setKeyState(k);
    if (k) await saveClaudeKey(k);
    else await clearClaudeKey();
  }, []);

  const setPhotoScan = useCallback(async (photo: boolean) => {
    setPhotoScanState(photo);
    await savePhotoScan(photo);
  }, []);

  const value = useMemo(
    () => ({ ready, hasProfile, profile, updateProfile, replaceProfile, claudeKey, hasClaudeKey: !!claudeKey, setClaudeKey, photoScan, setPhotoScan }),
    [ready, hasProfile, profile, updateProfile, replaceProfile, claudeKey, setClaudeKey, photoScan, setPhotoScan],
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfile must be used inside ProfileProvider");
  return ctx;
}

/** Current verdict tone; "humor" when unset or outside the provider. */
export function useTone(): Tone {
  const ctx = useContext(ProfileContext);
  return ctx?.profile.tone === "serious" ? "serious" : "humor";
}
