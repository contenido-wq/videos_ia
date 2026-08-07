import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import {
  parseSilenceDetectOutput,
  mergeCutRanges,
  computeKeepSegments,
  detectFillerRanges,
  remapWords,
  trimVideoToSegments,
  findPrimarySpeakerId,
  detectOtherSpeakerRanges,
  computeAdaptiveNoiseFloorDb,
} from "./videoTrimService";
import type { TranscribedWord, DiarizedWord } from "./checklistSyncService";
import { getVideoDurationInSeconds } from "./ffmpegService";

const execFileAsync = promisify(execFile);

describe("parseSilenceDetectOutput", () => {
  it("empareja silence_start con silence_end e ignora otras líneas de ffmpeg", () => {
    const stderr = [
      "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'input.mov':",
      "  Duration: 00:01:12.09, start: 0.000000, bitrate: 36414 kb/s",
      "[silencedetect @ 0x7f8b1] silence_start: 3.6142",
      "frame=  120 fps=0.0 q=-0.0 size=N/A time=00:00:04.00 bitrate=N/A",
      "[silencedetect @ 0x7f8b1] silence_end: 5.20517 | silence_duration: 1.59097",
      "[silencedetect @ 0x7f8b1] silence_start: 40.1",
      "[silencedetect @ 0x7f8b1] silence_end: 41.75 | silence_duration: 1.65",
    ].join("\n");

    expect(parseSilenceDetectOutput(stderr)).toEqual([
      { start: 3.6142, end: 5.20517 },
      { start: 40.1, end: 41.75 },
    ]);
  });

  it("cierra un silence_start sin silence_end en totalDurationSeconds", () => {
    const stderr = "[silencedetect @ 0x1] silence_start: 65.0";
    expect(parseSilenceDetectOutput(stderr, 72.09)).toEqual([{ start: 65.0, end: 72.09 }]);
  });

  it("devuelve [] si no hay silencios", () => {
    expect(parseSilenceDetectOutput("frame=1 fps=0.0")).toEqual([]);
  });
});

describe("mergeCutRanges", () => {
  it("devuelve [] si no hay rangos", () => {
    expect(mergeCutRanges([])).toEqual([]);
  });

  it("ordena rangos no solapados sin cambiarlos", () => {
    const result = mergeCutRanges([{ start: 10, end: 12 }, { start: 1, end: 2 }]);
    expect(result).toEqual([{ start: 1, end: 2 }, { start: 10, end: 12 }]);
  });

  it("fusiona rangos solapados en uno solo", () => {
    const result = mergeCutRanges([{ start: 1, end: 5 }, { start: 3, end: 8 }]);
    expect(result).toEqual([{ start: 1, end: 8 }]);
  });

  it("fusiona rangos que quedan pegados exactamente en el borde", () => {
    const result = mergeCutRanges([{ start: 1, end: 5 }, { start: 5, end: 7 }]);
    expect(result).toEqual([{ start: 1, end: 7 }]);
  });

  it("un rango totalmente contenido en otro no agrega un rango extra", () => {
    const result = mergeCutRanges([{ start: 1, end: 10 }, { start: 3, end: 4 }]);
    expect(result).toEqual([{ start: 1, end: 10 }]);
  });
});

describe("computeKeepSegments", () => {
  it("sin cortes, devuelve un solo tramo con toda la duración", () => {
    expect(computeKeepSegments(10, [])).toEqual([{ start: 0, end: 10 }]);
  });

  it("un corte en el medio produce dos tramos encogidos por el padding", () => {
    const result = computeKeepSegments(10, [{ start: 4, end: 6 }], 0.12);
    expect(result).toEqual([
      { start: 0, end: 4.12 },
      { start: 5.88, end: 10 },
    ]);
  });

  it("corte pegado al inicio no genera un tramo vacío antes", () => {
    const result = computeKeepSegments(10, [{ start: 0, end: 2 }], 0.12);
    expect(result).toEqual([{ start: 1.88, end: 10 }]);
  });

  it("corte que llega hasta el final no genera un tramo vacío al final", () => {
    const result = computeKeepSegments(10, [{ start: 8, end: 10 }], 0.12);
    expect(result).toEqual([{ start: 0, end: 8.12 }]);
  });
});

function w(text: string, start: number, end: number): TranscribedWord {
  return { text, start, end };
}

