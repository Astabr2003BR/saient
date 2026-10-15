export const DEFAULT_MAX_SEGMENT_CHARS = 220;

export type NarrationSegment = {
  id: string;
  order: number;
  text: string;
};

export type TimedCaption = NarrationSegment & {
  startMs: number;
  endMs: number;
};

function normalizeInput(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sentenceCandidates(text: string): string[] {
  const out: string[] = [];
  for (const paragraph of text.split(/\n+/u)) {
    const matches = paragraph.match(/[^.!?…]+(?:[.!?…]+|$)/gu) ?? [];
    for (const match of matches) {
      const value = match.trim();
      if (value) out.push(value);
    }
  }
  return out;
}

function splitLongText(text: string, maxChars: number): string[] {
  const pieces: string[] = [];
  let remaining = text.trim();

  while (remaining.length > maxChars) {
    const window = remaining.slice(0, maxChars + 1);
    let cut = -1;

    for (const separator of [", ", "; ", ": ", " "]) {
      const index = window.lastIndexOf(separator);
      if (index >= Math.floor(maxChars * 0.5)) {
        cut = index + (separator === " " ? 0 : 1);
        break;
      }
    }

    if (cut <= 0) cut = maxChars;

    const piece = remaining.slice(0, cut).trim();
    if (piece) pieces.push(piece);
    remaining = remaining.slice(cut).trim();
  }

  if (remaining) pieces.push(remaining);
  return pieces;
}

export function segmentNarration(
  input: string,
  maxChars = DEFAULT_MAX_SEGMENT_CHARS,
): NarrationSegment[] {
  if (!Number.isInteger(maxChars) || maxChars < 40 || maxChars > 1000) {
    throw new RangeError("maxChars must be an integer between 40 and 1000");
  }

  const normalized = normalizeInput(input);
  if (!normalized) return [];

  const chunks = sentenceCandidates(normalized).flatMap((sentence) =>
    splitLongText(sentence, maxChars),
  );

  return chunks.map((text, index) => ({
    id: `seg-${String(index + 1).padStart(3, "0")}`,
    order: index,
    text,
  }));
}

export function buildCaptionTimeline(
  segments: NarrationSegment[],
  durationsMs: number[],
  gapMs = 80,
): TimedCaption[] {
  if (segments.length !== durationsMs.length) {
    throw new RangeError("segments and durationsMs must have the same length");
  }
  if (!Number.isFinite(gapMs) || gapMs < 0 || gapMs > 10_000) {
    throw new RangeError("gapMs must be between 0 and 10000");
  }

  let cursor = 0;
  return segments.map((segment, index) => {
    const duration = durationsMs[index];
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new RangeError(`durationsMs[${index}] must be a positive finite number`);
    }

    const startMs = Math.round(cursor);
    const endMs = Math.round(cursor + duration);
    cursor = endMs + gapMs;

    return {
      ...segment,
      startMs,
      endMs,
    };
  });
}
