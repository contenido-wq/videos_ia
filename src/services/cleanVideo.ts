import path from "path";
import { prepareTrimmedVideo } from "./rawVideoCleaningService";

async function main() {
  const rawVideoPath = process.argv[2];
  const slug = process.argv[3];
  if (!rawVideoPath || !slug) {
    console.error("Uso: npm run clean:video -- <ruta-al-video> <slug>");
    process.exit(1);
  }

  const result = await prepareTrimmedVideo({ slug, rawVideoPath: path.resolve(rawVideoPath) });
  console.log(`\nListo. Video limpio: public/${result.videoPath}`);
  console.log(`Duración final: ${result.durationInSeconds.toFixed(1)}s`);
}

main().catch((err) => {
  console.error("FALLÓ:", err.message);
  process.exit(1);
});
