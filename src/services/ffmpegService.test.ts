import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { getVideoDurationInSeconds, extractAudioTrack, measureMaxVolumeDb } from "./ffmpegService";

const execFileAsync = promisify(execFile);
const FIXTURE_DIR = path.join(__dirname, "__fixtures__");
const FIXTURE_VIDEO = path.join(FIXTURE_DIR, "tiny-test-video.mp4");
const QUIET_FIXTURE_VIDEO = path.join(FIXTURE_DIR, "quiet-test-video.mp4");

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
  // Mismo tono pero mucho más flojo (10% de amplitud), para probar que
  // measureMaxVolumeDb refleja niveles de audio distintos entre archivos.
  await execFileAsync("ffmpeg", [
    "-y",
    "-f", "lavfi", "-i", "color=c=black:s=64x64:d=2",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
    "-af", "volume=0.1",
    "-shortest",
    QUIET_FIXTURE_VIDEO,
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

describe("measureMaxVolumeDb", () => {
  it("devuelve un número dB finito, menor o igual a 0", async () => {
    const db = await measureMaxVolumeDb(FIXTURE_VIDEO);
    expect(Number.isFinite(db)).toBe(true);
    expect(db).toBeLessThanOrEqual(0);
  });

  it("un audio más flojo reporta un max_volume más bajo que uno a volumen completo", async () => {
    const loudDb = await measureMaxVolumeDb(FIXTURE_VIDEO);
    const quietDb = await measureMaxVolumeDb(QUIET_FIXTURE_VIDEO);
    expect(quietDb).toBeLessThan(loudDb);
  });
});
