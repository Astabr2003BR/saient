import fs from "node:fs";

const nativePath = "modules/saient-diffusion/android/src/main/java/expo/modules/saientdiffusion/SaientDiffusionModule.kt";
const source = fs.readFileSync(nativePath, "utf8");

function requireText(text, message) {
  if (!source.includes(text)) throw new Error(message);
}

function forbidText(text, message) {
  if (source.includes(text)) throw new Error(message);
}

requireText(
  '"--backend", "te=cpu,vae=cpu,diffusion=vulkan0"',
  "Wan must keep diffusion on Vulkan while text encoding and VAE stay on CPU.",
);
requireText(
  '"--params-backend", "diffusion=cpu,te=disk,vae=cpu"',
  "Wan must keep the repeatedly-used diffusion weights in RAM while leaving the large text encoder on disk.",
);
requireText(
  '"--max-vram", "vulkan0=-0.75"',
  "Wan must auto-detect Vulkan memory and reserve 0.75 GiB instead of capping Vulkan at 0.75 GiB.",
);
requireText(
  '"--mmap"',
  "Wan must enable mmap so model files can benefit from the OS page cache.",
);

forbidText(
  '"--params-backend", "disk"',
  "Wan must not reload every model component from disk during generation.",
);
forbidText(
  '"--max-vram", "cpu=0.20,vulkan0=0.75"',
  "Wan must not restrict Vulkan to a 0.75 GiB maximum budget.",
);

console.log("Wan performance contract passed.");
