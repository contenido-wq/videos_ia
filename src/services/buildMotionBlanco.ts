import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { prepareTrimmedVideo } from "./rawVideoCleaningService";
import { getVideoDurationInSeconds, measureIntegratedLufs, normalizeVideoAudio } from "./ffmpegService";
import { buildCaptionChunks } from "./captionChunkService";
import type { TranscribedWord } from "./checklistSyncService";
import type {
  MotionBlancoPlan,
  RenderedMotionBlancoGraphic,
  RenderedMotionBlancoGuion,
} from "../types/guion";

const execFileAsync = promisify(execFile);
const PUBLIC_DIR = path.join(process.cwd(), "public");

// El gráfico entra un pelín antes de la palabra que lo dispara y sale un pelín después.
const GRAPHIC_LEAD_SECONDS = 0.12;
const GRAPHIC_TAIL_SECONDS = 0.2;
// Encuadres del presentador: alterna plano normal y punch-in en cada frase nueva.
const WIDE_SCALE = 1.04;
const CLOSE_SCALE = 1.18;
// Voz al nivel de Instagram/TikTok y música siempre bastante por debajo de la voz.
const VOICE_TARGET_LUFS = -14;
const MUSIC_BELOW_VOICE_DB = 18;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ ]/g, "")
    .trim();
}

/** Índice de la primera y última palabra de `phrase` en `words`, buscando desde `fromIndex`. */
function findPhrase(words: TranscribedWord[], phrase: string, fromIndex: number): [number, number] {
  const target = normalize(phrase).split(/\s+/);
  const normalized = words.map((w) => normalize(w.text));
  for (let i = fromIndex; i <= normalized.length - target.length; i++) {
    if (target.every((t, k) => normalized[i + k] === t)) return [i, i + target.length - 1];
  }
  throw new Error(`No se encontró la frase "${phrase}" en la transcripción (desde la palabra ${fromIndex})`);
}

async function makeProxy(inputPath: string, outputPath: string): Promise<void> {
  if (fs.existsSync(outputPath)) {
    console.log("proxy 1080x1920 ya existe, se reutiliza");
    return;
  }
  console.log("creando proxy 1080x1920 H.264 para Remotion...");
  await execFileAsync("ffmpeg", [
    "-y",
    "-i", inputPath,
    "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920",
    "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k",
    outputPath,
  ], { maxBuffer: 1024 * 1024 * 64 });
}

function copyAsset(from: string, slug: string, relTarget: string): string {
  const target = path.join(PUBLIC_DIR, "assets", slug, relTarget);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!fs.existsSync(target)) fs.copyFileSync(from, target);
  return path.relative(PUBLIC_DIR, target).split(path.sep).join("/");
}

