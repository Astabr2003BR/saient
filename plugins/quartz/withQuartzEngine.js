// Expo config plugin: bundle the Quartz on-device engine into the Android app and run it
// as a foreground service. Re-applies on every `expo prebuild`, so the native integration
// (which otherwise lives only in the gitignored android/ dir) is durable + tracked.
//
// What it injects:
//   1. engine binaries -> app/src/main/jniLibs/arm64-v8a/ (extracted to the
//      exec-allowed nativeLibraryDir at install). libquartz.so hosts chat/SDXL;
//      libquartz-wan.so is the pinned Vulkan Wan CLI fallback;
//      libquartz-wan-fast.so is the pinned persistent Wan server.
//   2. Kotlin sources (QuartzEngine.kt, QuartzService.kt) -> the app package
//   3. MainApplication.onCreate -> start the foreground service
//   4. AndroidManifest -> cleartext localhost, FGS permissions, the <service>
//   5. gradle.properties -> useLegacyPackaging (extract the lib) + arm64-only
//   6. app/build.gradle -> don't strip executable engine payloads

const {
  withDangerousMod,
  withAndroidManifest,
  withMainApplication,
  withGradleProperties,
  withAppBuildGradle,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PACKAGE_DIR = path.join('co', 'uk', 'staticplay', 'app');
const APP_ID_SUFFIX = '';
const KOTLIN_FILES = ['QuartzEngine.kt', 'QuartzService.kt', 'QuartzForegroundStarter.kt'];
const FGS_PERMISSIONS = [
  'android.permission.FOREGROUND_SERVICE',
  // specialUse (not dataSync): the FGS hosts the on-device AI inference engine — that's not a data
  // sync, and dataSync's Android-14+ time cap is what crashed the old build. specialUse has no cap
  // and is the honest Play type (declare the subtype in Play Console at submission).
  'android.permission.FOREGROUND_SERVICE_SPECIAL_USE',
  'android.permission.POST_NOTIFICATIONS',
];

// 1. Copy the engine binaries + Kotlin sources into the generated android project.
const withNativeFiles = (config) =>
  withDangerousMod(config, [
    'android',
    async (cfg) => {
      const { projectRoot, platformProjectRoot } = cfg.modRequest;
      const pluginDir = path.join(projectRoot, 'plugins', 'quartz');

      const binSrc = path.join(projectRoot, 'engine', 'arm64-v8a', 'libquartz.so');
      const wanBinSrc = path.join(projectRoot, 'engine', 'arm64-v8a', 'libquartz-wan.so');
      const wanFastBinSrc = path.join(projectRoot, 'engine', 'arm64-v8a', 'libquartz-wan-fast.so');
      const jniDir = path.join(platformProjectRoot, 'app', 'src', 'main', 'jniLibs', 'arm64-v8a');
      fs.mkdirSync(jniDir, { recursive: true });
      fs.copyFileSync(binSrc, path.join(jniDir, 'libquartz.so'));
      fs.copyFileSync(wanBinSrc, path.join(jniDir, 'libquartz-wan.so'));
      fs.copyFileSync(wanFastBinSrc, path.join(jniDir, 'libquartz-wan-fast.so'));

      const javaDir = path.join(platformProjectRoot, 'app', 'src', 'main', 'java', PACKAGE_DIR);
      fs.mkdirSync(javaDir, { recursive: true });
      for (const f of KOTLIN_FILES) {
        fs.copyFileSync(path.join(pluginDir, f), path.join(javaDir, f));
      }
      return cfg;
    },
  ]);

// 2. AndroidManifest: cleartext localhost + FGS permissions + the <service>.
const withManifest = (config) =>
  withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest['uses-permission'] = manifest['uses-permission'] || [];
    // Drop permissions older builds declared: SEND_SMS (Play-restricted) and the dataSync FGS type
    // (replaced by specialUse). Filtering here keeps an incremental prebuild from leaving them behind.
    const drop = new Set([
      'android.permission.SEND_SMS',
      'android.permission.FOREGROUND_SERVICE_DATA_SYNC',
    ]);
    manifest['uses-permission'] = manifest['uses-permission'].filter(
      (p) => !(p.$ && drop.has(p.$['android:name'])),
    );
    for (const name of FGS_PERMISSIONS) {
      if (!manifest['uses-permission'].some((p) => p.$ && p.$['android:name'] === name)) {
        manifest['uses-permission'].push({ $: { 'android:name': name } });
      }
    }
    const app = manifest.application[0];
    app.$['android:usesCleartextTraffic'] = 'true';
    app.service = app.service || [];
    let svc = app.service.find((s) => s.$ && s.$['android:name'] === '.QuartzService');
    if (!svc) {
      svc = { $: { 'android:name': '.QuartzService', 'android:exported': 'false' } };
      app.service.push(svc);
    }
    svc.$['android:foregroundServiceType'] = 'specialUse';
    // Play reads this subtype declaration when reviewing the specialUse foreground service.
    svc.property = [
      {
        $: {
          'android:name': 'android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE',
          'android:value': 'on-device AI model inference engine for offline chat',
        },
      },
    ];
    return cfg;
  });

