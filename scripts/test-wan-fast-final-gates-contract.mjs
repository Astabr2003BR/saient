import assert from "node:assert/strict";
import fs from "node:fs";

const finalGatesPath = ".github/workflows/video-studio-final-gates.yml";
assert.equal(fs.existsSync(finalGatesPath), true, `missing ${finalGatesPath}`);
const workflow = fs.readFileSync(finalGatesPath, "utf8");

for (const command of [
  "npm run test:wan-fast-policy",
  "npm run test:wan-fast-build",
  "npm run test:wan-fast-native",
  "npm run test:wan-fast-generation",
  "npm run test:wan-fast-fallback",
  "npm run test:wan-fast-ui",
  "npm run test:wan",
  "npm run test:wan-performance",
  "npm run test:wan-startup-diagnostics",
  "npm run typecheck",
]) {
  assert.ok(workflow.includes(command), `final gates must run: ${command}`);
}

assert.ok(
  workflow.includes("npm audit --omit=dev --audit-level=critical"),
  "final gates must reject critical production dependency vulnerabilities",
);
assert.ok(
  workflow.includes("npx expo prebuild --platform android --no-install --non-interactive"),
  "final gates must generate the Android project before native verification",
);
assert.ok(
  workflow.includes("./gradlew :app:compileReleaseKotlin --stacktrace --no-daemon"),
  "final gates must compile release Kotlin",
);

for (const binary of ["libquartz.so", "libquartz-wan.so", "libquartz-wan-fast.so"]) {
  assert.ok(
    workflow.includes(`android/app/src/main/jniLibs/arm64-v8a/${binary}`),
    `final gates must verify generated Android payload ${binary}`,
  );
  assert.ok(
    workflow.includes(`engine/arm64-v8a/${binary}`),
    `final gates must compare generated payload with source engine artifact ${binary}`,
  );
}

assert.match(
  workflow,
  /cmp\s+engine\/arm64-v8a\/\$?[^\n]*android\/app\/src\/main\/jniLibs\/arm64-v8a|cmp\s+"?engine\/arm64-v8a\/\$f"?[\s\S]{0,200}"?android\/app\/src\/main\/jniLibs\/arm64-v8a\/\$f"?/,
  "final gates must byte-compare packaged engine payloads with source artifacts",
);

for (const watchedPath of [
  "app/(tabs)/video.tsx",
  "lib/wan-fast/**",
  "modules/saient-diffusion/**",
  "engine/arm64-v8a/**",
  "plugins/quartz/**",
]) {
  assert.ok(workflow.includes(`'${watchedPath}'`), `final gates must trigger on ${watchedPath}`);
}

console.log("Wan Fast final gates contract passed.");
