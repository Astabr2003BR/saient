const { withAndroidManifest } = require("@expo/config-plugins");

const TTS_SERVICE_ACTION = "android.intent.action.TTS_SERVICE";

module.exports = function withTextToSpeechQueries(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    const queries = manifest.queries ?? [{}];
    const root = queries[0] ?? {};
    const intents = root.intent ?? [];

    const alreadyPresent = intents.some((intent) =>
      (intent.action ?? []).some((action) => action?.$?.["android:name"] === TTS_SERVICE_ACTION),
    );

    if (!alreadyPresent) {
      intents.push({
        action: [{ $: { "android:name": TTS_SERVICE_ACTION } }],
      });
    }

    root.intent = intents;
    queries[0] = root;
    manifest.queries = queries;
    return config;
  });
};
