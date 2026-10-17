import fs from "node:fs";

const videoPath = "app/(tabs)/video.tsx";
let source = fs.readFileSync(videoPath, "utf8");

function replaceRequired(anchor, replacement, label) {
  if (!source.includes(anchor)) throw new Error(`${label} anchor not found.`);
  source = source.replace(anchor, replacement);
}

if (!source.includes('from "@/lib/wan-fast/policy"')) {
  replaceRequired(
    'import { C } from "@/lib/theme";\n',
    'import { C } from "@/lib/theme";\nimport { resolveWanProfile } from "@/lib/wan-fast/policy";\n',
    "Wan Fast policy import",
  );
}

if (!source.includes("generateSmartLocalVideo,")) {
  replaceRequired(
    `  cancelDiffusionModelDownload,\n  cancelLocalVideo,\n  diffusionAvailable,\n  downloadVideoModel,\n  generateLocalVideo,\n  getVideoStatus,`,
    `  cancelDiffusionModelDownload,\n  cancelLocalVideo,\n  cancelSmartLocalVideo,\n  diffusionAvailable,\n  downloadVideoModel,\n  generateLocalVideo,\n  generateSmartLocalVideo,\n  getVideoStatus,\n  getWanFastStatus,\n  startWanFastEngine,`,
    "Wan Fast UI native imports",
  );
}

if (!source.includes("type WanFastStatus,")) {
  replaceRequired(
    `  type DiffusionStatus,\n  type VideoGenerationResult,\n  type VideoProgress,`,
    `  type DiffusionStatus,\n  type VideoGenerationResult,\n  type VideoProgress,\n  type WanFastStatus,\n  type WanSmartVideoResult,`,
    "Wan Fast UI type imports",
  );
}

if (!source.includes('const FAST_PROFILE = resolveWanProfile("fast")')) {
  const frameAnchor = `const FRAME_PRESETS = [\n  { value: 5, label: "5 quadros" },\n  { value: 17, label: "2 s" },\n  { value: 41, label: "5 s" },\n];\n`;
  replaceRequired(
    frameAnchor,
    `${frameAnchor}\nconst FAST_PROFILE = resolveWanProfile("fast");\nconst BALANCED_PROFILE = resolveWanProfile("balanced");\nconst QUALITY_PROFILE = resolveWanProfile("quality");\n`,
    "Wan Fast profile constants",
  );
}

if (!source.includes("function fastStateLabel(")) {
  const statusAnchor = "function statusLabel(checking: boolean, status: DiffusionStatus | null) {";
  const helper = `function fastStateLabel(status: WanFastStatus | null) {\n  switch (status?.state) {\n    case "starting": return "Inicializando motor";\n    case "loading": return "Carregando modelos";\n    case "ready": return "Pronto";\n    case "generating": return "Gerando";\n    case "stopping": return "Finalizando";\n    case "failed": return "Falha no motor rápido";\n    default: return "Desligado";\n  }\n}\n\n${statusAnchor}`;
  replaceRequired(statusAnchor, helper, "Wan Fast state label");
}

if (!source.includes('const smartResult = "engineMode" in result')) {
  const start = source.indexOf("function GeneratedVideo(");
  const end = source.indexOf("\nfunction FinalVideo(", start);
  if (start < 0 || end < 0) throw new Error("GeneratedVideo bounds not found.");
  let generated = source.slice(start, end);
  generated = generated.replace(
    "function GeneratedVideo({ result }: { result: VideoGenerationResult }) {",
    "function GeneratedVideo({ result }: { result: VideoGenerationResult | WanSmartVideoResult }) {",
  );
  generated = generated.replace(
    `  const player = useVideoPlayer(result.uri, (instance) => {\n    instance.loop = true;\n    instance.play();\n  });`,
    `  const player = useVideoPlayer(result.uri, (instance) => {\n    instance.loop = true;\n    instance.play();\n  });\n  const smartResult = "engineMode" in result ? result as WanSmartVideoResult : null;`,
  );
  const metaAnchor = `      <View style={styles.resultBottom}>\n        <Ionicons name="checkmark-circle" size={17} color={C.green} />\n        <Text style={styles.resultMeta}>\n          {result.frames} quadros · {result.steps} passos · {result.elapsedSeconds.toFixed(1)} s\n        </Text>\n      </View>`;
  if (!generated.includes(metaAnchor)) throw new Error("GeneratedVideo metadata anchor not found.");
  generated = generated.replace(
    metaAnchor,
    `${metaAnchor}\n      {smartResult && (\n        <View style={styles.fastResultMeta}>\n          <Text style={styles.fastResultText}>\n            Motor: {smartResult.engineMode === "fast" ? "Rápido" : "CLI fallback"} · {smartResult.startKind === "warm" ? "quente" : "frio"} · {(smartResult.timings.totalMs / 1000).toFixed(1)} s\n          </Text>\n          {smartResult.timings.timeToFirstProgressMs != null && (\n            <Text style={styles.fastResultText}>Primeiro progresso: {(smartResult.timings.timeToFirstProgressMs / 1000).toFixed(1)} s</Text>\n          )}\n          {smartResult.engineSessionId && (\n            <Text style={styles.fastResultText}>Sessão {smartResult.engineSessionId.slice(0, 8)} · geração {smartResult.generationCount ?? 1}</Text>\n          )}\n          {smartResult.fallbackReason && (\n            <Text style={styles.fastFallbackText}>Fallback CLI: {smartResult.fallbackReason}</Text>\n          )}\n        </View>\n      )}`,
  );
  source = source.slice(0, start) + generated + source.slice(end);
}