// 3. MainApplication.onCreate: register a lifecycle-aware starter for the engine service.
// We must NOT call startForegroundService() here: when Android recreates the app process in the
// background, that call runs backgrounded and throws ForegroundServiceStartNotAllowedException,
// crashing the app. QuartzForegroundStarter starts the service only from a visible activity.
const INJECT = [
  '',
  '    // Quartz on-device engine (injected by withQuartzEngine plugin): start the FGS only while a',
  '    // UI activity is visible — never from Application.onCreate, which crashes on background',
  '    // process launches (ForegroundServiceStartNotAllowedException) on Android 12+.',
  '    registerActivityLifecycleCallbacks(QuartzForegroundStarter())',
].join('\n');
const withMainApp = (config) =>
  withMainApplication(config, (cfg) => {
    let src = cfg.modResults.contents;
    // Remove any earlier direct-start injection so upgrades don't leave the crashing code behind.
    src = src.replace(
      /\n\s*\/\/ Quartz on-device engine foreground service[\s\S]*?else startService\(quartzServiceIntent\)\n/,
      '\n',
    );
    if (!src.includes('QuartzForegroundStarter()')) {
      const anchor = 'ApplicationLifecycleDispatcher.onApplicationCreate(this)';
      src = src.replace(anchor, anchor + '\n' + INJECT);
    }
    cfg.modResults.contents = src;
    return cfg;
  });

// 4. gradle.properties: extract the exec'able lib, build arm64 only, and optimize releases.
const withGradleProps = (config) =>
  withGradleProperties(config, (cfg) => {
    const set = (key, value) => {
      const item = cfg.modResults.find((i) => i.type === 'property' && i.key === key);
      if (item) item.value = value;
      else cfg.modResults.push({ type: 'property', key, value });
    };
    set('expo.useLegacyPackaging', 'true');
    set('reactNativeArchitectures', 'arm64-v8a');
    set('android.enableMinifyInReleaseBuilds', 'true');
    set('android.enableShrinkResourcesInReleaseBuilds', 'true');
    return cfg;
  });

// 5. app/build.gradle: keep executable payloads unstripped.
const withAppGradle = (config) =>
  withAppBuildGradle(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (!src.includes('keepDebugSymbols += "**/libquartz.so"')) {
      src = src.replace(
        /useLegacyPackaging [^\n]*\n/,
        (m) => m + '            keepDebugSymbols += "**/libquartz.so"\n'
      );
    }
    if (!src.includes('keepDebugSymbols += "**/libquartz-wan.so"')) {
      src = src.replace(
        /keepDebugSymbols \+= "\*\*\/libquartz\.so"\n/,
        (m) => m + '            keepDebugSymbols += "**/libquartz-wan.so"\n'
      );
    }
    if (!src.includes('keepDebugSymbols += "**/libquartz-wan-fast.so"')) {
      src = src.replace(
        /keepDebugSymbols \+= "\*\*\/libquartz-wan\.so"\n/,
        (m) => m + '            keepDebugSymbols += "**/libquartz-wan-fast.so"\n'
      );
    }
    if (APP_ID_SUFFIX && !src.includes('applicationIdSuffix')) {
      src = src.replace(
        /(\n\s*release \{\n)/,
        `$1            applicationIdSuffix "${APP_ID_SUFFIX}"\n`
      );
    } else if (!APP_ID_SUFFIX) {
      src = src.replace(/^\s*applicationIdSuffix\s+"[^"]+"\s*\n/m, '');
    }
    cfg.modResults.contents = src;
    return cfg;
  });

module.exports = (config) =>
  withAppGradle(withGradleProps(withMainApp(withManifest(withNativeFiles(config)))));
