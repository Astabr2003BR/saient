// Chat routing: on-device Quartz only.
//
// A Quartz server binary runs ON the phone bound to 127.0.0.1, exposing the
// same OpenAI-compatible SSE API the desktop uses. This client just streams
// from it — identical contract to Saient desktop.
//
export const QUARTZ_BASE = "http://127.0.0.1:18799";

export type Role = "system" | "user" | "assistant";
export interface ChatMsg { role: Role; content: string }

/** Is the on-device Quartz server up? (Phase 0: always false → mock path.) */
export async function quartzReady(): Promise<boolean> {
  try {
    const r = await fetch(`${QUARTZ_BASE}/health`, { method: "GET" });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Stream a chat completion. Calls `onToken` for each chunk.
 * Falls back to a typed-out mock reply when the engine isn't present yet.
 */
export async function quartzChat(
  messages: ChatMsg[],
  onToken: (t: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (await quartzReady()) {
    await streamReal(messages, onToken, signal);
  } else {
    await streamMock(messages, onToken, signal);
  }
}

// ── Real engine (SSE, OpenAI-compatible — same as desktop Quartz) ────────────────
// React Native's fetch has no streaming body (res.body is null), so we use XHR and
// parse the incrementally-growing responseText on each onprogress tick — the reliable
// way to consume Server-Sent Events in RN / Expo Go.
export function createVisibleTokenSink(onToken: (t: string) => void) {
  const start = "<think>";
  const end = "</think>";
  let pending = "";
  let thinking = false;
  let emitted = false;
  let closed = false;

  const markerPrefixAtEnd = (text: string, marker: string) => {
    const max = Math.min(text.length, marker.length - 1);
    for (let n = max; n > 0; n--) {
      if (text.endsWith(marker.slice(0, n))) return n;
    }
    return 0;
  };

  const emit = (text: string) => {
    if (!emitted) text = text.trimStart();
    if (!text) return;
    emitted = true;
    onToken(text);
  };

  const push = (piece: string) => {
    if (closed) return;
    pending += piece;
    while (pending) {
      const marker = thinking ? end : start;
      const markerAt = pending.indexOf(marker);
      if (markerAt >= 0) {
        if (!thinking) emit(pending.slice(0, markerAt));
        pending = pending.slice(markerAt + marker.length);
        thinking = !thinking;
        continue;
      }

      const held = markerPrefixAtEnd(pending, marker);
      const settled = pending.slice(0, pending.length - held);
      if (!thinking) emit(settled);
      pending = pending.slice(pending.length - held);
      break;
    }
  };

  const flush = () => {
    if (closed) return;
    if (!thinking) emit(pending);
    pending = "";
    closed = true;
  };

  return { push, flush };
}

function streamReal(messages: ChatMsg[], onToken: (t: string) => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${QUARTZ_BASE}/v1/chat/completions`);
    xhr.setRequestHeader("Content-Type", "application/json");

    let consumed = 0; // chars of responseText already moved into `buf`
    let buf = "";
    let resolved = false;
    const visible = createVisibleTokenSink(onToken);
    const finish = () => { if (!resolved) { resolved = true; resolve(); } };

    const drain = () => {
      const text = xhr.responseText;
      if (text.length <= consumed) return;
      buf += text.slice(consumed);
      consumed = text.length;
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") { visible.flush(); finish(); return; }
        try {
          const piece = JSON.parse(data)?.choices?.[0]?.delta?.content;
          if (piece) visible.push(piece);
        } catch {
          /* ignore keep-alives / partial lines */
        }
      }
    };

    xhr.onprogress = drain;
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) { reject(new Error(`Quartz HTTP ${xhr.status}`)); return; }
      drain();
      visible.flush();
      finish();
    };
    xhr.onerror = () => reject(new Error("Erro de rede do Quartz"));
    if (signal) {
      if (signal.aborted) { xhr.abort(); finish(); return; }
      signal.addEventListener("abort", () => { xhr.abort(); finish(); });
    }
    xhr.send(JSON.stringify({ messages, stream: true }));
  });
}

// ── Fallback when the engine isn't serving (no model yet, still loading, or unloaded to save
// battery). Kept deliberately generic so it's accurate whichever the cause is. ────────────────
async function streamMock(_messages: ChatMsg[], onToken: (t: string) => void, signal?: AbortSignal) {
  const reply =
    "O motor local não está em execução agora. Abra a aba Modelos para baixar um modelo, " +
    "ou toque em Carregar caso tenha descarregado o modelo para economizar bateria. Tudo funciona localmente no seu celular — sem nuvem e sem chaves de API.";
  for (const word of reply.split(/(\s+)/)) {
    if (signal?.aborted) return;
    onToken(word);
    await new Promise((r) => setTimeout(r, 18));
  }
}