describe("detectFillerRanges", () => {
  it("detecta una muletilla de una sola palabra", () => {
    const words = [w("Entonces", 0, 0.5), w("eh", 0.6, 0.8), w("vamos", 0.9, 1.2)];
    expect(detectFillerRanges(words)).toEqual([{ start: 0.6, end: 0.8 }]);
  });

  it("no detecta nada si no hay muletillas", () => {
    const words = [w("Hola", 0, 0.3), w("mundo", 0.4, 0.7)];
    expect(detectFillerRanges(words)).toEqual([]);
  });

  it("detecta una muletilla de dos palabras (\"o sea\")", () => {
    const words = [w("o", 1, 1.1), w("sea", 1.1, 1.3), w("que", 1.4, 1.5)];
    expect(detectFillerRanges(words)).toEqual([{ start: 1, end: 1.3 }]);
  });

  // OJO: no se detectan ni cortan palabras repetidas (ej. "ManyChat. ManyChat te va
  // a ayudar...", "Lobbo. Lobbo es absurdo..."). Se probó contra contenido real y esa
  // repetición es un recurso retórico deliberado del guion, no un titubeo — cortarla
  // borraba palabras reales del audio. Solo se cortan las muletillas de la lista fija.
  it("no corta una palabra real repetida a propósito (recurso retórico, no titubeo)", () => {
    const words = [w("ManyChat.", 0, 0.5), w("ManyChat", 0.5, 1.0), w("te", 1.0, 1.2)];
    expect(detectFillerRanges(words)).toEqual([]);
  });
});

describe("remapWords", () => {
  it("con un solo segmento que cubre todo, las palabras quedan igual", () => {
    const words = [w("Hola", 1, 1.5)];
    expect(remapWords(words, [{ start: 0, end: 10 }])).toEqual(words);
  });

  it("una palabra que cae en el hueco entre dos segmentos a conservar se descarta", () => {
    const words = [w("antes", 0, 0.4), w("eh", 0.6, 0.9), w("despues", 1.2, 1.6)];
    const keepSegments = [{ start: 0, end: 0.5 }, { start: 1.0, end: 2.0 }];
    const result = remapWords(words, keepSegments);
    expect(result.map((word) => word.text)).toEqual(["antes", "despues"]);
  });

  it("una palabra en el segundo segmento se re-mapea sumando la duración conservada del primero (no la del corte crudo)", () => {
    // Este es el caso que estaba mal: remapWords debe usar exactamente los mismos
    // segmentos que trimVideoToSegments (con el padding ya aplicado), no la duración
    // cruda del rango cortado — si no, el timestamp final no calza con el video real.
    const words = [w("despues", 1.2, 1.6)];
    const keepSegments = [{ start: 0, end: 0.5 }, { start: 1.0, end: 2.0 }];
    const result = remapWords(words, keepSegments);
    expect(result).toEqual([{ text: "despues", start: 0.7, end: 1.1 }]);
  });

  it("varios segmentos antes de una palabra acumulan su duración conservada", () => {
    const words = [w("final", 9.2, 9.7)];
    const keepSegments = [{ start: 0, end: 1 }, { start: 4, end: 6 }, { start: 9, end: 11 }];
    const result = remapWords(words, keepSegments);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("final");
    expect(result[0].start).toBeCloseTo(3.2, 9);
    expect(result[0].end).toBeCloseTo(3.7, 9);
  });
});

const TRIM_FIXTURE_DIR = path.join(__dirname, "__fixtures__-trim");
const TRIM_FIXTURE_VIDEO = path.join(TRIM_FIXTURE_DIR, "source.mp4");

beforeAll(async () => {
  fs.mkdirSync(TRIM_FIXTURE_DIR, { recursive: true });
  await execFileAsync("ffmpeg", [
    "-y",
    "-f", "lavfi", "-i", "color=c=black:s=64x64:d=4",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
    "-shortest",
    TRIM_FIXTURE_VIDEO,
  ]);
}, 20000);

afterAll(() => {
  fs.rmSync(TRIM_FIXTURE_DIR, { recursive: true, force: true });
});

describe("trimVideoToSegments", () => {
  it("concatena los segmentos indicados y la duración final es la suma de sus tramos", async () => {
    const outputPath = path.join(TRIM_FIXTURE_DIR, "trimmed.mp4");
    await trimVideoToSegments(TRIM_FIXTURE_VIDEO, outputPath, [
      { start: 0, end: 1 },
      { start: 2, end: 3.5 },
    ]);

    expect(fs.existsSync(outputPath)).toBe(true);
    const duration = await getVideoDurationInSeconds(outputPath);
    expect(duration).toBeGreaterThan(2.3);
    expect(duration).toBeLessThan(2.7);
  });

  it("rechaza si no hay segmentos para conservar", async () => {
    await expect(
      trimVideoToSegments(TRIM_FIXTURE_VIDEO, path.join(TRIM_FIXTURE_DIR, "empty.mp4"), []),
    ).rejects.toThrow();
  });
});