async function main() {
  const rawVideoPath = process.argv[2];
  const slug = process.argv[3];
  if (!rawVideoPath || !slug) {
    console.error("Uso: npx tsx src/services/buildMotionBlanco.ts <ruta-al-video> <slug>");
    process.exit(1);
  }

  const plan = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "content", "motion-blanco", `${slug}.json`), "utf-8"),
  ) as MotionBlancoPlan;

  const trimmed = await prepareTrimmedVideo({ slug, rawVideoPath: path.resolve(rawVideoPath) });
  const words = trimmed.words;

  const proxyAbsPath = path.join(PUBLIC_DIR, "assets", slug, "video", "proxy-1080.mp4");
  await makeProxy(path.join(PUBLIC_DIR, trimmed.videoPath), proxyAbsPath);
  const normalizedAbsPath = path.join(PUBLIC_DIR, "assets", slug, "video", "proxy-1080-norm.mp4");
  if (!fs.existsSync(normalizedAbsPath)) {
    console.log(`normalizando voz a ${VOICE_TARGET_LUFS} LUFS...`);
    await normalizeVideoAudio(proxyAbsPath, normalizedAbsPath, VOICE_TARGET_LUFS);
  }
  const durationInSeconds = await getVideoDurationInSeconds(normalizedAbsPath);

  const [, titleEnd] = findPhrase(words, plan.title.toPhrase, 0);

  let cursor = 0;
  const graphics: RenderedMotionBlancoGraphic[] = plan.graphics.map((g) => {
    const [fromIdx] = findPhrase(words, g.fromPhrase, cursor);
    const [, toIdx] = findPhrase(words, g.toPhrase, fromIdx);
    cursor = toIdx + 1;
    const startSeconds = Math.max(0, words[fromIdx].start - GRAPHIC_LEAD_SECONDS);
    const endSeconds = Math.min(durationInSeconds, words[toIdx].end + GRAPHIC_TAIL_SECONDS);
    const at = (phrase: string) => words[findPhrase(words, phrase, fromIdx)[0]].start;
    return {
      id: g.id,
      kind: g.kind,
      startSeconds,
      durationInSeconds: endSeconds - startSeconds,
      title: g.title,
      body: g.body,
      note: g.note,
      noteAtSeconds: g.notePhrase ? at(g.notePhrase) : undefined,
      reveals: (g.reveals ?? []).map((r) => ({ text: r.text, atSeconds: at(r.atPhrase) })),
    };
  });

  // Dos gráficos seguidos no se pisan: el anterior corta justo cuando entra el siguiente.
  graphics.forEach((g, i) => {
    const next = graphics[i + 1];
    if (next && g.startSeconds + g.durationInSeconds > next.startSeconds) {
      g.durationInSeconds = next.startSeconds - g.startSeconds;
    }
  });

  // Jump cut en cada inicio de frase y al volver de cada gráfico, alternando encuadre.
  const cutPoints = new Set<number>([0]);
  words.forEach((w, i) => {
    const prev = words[i - 1];
    if (prev && /[.?!]$/.test(prev.text)) cutPoints.add(Math.max(0, w.start - 0.05));
  });
  graphics.forEach((g) => cutPoints.add(g.startSeconds + g.durationInSeconds));
  const jumpCuts = [...cutPoints]
    .sort((a, b) => a - b)
    .map((atSeconds, i) => ({ atSeconds, scale: i % 2 === 0 ? WIDE_SCALE : CLOSE_SCALE }));

  const musicSource = path.join(process.cwd(), "content", "musica", "motivation-paulyudin.mp3");
  const musicLufs = await measureIntegratedLufs(musicSource);
  const musicVolume = Math.pow(10, (VOICE_TARGET_LUFS - MUSIC_BELOW_VOICE_DB - musicLufs) / 20);

  const sfxSource = path.join(PUBLIC_DIR, "assets", "cortes-documental-prueba", "sfx");
  const guion: RenderedMotionBlancoGuion = {
    type: "motion-blanco",
    slug,
    videoPath: path.relative(PUBLIC_DIR, normalizedAbsPath).split(path.sep).join("/"),
    durationInSeconds,
    title: { kicker: plan.title.kicker, headline: plan.title.headline, durationInSeconds: words[titleEnd].end + 0.3 },
    graphics,
    captionChunks: buildCaptionChunks(words, 3, 0.35),
    jumpCuts,
    sfx: {
      whooshPath: copyAsset(path.join(sfxSource, "whoosh.mp3"), slug, "sfx/whoosh.mp3"),
      whooshDurationInSeconds: await getVideoDurationInSeconds(path.join(sfxSource, "whoosh.mp3")),
      popPath: copyAsset(path.join(sfxSource, "hit.mp3"), slug, "sfx/pop.mp3"),
      popDurationInSeconds: await getVideoDurationInSeconds(path.join(sfxSource, "hit.mp3")),
    },
    music: {
      path: copyAsset(musicSource, slug, "sfx/music.mp3"),
      volume: musicVolume,
    },
  };

  const dataPath = path.join(PUBLIC_DIR, "data", `${slug}.json`);
  fs.mkdirSync(path.dirname(dataPath), { recursive: true });
  fs.writeFileSync(dataPath, JSON.stringify(guion, null, 2));
  console.log(`\nListo: public/data/${slug}.json — ${graphics.length} gráficos, ${durationInSeconds.toFixed(1)}s`);
  for (const g of graphics) {
    console.log(`  ${g.id.padEnd(12)} ${g.startSeconds.toFixed(2)}s → ${(g.startSeconds + g.durationInSeconds).toFixed(2)}s`);
  }
}

main().catch((err) => {
  console.error("FALLÓ:", err.message);
  process.exit(1);
});
