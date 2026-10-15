import { Ionicons } from "@expo/vector-icons";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { C } from "@/lib/theme";

// Renders model-generated HTML in a sandboxed WebView. Locked down because the content is
// model-authored: no JS bridge back to the app (no onMessage / injectedJavaScript), no file access,
// and navigation is confined to about:/data: so a generated page can't reach the filesystem, the
// network, or app internals. JavaScript itself stays on — mockups need it to be interactive.
export function HtmlPreview({ html, onClose }: { html: string | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={html != null} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.bar}>
          <Ionicons name="eye-outline" size={18} color={C.accent} />
          <Text style={styles.title}>Prévia</Text>
          <View style={{ flex: 1 }} />
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Fechar prévia">
            <Ionicons name="close" size={26} color={C.text} />
          </Pressable>
        </View>
        {html != null && (
          <WebView
            style={styles.web}
            containerStyle={styles.web}
            originWhitelist={["about:*", "data:*"]}
            source={{ html }}
            javaScriptEnabled
            allowFileAccess={false}
            allowFileAccessFromFileURLs={false}
            allowUniversalAccessFromFileURLs={false}
            setSupportMultipleWindows={false}
            onShouldStartLoadWithRequest={(req) =>
              req.url === "about:blank" || req.url.startsWith("about:") || req.url.startsWith("data:")
            }
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor: C.bg2,
  },
  title: { color: C.text, fontSize: 16, fontWeight: "700" },
  web: { flex: 1, backgroundColor: "#ffffff" },
});