if (!source.includes("const [fastEngineEnabled, setFastEngineEnabled] = useState(false)")) {
  replaceRequired(
    "  const [result, setResult] = useState<VideoGenerationResult | null>(null);",
    `  const [result, setResult] = useState<VideoGenerationResult | WanSmartVideoResult | null>(null);\n  const [fastEngineEnabled, setFastEngineEnabled] = useState(false);\n  const [fastStatus, setFastStatus] = useState<WanFastStatus | null>(null);`,
    "Wan Fast UI state",
  );
}

if (!source.includes("startWanFastEngine().then(setFastStatus)")) {
  replaceRequired(
    "  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));",
    `  useFocusEffect(useCallback(() => {\n    void refresh();\n    if (fastEngineEnabled && status?.active) {\n      void startWanFastEngine().then(setFastStatus).catch(() => {\n        void getWanFastStatus().then(setFastStatus).catch(() => undefined);\n      });\n    }\n  }, [fastEngineEnabled, refresh, status?.active]));`,
    "Wan Fast prewarm",
  );
}

if (!source.includes("fastEngineEnabled ? generateSmartLocalVideo : generateLocalVideo")) {
  const start = source.indexOf("  const generate = useCallback(async () => {");
  const end = source.indexOf("\n  const dubAndExport = useCallback", start);
  if (start < 0 || end < 0) throw new Error("Video generate callback bounds not found.");
  let generate = source.slice(start, end);
  const oldCall = `    try {\n      setResult(await generateLocalVideo({\n        prompt: prompt.trim(),\n        negativePrompt: negativePrompt.trim(),\n        steps,\n        guidance: 6,\n        seed,\n        frames,\n      }));\n    } catch (error) {`;
  if (!generate.includes(oldCall)) throw new Error("Video generation call anchor not found.");
  generate = generate.replace(
    oldCall,
    `    try {\n      const generateVideoRequest = fastEngineEnabled ? generateSmartLocalVideo : generateLocalVideo;\n      if (fastEngineEnabled) {\n        setFastStatus((current) => current\n          ? { ...current, state: "generating", message: "Gerando" }\n          : { state: "generating", available: true, healthy: true, generationCount: 0, message: "Gerando" });\n      }\n      const generated = await generateVideoRequest({\n        prompt: prompt.trim(),\n        negativePrompt: negativePrompt.trim(),\n        steps,\n        guidance: 6,\n        seed,\n        frames,\n      });\n      setResult(generated);\n    } catch (error) {`,
  );
  generate = generate.replace(
    `    } finally {\n      setGenerating(false);\n      setCancelling(false);\n    }\n  }, [frames, negativePrompt, prompt, seed, status?.active, status?.valid, steps]);`,
    `    } finally {\n      if (fastEngineEnabled) {\n        void getWanFastStatus().then(setFastStatus).catch(() => undefined);\n      }\n      setGenerating(false);\n      setCancelling(false);\n    }\n  }, [fastEngineEnabled, frames, negativePrompt, prompt, seed, status?.active, status?.valid, steps]);`,
  );
  source = source.slice(0, start) + generate + source.slice(end);
}

