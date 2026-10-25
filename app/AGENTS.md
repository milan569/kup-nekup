This is an Expo/React Native app whose primary target is the **web build** (a home-screen web app on iPhone, served from GitHub Pages at https://milan569.github.io/kup-nekup/). Native Expo Go still works for development, but every change must work on web first.

## Project layout and rules of this app

- `src/core/` is the engine (Open Food Facts client, scoring rules, Claude calls, translations, cache). It is plain TypeScript: **no imports from `react-native`, `expo-*`, `node:*`, and no `process.env`**. Constants live in `src/core/config.ts`. Tests sit next to the code (`*.test.ts`) and run with `npm test` (vitest, Node environment).
- There is no server. The Claude key is held in memory by `src/core/anthropic.ts` (SDK with `dangerouslyAllowBrowser`), stored on the device by `src/storage/claudeKey.ts`, entered on `src/screens/ClaudeKeyScreen.tsx`. Never put a key in `EXPO_PUBLIC_*`, in the repo, in a URL or in a log.
- `src/api/client.ts` keeps the former HTTP API surface (`api.lookupEan`, `api.insight`, …) and calls `src/core/lookup.ts` directly; every failure becomes an `ApiError` from `src/core/errors.ts`. Screens branch on `kind === "auth"` (no/invalid key) and `code === "in_store_code"`.
- Storage: `src/storage/kv.ts` (AsyncStorage) has a web twin `kv.web.ts` (IndexedDB via idb-keyval); the product/insight cache uses `cacheStore.ts` / `cacheStore.web.ts`. Metro picks the `.web.ts` file on web.
- Every Claude call reports usage to `src/core/usage.ts`; the app sums it in `src/storage/spend.ts` and enforces a daily cap. Call `assertSpendAllowed()` before any new paid request.
- Strict AI tool schemas are at the API's grammar-size limit: adding a field can break every request at runtime. Run `npm run check:tools` (needs `ANTHROPIC_API_KEY` in the shell, costs about a cent) before shipping a schema change; `src/core/schemas.test.ts` guards the ≤16-union rule.
- Web specifics: `public/index.html` is the HTML template, `public/manifest.json` the PWA manifest; `app.config.js` sets `experiments.baseUrl` from `EXPO_BASE_URL` (CI sets `/kup-nekup`). `Alert.alert` is a no-op on web, use `src/utils/confirm.ts`. Long AI calls go through `src/utils/wakeLock.ts`.
- Before declaring work done: `npx tsc --noEmit` and `npm test` must pass, and the change must be tried in the browser (`npx expo start --web`).

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
