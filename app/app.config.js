// Dynamic config on top of app.json. GitHub Pages serves the app under
// /<repository name>/, so the CI build sets EXPO_BASE_URL to that path
// (.github/workflows/pages.yml); locally the variable is unset and the app runs at /.
module.exports = ({ config }) => ({
  ...config,
  experiments: {
    ...(config.experiments ?? {}),
    baseUrl: process.env.EXPO_BASE_URL ?? "",
  },
});
