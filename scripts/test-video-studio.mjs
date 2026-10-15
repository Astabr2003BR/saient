import assert from "node:assert/strict";
import {
  buildCaptionTimeline,
  segmentNarration,
} from "../lib/video-studio/script.ts";

assert.deepEqual(segmentNarration("   \n\t  "), []);

const basic = segmentNarration("Olá, mundo. Tudo bem? Vamos criar o vídeo!");
assert.deepEqual(
  basic.map((segment) => segment.text),
  ["Olá, mundo.", "Tudo bem?", "Vamos criar o vídeo!"],
);
assert.deepEqual(
  basic.map((segment) => segment.id),
  ["seg-001", "seg-002", "seg-003"],
);

const multiline = segmentNarration("Primeira fala.\nSegunda fala sem pontuação");
assert.deepEqual(
  multiline.map((segment) => segment.text),
  ["Primeira fala.", "Segunda fala sem pontuação"],
);

const longText = "Este é um trecho muito longo, com várias palavras para garantir que a divisão respeite o limite configurado sem perder conteúdo importante no processo.";
const split = segmentNarration(longText, 60);
assert.ok(split.length > 1);
assert.ok(split.every((segment) => segment.text.length <= 60));
assert.equal(split.map((segment) => segment.text).join(" ").replace(/\s+/g, " ").trim(), longText);

assert.throws(() => segmentNarration("teste", 39), RangeError);
assert.throws(() => segmentNarration("teste", 1001), RangeError);

const captions = buildCaptionTimeline(basic.slice(0, 2), [1000, 500], 80);
assert.deepEqual(
  captions.map(({ startMs, endMs }) => [startMs, endMs]),
  [[0, 1000], [1080, 1580]],
);
assert.equal(captions[0].text, "Olá, mundo.");

assert.throws(() => buildCaptionTimeline(basic, [1000]), RangeError);
assert.throws(() => buildCaptionTimeline(basic.slice(0, 1), [0]), RangeError);
assert.throws(() => buildCaptionTimeline(basic.slice(0, 1), [1000], -1), RangeError);

console.log("video studio narration segmentation and caption timing contracts passed");
