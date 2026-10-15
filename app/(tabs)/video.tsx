import { Ionicons } from "@expo/vector-icons";
import { VideoView, useVideoPlayer } from "expo-video";
import * as WebBrowser from "expo-web-browser";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { C } from "@/lib/theme";
import {
  runVideoStudioPostProcess,
  type VideoStudioPipelinePhase,
  type VideoStudioPipelineProgress,
  type VideoStudioPostProcessResult,
} from "@/lib/video-studio/pipeline";
import {
  addDiffusionDownloadProgressListener,
  addVideoProgressListener,
  cancelDiffusionModelDownload,
  cancelLocalVideo,
  diffusionAvailable,
  downloadVideoModel,
  generateLocalVideo,
  getVideoStatus,
  removeVideoModel,
  setVideoModelActive,
  type DiffusionDownloadProgress,
  type DiffusionStatus,
  type VideoGenerationResult,
  type VideoProgress,
} from "@/modules/saient-diffusion";
import {
  cancelSpeechSynthesis,
  cancelVideoExport,
  cleanupSynthesizedSegments,
  exportDubbedVideo,
  getOfflineVoices,
  promoteVideoStudioExport,
  synthesizeSpeechSegment,
  videoStudioAvailable,
  type OfflineVoice,
} from "@/modules/saient-video-studio";

// Abaixo de 8 passos, o Wan não resolve bem pessoas. Por isso os presets
// começam no ponto em que a saída já é utilizável.
const STEP_PRESETS = [
  { value: 8, label: "Padrão" },
  { value: 12, label: "Alta" },
  { value: 20, label: "Máxima" },
];

const FRAME_PRESETS = [
  { value: 5, label: "5 quadros" },
  { value: 17, label: "2 s" },
  { value: 41, label: "5 s" },
];

const SPEECH_RATE_PRESETS = [
  { value: 0.9, label: "Calma" },
  { value: 1, label: "Normal" },
  { value: 1.15, label: "Rápida" },
];

function fmtBytes(bytes: number) {
  return bytes >= 1_000_000_000
    ? `${(bytes / 1_000_000_000).toFixed(2)} GB`
    : `${Math.round(bytes / 1_000_000)} MB`;
}

function phaseLabel(phase: VideoStudioPipelinePhase | undefined) {
  switch (phase) {
    case "synthesizing": return "Gerando dublagem PT-BR";
    case "exporting": return "Montando áudio, vídeo e legendas";
    case "promoting": return "Salvando vídeo final";
    case "cleanup": return "Limpando arquivos temporários";
    case "done": return "Concluído";
    default: return "Preparando Estúdio de Vídeo";
  }
}

function statusLabel(checking: boolean, status: DiffusionStatus | null) {
  if (checking) return "Verificando";
  if (status?.active) return "Pronto";
  if (status?.valid) return "Inativo";
  return "Modelo necessário";
}

function statusMessage(status: DiffusionStatus | null, downloading: boolean) {
  if (downloading) return "Baixando e verificando o pacote de vídeo Wan2.1.";
  if (!status) return "Verificando o pacote de vídeo Wan2.1.";
  if (!status.available) return "O módulo Wan não está disponível neste aparelho.";
  if (status.active) return "Pacote Wan2.1 ativo e pronto para gerar vídeos.";
  if (status.valid) return "Pacote Wan2.1 instalado. Ative o modelo para gerar vídeos.";
  return "Baixe o pacote de vídeo Wan2.1 para começar.";
}

function GeneratedVideo({ result }: { result: VideoGenerationResult }) {
  const player = useVideoPlayer(result.uri, (instance) => {
    instance.loop = true;
    instance.play();
  });
  return (
    <View style={styles.resultCard}>
      <VideoView
        player={player}
        style={styles.video}
        nativeControls
        contentFit="contain"
        fullscreenOptions={{ enable: true }}
      />
      <View style={styles.resultBottom}>
        <Ionicons name="checkmark-circle" size={17} color={C.green} />
        <Text style={styles.resultMeta}>
          {result.frames} quadros · {result.steps} passos · {result.elapsedSeconds.toFixed(1)} s
        </Text>
      </View>
    </View>
  );
}

