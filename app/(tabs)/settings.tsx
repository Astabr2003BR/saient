import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Mascot } from "@/components/Mascot";
import { C } from "@/lib/theme";

function Row({ icon, label, value, onPress }: { icon: any; label: string; value?: string; onPress?: () => void }) {
  return (
    <Pressable style={styles.row} onPress={onPress} disabled={!onPress}>
      <Ionicons name={icon} size={18} color={C.text2} />
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={{ flex: 1 }} />
      {value ? <Text style={styles.rowValue}>{value}</Text> : null}
      {onPress ? <Ionicons name="chevron-forward" size={16} color={C.text3} /> : null}
    </Pressable>
  );
}

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const version = Constants.expoConfig?.version ?? "0.1.0";

  return (
    <ScrollView style={[styles.root, { paddingTop: insets.top }]} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <View style={styles.hero}>
        <Mascot size={26} />
        <Text style={styles.brand}>SAIENT</Text>
        <Text style={styles.tag}>IA local no seu bolso.</Text>
      </View>

      <Text style={styles.section}>Motor</Text>
      <View style={styles.group}>
        <Row icon="flash" label="Motor de inferência" value="Quartz" />
        <Row icon="hardware-chip" label="Executa em" value="Este aparelho" />
      </View>

      <Text style={styles.section}>Sobre</Text>
      <View style={styles.group}>
        <Row icon="information-circle" label="Versão" value={version} />
        <Row
          icon="globe"
          label="Site"
          onPress={() => WebBrowser.openBrowserAsync("https://saient.co.uk")}
        />
        <Row
          icon="desktop"
          label="Saient para computador"
          onPress={() => WebBrowser.openBrowserAsync("https://saient.co.uk/#download")}
        />
        <Row
          icon="shield-checkmark"
          label="Privacidade"
          onPress={() => WebBrowser.openBrowserAsync("https://saient.co.uk/privacy")}
        />
        <Row
          icon="document-text"
          label="Avisos de código aberto"
          onPress={() => router.push("/notices")}
        />
      </View>

      <Text style={styles.foot}>Tudo é executado no seu celular. Nada é enviado para a nuvem.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  hero: { alignItems: "center", gap: 6, paddingVertical: 20 },
  brand: { color: C.text, fontSize: 18, fontWeight: "800", letterSpacing: 1, marginTop: 8 },
  tag: { color: C.text2, fontSize: 13 },
  section: {
    color: C.text3,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 18,
    marginBottom: 8,
    marginLeft: 4,
  },
  group: { backgroundColor: C.bg2, borderWidth: 1, borderColor: C.border, borderRadius: 12, overflow: "hidden" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  rowLabel: { color: C.text, fontSize: 15 },
  rowValue: { color: C.text2, fontSize: 14, fontFamily: "monospace" },
  foot: { color: C.text3, fontSize: 12, textAlign: "center", marginTop: 24, lineHeight: 18 },
});
