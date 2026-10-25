// Dynamic config on top of app.json. GitHub Pages serves the app under
// /kup-nekup/, so the CI build sets EXPO_BASE_URL=/kup-nekup; locally the
// variable is unset and the app runs at /.
module.exports = ({ config }) => ({
  ...config,
  experiments: {
    ...(config.experiments ?? {}),
    baseUrl: process.env.EXPO_BASE_URL ?? "",
  },
});