function FinalVideo({ result }: { result: VideoStudioPostProcessResult }) {
  const player = useVideoPlayer(result.uri, (instance) => {
    instance.loop = true;
  });
  return (
    <View style={[styles.resultCard, styles.finalCard]}>
      <VideoView
        player={player}
        style={styles.video}
        nativeControls
        contentFit="contain"
        fullscreenOptions={{ enable: true }}
      />
      <View style={styles.resultBottom}>
        <Ionicons name="checkmark-circle" size={17} color={C.green} />
        <Text style={styles.resultMeta}>
          MP4 · {fmtBytes(result.fileBytes)} · {result.audioSegmentCount} fala(s) · {result.captionCount} legenda(s)
        </Text>
      </View>
    </View>
  );
}

export default function VideoScreen() {
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<DiffusionStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [cancellingDownload, setCancellingDownload] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [steps, setSteps] = useState(8);
  const [frames, setFrames] = useState(5);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 2_147_483_647));
  const [progress, setProgress] = useState<VideoProgress | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DiffusionDownloadProgress | null>(null);
  const [result, setResult] = useState<VideoGenerationResult | null>(null);

  const [narration, setNarration] = useState("");
  const [voices, setVoices] = useState<OfflineVoice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<string | null>(null);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [speechRate, setSpeechRate] = useState(1);
  const [captionsEnabled, setCaptionsEnabled] = useState(true);
  const [postProcessing, setPostProcessing] = useState(false);
  const [cancellingStudio, setCancellingStudio] = useState(false);
  const [studioProgress, setStudioProgress] = useState<VideoStudioPipelineProgress | null>(null);
  const [finalVideo, setFinalVideo] = useState<VideoStudioPostProcessResult | null>(null);

  const refresh = useCallback(async () => {
    setChecking(true);
    try {
      setStatus(await getVideoStatus());
    } catch (error) {
      setStatus({ available: false, installed: false, valid: false, active: false, modelBytes: 0, message: String(error) });
    } finally {
      setChecking(false);
    }
  }, []);

  const refreshVoices = useCallback(async () => {
    if (!videoStudioAvailable()) {
      setVoices([]);
      setSelectedVoice(null);
      setVoiceError("Este build ainda não inclui o módulo Android de dublagem.");
      return;
    }
    setVoiceLoading(true);
    setVoiceError(null);
    try {
      const list = await getOfflineVoices("pt-BR");
      setVoices(list);
      setSelectedVoice((current) => {
        if (current && list.some((voice) => voice.name === current)) return current;
        return list[0]?.name ?? null;
      });
      if (list.length === 0) {
        setVoiceError("Nenhuma voz PT-BR sem internet instalada.");
      }
    } catch (error) {
      setVoices([]);
      setSelectedVoice(null);
      setVoiceError(`Não foi possível carregar as vozes: ${String(error)}`);
    } finally {
      setVoiceLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  useEffect(() => {
    if (!result?.uri || !videoStudioAvailable()) return;
    void refreshVoices();
  }, [refreshVoices, result?.uri]);

  useEffect(() => {
    if (!diffusionAvailable()) return;
    const progressSubscription = addVideoProgressListener(setProgress);
    const downloadSubscription = addDiffusionDownloadProgressListener((event) => {
      if (event.model === "video") setDownloadProgress(event);
    });
    return () => {
      progressSubscription.remove();
      downloadSubscription.remove();
    };
  }, []);

  const download = useCallback(async () => {
    setDownloading(true);
    setDownloadProgress(null);
    try {
      setStatus(await downloadVideoModel());
      Alert.alert("Wan pronto", "O pacote móvel Wan2.1 foi verificado e instalado.");
    } catch (error) {
      if (!String(error).toLocaleLowerCase().includes("cancel")) {
        Alert.alert("Não foi possível baixar o Wan", String(error));
      }
      await refresh();
    } finally {
      setDownloading(false);
      setCancellingDownload(false);
    }
  }, [refresh]);

  const generate = useCallback(async () => {
    if (!status?.valid || !status.active) {
      Alert.alert("Modelo Wan necessário", status?.valid ? "Ative o modelo Wan primeiro." : "Baixe o pacote Wan2.1 primeiro.");
      return;
    }
    if (!prompt.trim()) {
      Alert.alert("Descrição necessária", "Descreva o movimento que o Wan deve criar.");
      return;
    }
    setGenerating(true);
    setProgress(null);
    setResult(null);
    setFinalVideo(null);
    setStudioProgress(null);
    try {
      setResult(await generateLocalVideo({
        prompt: prompt.trim(),
        negativePrompt: negativePrompt.trim(),
        steps,
        guidance: 6,
        seed,
        frames,
      }));
    } catch (error) {
      if (!String(error).toLocaleLowerCase().includes("cancel")) {
        Alert.alert("Falha na geração do vídeo", String(error));
      }
    } finally {
      setGenerating(false);
      setCancelling(false);
    }
  }, [frames, negativePrompt, prompt, seed, status?.active, status?.valid, steps]);

  const dubAndExport = useCallback(async () => {
    if (!result) return;
    if (!videoStudioAvailable()) {
      Alert.alert("Estúdio de Vídeo indisponível", "Este build não contém o módulo Android de dublagem e exportação.");
      return;
    }
    if (!narration.trim()) {
      Alert.alert("Dublagem PT-BR", "Digite a fala que será dublada.");
      return;
    }
    if (!selectedVoice || voices.length === 0) {
      Alert.alert("Voz sem internet necessária", "Instale ou atualize uma voz PT-BR no aparelho e toque em Atualizar vozes.");
      return;
    }

    setPostProcessing(true);
    setCancellingStudio(false);
    setStudioProgress(null);
    setFinalVideo(null);
    try {
      const output = await runVideoStudioPostProcess({
        videoUri: result.uri,
        videoDurationMs: result.frames / result.fps * 1000,
        narration: narration.trim(),
        locale: "pt-BR",
        voiceName: selectedVoice ?? undefined,
        speechRate,
        captionsEnabled,
        outputName: `saient-${Date.now()}`,
        onProgress: setStudioProgress,
      }, {
        synthesizeSpeechSegment,
        exportDubbedVideo,
        promoteVideoStudioExport,
        cleanupSynthesizedSegments,
      });
      setFinalVideo(output);
      if (output.cleanupWarning) {
        Alert.alert("Vídeo salvo", `O MP4 foi criado, mas a limpeza temporária informou: ${output.cleanupWarning}`);
      }
    } catch (error) {
      const message = String(error);
      if (!message.toLocaleLowerCase().includes("cancel")) {
        Alert.alert("Falha ao dublar/exportar", message);
      }
    } finally {
      setPostProcessing(false);
      setCancellingStudio(false);
    }
  }, [captionsEnabled, narration, result, selectedVoice, speechRate, voices.length]);

  const cancelStudio = useCallback(async () => {
    const phase = studioProgress?.phase;
    if (!postProcessing || cancellingStudio) return;
    if (phase !== "synthesizing" && phase !== "exporting") return;
    setCancellingStudio(true);
    try {
      if (phase === "synthesizing") {
        await cancelSpeechSynthesis();
      } else {
        await cancelVideoExport();
      }
    } finally {
      setCancellingStudio(false);
    }
  }, [cancellingStudio, postProcessing, studioProgress?.phase]);

  const downloadFraction = downloadProgress && downloadProgress.totalBytes > 0
    ? downloadProgress.completedBytes / downloadProgress.totalBytes
    : 0;
  const generationFraction = progress && progress.total > 0 ? progress.completed / progress.total : 0;
  const studioPhase = studioProgress?.phase;
  const studioCancellable = studioPhase === "synthesizing" || studioPhase === "exporting";
  const busy = downloading || generating || postProcessing;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{ padding: 16, paddingTop: insets.top + 8, paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.h1}>Vídeo</Text>
          <Text style={styles.sub}>Wan2.1 local · dublagem e legendas PT-BR</Text>
        </View>
        <View style={[styles.state, status?.active ? styles.stateReady : styles.stateWaiting]}>
          <Ionicons name={status?.active ? "checkmark-circle" : "flask-outline"} size={15} color={status?.active ? C.green : C.amber} />
          <Text style={{ color: status?.active ? C.green : C.amber, fontSize: 11, fontWeight: "700" }}>
            {statusLabel(checking, status)}
          </Text>
        </View>
      </View>

      {!status?.valid ? (
        <View style={styles.setupCard}>
          <View style={styles.setupIcon}><Ionicons name="videocam-outline" size={34} color={C.accent} /></View>
          <Text style={styles.setupTitle}>Adicionar pacote de vídeo Wan</Text>
          <Text style={styles.setupText}>
            Baixe o transformador Wan2.1 1.3B quantizado, o codificador UMT5-XXL Q4_K_M e o VAE do Saient Pi. Todos os arquivos são verificados por SHA-256 antes da instalação.
          </Text>
          <Text style={styles.setupMeta}>4,73 GB · perfil 416×240 · sem internet após configurar</Text>
          <Pressable style={[styles.primary, busy && styles.disabled]} onPress={() => { void download(); }} disabled={busy || !status?.available}>
            <Ionicons name="download-outline" size={18} color={C.bg} />
            <Text style={styles.primaryText}>{downloading ? `Baixando ${Math.floor(downloadFraction * 100)}%` : "Baixar pacote Wan"}</Text>
          </Pressable>
          {downloading && (
            <View style={styles.downloadProgress}>
              <View style={styles.track}><View style={[styles.fill, { width: `${Math.floor(downloadFraction * 100)}%` }]} /></View>
              <Text style={styles.progressHint} numberOfLines={1}>{downloadProgress?.currentFile ?? "Conectando ao Saient Pi"}</Text>
              <Pressable
                style={[styles.textButton, cancellingDownload && styles.disabled]}
                disabled={cancellingDownload}
                onPress={() => {
                  setCancellingDownload(true);
                  void cancelDiffusionModelDownload().finally(() => setCancellingDownload(false));
                }}
              >
                <Text style={styles.dangerText}>{cancellingDownload ? "Parando…" : "Cancelar download"}</Text>
              </Pressable>
            </View>
          )}
          <Pressable style={styles.licenseButton} onPress={() => { void WebBrowser.openBrowserAsync("https://huggingface.co/Wan-AI/Wan2.1-T2V-1.3B"); }}>
            <Text style={styles.licenseText}>Detalhes do modelo Wan2.1 T2V 1.3B</Text>
          </Pressable>
          <Text style={styles.statusMessage}>{statusMessage(status, downloading)}</Text>
        </View>
      ) : (
        <>
          <View style={[styles.modelCard, !status.active && { borderColor: C.amber }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.modelName}>Pacote móvel Wan2.1 T2V 1.3B</Text>
              <Text style={styles.modelMeta}>{fmtBytes(status.modelBytes)} · {status.active ? "Ativo" : "Inativo"} · Vulkan</Text>
            </View>
            {!status.active && (
              <Pressable onPress={() => { void setVideoModelActive(true).then(setStatus); }} disabled={busy}>
                <Text style={styles.actionText}>Ativar</Text>
              </Pressable>
            )}
            <Pressable
              hitSlop={10}
              disabled={busy}
              onPress={() => Alert.alert("Remover modelo Wan?", "Os vídeos gerados permanecerão no celular.", [
                { text: "Manter", style: "cancel" },
                { text: "Remover", style: "destructive", onPress: () => { void removeVideoModel().then(setStatus); } },
              ])}
            >
              <Ionicons name="trash-outline" size={18} color={C.text3} />
            </Pressable>
          </View>

          <Text style={styles.label}>Descrição do movimento</Text>
          <TextInput style={styles.prompt} value={prompt} onChangeText={setPrompt} editable={!busy} multiline maxLength={1000} placeholder="Uma raposa vermelha vira para a câmera enquanto a neve cai…" placeholderTextColor={C.text3} />
          <Text style={styles.label}>Evitar (opcional)</Text>
          <TextInput style={styles.negative} value={negativePrompt} onChangeText={setNegativePrompt} editable={!busy} maxLength={1000} placeholder="estático, borrado, distorcido, texto" placeholderTextColor={C.text3} />

          <Text style={styles.label}>Passos</Text>
          <View style={styles.presets}>
            {STEP_PRESETS.map((preset) => (
              <Pressable key={preset.value} style={[styles.preset, steps === preset.value && styles.presetOn]} onPress={() => setSteps(preset.value)} disabled={busy}>
                <Text style={[styles.presetLabel, steps === preset.value && { color: C.accent }]}>{preset.label}</Text>
                <Text style={styles.presetMeta}>{preset.value}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>Duração a 8 fps</Text>
          <View style={styles.presets}>
            {FRAME_PRESETS.map((preset) => (
              <Pressable key={preset.value} style={[styles.preset, frames === preset.value && styles.presetOn]} onPress={() => setFrames(preset.value)} disabled={busy}>
                <Text style={[styles.presetLabel, frames === preset.value && { color: C.accent }]}>{preset.label}</Text>
                <Text style={styles.presetMeta}>{preset.value} q</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.warning}>Comece com 5 quadros no modo Padrão. Vídeos mais longos e com mais passos demoram bastante mais e aquecem o celular.</Text>

          <View style={styles.seedRow}>
            <View style={{ flex: 1 }}><Text style={styles.label}>Semente</Text><Text style={styles.seedValue}>{seed}</Text></View>
            <Pressable style={styles.randomButton} onPress={() => setSeed(Math.floor(Math.random() * 2_147_483_647))} disabled={busy}>
              <Ionicons name="shuffle" size={17} color={C.accent} /><Text style={styles.actionText}>Aleatória</Text>
            </Pressable>
          </View>

          {generating && (
            <View style={styles.progressCard}>
              <View style={styles.progressTop}>
                <Text style={styles.progressLabel}>{progress ? `Processando ${progress.completed} de ${progress.total}` : "Carregando Wan"}</Text>
                <Text style={styles.progressPct}>{Math.round(generationFraction * 100)}%</Text>
              </View>
              <View style={styles.track}><View style={[styles.fill, { width: `${Math.round(generationFraction * 100)}%` }]} /></View>
              <Text style={styles.progressHint}>O chat fica descarregado da memória até o processo nativo de vídeo terminar.</Text>
            </View>
          )}

          {result && <GeneratedVideo result={result} />}

          {generating ? (
            <Pressable
              style={[styles.cancelButton, cancelling && styles.disabled]}
              disabled={cancelling}
              onPress={() => { setCancelling(true); void cancelLocalVideo().finally(() => setCancelling(false)); }}
            >
              <Ionicons name="stop-circle-outline" size={19} color={C.red} /><Text style={styles.dangerText}>{cancelling ? "Parando…" : "Cancelar geração"}</Text>
            </Pressable>
          ) : (
            <Pressable style={[styles.generateButton, (!prompt.trim() || !status.active || postProcessing) && styles.disabled]} disabled={!prompt.trim() || !status.active || postProcessing} onPress={() => { void generate(); }}>
              <Ionicons name="videocam" size={19} color={C.bg} /><Text style={styles.generateText}>Gerar no celular</Text>
            </Pressable>
          )}

          {result && !generating && (
            <View style={styles.studioCard}>
              <View style={styles.studioHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.studioTitle}>Dublagem PT-BR</Text>
                  <Text style={styles.studioSub}>Sem internet · sem créditos · voz do Android</Text>
                </View>
                <Ionicons name="mic-outline" size={22} color={C.accent} />
              </View>

              <Text style={styles.label}>Fala</Text>
              <TextInput
                style={styles.narration}
                value={narration}
                onChangeText={setNarration}
                editable={!postProcessing}
                multiline
                maxLength={1500}
                placeholder="Digite a fala em português que deve entrar no vídeo…"
                placeholderTextColor={C.text3}
              />
              <Text style={styles.durationHint}>
                Vídeo bruto: {(result.frames / result.fps).toFixed(2)} s. A fala precisa caber nesse tempo.
              </Text>

              <View style={styles.rowBetween}>
                <Text style={styles.label}>Voz PT-BR sem internet</Text>
                <Pressable style={styles.refreshVoice} disabled={voiceLoading || postProcessing} onPress={() => { void refreshVoices(); }}>
                  <Ionicons name="refresh" size={14} color={C.accent} />
                  <Text style={styles.actionText}>{voiceLoading ? "Buscando…" : "Atualizar vozes"}</Text>
                </Pressable>
              </View>

              {voices.length > 0 ? (
                <View style={styles.voiceGrid}>
                  {voices.slice(0, 8).map((voice) => (
                    <Pressable
                      key={voice.name}
                      style={[styles.voiceButton, selectedVoice === voice.name && styles.voiceButtonOn]}
                      disabled={postProcessing}
                      onPress={() => setSelectedVoice(voice.name)}
                    >
                      <Ionicons name={selectedVoice === voice.name ? "radio-button-on" : "radio-button-off"} size={15} color={selectedVoice === voice.name ? C.accent : C.text3} />
                      <Text style={[styles.voiceText, selectedVoice === voice.name && { color: C.text }]} numberOfLines={1}>{voice.name}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : (
                <Text style={styles.voiceEmpty}>{voiceLoading ? "Procurando vozes PT-BR sem internet…" : "Nenhuma voz PT-BR sem internet instalada."}</Text>
              )}
              {!!voiceError && <Text style={styles.voiceError}>{voiceError}</Text>}

              <Text style={styles.label}>Velocidade da voz</Text>
              <View style={styles.presets}>
                {SPEECH_RATE_PRESETS.map((preset) => (
                  <Pressable
                    key={preset.value}
                    style={[styles.preset, speechRate === preset.value && styles.presetOn]}
                    disabled={postProcessing}
                    onPress={() => setSpeechRate(preset.value)}
                  >
                    <Text style={[styles.presetLabel, speechRate === preset.value && { color: C.accent }]}>{preset.label}</Text>
                    <Text style={styles.presetMeta}>{preset.value.toFixed(2)}×</Text>
                  </Pressable>
                ))}
              </View>

              <View style={styles.toggleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.toggleTitle}>Legendas</Text>
                  <Text style={styles.toggleSub}>Gravadas no MP4 e sincronizadas com a dublagem.</Text>
                </View>
                <Switch
                  value={captionsEnabled}
                  onValueChange={setCaptionsEnabled}
                  disabled={postProcessing}
                />
              </View>

              {postProcessing && (
                <View style={styles.studioProgressCard}>
                  <View style={styles.progressTop}>
                    <Text style={styles.progressLabel}>{phaseLabel(studioPhase)}</Text>
                    {studioProgress?.total ? <Text style={styles.progressPct}>{studioProgress.completed ?? 0}/{studioProgress.total}</Text> : null}
                  </View>
                  <Text style={styles.progressHint}>Processamento local no aparelho. Nenhum crédito é consumido.</Text>
                </View>
              )}

              {postProcessing && studioCancellable ? (
                <Pressable
                  style={[styles.cancelButton, cancellingStudio && styles.disabled]}
                  disabled={cancellingStudio}
                  onPress={() => { void cancelStudio(); }}
                >
                  <Ionicons name="stop-circle-outline" size={19} color={C.red} />
                  <Text style={styles.dangerText}>{cancellingStudio ? "Cancelando…" : "Cancelar dublagem/exportação"}</Text>
                </Pressable>
              ) : (
                <Pressable
                  style={[styles.studioButton, (!narration.trim() || !selectedVoice || postProcessing) && styles.disabled]}
                  disabled={!narration.trim() || !selectedVoice || postProcessing}
                  onPress={() => { void dubAndExport(); }}
                >
                  <Ionicons name="sparkles" size={19} color={C.bg} />
                  <Text style={styles.generateText}>Dublar e exportar</Text>
                </Pressable>
              )}

              {finalVideo && (
                <>
                  <Text style={styles.finalLabel}>Vídeo final</Text>
                  <FinalVideo result={finalVideo} />
                </>
              )}
            </View>
          )}
        </>
      )}

      <Text style={styles.foot}>Wan, dublagem PT-BR e exportação rodam localmente. Sem inferência em nuvem e sem créditos por geração.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  h1: { color: C.text, fontSize: 24, fontWeight: "800" },
  sub: { color: C.text2, fontSize: 13, marginTop: 3 },
  state: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, height: 30 },
  stateReady: { borderColor: C.green, backgroundColor: "rgba(54,211,153,0.08)" },
  stateWaiting: { borderColor: C.amber, backgroundColor: "rgba(245,179,66,0.08)" },
  setupCard: { alignItems: "center", padding: 22, backgroundColor: C.bg2, borderRadius: 16, borderWidth: 1, borderColor: C.border },
  setupIcon: { width: 72, height: 72, alignItems: "center", justifyContent: "center", borderRadius: 22, backgroundColor: C.bg3, marginBottom: 14 },
  setupTitle: { color: C.text, fontSize: 18, fontWeight: "800", textAlign: "center" },
  setupText: { color: C.text2, fontSize: 13, lineHeight: 20, textAlign: "center", marginTop: 8 },
  setupMeta: { color: C.text3, fontSize: 11, fontFamily: "monospace", marginTop: 10, textAlign: "center" },
  primary: { width: "100%", minHeight: 48, backgroundColor: C.accent, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 18 },
  primaryText: { color: C.bg, fontSize: 14, fontWeight: "800" },
  downloadProgress: { width: "100%", marginTop: 12 },
  licenseButton: { marginTop: 12, minHeight: 32, justifyContent: "center" },
  licenseText: { color: C.text3, fontSize: 10, textDecorationLine: "underline" },
  statusMessage: { color: C.text3, fontSize: 11, textAlign: "center", marginTop: 12 },
  modelCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: C.bg2, borderWidth: 1, borderColor: C.green, borderRadius: 12, padding: 14, marginBottom: 18 },
  modelName: { color: C.text, fontSize: 14, fontWeight: "700" },
  modelMeta: { color: C.text3, fontSize: 11, marginTop: 3 },
  label: { color: C.text2, fontSize: 12, fontWeight: "700", marginBottom: 7, marginTop: 12 },
  prompt: { minHeight: 104, color: C.text, backgroundColor: C.bg2, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 13, fontSize: 14, textAlignVertical: "top" },
  negative: { height: 48, color: C.text, backgroundColor: C.bg2, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 13, fontSize: 13 },
  presets: { flexDirection: "row", gap: 7 },
  preset: { flex: 1, minHeight: 58, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: C.bg2, borderWidth: 1, borderColor: C.border },
  presetOn: { borderColor: C.accent, backgroundColor: "rgba(124,92,255,0.10)" },
  presetLabel: { color: C.text2, fontSize: 12, fontWeight: "700" },
  presetMeta: { color: C.text3, fontSize: 9, marginTop: 3 },
  warning: { color: C.amber, fontSize: 10, lineHeight: 15, marginTop: 9 },
  seedRow: { flexDirection: "row", alignItems: "flex-end", marginTop: 6 },
  seedValue: { color: C.text, fontFamily: "monospace", fontSize: 14 },
  randomButton: { height: 38, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 9, backgroundColor: C.bg2, borderWidth: 1, borderColor: C.border },
  actionText: { color: C.accent, fontSize: 12, fontWeight: "700" },
  progressCard: { marginTop: 18, backgroundColor: C.bg2, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 14 },
  progressTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  progressLabel: { color: C.text, fontSize: 13, fontWeight: "700", flex: 1 },
  progressPct: { color: C.accent, fontSize: 12, fontFamily: "monospace", marginLeft: 8 },
  track: { height: 7, backgroundColor: C.bg3, borderRadius: 4, overflow: "hidden", marginTop: 10 },
  fill: { height: 7, backgroundColor: C.accent, borderRadius: 4 },
  progressHint: { color: C.text3, fontSize: 10, lineHeight: 15, marginTop: 9, textAlign: "center" },
  resultCard: { marginTop: 18, overflow: "hidden", backgroundColor: C.bg2, borderWidth: 1, borderColor: C.border, borderRadius: 14 },
  finalCard: { borderColor: C.green },
  video: { width: "100%", aspectRatio: 416 / 240, backgroundColor: C.bg3 },
  resultBottom: { flexDirection: "row", alignItems: "center", gap: 7, padding: 12 },
  resultMeta: { color: C.text2, fontSize: 11, flex: 1 },
  generateButton: { minHeight: 52, marginTop: 18, borderRadius: 13, backgroundColor: C.accent, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  generateText: { color: C.bg, fontSize: 15, fontWeight: "800" },
  cancelButton: { minHeight: 50, marginTop: 18, borderRadius: 13, borderWidth: 1, borderColor: C.red, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  textButton: { alignSelf: "center", minHeight: 38, justifyContent: "center", marginTop: 6, paddingHorizontal: 12 },
  dangerText: { color: C.red, fontSize: 14, fontWeight: "700" },
  studioCard: { marginTop: 18, padding: 14, borderRadius: 14, backgroundColor: C.bg2, borderWidth: 1, borderColor: C.border },
  studioHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 2 },
  studioTitle: { color: C.text, fontSize: 17, fontWeight: "800" },
  studioSub: { color: C.text3, fontSize: 10, marginTop: 2 },
  narration: { minHeight: 92, color: C.text, backgroundColor: C.bg3, borderWidth: 1, borderColor: C.border, borderRadius: 11, padding: 12, fontSize: 14, textAlignVertical: "top" },
  durationHint: { color: C.amber, fontSize: 10, lineHeight: 15, marginTop: 7 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  refreshVoice: { minHeight: 34, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, marginTop: 6 },
  voiceGrid: { gap: 7 },
  voiceButton: { minHeight: 42, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, backgroundColor: C.bg3, borderWidth: 1, borderColor: C.border, borderRadius: 9 },
  voiceButtonOn: { borderColor: C.accent, backgroundColor: "rgba(124,92,255,0.10)" },
  voiceText: { color: C.text2, fontSize: 11, flex: 1 },
  voiceEmpty: { color: C.text3, fontSize: 11, lineHeight: 17, paddingVertical: 8 },
  voiceError: { color: C.amber, fontSize: 10, lineHeight: 15, marginTop: 5 },
  toggleRow: { minHeight: 62, flexDirection: "row", alignItems: "center", gap: 12, marginTop: 14, padding: 11, backgroundColor: C.bg3, borderRadius: 10, borderWidth: 1, borderColor: C.border },
  toggleTitle: { color: C.text, fontSize: 13, fontWeight: "700" },
  toggleSub: { color: C.text3, fontSize: 10, lineHeight: 15, marginTop: 2 },
  studioProgressCard: { marginTop: 14, backgroundColor: C.bg3, borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 12 },
  studioButton: { minHeight: 52, marginTop: 16, borderRadius: 13, backgroundColor: C.accent, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  finalLabel: { color: C.green, fontSize: 13, fontWeight: "800", marginTop: 18 },
  foot: { color: C.text3, fontSize: 11, lineHeight: 17, textAlign: "center", marginTop: 20 },
  disabled: { opacity: 0.45 },
});