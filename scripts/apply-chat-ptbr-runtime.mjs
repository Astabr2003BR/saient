import fs from "node:fs";

function replaceRequired(file, from, to) {
  let source = fs.readFileSync(file, "utf8");
  if (source.includes(from)) {
    source = source.split(from).join(to);
    fs.writeFileSync(file, source);
    console.log(`${file}: tradução aplicada`);
    return;
  }
  if (!source.includes(to)) {
    throw new Error(`${file}: texto esperado não encontrado: ${from}`);
  }
  console.log(`${file}: já estava traduzido`);
}

replaceRequired(
  "app/(tabs)/index.tsx",
  'const SYSTEM = "You are Saient, a helpful AI assistant running entirely on this phone. Be concise and friendly.\\n/no_think";',
  'const SYSTEM = "Você é o Saient, um assistente de IA útil que roda inteiramente neste celular. Responda sempre em português do Brasil, de forma clara e concisa.\\n/no_think";',
);

replaceRequired(
  "app/(tabs)/index.tsx",
  '"You are Saient Build, an on-device web prototyper. When the user describes a page, screen, UI, or " +',
  '"Você é o Saient Build, um criador local de protótipos web. Responda sempre em português do Brasil. Quando o usuário descrever uma página, tela, interface ou " +',
);
replaceRequired(
  "app/(tabs)/index.tsx",
  '"component, reply with ONE self-contained HTML document inside a single ```html code block: put CSS in " +',
  '"componente, responda com UM documento HTML autocontido dentro de um único bloco ```html: coloque o CSS em " +',
);
replaceRequired(
  "app/(tabs)/index.tsx",
  '"an inline <style> tag and any JS in an inline <script> tag, and use NO external files, CDNs, fonts, or " +',
  '"uma tag <style> interna e qualquer JS em uma tag <script> interna; NÃO use arquivos externos, CDNs, fontes ou " +',
);
replaceRequired(
  "app/(tabs)/index.tsx",
  '"image URLs (use inline SVG or CSS instead). Make it clean and modern. Add at most one short sentence " +',
  '"URLs de imagens (use SVG inline ou CSS). Faça uma interface limpa e moderna. Adicione no máximo uma frase curta " +',
);
replaceRequired(
  "app/(tabs)/index.tsx",
  '"before the code block, and nothing after it.\\n/no_think";',
  '"antes do bloco de código e nada depois dele.\\n/no_think";',
);

replaceRequired(
  "app/(tabs)/index.tsx",
  '{ text: "Delete",',
  '{ text: "Excluir",',
);

replaceRequired(
  "lib/quartz.ts",
  '"The on-device engine isn’t running right now. Open the Models tab to download a model, " +',
  '"O motor local não está em execução agora. Abra a aba Modelos para baixar um modelo, " +',
);
replaceRequired(
  "lib/quartz.ts",
  '"or tap Load there if you unloaded it to save battery. Everything runs offline on your phone — no cloud, no API keys.";',
  '"ou toque em Carregar caso tenha descarregado o modelo para economizar bateria. Tudo funciona localmente no seu celular — sem nuvem e sem chaves de API.";',
);
replaceRequired(
  "lib/quartz.ts",
  'new Error("Quartz network error")',
  'new Error("Erro de rede do Quartz")',
);
