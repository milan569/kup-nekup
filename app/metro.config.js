// Metro configuration (Expo default + one resolver tweak).
//
// `@anthropic-ai/sdk` ships ESM (.mjs) and CommonJS (.js) twins of every
// file. Metro picks the ESM build, and in the development bundle React
// Refresh enumerates the exports of `resources/beta/messages/index.mjs`
// while `messages.mjs` is still being evaluated (an import cycle through
// `lib/tools/BetaToolRunner.mjs` → `resources/beta.mjs`), which throws
// "Cannot access 'BETA_BROWSER_MEMBER_NAME_VALUES' before initialization"
// and leaves the dev server with a black screen. The CommonJS build assigns
// its exports lazily, so the cycle is harmless there. The production export
// has no React Refresh and is left untouched (`context.dev` is false).
const fs = require("fs");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = defaultResolveRequest ?? context.resolveRequest;
  const resolution = resolve(context, moduleName, platform);
  if (context.dev && resolution.type === "sourceFile" && resolution.filePath.endsWith(".mjs")) {
    // Windows paths use backslashes
    const normalized = resolution.filePath.split("\\").join("/");
    if (normalized.includes("/@anthropic-ai/sdk/")) {
      const cjs = resolution.filePath.slice(0, -4) + ".js";
      if (fs.existsSync(cjs)) return { type: "sourceFile", filePath: cjs };
    }
  }
  return resolution;
};

module.exports = config;
