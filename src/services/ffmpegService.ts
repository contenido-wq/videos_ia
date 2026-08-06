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
