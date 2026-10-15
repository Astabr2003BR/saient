import fs from "node:fs";

const nativePath = "modules/saient-diffusion/android/src/main/java/expo/modules/saientdiffusion/SaientDiffusionModule.kt";
let source = fs.readFileSync(nativePath, "utf8");

const currentBlock = `      "--backend", "te=cpu,vae=cpu,diffusion=vulkan0",
      "--params-backend", "disk",
      "--max-vram", "cpu=0.20,vulkan0=0.75",
      "--vae-tiling",`;

const optimizedBlock = `      "--backend", "te=cpu,vae=cpu,diffusion=vulkan0",
      "--params-backend", "diffusion=cpu,te=disk,vae=cpu",
      "--max-vram", "vulkan0=-0.75",
      "--mmap",
      "--vae-tiling",`;

if (source.includes(optimizedBlock)) {
  console.log("Wan performance profile already applied.");
  process.exit(0);
}

const matches = source.split(currentBlock).length - 1;
if (matches !== 1) {
  throw new Error(`Expected exactly one legacy Wan performance block, found ${matches}.`);
}

source = source.replace(currentBlock, optimizedBlock);
fs.writeFileSync(nativePath, source);
console.log("Applied Wan performance profile: diffusion weights in RAM, large TE on disk, mmap, dynamic Vulkan budget.");
