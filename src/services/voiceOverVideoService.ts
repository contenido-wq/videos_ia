import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { generateSpeech } from "./ai33Service";
import { getVideoDurationInSeconds } from "./ffmpegService";
import type { TranscribedWord } from "./checklistSyncService";

const execFileAsync = promisify(execFile);

const MAX_CAPTION_WORDS = 8;
const MAX_CAPTION_SECONDS = 3.5;

export interface NarrationSection {
  id: string;
  text: string;
}

/** Parsea un guion .md como el de Shadow Figure: cada encabezado "### ..."
 * es una sección, y cada línea de blockquote (">") dentro es narración real
 * que se concatena en un solo párrafo por sección. */
export function parseNarrationSections(markdown: string): NarrationSection[] {
  const blocks = markdown.split(/^### /m).slice(1);
  return blocks.map((block, i) => {
    const header = block.split("\n")[0].trim();
    const id = `s${i + 1}`;
    const lines = block
      .split("\n")
      .filter((l) => l.trim().startsWith(">"))
      .map((l) => l.replace(/^>\s?/, "").trim())
      .filter(Boolean);
    return { id, text: lines.join(" ") };
  }).filter((s) => s.text.length > 0);
}

interface RenderedSection extends NarrationSection {
  audioPath: string;
  durationInSeconds: number;
  words: TranscribedWord[];
}

async function concatAudio(sectionPaths: string[], outputPath: string): Promise<void> {
  const listPath = outputPath.replace(/\.mp3$/, "-concat-list.txt");
  const listContent = sectionPaths.map((p) => `file '${path.resolve(p)}'`).join("\n");
  fs.writeFileSync(listPath, listContent);
  await execFileAsync("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outputPath]);
  fs.rmSync(listPath);
}

function formatSrtTimestamp(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const msRem = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(msRem).padStart(3, "0")}`;
}

function buildSrt(words: TranscribedWord[]): string {
  const entries: { start: number; end: number; text: string }[] = [];
  let chunk: TranscribedWord[] = [];

  const flush = () => {
    if (chunk.length === 0) return;
    entries.push({
      start: chunk[0].start,
      end: chunk[chunk.length - 1].end,
      text: chunk.map((w) => w.text).join(" "),
    });
    chunk = [];
  };

  for (const w of words) {
    const wouldSpan = chunk.length > 0 ? w.end - chunk[0].start : 0;
    if (chunk.length >= MAX_CAPTION_WORDS || wouldSpan > MAX_CAPTION_SECONDS) flush();
    chunk.push(w);
  }
  flush();

  return entries
    .map((e, i) => `${i + 1}\n${formatSrtTimestamp(e.start)} --> ${formatSrtTimestamp(e.end)}\n${e.text}\n`)
    .join("\n");
}

export interface BuildVoiceOverEpisodeParams {
  slug: string;
  scriptMarkdownPath: string;
  imagePath: string;
  voiceId: string;
  outputVideoPath: string;
}

export async function buildVoiceOverEpisode(params: BuildVoiceOverEpisodeParams): Promise<{
  videoPath: string;
  durationInSeconds: number;
}> {
  const { slug, scriptMarkdownPath, imagePath, voiceId, outputVideoPath } = params;
  const assetsDir = path.join(process.cwd(), "public", "assets", slug);
  const audioDir = path.join(assetsDir, "audio");
  fs.mkdirSync(audioDir, { recursive: true });

  const markdown = fs.readFileSync(scriptMarkdownPath, "utf-8");
  const sections = parseNarrationSections(markdown);
  console.log(`${sections.length} secciones de narración encontradas en el guion`);

  const rendered: RenderedSection[] = [];
  let cursorSeconds = 0;
  for (const section of sections) {
    const audioPath = path.join(audioDir, `${section.id}.mp3`);
    let words: TranscribedWord[];
    if (fs.existsSync(audioPath)) {
      console.log(`[${section.id}] audio ya existe, se reutiliza`);
      const wordsPath = path.join(audioDir, `${section.id}.words.json`);
      words = JSON.parse(fs.readFileSync(wordsPath, "utf-8"));
    } else {
      console.log(`[${section.id}] generando voz (${section.text.split(/\s+/).length} palabras)...`);
      const result = await generateSpeech(section.text, { outputPath: audioPath, voiceId, withTranscript: true });
      words = result.words;
      fs.writeFileSync(path.join(audioDir, `${section.id}.words.json`), JSON.stringify(words, null, 2));
    }
    const durationInSeconds = await getVideoDurationInSeconds(audioPath);
    const remapped = words.map((w) => ({ ...w, start: w.start + cursorSeconds, end: w.end + cursorSeconds }));
    rendered.push({ ...section, audioPath, durationInSeconds, words: remapped });
    cursorSeconds += durationInSeconds;
    console.log(`[${section.id}] ${durationInSeconds.toFixed(1)}s (acumulado: ${cursorSeconds.toFixed(1)}s)`);
  }

  const fullAudioPath = path.join(assetsDir, "narration-full.mp3");
  console.log("concatenando audio completo...");
  await concatAudio(rendered.map((r) => r.audioPath), fullAudioPath);
  const totalDurationSeconds = await getVideoDurationInSeconds(fullAudioPath);

  const allWords = rendered.flatMap((r) => r.words);
  const srtPath = path.join(assetsDir, "captions.srt");
  fs.writeFileSync(srtPath, buildSrt(allWords));
  console.log(`captions.srt generado con ${allWords.length} palabras`);

  fs.mkdirSync(path.dirname(outputVideoPath), { recursive: true });
  console.log("renderizando video final (imagen fija + audio, sin subtítulos incrustados)...");
  // Este ffmpeg no tiene libass ni libfreetype compilados (sin soporte para
  // el filtro "subtitles" ni "drawtext"), así que no se pueden incrustar
  // subtítulos en el video acá. En vez de eso, captions.srt queda listo para
  // subirlo como pista de subtítulos separada en YouTube Studio — funciona
  // igual de bien para SEO/indexación y el espectador puede togglearlos.
  await execFileAsync("ffmpeg", [
    "-y",
    "-loop", "1",
    "-i", imagePath,
    "-i", fullAudioPath,
    "-vf", "scale=1920:1080",
    "-c:v", "libx264",
    "-tune", "stillimage",
    "-c:a", "aac",
    "-b:a", "192k",
    "-pix_fmt", "yuv420p",
    "-shortest",
    outputVideoPath,
  ]);

  return { videoPath: outputVideoPath, durationInSeconds: totalDurationSeconds };
}
