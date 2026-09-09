import fs from "fs";
import os from "os";
import path from "path";
import { resolveChannel, listRecentVideos } from "./youtubeService";
import { analyzeChannel as analyzeChannelWithClaude } from "./channelAnalysisService";
import { editImage } from "./kieAiService";
import { buildChannelReportPdf } from "./channelReportPdfService";

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

  console.log("Analizando temas, personaje y títulos con Claude...");
  const analysis = await analyzeChannelWithClaude(videos);

  let characterImageBuffer: Buffer | null = null;
  let characterImagePrompt: string | null = null;
  if (analysis.character.present && analysis.character.description) {
    characterImagePrompt = buildCharacterImagePrompt(analysis.character.description);
    const referenceUrls = videos.slice(0, CHARACTER_REFERENCE_COUNT).map((v) => v.thumbnailUrl);
    const tempImagePath = path.join(os.tmpdir(), `personaje-${Date.now()}.png`);

    console.log("Generando imagen de referencia del personaje...");
    try {
      await editImage(characterImagePrompt, referenceUrls, tempImagePath, { aspectRatio: "3:2" });
      characterImageBuffer = fs.readFileSync(tempImagePath);
      fs.unlinkSync(tempImagePath);
    } catch (err) {
      console.error("No se pudo generar la imagen del personaje:", (err as Error).message);
    }
  }

  console.log("Armando el PDF del reporte...");
  const pdfBuffer = await buildChannelReportPdf({
    channel,
    analysis,
    characterImageBuffer,
    characterImagePrompt,
  });

  const slug = slugify(channel.title);
  const outputDir = path.join("content", "canales", slug);
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, "reporte.pdf");
  fs.writeFileSync(outputPath, pdfBuffer);

  console.log(`\nListo. Reporte guardado en ${outputPath}`);
  console.log(`\nTemas encontrados: ${analysis.topics.join(", ")}`);
}

main().catch((err) => {
  console.error("FALLÓ:", err.message);
  process.exit(1);
});
