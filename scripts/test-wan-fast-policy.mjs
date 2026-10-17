import assert from "node:assert/strict";

const policyUrl = new URL("../lib/wan-fast/policy.ts", import.meta.url);
const {
  resolveWanProfile,
  wanProgressFraction,
  shouldWanFallback,
} = await import(policyUrl.href);

assert.deepEqual(resolveWanProfile("fast"), { steps: 8, frames: 5 });
assert.deepEqual(resolveWanProfile("balanced"), { steps: 8, frames: 17 });
assert.deepEqual(resolveWanProfile("quality"), { steps: 12, frames: 17 });

assert.equal(wanProgressFraction(223, 242), 223 / 242,
  "native progress totals must be independent from requested diffusion steps");
assert.equal(wanProgressFraction(300, 242), 1,
  "native progress must clamp above 100%");
assert.equal(wanProgressFraction(-1, 242), 0,
  "negative completed progress must clamp to zero");
assert.equal(wanProgressFraction(10, 0), 0,
  "zero totals must not produce NaN/Infinity");
assert.equal(wanProgressFraction(Number.NaN, 242), 0,
  "non-finite progress must be rejected safely");

for (const reason of ["startup", "runtime", "memory", "generation"]) {
  assert.equal(shouldWanFallback(reason), true, `${reason} must be eligible for CLI fallback`);
}
assert.equal(shouldWanFallback("cancelled"), false,
  "explicit user cancellation must never trigger automatic fallback");

console.log("Wan Fast policy contract passed.");
