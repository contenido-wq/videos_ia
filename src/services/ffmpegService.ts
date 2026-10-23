import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";

const execFileAsync = promisify(execFile);

export async function getVideoDurationInSeconds(filePath: string): Promise<number> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`ffprobe: el archivo no existe: ${filePath}`);
  }

  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "quiet",
    "-print_format", "json",
    "-show_format",
    filePath,
  ]);

  const data = JSON.parse(stdout) as { format?: { duration?: string } };
  const duration = Number(data.format?.duration);
  if (!Number.isFinite(duration)) {
    throw new Error(`ffprobe no devolvió una duración válida para ${filePath}`);
  }
  return duration;
}

export async function extractAudioTrack(videoPath: string, outputMp3Path: string): Promise<string> {
  await execFileAsync("ffmpeg", [
    "-y",
    "-i", videoPath,
    "-vn",
    "-acodec", "libmp3lame",
    "-q:a", "4",
    outputMp3Path,
  ]);
  return outputMp3Path;
}

export async function measureMaxVolumeDb(filePath: string): Promise<number> {
  // -map 0:a: solo lee el stream de audio, sin decodificar video. Sobre un
  // video 4K esto es la diferencia entre ~0.2s y más de 1 minuto por corrida.
  const { stderr } = await execFileAsync("ffmpeg", [
    "-i", filePath,
    "-map", "0:a:0",
    "-af", "volumedetect",
    "-f", "null",
    "-",
  ]);
  const match = stderr.match(/max_volume:\s*(-?[\d.]+)\s*dB/);
  if (!match) {
    throw new Error(`measureMaxVolumeDb: no se pudo leer max_volume de ${filePath}`);
  }
  return parseFloat(match[1]);
}

/** Sonoridad integrada (LUFS, EBU R128) de la primera pista de audio del archivo. */
export async function measureIntegratedLufs(filePath: string): Promise<number> {
  const { stderr } = await execFileAsync("ffmpeg", [
    "-nostats",
    "-i", filePath,
    "-map", "0:a:0",
    "-af", "ebur128=peak=true",
    "-f", "null",
    "-",
  ]);
  // El resumen final es el último bloque "I:  -xx.x LUFS".
  const matches = [...stderr.matchAll(/^\s+I:\s+(-?[\d.]+)\s+LUFS/gm)];
  if (matches.length === 0) {
    throw new Error(`No se pudo medir la sonoridad de ${filePath}`);
  }
  return parseFloat(matches[matches.length - 1][1]);
}

/** Copia el video sin recodificar la imagen y sube/normaliza la voz a `targetLufs`
 * (loudnorm de una pasada + compresor suave para que las frases bajas no se pierdan). */
export async function normalizeVideoAudio(inputPath: string, outputPath: string, targetLufs: number): Promise<void> {
  await execFileAsync("ffmpeg", [
    "-y",
    "-i", inputPath,
    "-map", "0:v:0",
    "-map", "0:a:0",
    "-c:v", "copy",
    "-af", `highpass=f=70,acompressor=threshold=-28dB:ratio=3:attack=10:release=150,loudnorm=I=${targetLufs}:TP=-3:LRA=7`,
    "-c:a", "aac",
    "-b:a", "192k",
    outputPath,
  ], { maxBuffer: 64 * 1024 * 1024 });
}
