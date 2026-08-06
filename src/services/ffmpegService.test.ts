import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { getVideoDurationInSeconds, extractAudioTrack } from "./ffmpegService";

const execFileAsync = promisify(execFile);
const FIXTURE_DIR = path.join(__dirname, "__fixtures__");
const FIXTURE_VIDEO = path.join(FIXTURE_DIR, "tiny-test-video.mp4");

beforeAll(async () => {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  // Video sintético de 2s con tono de audio, generado con ffmpeg (sin depender
  // de ningún archivo del usuario, que además está gitignored).
  await execFileAsync("ffmpeg", [
    "-y",
    "-f", "lavfi", "-i", "color=c=black:s=64x64:d=2",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
    "-shortest",
    FIXTURE_VIDEO,
  ]);
}, 20000);

afterAll(() => {
  fs.rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

describe("getVideoDurationInSeconds", () => {
  it("lee la duración real de un video de 2 segundos", async () => {
    const duration = await getVideoDurationInSeconds(FIXTURE_VIDEO);
    expect(duration).toBeGreaterThan(1.9);
    expect(duration).toBeLessThan(2.1);
  });

  it("rechaza con un mensaje claro si el archivo no existe", async () => {
    await expect(getVideoDurationInSeconds(path.join(FIXTURE_DIR, "no-existe.mp4"))).rejects.toThrow();
  });
});

describe("extractAudioTrack", () => {
  it("extrae el audio a un mp3 que existe y no está vacío", async () => {
    const outputPath = path.join(FIXTURE_DIR, "extracted.mp3");
    const result = await extractAudioTrack(FIXTURE_VIDEO, outputPath);

    expect(result).toBe(outputPath);
    expect(fs.existsSync(outputPath)).toBe(true);
    expect(fs.statSync(outputPath).size).toBeGreaterThan(0);
  });
});
