import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { EMPTY_PROFILE, type Tone, type UserProfile } from "./api/types";
import { setClaudeApiKey } from "./api/client";
import { clearClaudeKey, loadClaudeKey, saveClaudeKey } from "./storage/claudeKey";
import { loadProfile, saveProfile } from "./storage/profile";
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
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [hasProfile, setHasProfile] = useState(false);
  const [profile, setProfile] = useState<UserProfile>(EMPTY_PROFILE);
  const [claudeKey, setKeyState] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [stored, key] = await Promise.all([loadProfile(), loadClaudeKey(), loadSpend()]);
      if (cancelled) return;
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

  const value = useMemo(
    () => ({ ready, hasProfile, profile, updateProfile, replaceProfile, claudeKey, hasClaudeKey: !!claudeKey, setClaudeKey }),
    [ready, hasProfile, profile, updateProfile, replaceProfile, claudeKey, setClaudeKey],
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
