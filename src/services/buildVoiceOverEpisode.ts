import path from "path";
import { buildVoiceOverEpisode } from "./voiceOverVideoService";

async function main() {
  const [scriptPath, imagePath, slug, voiceId] = process.argv.slice(2);
  if (!scriptPath || !imagePath || !slug) {
    console.error("Uso: npm run build:voiceover-episode -- <guion.md> <imagen.jpg> <slug> [voiceId]");
    process.exit(1);
  }

  const outputVideoPath = path.join(process.cwd(), "out", `${slug}.mp4`);
  const result = await buildVoiceOverEpisode({
    slug,
    scriptMarkdownPath: path.resolve(scriptPath),
    imagePath: path.resolve(imagePath),
    voiceId: voiceId ?? "U1nBX3lzKSM937PaYYfk",
    outputVideoPath,
  });

  console.log(`\nListo. Video: ${result.videoPath}`);
  console.log(`Duración: ${result.durationInSeconds.toFixed(1)}s (${(result.durationInSeconds / 60).toFixed(1)} min)`);
}

main().catch((err) => {
  console.error("FALLÓ:", err.message);
  process.exit(1);
});
