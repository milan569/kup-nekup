import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { EMPTY_PROFILE, type Tone, type UserProfile } from "./api/types";
import { setAppToken, setBaseUrl } from "./api/client";
import { loadProfile, saveProfile } from "./storage/profile";
import { loadSettings } from "./storage/settings";

interface ProfileContextValue {
  ready: boolean;
  hasProfile: boolean;
  profile: UserProfile;
  updateProfile: (patch: Partial<UserProfile>) => Promise<void>;
  replaceProfile: (profile: UserProfile) => Promise<void>;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [hasProfile, setHasProfile] = useState(false);
  const [profile, setProfile] = useState<UserProfile>(EMPTY_PROFILE);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [stored, settings] = await Promise.all([loadProfile(), loadSettings()]);
      if (cancelled) return;
      setBaseUrl(settings.apiUrl);
      setAppToken(settings.appToken);
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

  const value = useMemo(
    () => ({ ready, hasProfile, profile, updateProfile, replaceProfile }),
    [ready, hasProfile, profile, updateProfile, replaceProfile],
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
