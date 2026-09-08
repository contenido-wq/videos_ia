import fs from "fs";
import path from "path";
import { resolveChannel, listRecentVideos } from "./youtubeService";
import { analyzeChannel as analyzeChannelWithClaude } from "./channelAnalysisService";
import { editImage } from "./kieAiService";

const CHARACTER_REFERENCE_COUNT = 3;

function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildCharacterImagePrompt(description: string): string {
  return `Full-body character reference sheet of this exact recurring animated character: ${description}. Neutral standing pose, front-facing, arms relaxed at sides, plain flat light-gray background, no text, no other characters, no props.`;
}

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error("Uso: npm run analyze:channel -- <url-o-@handle-del-canal>");
    process.exit(1);
  }

  console.log(`Resolviendo canal "${input}"...`);
  const channel = await resolveChannel(input);
  console.log(`Canal: ${channel.title} (${channel.channelId})`);

  console.log("Listando videos recientes...");
  const { videos, usedFallback } = await listRecentVideos(channel);
  console.log(
    `${videos.length} videos analizados${
      usedFallback ? " (sin videos en los últimos 30 días, se usaron los más recientes)" : ""
    }.`,
  );

  console.log("Analizando temas y personaje con Claude...");
  const analysis = await analyzeChannelWithClaude(videos);

  const slug = slugify(channel.title);
  const outputDir = path.join("content", "canales", slug);
  fs.mkdirSync(outputDir, { recursive: true });

  let imageGenerated = false;
  let promptSaved = false;
  if (analysis.character.present && analysis.character.description) {
    const prompt = buildCharacterImagePrompt(analysis.character.description);
    const referenceUrls = videos.slice(0, CHARACTER_REFERENCE_COUNT).map((v) => v.thumbnailUrl);

    const promptFileContent = `${prompt}\n\nURLs de referencia usadas (pasalas como image_urls si lo generás manualmente en kie.ai u otra herramienta de edición de imagen con referencia):\n${referenceUrls
      .map((u) => `- ${u}`)
      .join("\n")}\n`;
    fs.writeFileSync(path.join(outputDir, "personaje-prompt.txt"), promptFileContent);
    promptSaved = true;

    console.log("Generando imagen de referencia del personaje...");
    try {
      await editImage(prompt, referenceUrls, path.join(outputDir, "personaje.png"), { aspectRatio: "3:2" });
      imageGenerated = true;
    } catch (err) {
      console.error("No se pudo generar la imagen del personaje:", (err as Error).message);
    }
  }

  const personajeMd = analysis.character.present
    ? `# Personaje — ${channel.title}\n\n${analysis.character.description}\n\n---\n\nEsta imagen fue generada a partir de las miniaturas reales de este canal. Si el canal no es tuyo, es solo referencia interna de moodboard — no publiques esta imagen ni una copia visualmente idéntica; usala para inspirarte en un personaje propio y distinto.\n`
    : `# Personaje — ${channel.title}\n\nEste canal no muestra un personaje visual consistente en la muestra analizada.\n`;
  fs.writeFileSync(path.join(outputDir, "personaje.md"), personajeMd);

  const analisisJson = {
    channel: { channelId: channel.channelId, title: channel.title, handle: channel.handle ?? null },
    videosAnalyzed: videos.map((v) => ({ videoId: v.videoId, title: v.title, publishedAt: v.publishedAt })),
    usedFallback,
    topics: analysis.topics,
    disclaimer: analysis.disclaimer,
    disclaimerNote:
      'Este texto complementa la descripción del video, pero NO reemplaza activar el toggle "Contenido alterado o sintético" en YouTube Studio al subir el video.',
  };
  fs.writeFileSync(path.join(outputDir, "analisis.json"), JSON.stringify(analisisJson, null, 2));

  console.log(`\nListo. Archivos guardados en ${outputDir}/:`);
  console.log(`  - analisis.json`);
  console.log(`  - personaje.md`);
  if (promptSaved) console.log(`  - personaje-prompt.txt`);
  if (imageGenerated) console.log(`  - personaje.png`);
  console.log(`\nTemas encontrados: ${analysis.topics.join(", ")}`);
}

main().catch((err) => {
  console.error("FALLÓ:", err.message);
  process.exit(1);
});
