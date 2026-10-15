import assert from "node:assert/strict";
import fs from "node:fs";

const chat = fs.readFileSync("app/(tabs)/index.tsx", "utf8");
const quartz = fs.readFileSync("lib/quartz.ts", "utf8");

for (const forbidden of [
  "You are Saient, a helpful AI assistant running entirely on this phone.",
  "You are Saient Build, an on-device web prototyper.",
  '{ text: "Delete",',
]) {
  assert.equal(chat.includes(forbidden), false, `chat still contains English runtime text: ${forbidden}`);
}

for (const required of [
  "Responda sempre em português do Brasil",
  "Você é o Saient Build",
]) {
  assert.equal(chat.includes(required), true, `missing PT-BR chat instruction: ${required}`);
}

for (const forbidden of [
  "The on-device engine isn’t running right now.",
  "Open the Models tab to download a model",
  "Quartz network error",
]) {
  assert.equal(quartz.includes(forbidden), false, `Quartz still contains English user-facing runtime text: ${forbidden}`);
}

for (const required of [
  "O motor local não está em execução agora.",
  "Abra a aba Modelos para baixar um modelo",
  "Erro de rede do Quartz",
]) {
  assert.equal(quartz.includes(required), true, `missing PT-BR Quartz runtime text: ${required}`);
}

console.log("chat PT-BR runtime contract passed");
