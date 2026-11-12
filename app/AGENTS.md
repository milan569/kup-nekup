This is an Expo/React Native app whose primary target is the **web build** (a home-screen web app on iPhone, served from GitHub Pages at https://milan569.github.io/kup-nekup/). Native Expo Go still works for development, but every change must work on web first.

## Project layout and rules of this app

- `src/core/` is the engine (Open Food Facts client, scoring rules, Claude calls, translations, cache). It is plain TypeScript: **no imports from `react-native`, `expo-*`, `node:*`, and no `process.env`**. Constants live in `src/core/config.ts`. Tests sit next to the code (`*.test.ts`) and run with `npm test` (vitest, Node environment).
- There is no server. The Claude key is held in memory by `src/core/anthropic.ts` (SDK with `dangerouslyAllowBrowser`), stored on the device by `src/storage/claudeKey.ts`, entered on `src/screens/ClaudeKeyScreen.tsx`. Never put a key in `EXPO_PUBLIC_*`, in the repo, in a URL or in a log.
- `src/api/client.ts` keeps the former HTTP API surface (`api.lookupEan`, `api.insight`, …) and calls `src/core/lookup.ts` directly; every failure becomes an `ApiError` from `src/core/errors.ts`. Screens branch on `kind === "auth"` (no/invalid key) and `code === "in_store_code"`.
- Storage: `src/storage/kv.ts` (AsyncStorage) has a web twin `kv.web.ts` (IndexedDB via idb-keyval); the product/insight cache uses `cacheStore.ts` / `cacheStore.web.ts`. Metro picks the `.web.ts` file on web.
- Every Claude call reports usage to `src/core/usage.ts`; the app sums it in `src/storage/spend.ts` and enforces a daily cap. Call `assertSpendAllowed()` before any new paid request.
- Strict AI tool schemas are at the API's grammar-size limit: adding a field can break every request at runtime. Run `npm run check:tools` (reads `ANTHROPIC_API_KEY` from the git-ignored `scripts/.env` or the shell, costs about a cent) before shipping a schema change; `src/core/schemas.test.ts` guards the ≤16-union rule. `npm run smoke` runs the engine end to end against the real API (about 0.1 USD).
- Web specifics: `public/index.html` is the HTML template, `public/manifest.json` the PWA manifest; `app.config.js` sets `experiments.baseUrl` from `EXPO_BASE_URL` (CI sets `/kup-nekup`). `Alert.alert` is a no-op on web, use `src/utils/confirm.ts`. Long AI calls go through `src/utils/wakeLock.ts`.
- Errors from API calls are shown with `src/components/ApiErrorBox.tsx`: an `ApiError` of kind `auth` (no key, rejected key) gets the "Zadat klíč" button, everything else retry/close. Keep the error *kind* next to the message (`errorKindOf` in `src/api/client.ts`), never just the string.
- Scan screen on the web: the camera asks for permission itself (no `requestPermission()` round trip; an iPhone home-screen app asks at every launch anyway, so every extra tap counts). `src/utils/camera.ts` raises the stream from Safari's 640×480 default to 1920×1440, continuous focus and 2× zoom after `onCameraReady`, and after `visibilitychange` checks whether the stream is still alive before the view is mounted again. A barcode counts only after two agreeing reads (`ScanVoter` in `src/core/scan.ts`): one blurred frame can decode to wrong digits with a valid check digit.
- Scan without the live camera (web, `photoScan` in the profile context, stored by `src/storage/scanMode.ts`, toggled in Profil or after a refused prompt): the scan screen mounts no `CameraView`, so nothing calls `getUserMedia`; photos come from the system camera (`takeLabelPhoto()`, a file input with `capture`, never prompts). Every still photo taken there or picked from the gallery goes through `lookupFromPhoto`: `barcodesInPhoto()` (`src/utils/barcodePhoto.ts`, the live scanner's decoder on a ≤3000 px copy) → `pickScannedCode()` → `useLookup().lookupCodeFromPhoto()`, which asks the database by the code and reads the label with AI only for an unknown code or a shop's scale label; `lookupPhoto` accepts the decoded code as `ean` and trusts it over the model's digits. Keep anything that could start the live camera out of the photo-mode path.
- AI cache keys in `src/core/lookup.ts` contain the tone (Slušný režim) and the market (countries + stores) because the prompts do; a manual-entry key contains everything `assessManual` reads. Stored AI texts carry `tone`; screens show them only in the current tone (`HistoryScreen`, `ResultScreen`, `findSimilar`).
- `App.tsx` wraps the app in `src/components/ErrorBoundary.tsx`; lookups into static tables with stored values (`VERDICTS[v]`, `riskColors[r]`…) still need a fallback, a stale history entry must never blank the screen.
- `metro.config.js` maps `@anthropic-ai/sdk` to its CommonJS files in the development bundle only: the ESM build has an import cycle that React Refresh turns into "Cannot access 'BETA_BROWSER_MEMBER_NAME_VALUES' before initialization" (black screen on `expo start --web`). The production export is untouched.
- Before declaring work done: `npx tsc --noEmit` and `npm test` must pass, and the change must be tried in the browser (`npx expo start --web`, or the GitHub Pages export served from `dist-web/`). In the Claude desktop app the Browser pane must be shown while testing: a hidden pane never runs `requestAnimationFrame`, so React Navigation's header back button looks dead and screenshots time out.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start --web        # start the dev server for the web target
npx expo start              # start the dev server (native, Expo Go)
npm test                    # vitest: the engine's unit tests
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
MSYS_NO_PATHCONV=1 EXPO_BASE_URL=/kup-nekup npx expo export -p web   # the GitHub Pages build (Git Bash on Windows needs MSYS_NO_PATHCONV)
```

## Navigation & Routing

- **This project uses React Navigation (native stack + bottom tabs), not Expo Router.** Navigators are defined in `src/navigation.tsx`, route params in `src/navigationTypes.ts`, screens in `src/screens/`. Do not add `expo-router` or an `src/app/` directory.
- Docs: https://reactnavigation.org/docs/getting-started

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md
