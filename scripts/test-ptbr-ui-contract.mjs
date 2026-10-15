import assert from "node:assert/strict";
import fs from "node:fs";

const checks = {
  "app/(tabs)/_layout.tsx": [
    'title: "Chat"',
  ],
  "app/(tabs)/index.tsx": [
    '"Saved chats unavailable"',
    '"Chat saved"',
    '"Could not save chat"',
    '"Delete saved chat?"',
    '"Clear this chat?"',
    '"Could not delete chat"',
    '"Start a new chat?"',
    '"New chat"',
    'accessibilityLabel="Open saved chats"',
    'accessibilityLabel="Save chat"',
    'accessibilityLabel="Delete current chat"',
    '>Build<',
    '>Agent<',
    '>Your AI, on your phone.<',
    '>Load an on-device model to get started.<',
    '"Describe a page or UI to build…"',
    '"Ask me to text or call someone…"',
    '"Message Saient…"',
  ],
  "app/(tabs)/models.tsx": [
    '>Models<',
    'Download a model to run entirely on this phone.',
    'Native image generation through Quartz',
    'Engine off to save battery',
    'Checking Quartz engine',
    'Quartz engine ready',
    'No model loaded yet',
    '>Load<',
    '>Unload<',
    '>Curated models<',
    '>Get<',
    '>Use<',
    '>Active<',
    '>Delete<',
    '>Image models<',
    'Native 1024×1024 SDXL generation.',
    'Deactivate to block image inference',
    'Inactive — installed files remain',
    '>Imported models<',
    'Imported from Downloads',
    'No models downloaded yet',
    '>More options<',
    'Already downloaded a model?',
    'Search Downloads',
    '>Device model test<',
    'Recommended:',
    'Test this device',
    'Curated models are open-licensed',
    '"Image model ready"',
    '"Could not download image model"',
    '"Could not change image model"',
    '"Could not use model"',
    '"Could not delete model"',
    '"No usable GGUF models found"',
    '"Could not search Downloads"',
    '"Model imported"',
    '"Could not import model"',
    '"Device test unavailable"',
    '"Could not test this device"',
    '"Could not unload the model"',
    '"Could not load the model"',
  ],
  "app/(tabs)/create.tsx": [
    'label: "Quick"',
    'label: "Balanced"',
    'label: "Detailed"',
    'label: "Quality"',
    '"Preparing Quartz"',
    '"Encoding prompt"',
    '"Decoding PNG"',
    '"Starting denoising"',
    '"Image model ready"',
    '"Could not download image model"',
    '"Image model needed"',
    '"Image model inactive"',
    '"Prompt needed"',
    '"Image generation failed"',
    '"Remove image model?"',
    '>Create<',
    'SDXL, entirely on this phone through Quartz',
    '"Checking"',
    '"Ready"',
    '"Model needed"',
    '>Add the Saient image model<',
    'Download the SDXL FP16 pack',
    'offline after setup',
    'Downloading ${',
    '"Download model · 6.94 GB"',
    '"Connecting to Saient"',
    '"Cancel download"',
    '"Active"',
    '"Inactive"',
    'Image inference is disabled.',
    '>Prompt<',
    '>Avoid (optional)<',
    '>Quality<',
    ' steps<',
    'Phone speed and temperature vary',
    '>Seed<',
    '>Random<',
    'Chat is unloaded while Quartz creates the image',
    'Saved on phone',
    '"Cancel generation"',
    '"Generate on phone"',
    '"Activate in Models"',
    'No ONNX Runtime and no cloud inference.',
  ],
  "app/(tabs)/settings.tsx": [
    '>Local AI, in your pocket.<',
    '>Engine<',
    'label="Inference engine"',
    'label="Runs on"',
    'value="This device"',
    '>About<',
    'label="Version"',
    'label="Website"',
    'label="Get Saient for desktop"',
    'label="Privacy"',
    'label="Open-source notices"',
    'Everything runs on your phone.',
  ],
  "components/ChatHistoryModal.tsx": [
    '>Saved chats<',
    'saved on this phone',
    'accessibilityLabel="Close saved chats"',
    'accessibilityLabel="Start a new chat"',
    '>New chat<',
    '>No saved chats yet.<',
    ' messages<',
    'Open saved chat',
    'Delete saved chat',
  ],
  "components/Artifact.tsx": [
    'lang || "code"',
    '? "line" : "lines"',
    'accessibilityLabel="Preview"',
    '>Preview<',
    '"Copied" : "Copy"',
  ],
  "components/HtmlPreview.tsx": [
    '>Preview<',
    'accessibilityLabel="Close preview"',
  ],
  "app/notices.tsx": [
    '>Open-source notices<',
    'Downloaded models remain third-party open weights',
    '>View model license →<',
    '>View SDXL license →<',
    '>View VAE model and license →<',
    '>View Wan model and license →<',
    '>View backend license →<',
    '>Read the full Apache 2.0 license →<',
    'Everything runs on your device.',
  ],
};

for (const [file, forbidden] of Object.entries(checks)) {
  assert.equal(fs.existsSync(file), true, `missing ${file}`);
  const source = fs.readFileSync(file, "utf8");
  for (const text of forbidden) {
    assert.equal(source.includes(text), false, `${file} still contains English UI text: ${text}`);
  }
}

const layout = fs.readFileSync("app/(tabs)/_layout.tsx", "utf8");
for (const label of ["Conversa", "Modelos", "Criar", "Vídeo", "Configurações"]) {
  assert.equal(layout.includes(`title: "${label}"`), true, `missing PT-BR tab label: ${label}`);
}

const video = fs.readFileSync("app/(tabs)/video.tsx", "utf8");
for (const label of ["Adicionar pacote de vídeo Wan", "Baixar pacote Wan", "Cancelar download", "Gerar no celular", "Dublagem PT-BR", "Legendas", "Dublar e exportar", "Vídeo final"]) {
  assert.equal(video.includes(label), true, `missing PT-BR video label: ${label}`);
}

const wizard = fs.readFileSync("components/SetupWizard.tsx", "utf8");
for (const label of ["Sua IA, no seu celular", "Baixe um modelo", "Pular", "Próximo", "Começar"]) {
  assert.equal(wizard.includes(label), true, `missing PT-BR onboarding label: ${label}`);
}

console.log("full PT-BR UI localization contract passed");