function dw(text: string, start: number, end: number, speakerId: string): DiarizedWord {
  return { text, start, end, speakerId };
}

describe("findPrimarySpeakerId", () => {
  // "Quien habla primero" no sirve como heurística: en un video real, la otra
  // persona decía "Listo." como referencia/cue antes de que el usuario empezara
  // a hablar, y terminaba quedándose con la voz equivocada. "Quien habla más en
  // total" sí lo identificó bien en ese mismo video (131.5s del usuario vs
  // 120.1s de la otra persona), porque el hablante principal hace la entrega
  // completa (incluye asides, interacciones, etc.), no solo lee la línea limpia.
  it("devuelve el speakerId con más duración total hablada, sin importar quién habla primero", () => {
    const words = [
      dw("Listo", 0, 0.3, "speaker_0"),
      dw("Hola", 1, 1.3, "speaker_1"),
      dw("mundo", 1.3, 1.6, "speaker_1"),
      dw("como", 1.6, 1.9, "speaker_1"),
      dw("estan", 1.9, 2.2, "speaker_1"),
    ];
    expect(findPrimarySpeakerId(words)).toBe("speaker_1");
  });

  it("lanza un error si no hay palabras", () => {
    expect(() => findPrimarySpeakerId([])).toThrow();
  });
});

describe("detectOtherSpeakerRanges", () => {
  it("no detecta nada si todas las palabras son del hablante principal", () => {
    const words = [dw("Hola", 0, 0.3, "speaker_0"), dw("mundo", 0.4, 0.7, "speaker_0")];
    expect(detectOtherSpeakerRanges(words, "speaker_0")).toEqual([]);
  });

  it("agrupa un tramo consecutivo del otro hablante en un solo rango", () => {
    const words = [
      dw("Hola", 0, 0.3, "speaker_0"),
      dw("Repite", 0.5, 0.8, "speaker_1"),
      dw("esto", 0.8, 1.1, "speaker_1"),
      dw("chao", 1.5, 1.8, "speaker_0"),
    ];
    expect(detectOtherSpeakerRanges(words, "speaker_0")).toEqual([{ start: 0.5, end: 1.1 }]);
  });

  it("detecta varios tramos separados del otro hablante", () => {
    const words = [
      dw("Hola", 0, 0.3, "speaker_0"),
      dw("eco", 0.5, 0.8, "speaker_1"),
      dw("sigo", 1.0, 1.3, "speaker_0"),
      dw("otro", 1.5, 1.8, "speaker_2"),
      dw("fin", 2.0, 2.3, "speaker_0"),
    ];
    expect(detectOtherSpeakerRanges(words, "speaker_0")).toEqual([
      { start: 0.5, end: 0.8 },
      { start: 1.5, end: 1.8 },
    ]);
  });

  it("incluye un tramo del otro hablante que llega hasta el final", () => {
    const words = [dw("Hola", 0, 0.3, "speaker_0"), dw("eco", 0.5, 0.8, "speaker_1")];
    expect(detectOtherSpeakerRanges(words, "speaker_0")).toEqual([{ start: 0.5, end: 0.8 }]);
  });
});

describe("computeAdaptiveNoiseFloorDb", () => {
  // Evidencia real: un video con max_volume -2.2dB (grabación "normal") necesitaba
  // ~-20dB de umbral para funcionar bien; otro con max_volume -11.5dB (grabación
  // más floja) con ese mismo -20dB fijo clasificaba el 85% del video como
  // "silencio" porque casi ningún fragmento de voz llegaba a superar ese piso.
  // Restar un margen fijo al max_volume del archivo, en vez de usar un número
  // absoluto, resuelve ambos casos.
  it("resta 25dB al max_volume del archivo", () => {
    expect(computeAdaptiveNoiseFloorDb(-11.5)).toBeCloseTo(-36.5, 5);
  });

  it("no baja del piso de -50dB aunque el archivo sea muy fuerte", () => {
    expect(computeAdaptiveNoiseFloorDb(-1)).toBe(-26);
  });

  it("se limita al piso de -50dB si el cálculo daría algo más bajo", () => {
    expect(computeAdaptiveNoiseFloorDb(-30)).toBe(-50);
  });
});
