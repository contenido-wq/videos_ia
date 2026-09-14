import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { parseNarrationSections } from "./voiceOverVideoService";

const execFileAsync = promisify(execFile);

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

async function main() {
  const [scriptPath, slug] = process.argv.slice(2);
  if (!scriptPath || !slug) {
    console.error("Uso: tsx verifyVoiceOverEpisode.ts <guion.md> <slug>");
    process.exit(1);
  }

  const markdown = fs.readFileSync(scriptPath, "utf-8");
  const sections = parseNarrationSections(markdown);
  const audioDir = path.join(process.cwd(), "public", "assets", slug, "audio");

  let totalScriptWords = 0;
  let totalMatchedWords = 0;
  let totalDurationSeconds = 0;
  const problems: string[] = [];

  for (const section of sections) {
    const wordsPath = path.join(audioDir, `${section.id}.words.json`);
    const audioPath = path.join(audioDir, `${section.id}.mp3`);
    if (!fs.existsSync(wordsPath) || !fs.existsSync(audioPath)) {
      problems.push(`${section.id}: falta audio o transcripción generada`);
      continue;
    }
    const words: { text: string; start: number; end: number }[] = JSON.parse(fs.readFileSync(wordsPath, "utf-8"));
    const generatedText = normalize(words.map((w) => w.text).join(" "));
    const scriptText = normalize(section.text);

    const scriptWords = scriptText.split(" ");
    const generatedWords = new Set(generatedText.split(" "));
    const matched = scriptWords.filter((w) => generatedWords.has(w)).length;
    totalScriptWords += scriptWords.length;
    totalMatchedWords += matched;

    const matchRatio = matched / scriptWords.length;
    if (matchRatio < 0.85) {
      problems.push(`${section.id}: coincidencia baja con el guion (${(matchRatio * 100).toFixed(0)}%) — posible corte o alucinación de la voz`);
    }

    const duration = words.length > 0 ? words[words.length - 1].end : 0;
    totalDurationSeconds += duration;
    const wpm = duration > 0 ? (scriptWords.length / duration) * 60 : 0;
    if (wpm > 0 && (wpm < 90 || wpm > 220)) {
      problems.push(`${section.id}: ritmo de habla inusual (${wpm.toFixed(0)} palabras/min) — revisar manualmente`);
    }
  }

  const fullAudioPath = path.join(process.cwd(), "public", "assets", slug, "narration-full.mp3");
  let maxVolumeDb: number | null = null;
  if (fs.existsSync(fullAudioPath)) {
    try {
      const { stderr } = await execFileAsync("ffmpeg", ["-i", fullAudioPath, "-af", "volumedetect", "-f", "null", "-"]);
      const match = stderr.match(/max_volume:\s*(-?[\d.]+)\s*dB/);
      if (match) maxVolumeDb = parseFloat(match[1]);
    } catch {
      // ignore, se reporta como null abajo
    }
  } else {
    problems.push("narration-full.mp3 no existe");
  }

  console.log(`\n=== Verificación de ${slug} ===`);
  console.log(`Coincidencia texto guion vs. transcripción real: ${((totalMatchedWords / totalScriptWords) * 100).toFixed(1)}%`);
  console.log(`Duración total (suma de secciones): ${(totalDurationSeconds / 60).toFixed(1)} min`);
  console.log(`Volumen pico (max_volume): ${maxVolumeDb === null ? "no medido" : maxVolumeDb.toFixed(1) + " dB"}`);
  if (maxVolumeDb !== null && maxVolumeDb < -20) {
    problems.push(`Volumen pico muy bajo (${maxVolumeDb.toFixed(1)} dB) — posible audio silencioso o corrupto`);
  }

  if (problems.length === 0) {
    console.log("Sin problemas detectados.");
  } else {
    console.log("Problemas detectados:");
    for (const p of problems) console.log(` - ${p}`);
  }
}

main().catch((err) => {
  console.error("FALLÓ:", err.message);
  process.exit(1);
});
