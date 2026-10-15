import { Ionicons } from "@expo/vector-icons";
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { type SavedChat } from "@/lib/chats";
import { C } from "@/lib/theme";

interface ChatHistoryModalProps {
  visible: boolean;
  chats: SavedChat[];
  activeChatId: string | null;
  onClose: () => void;
  onLoad: (chat: SavedChat) => void;
  onDelete: (chat: SavedChat) => void;
  onNew: () => void;
}

export function ChatHistoryModal({
  visible,
  chats,
  activeChatId,
  onClose,
  onLoad,
  onDelete,
  onNew,
}: ChatHistoryModalProps) {
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Conversas salvas</Text>
              <Text style={styles.subtitle}>{chats.length} salva(s) neste celular</Text>
            </View>
            <Pressable
              style={styles.iconButton}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Fechar conversas salvas"
            >
              <Ionicons name="close" size={21} color={C.text2} />
            </Pressable>
          </View>

          <Pressable
            style={styles.newButton}
            onPress={onNew}
            accessibilityRole="button"
            accessibilityLabel="Iniciar uma nova conversa"
          >
            <Ionicons name="add" size={18} color="#0a0a12" />
            <Text style={styles.newButtonText}>Nova conversa</Text>
          </Pressable>

          <FlatList
            data={chats}
            keyExtractor={(chat) => chat.id}
            contentContainerStyle={chats.length === 0 ? styles.emptyList : styles.list}
            ListEmptyComponent={<Text style={styles.emptyText}>Nenhuma conversa salva ainda.</Text>}
            renderItem={({ item }) => {
              const active = item.id === activeChatId;
              return (
                <View style={[styles.row, active && styles.rowActive]}>
                  <Pressable
                    style={styles.loadButton}
                    onPress={() => onLoad(item)}
                    accessibilityRole="button"
                    accessibilityLabel={`Abrir conversa salva ${item.title}`}
                  >
                    <Text style={styles.chatTitle} numberOfLines={1}>{item.title}</Text>
                    <Text style={styles.chatMeta}>
                      {new Date(item.updatedAt).toLocaleString()} · {item.messages.length} mensagem(ns)
                    </Text>
                  </Pressable>
                  <Pressable
                    style={styles.deleteButton}
                    onPress={() => onDelete(item)}
                    accessibilityRole="button"
                    accessibilityLabel={`Excluir conversa salva ${item.title}`}
                  >
                    <Ionicons name="trash-outline" size={18} color={C.red} />
                  </Pressable>
                </View>
              );
            }}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.72)",
  },
  sheet: {
    maxHeight: "82%",
    minHeight: "55%",
    padding: 18,
    backgroundColor: C.bg2,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderColor: C.border,
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  title: { color: C.text, fontSize: 20, fontWeight: "800" },
  subtitle: { color: C.text3, fontSize: 12, marginTop: 3 },
  iconButton: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: C.bg3 },
  newButton: { height: 44, borderRadius: 12, flexDirection: "row", gap: 7, alignItems: "center", justifyContent: "center", backgroundColor: C.accent, marginBottom: 12 },
  newButtonText: { color: "#0a0a12", fontSize: 14, fontWeight: "800" },
  list: { gap: 8, paddingBottom: 18 },
  emptyList: { flexGrow: 1, justifyContent: "center", alignItems: "center" },
  emptyText: { color: C.text3, fontSize: 14 },
  row: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: C.border, borderRadius: 12, backgroundColor: C.bg3 },
  rowActive: { borderColor: C.accent },
  loadButton: { flex: 1, paddingHorizontal: 13, paddingVertical: 12 },
  chatTitle: { color: C.text, fontSize: 14, fontWeight: "700" },
  chatMeta: { color: C.text3, fontSize: 11, marginTop: 4 },
  deleteButton: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
});
