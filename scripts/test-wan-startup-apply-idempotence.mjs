import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "saient-wan-startup-"));
const paths = [
  "scripts/apply-wan-startup-diagnostics.mjs",
  "modules/saient-diffusion/android/src/main/java/expo/modules/saientdiffusion/SaientDiffusionModule.kt",
  "modules/saient-diffusion/src/SaientDiffusionModule.ts",
  "app/(tabs)/video.tsx",
];

try {
  for (const relative of paths) {
    const destination = path.join(temp, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(root, relative), destination);
  }

  const tracked = paths.slice(1);
  const before = new Map(tracked.map((relative) => [relative, fs.readFileSync(path.join(temp, relative), "utf8")]));

  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = spawnSync(process.execPath, ["scripts/apply-wan-startup-diagnostics.mjs"], {
      cwd: temp,
      encoding: "utf8",
    });
    assert.equal(result.status, 0,
      `startup diagnostics apply must be idempotent on attempt ${attempt}: ${result.stderr || result.stdout}`);

    for (const relative of tracked) {
      assert.equal(
        fs.readFileSync(path.join(temp, relative), "utf8"),
        before.get(relative),
        `${relative} must remain unchanged when startup diagnostics are already applied`,
      );
    }
  }

  console.log("Wan startup diagnostics apply idempotence contract passed.");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