if (!source.includes("fastEngineEnabled ? cancelSmartLocalVideo : cancelLocalVideo")) {
  replaceRequired(
    '              onPress={() => { setCancelling(true); void cancelLocalVideo().finally(() => setCancelling(false)); }}',
    `              onPress={() => {\n                setCancelling(true);\n                const cancelVideoRequest = fastEngineEnabled ? cancelSmartLocalVideo : cancelLocalVideo;\n                void cancelVideoRequest().finally(() => setCancelling(false));\n              }}`,
    "Wan Fast cancellation selection",
  );
}

if (!source.includes("Motor rápido (teste)")) {
  const promptAnchor = `          <Text style={styles.label}>Descrição do movimento</Text>`;
  const card = `          <View style={styles.fastCard}>\n            <View style={styles.toggleRow}>\n              <View style={{ flex: 1 }}>\n                <Text style={styles.toggleTitle}>Motor rápido (teste)</Text>\n                <Text style={styles.toggleSub}>Mantém Vulkan e os modelos carregados enquanto o app está em primeiro plano.</Text>\n                <Text style={styles.fastState}>Estado: {fastStateLabel(fastStatus)}</Text>\n              </View>\n              <Switch\n                value={fastEngineEnabled}\n                onValueChange={setFastEngineEnabled}\n                disabled={busy || !status.active}\n              />\n            </View>\n            <Text style={styles.label}>Perfil do vídeo</Text>\n            <View style={styles.presets}>\n              <Pressable\n                style={[styles.preset, steps === FAST_PROFILE.steps && frames === FAST_PROFILE.frames && styles.presetOn]}\n                onPress={() => { setSteps(FAST_PROFILE.steps); setFrames(FAST_PROFILE.frames); }}\n                disabled={busy}\n              >\n                <Text style={styles.presetLabel}>Rápido</Text>\n                <Text style={styles.presetMeta}>{FAST_PROFILE.steps} passos · {FAST_PROFILE.frames} q</Text>\n              </Pressable>\n              <Pressable\n                style={[styles.preset, steps === BALANCED_PROFILE.steps && frames === BALANCED_PROFILE.frames && styles.presetOn]}\n                onPress={() => { setSteps(BALANCED_PROFILE.steps); setFrames(BALANCED_PROFILE.frames); }}\n                disabled={busy}\n              >\n                <Text style={styles.presetLabel}>Equilibrado</Text>\n                <Text style={styles.presetMeta}>{BALANCED_PROFILE.steps} passos · {BALANCED_PROFILE.frames} q</Text>\n              </Pressable>\n              <Pressable\n                style={[styles.preset, steps === QUALITY_PROFILE.steps && frames === QUALITY_PROFILE.frames && styles.presetOn]}\n                onPress={() => { setSteps(QUALITY_PROFILE.steps); setFrames(QUALITY_PROFILE.frames); }}\n                disabled={busy}\n              >\n                <Text style={styles.presetLabel}>Qualidade</Text>\n                <Text style={styles.presetMeta}>{QUALITY_PROFILE.steps} passos · {QUALITY_PROFILE.frames} q</Text>\n              </Pressable>\n            </View>\n          </View>\n\n${promptAnchor}`;
  replaceRequired(promptAnchor, card, "Wan Fast beta card");
}

if (!source.includes("fastCard:")) {
  replaceRequired(
    '  modelMeta: { color: C.text3, fontSize: 11, marginTop: 3 },\n',
    `  modelMeta: { color: C.text3, fontSize: 11, marginTop: 3 },\n  fastCard: { marginBottom: 6, padding: 12, borderRadius: 12, backgroundColor: C.bg2, borderWidth: 1, borderColor: C.border },\n  fastState: { color: C.accent, fontSize: 10, fontWeight: "700", marginTop: 4 },\n`,
    "Wan Fast beta styles",
  );
}

if (!source.includes("fastResultMeta:")) {
  replaceRequired(
    '  resultMeta: { color: C.text2, fontSize: 11, flex: 1 },\n',
    `  resultMeta: { color: C.text2, fontSize: 11, flex: 1 },\n  fastResultMeta: { paddingHorizontal: 12, paddingBottom: 12, gap: 3 },\n  fastResultText: { color: C.text3, fontSize: 10, lineHeight: 14 },\n  fastFallbackText: { color: C.amber, fontSize: 10, lineHeight: 14 },\n`,
    "Wan Fast result styles",
  );
}

fs.writeFileSync(videoPath, source);
console.log("Applied Wan Fast beta UI and benchmark metadata.");
