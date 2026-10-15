import { Ionicons } from "@expo/vector-icons";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChatHistoryModal } from "@/components/ChatHistoryModal";
import { Mascot } from "@/components/Mascot";
import { HtmlPreview } from "@/components/HtmlPreview";
import { Message, UIMessage } from "@/components/Message";
import { SetupWizard } from "@/components/SetupWizard";
import { runAgent } from "@/lib/agent";
import { deleteSavedChat, listSavedChats, saveChat, type SavedChat } from "@/lib/chats";
import { listLocal } from "@/lib/models";
import { quartzChat, type ChatMsg } from "@/lib/quartz";
import { C } from "@/lib/theme";

const SYSTEM = "Você é o Saient, um assistente de IA útil que roda inteiramente neste celular. Responda sempre em português do Brasil, de forma clara e concisa.\n/no_think";
const BUILD_SYSTEM =
  "Você é o Saient Build, um criador local de protótipos web. Responda sempre em português do Brasil. Quando o usuário descrever uma página, tela, interface ou " +
  "componente, responda com UM documento HTML autocontido dentro de um único bloco ```html: coloque o CSS em " +
  "uma tag <style> interna e qualquer JS em uma tag <script> interna; NÃO use arquivos externos, CDNs, fontes ou " +
  "URLs de imagens (use SVG inline ou CSS). Faça uma interface limpa e moderna. Adicione no máximo uma frase curta " +
  "antes do bloco de código e nada depois dele.\n/no_think";
const WIZARD_SEEN_KEY = "saient.setup-wizard-seen.v1";

