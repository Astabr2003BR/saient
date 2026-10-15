import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { C } from "@/lib/theme";

// A code/document artifact rendered as its own card (not crammed in a chat bubble): a header
// with the language + a copy button, and a horizontally-scrollable monospace body. HTML artifacts
// also get a Preview button (wired by the parent to a sandboxed WebView).
export function Artifact({ lang, code, onPreview }: { lang: string; code: string; onPreview?: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await Clipboard.setStringAsync(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const lineCount = code.split("\n").length;
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Ionicons name="code-slash" size={14} color={C.accent} />
        <Text style={styles.lang}>{lang || "código"}</Text>
        <Text style={styles.meta}>· {lineCount} {lineCount === 1 ? "linha" : "linhas"}</Text>
        <View style={{ flex: 1 }} />
        {onPreview && (
          <Pressable onPress={onPreview} style={styles.copyBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel="Prévia">
            <Ionicons name="eye-outline" size={14} color={C.accent} />
            <Text style={[styles.copyTxt, { color: C.accent }]}>Prévia</Text>
          </Pressable>
        )}
        <Pressable onPress={copy} style={styles.copyBtn} hitSlop={8}>
          <Ionicons name={copied ? "checkmark" : "copy-outline"} size={14} color={copied ? C.green : C.text2} />
          <Text style={[styles.copyTxt, copied && { color: C.green }]}>{copied ? "Copiado" : "Copiar"}</Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.bodyInner}>
        <Text style={styles.code}>{code}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginVertical: 6, marginHorizontal: 2, borderWidth: 1, borderColor: C.border, borderRadius: 12, backgroundColor: C.bg3, overflow: "hidden" },
  head: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border, backgroundColor: C.bg2 },
  lang: { color: C.accent, fontSize: 12, fontWeight: "700", fontFamily: "monospace" },
  meta: { color: C.text3, fontSize: 11 },
  copyBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  copyTxt: { color: C.text2, fontSize: 12, fontWeight: "600" },
  bodyInner: { padding: 12 },
  code: { color: C.text, fontSize: 13, fontFamily: "monospace", lineHeight: 19 },
});
