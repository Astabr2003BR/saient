import assert from "node:assert/strict";
import fs from "node:fs";

const buildPath = "scripts/build-wan-android.sh";
const pluginPath = "plugins/quartz/withQuartzEngine.js";
const lockPath = "engine/wan/BACKEND_LOCK.json";
const serverPatchPath = "engine/wan/saient-server-progress.patch";

const build = fs.readFileSync(buildPath, "utf8");
const plugin = fs.readFileSync(pluginPath, "utf8");
const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));

assert.match(build, /EXPECTED_COMMIT="e31a86ce9110b11a98bd5990c329093244c2d1e3"/,
  "Fast Engine must use the exact pinned stable-diffusion.cpp commit");
assert.match(build, /libquartz-wan\.so/,
  "existing CLI Wan fallback binary must remain in the build");
assert.match(build, /libquartz-wan-fast\.so/,
  "build must produce a separate persistent Wan server binary");
assert.match(build, /saient-server-progress\.patch/,
  "server progress patch must be applied separately from the existing common/CLI patch");
assert.match(build, /SD_SERVER_BUILD_FRONTEND=OFF/,
  "Android sd-server must not bundle/build the web frontend");
assert.match(build, /SD_VULKAN=ON/,
  "persistent server must retain Vulkan support");
assert.match(build, /SD_WEBM=ON/,
  "persistent server must retain WebM video output");
assert.match(build, /--target\s+sd-cli/,
  "current CLI target must still be built");
assert.match(build, /--target\s+sd-server/,
  "persistent sd-server target must be built");

assert.equal(fs.existsSync(serverPatchPath), true,
  "server-specific progress patch must exist");
const serverPatch = fs.readFileSync(serverPatchPath, "utf8");
assert.match(serverPatch, /examples\/server\/main\.cpp/,
  "server patch must target server main.cpp");
assert.match(serverPatch, /SAIENT_WAN_PROGRESS completed=%d total=%d\\n/,
  "server must emit newline-delimited Android progress");
assert.match(serverPatch, /sd_set_progress_callback\(saient_progress_callback, nullptr\)/,
  "server must register the progress callback");
assert.doesNotMatch(serverPatch, /ggml_extend\.hpp/,
  "server-only patch must not duplicate the existing shared memory/K-quant patch");

assert.match(plugin, /libquartz-wan-fast\.so/,
  "Expo plugin must copy the Fast Engine binary into jniLibs");
assert.match(plugin, /keepDebugSymbols \+= "\*\*\/libquartz-wan-fast\.so"/,
  "Gradle packaging must preserve the executable Fast Engine payload");
assert.match(plugin, /libquartz-wan\.so/,
  "Expo plugin must continue packaging the CLI fallback");

assert.equal(lock.artifact?.path, "../arm64-v8a/libquartz-wan.so",
  "existing CLI artifact lock must remain intact");
assert.equal(lock.fastArtifact?.path, "../arm64-v8a/libquartz-wan-fast.so",
  "backend lock must identify the separate Fast Engine artifact");
assert.equal(lock.fastArtifact?.target, "sd-server",
  "Fast Engine artifact must be traceable to sd-server");

console.log("Wan Fast build/package contract passed.");