export default function ChatScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabH = useBottomTabBarHeight();
  // Lift the input bar by exactly the keyboard height (minus the tab bar it already sits above).
  const { height: kbHeight } = useReanimatedKeyboardAnimation();
  const inputLift = useAnimatedStyle(() => ({ marginBottom: Math.max(0, Math.abs(kbHeight.value) - tabH) }));
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [showWizard, setShowWizard] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [agent, setAgent] = useState(false);
  const [build, setBuild] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [savedChats, setSavedChats] = useState<SavedChat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const listRef = useRef<FlatList<UIMessage>>(null);
  const abort = useRef<AbortController | null>(null);

  // First launch: show the setup wizard once (tracked in SecureStore).
  useEffect(() => {
    let cancelled = false;
    SecureStore.getItemAsync(WIZARD_SEEN_KEY)
      .then((seen) => { if (!cancelled && !seen) setShowWizard(true); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const finishWizard = useCallback((finished: boolean) => {
    setShowWizard(false);
    void SecureStore.setItemAsync(WIZARD_SEEN_KEY, "1").catch(() => {});
    // On "Get started" (not Skip), send first-timers with no model straight to the Models tab.
    if (finished) {
      void listLocal()
        .then((local) => { if (Object.keys(local).length === 0) router.push("/models"); })
        .catch(() => {});
    }
  }, [router]);

  function scrollToEnd() {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }

  const appendMsg = (m: Omit<UIMessage, "id">) =>
    setMessages((cur) => [...cur, { ...m, id: `${Date.now()}-${Math.random().toString(36).slice(2)}` }]);

  // The agent asks before sending a text — one-tap confirm, never a silent send.
  const confirmSend = (name: string, message: string) =>
    new Promise<boolean>((resolve) => {
      Alert.alert(
        `Enviar para ${name}?`,
        message,
        [
          { text: "Cancelar", style: "cancel", onPress: () => resolve(false) },
          { text: "Enviar", onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      );
    });

  async function send() {
    const text = input.trim();
    await sendText(text);
  }

  async function sendText(text: string, busyAlready = false) {
    if (!text || (busy && !busyAlready)) return;
    setInput("");

    const prior = messages;
    appendMsg({ role: "user", content: text });
    setBusy(true);
    scrollToEnd();
    abort.current = new AbortController();

    // Agent mode: run the tool loop, rendering each tool action/result as it happens.
    if (agent) {
      try {
        await runAgent(text, (e) => {
          if (e.type === "tool") {
            const a = Object.values(e.args).map(String).join(" · ");
            appendMsg({ kind: "tool", role: "assistant", content: `🔧 ${e.name}${a ? `: ${a}` : ""}` });
          } else if (e.type === "result") {
            appendMsg({ kind: "tool", role: "assistant", content: `↳ ${e.text}` });
          } else {
            appendMsg({ role: "assistant", content: e.text });
          }
          scrollToEnd();
        }, confirmSend, abort.current.signal);
      } catch (e) {
        appendMsg({ role: "assistant", content: `Erro: ${String(e)}` });
      } finally {
        setBusy(false);
      }
      return;
    }

    // Plain chat: stream into a single assistant bubble.
    const aiMsg: UIMessage = { id: `ai-${Date.now()}`, role: "assistant", content: "", streaming: true };
    setMessages((cur) => [...cur, aiMsg]);
    const history: ChatMsg[] = [
      { role: "system", content: build ? BUILD_SYSTEM : SYSTEM },
      ...prior.filter((m) => m.kind !== "tool" && (m.content || m.role === "user")).map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: text },
    ];
    try {
      await quartzChat(history, (tok) => {
        // The FlatList auto-scrolls via onContentSizeChange as the bubble grows, so we don't
        // also scroll per token here — one scroll driver instead of two keeps streaming smooth.
        setMessages((cur) => cur.map((m) => (m.id === aiMsg.id ? { ...m, content: m.content + tok } : m)));
      }, abort.current.signal);
    } catch (e) {
      setMessages((cur) => cur.map((m) => (m.id === aiMsg.id ? { ...m, content: m.content || `Erro: ${String(e)}` } : m)));
    } finally {
      setMessages((cur) => cur.map((m) => (m.id === aiMsg.id ? { ...m, streaming: false } : m)));
      setBusy(false);
    }
  }

  function stop() {
    abort.current?.abort();
    setBusy(false);
  }

  function resetChat() {
    abort.current?.abort();
    setMessages([]);
    setInput("");
    setBusy(false);
    setActiveChatId(null);
  }

  async function openHistory() {
    try {
      setSavedChats(await listSavedChats());
      setHistoryOpen(true);
    } catch (error) {
      Alert.alert("Conversas salvas indisponíveis", String(error));
    }
  }

  async function saveCurrentChat() {
    if (messages.length === 0 || busy || saving) return;
    setSaving(true);
    try {
      const existing = savedChats.find((chat) => chat.id === activeChatId) ?? null;
      const saved = await saveChat(messages, existing);
      setActiveChatId(saved.id);
      setSavedChats((current) => [saved, ...current.filter((chat) => chat.id !== saved.id)]);
      Alert.alert("Conversa salva", `“${saved.title}” foi salva neste celular.`);
    } catch (error) {
      Alert.alert("Não foi possível salvar a conversa", String(error));
    } finally {
      setSaving(false);
    }
  }

  function loadChat(chat: SavedChat) {
    setMessages(chat.messages.map((message) => ({ ...message })));
    setActiveChatId(chat.id);
    setInput("");
    setHistoryOpen(false);
    scrollToEnd();
  }

  function confirmDeleteCurrent() {
    if (messages.length === 0 || busy) return;
    const saved = savedChats.find((chat) => chat.id === activeChatId);
    Alert.alert(
      saved ? "Excluir conversa salva?" : "Limpar esta conversa?",
      saved
        ? `“${saved.title}” será removida permanentemente deste celular.`
        : "Esta conversa não salva será apagada permanentemente.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Excluir",
          style: "destructive",
          onPress: () => {
            void (async () => {
              try {
                if (saved) await deleteSavedChat(saved.id);
                setSavedChats((current) => current.filter((chat) => chat.id !== saved?.id));
                resetChat();
              } catch (error) {
                Alert.alert("Não foi possível excluir a conversa", String(error));
              }
            })();
          },
        },
      ],
    );
  }

  function confirmDeleteSaved(chat: SavedChat) {
    Alert.alert(
      "Excluir conversa salva?",
      `“${chat.title}” será removida permanentemente deste celular.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Excluir",
          style: "destructive",
          onPress: () => {
            void deleteSavedChat(chat.id).then(() => {
              setSavedChats((current) => current.filter((saved) => saved.id !== chat.id));
              if (activeChatId === chat.id) resetChat();
            }).catch((error) => Alert.alert("Não foi possível excluir a conversa", String(error)));
          },
        },
      ],
    );
  }

  function startNewChat() {
    setHistoryOpen(false);
    if (messages.length === 0) {
      resetChat();
      return;
    }
    Alert.alert(
      "Iniciar uma nova conversa?",
      activeChatId ? "Sua conversa salva continuará no histórico." : "Esta conversa não salva será apagada.",
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Nova conversa", onPress: resetChat },
      ],
    );
  }

  return (
    <>
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <View style={styles.logoGroup}>
            <Text style={styles.logo}>SAIENT</Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable
              onPress={() => { void openHistory(); }}
              style={[styles.headerButton, busy && styles.disabled]}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Abrir conversas salvas"
            >
              <Ionicons name="time-outline" size={17} color={C.text2} />
            </Pressable>
            <Pressable
              onPress={() => { void saveCurrentChat(); }}
              style={[styles.headerButton, (busy || saving || messages.length === 0) && styles.disabled]}
              disabled={busy || saving || messages.length === 0}
              accessibilityRole="button"
              accessibilityLabel="Salvar conversa"
            >
              <Ionicons name={saving ? "hourglass-outline" : "bookmark-outline"} size={17} color={C.text2} />
            </Pressable>
            <Pressable
              onPress={confirmDeleteCurrent}
              style={[styles.headerButton, (busy || messages.length === 0) && styles.disabled]}
              disabled={busy || messages.length === 0}
              accessibilityRole="button"
              accessibilityLabel="Excluir conversa atual"
            >
              <Ionicons name="trash-outline" size={17} color={messages.length > 0 ? C.red : C.text3} />
            </Pressable>
            <Pressable
              onPress={() => { setBuild((b) => !b); setAgent(false); }}
              style={[styles.agentBtn, build && styles.agentOn]}
              accessibilityRole="switch"
              accessibilityState={{ checked: build }}
              accessibilityLabel={`Modo construtor ${build ? "ativado" : "desativado"}`}
            >
              <Ionicons name="hammer" size={13} color={build ? C.accent : C.text3} />
              <Text style={[styles.agentTxt, { color: build ? C.accent : C.text3 }]}>Construtor</Text>
            </Pressable>
            <Pressable
              onPress={() => { setAgent((a) => !a); setBuild(false); }}
              style={[styles.agentBtn, agent && styles.agentOn]}
              accessibilityRole="switch"
              accessibilityState={{ checked: agent }}
              accessibilityLabel={`Modo agente ${agent ? "ativado" : "desativado"}`}
            >
              <Ionicons name="construct" size={13} color={agent ? C.accent : C.text3} />
              <Text style={[styles.agentTxt, { color: agent ? C.accent : C.text3 }]}>Agente</Text>
            </Pressable>
          </View>
        </View>

        {messages.length === 0 ? (
          <View style={styles.empty}>
            <Mascot size={34} />
            <Text style={styles.emptyTitle}>Sua IA, no seu celular.</Text>
            <Text style={styles.emptySub}>Carregue um modelo local para começar.</Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            style={{ flex: 1 }}
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={({ item }) => <Message msg={item} onPreview={setPreviewHtml} />}
            contentContainerStyle={{ paddingVertical: 12 }}
            onContentSizeChange={scrollToEnd}
            keyboardShouldPersistTaps="handled"
          />
        )}

        <Animated.View style={[styles.inputBar, { paddingBottom: 10 }, inputLift]}>
          <TextInput
            style={styles.input}
            placeholder={build
              ? "Descreva uma página ou interface para criar…"
              : agent
                ? "Peça para eu preparar uma mensagem ou ligação…"
                : "Mensagem para o Saient…"}
            placeholderTextColor={C.text3}
            value={input}
            onChangeText={setInput}
            multiline
            onSubmitEditing={send}
          />
          <Pressable style={[styles.send, busy && styles.sendStop]} onPress={busy ? stop : send}>
            <Ionicons name={busy ? "stop" : "arrow-up"} size={20} color={busy ? C.red : "#0a0a12"} />
          </Pressable>
        </Animated.View>
      </View>
      <ChatHistoryModal
        visible={historyOpen}
        chats={savedChats}
        activeChatId={activeChatId}
        onClose={() => setHistoryOpen(false)}
        onLoad={loadChat}
        onDelete={confirmDeleteSaved}
        onNew={startNewChat}
      />
      <SetupWizard visible={showWizard} onDone={finishWizard} />
      <HtmlPreview html={previewHtml} onClose={() => setPreviewHtml(null)} />
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  logo: { color: C.text, fontWeight: "800", fontSize: 16, letterSpacing: 1 },
  logoGroup: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 5 },
  headerButton: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.border, backgroundColor: C.bg2 },
  disabled: { opacity: 0.38 },
  agentBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, borderWidth: 1, borderColor: C.border, backgroundColor: C.bg2 },
  agentOn: { borderColor: C.accent, backgroundColor: C.bg3 },
  agentTxt: { fontSize: 12, fontWeight: "700" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, paddingHorizontal: 30 },
  emptyTitle: { color: C.text, fontSize: 20, fontWeight: "700", marginTop: 8 },
  emptySub: { color: C.text2, fontSize: 14, textAlign: "center", lineHeight: 21 },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: C.border,
    backgroundColor: C.bg2,
  },
  input: {
    flex: 1,
    color: C.text,
    fontSize: 15,
    maxHeight: 120,
    minHeight: 42,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: C.bg3,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: C.border,
  },
  send: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: C.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  sendStop: { backgroundColor: C.bg3, borderWidth: 1, borderColor: C.red },
});
