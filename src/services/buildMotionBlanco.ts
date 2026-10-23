import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { prepareTrimmedVideo } from "./rawVideoCleaningService";
import { getVideoDurationInSeconds, measureIntegratedLufs, normalizeVideoAudio } from "./ffmpegService";
import { buildCaptionChunks } from "./captionChunkService";
import type { TranscribedWord } from "./checklistSyncService";
import { bgRelPath, cutoutRelPath, generateMotionBlancoImages } from "./motionBlancoImages";
import type { MotionBlancoPlan, RenderedMotionBlancoGuion, RenderedMotionBlancoScene } from "../types/guion";

const execFileAsync = promisify(execFile);
const PUBLIC_DIR = path.join(process.cwd(), "public");

// La escena entra un pelín antes de la palabra que la dispara y sale un pelín después.
const SCENE_LEAD_SECONDS = 0.12;
const SCENE_TAIL_SECONDS = 0.15;
// Regla de ritmo: ninguna escena (gráfico o plano del presentador) dura más de esto.
const MAX_SCENE_SECONDS = 3;
// Elementos sin frase propia entran uno tras otro con esta separación.
const STAGGER_SECONDS = 0.14;
const FIRST_ITEM_DELAY_SECONDS = 0.18;
// Encuadres del presentador: rota entre plano abierto, medio y cerrado con un leve corrimiento lateral.
const FRAMINGS = [
  { scale: 1.04, offsetX: 0 },
  { scale: 1.2, offsetX: -2.5 },
  { scale: 1.1, offsetX: 2 },
  { scale: 1.26, offsetX: 1.5 },
];
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
  const scenes: RenderedMotionBlancoScene[] = plan.scenes.map((scene) => {
    const [fromIdx] = findPhrase(words, scene.fromPhrase, cursor);
    cursor = fromIdx + 1;
    const startSeconds = Math.max(0, words[fromIdx].start - SCENE_LEAD_SECONDS);
    // Sin toPhrase el final se ajusta abajo al inicio de la escena siguiente.
    const endSeconds = scene.toPhrase
      ? words[findPhrase(words, scene.toPhrase, fromIdx)[1]].end + SCENE_TAIL_SECONDS
      : Number.POSITIVE_INFINITY;
    const at = (phrase: string) => words[findPhrase(words, phrase, fromIdx)[0]].start;

    // Lo anclado a una frase entra con la palabra; lo demás, escalonado desde el inicio.
    let staggerIndex = 0;
    const timed = (atPhrase?: string) =>
      atPhrase ? at(atPhrase) : startSeconds + FIRST_ITEM_DELAY_SECONDS + STAGGER_SECONDS * staggerIndex++;

    return {
      id: scene.id,
      layout: scene.layout ?? "full",
      startSeconds,
      durationInSeconds: endSeconds - startSeconds,
      bgPath: bgRelPath(slug, scene.id),
      mid: (scene.mid ?? []).map((m) => ({ imagePath: cutoutRelPath(slug, m.id), atSeconds: timed(m.atPhrase) })),
      front: (scene.front ?? []).map((f) => ({ kind: f.kind, text: f.text, atSeconds: timed(f.atPhrase) })),
    };
  });

  scenes.forEach((scene, i) => {
    const next = scenes[i + 1];
    const limit = next ? next.startSeconds : durationInSeconds;
    if (scene.startSeconds + scene.durationInSeconds > limit) scene.durationInSeconds = limit - scene.startSeconds;
  });

  const tooLong = scenes.filter((s) => s.durationInSeconds > MAX_SCENE_SECONDS + 0.15);
  if (tooLong.length > 0) {
    throw new Error(
      `Escenas de más de ${MAX_SCENE_SECONDS}s (pártelas en el plan): ` +
        tooLong.map((s) => `${s.id} ${s.durationInSeconds.toFixed(2)}s`).join(", "),
    );
  }

  // Se valida el ritmo antes de generar: no se gastan créditos en un plan que hay que rehacer.
  if (!process.env.SKIP_IMAGES) await generateMotionBlancoImages(slug, plan);

  // Jump cut del presentador en cada frase nueva y al volver de cada escena; los tramos que
  // aún pasen de MAX_SCENE_SECONDS se parten en partes iguales para respetar el ritmo.
  const cutPoints = new Set<number>([0]);
  words.forEach((w, i) => {
    const prev = words[i - 1];
    if (prev && /[.?!]$/.test(prev.text)) cutPoints.add(Math.max(0, w.start - 0.05));
  });
  scenes.forEach((s) => {
    cutPoints.add(s.startSeconds);
    cutPoints.add(s.startSeconds + s.durationInSeconds);
  });
  cutPoints.add(durationInSeconds);
  const sortedCuts = [...cutPoints].sort((a, b) => a - b);
  const allCuts: number[] = [];
  sortedCuts.forEach((at, i) => {
    allCuts.push(at);
    const next = sortedCuts[i + 1];
    if (next === undefined) return;
    const parts = Math.ceil((next - at) / MAX_SCENE_SECONDS);
    for (let k = 1; k < parts; k++) allCuts.push(at + ((next - at) * k) / parts);
  });
  const jumpCuts = allCuts
    .filter((at) => at < durationInSeconds)
    .map((atSeconds, i) => ({ atSeconds, ...FRAMINGS[i % FRAMINGS.length] }));

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
    scenes,
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
  console.log(`\nListo: public/data/${slug}.json — ${scenes.length} escenas, ${durationInSeconds.toFixed(1)}s`);
  for (const s of scenes) {
    console.log(`  ${s.id.padEnd(22)} ${s.startSeconds.toFixed(2)}s → ${(s.startSeconds + s.durationInSeconds).toFixed(2)}s (${s.durationInSeconds.toFixed(2)}s)`);
  }
}

main().catch((err) => {
  console.error("FALLÓ:", err.message);
  process.exit(1);
});
