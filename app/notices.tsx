import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FALLBACK } from "@/lib/models";
import { C } from "@/lib/theme";

// License / attribution notices for the models we redistribute. Apache-2.0 (and MIT) require
// the license + copyright notice to travel with the software, so we ship them in-app here.
export default function NoticesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: 16, paddingTop: insets.top + 8, paddingBottom: 40 }}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={C.text} />
        </Pressable>
        <Text style={styles.h1}>Avisos de código aberto</Text>
      </View>

      <Text style={styles.intro}>
        Os fluxos de conversa Quartz e SDXL do Saient são desenvolvidos internamente. O vídeo Wan experimental usa um
        backend stable-diffusion.cpp/ggml fixado. Os modelos baixados continuam sendo pesos abertos de terceiros
        sob suas próprias licenças:
      </Text>

      {FALLBACK.map((m) => (
        <View key={m.id} style={styles.card}>
          <Text style={styles.name}>{m.name}</Text>
          <Text style={styles.meta}>{m.params} · {m.quant} · {m.license}</Text>
          <Text style={styles.copy}>
            © Alibaba Cloud, Qwen team. Licenciado sob Apache License 2.0. Quantização GGUF publicada pela ggml-org.
          </Text>
          {m.licenseUrl ? (
            <Pressable onPress={() => WebBrowser.openBrowserAsync(m.licenseUrl!)}>
              <Text style={styles.link}>Ver licença do modelo →</Text>
            </Pressable>
          ) : null}
        </View>
      ))}

      <View style={styles.card}>
        <Text style={styles.name}>Stable Diffusion XL base 1.0</Text>
        <Text style={styles.meta}>FP16 · CreativeML Open RAIL++-M</Text>
        <Text style={styles.copy}>
          Pesos base SDXL publicados pela Stability AI. O Saient distribui os componentes FP16 usados pelo Quartz.
        </Text>
        <Pressable onPress={() => WebBrowser.openBrowserAsync("https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/blob/main/LICENSE.md")}>
          <Text style={styles.link}>Ver licença do SDXL →</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.name}>SDXL VAE FP16 Fix</Text>
        <Text style={styles.meta}>FP16 · MIT</Text>
        <Text style={styles.copy}>
          Pesos VAE SDXL compatíveis com FP16 publicados por madebyollin, usados para evitar a instabilidade numérica do VAE FP16 original.
        </Text>
        <Pressable onPress={() => WebBrowser.openBrowserAsync("https://huggingface.co/madebyollin/sdxl-vae-fp16-fix")}>
          <Text style={styles.link}>Ver modelo VAE e licença →</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.name}>Wan2.1 T2V 1.3B + UMT5 XXL encoder</Text>
        <Text style={styles.meta}>Q4_K / Q2_K ultra-low-memory pack · Apache License 2.0</Text>
        <Text style={styles.copy}>
          Os pesos de vídeo Wan são publicados pela equipe Wan. A conversão do codificador UMT5 GGUF é publicada por city96.
        </Text>
        <Pressable onPress={() => WebBrowser.openBrowserAsync("https://huggingface.co/Wan-AI/Wan2.1-T2V-1.3B") }>
          <Text style={styles.link}>Ver modelo Wan e licença →</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.name}>stable-diffusion.cpp</Text>
        <Text style={styles.meta}>Wan inference backend · MIT</Text>
        <Text style={styles.copy}>
          Copyright © 2023 leejet and contributors. O Saient inclui um build arm64 Vulkan fixado e ajustado localmente para inferência experimental de vídeo.
        </Text>
        <Pressable onPress={() => WebBrowser.openBrowserAsync("https://github.com/leejet/stable-diffusion.cpp/blob/master/LICENSE") }>
          <Text style={styles.link}>Ver licença do backend →</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.name}>Apache License 2.0</Text>
        <Text style={styles.copy}>
          O texto completo da licença Apache 2.0 rege os modelos acima. Você pode usar, modificar e redistribuir
          esses modelos conforme os termos da licença, mantendo este aviso.
        </Text>
        <Pressable onPress={() => WebBrowser.openBrowserAsync("https://www.apache.org/licenses/LICENSE-2.0")}>
          <Text style={styles.link}>Ler a licença Apache 2.0 completa →</Text>
        </Pressable>
      </View>

      <Text style={styles.foot}>Motor Quartz © StaticPlay. Atribuição do backend Wan acima. Tudo é executado no seu aparelho.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  h1: { color: C.text, fontSize: 22, fontWeight: "800" },
  intro: { color: C.text2, fontSize: 14, lineHeight: 20, marginBottom: 16 },
  card: { padding: 14, backgroundColor: C.bg2, borderWidth: 1, borderColor: C.border, borderRadius: 12, marginBottom: 10 },
  name: { color: C.text, fontSize: 15, fontWeight: "700" },
  meta: { color: C.accent, fontSize: 11, fontFamily: "monospace", marginTop: 2 },
  copy: { color: C.text2, fontSize: 13, lineHeight: 19, marginTop: 8 },
  link: { color: C.accent, fontSize: 13, fontWeight: "600", marginTop: 10 },
  foot: { color: C.text3, fontSize: 12, textAlign: "center", marginTop: 18, lineHeight: 18 },
});
