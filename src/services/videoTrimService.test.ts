import { describe, it, expect } from "vitest";
import {
  parseSilenceDetectOutput,
  mergeCutRanges,
  computeKeepSegments,
  detectFillerRanges,
  remapWords,
} from "./videoTrimService";
import type { TranscribedWord } from "./checklistSyncService";

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

  it("no detecta nada si no hay muletillas ni repeticiones", () => {
    const words = [w("Hola", 0, 0.3), w("mundo", 0.4, 0.7)];
    expect(detectFillerRanges(words)).toEqual([]);
  });

  it("detecta una muletilla de dos palabras (\"o sea\")", () => {
    const words = [w("o", 1, 1.1), w("sea", 1.1, 1.3), w("que", 1.4, 1.5)];
    expect(detectFillerRanges(words)).toEqual([{ start: 1, end: 1.3 }]);
  });

  it("detecta una palabra inmediatamente repetida y corta solo la primera", () => {
    const words = [w("la", 0, 0.2), w("la", 0.2, 0.4), w("puerta", 0.4, 0.7)];
    expect(detectFillerRanges(words)).toEqual([{ start: 0, end: 0.2 }]);
  });

  it("ignora mayúsculas/acentos al detectar repeticiones", () => {
    const words = [w("La", 0, 0.2), w("la", 0.2, 0.4)];
    expect(detectFillerRanges(words)).toEqual([{ start: 0, end: 0.2 }]);
  });
});

describe("remapWords", () => {
  it("sin cortes, las palabras quedan igual", () => {
    const words = [w("Hola", 1, 1.5)];
    expect(remapWords(words, [])).toEqual(words);
  });

  it("una palabra dentro de un rango cortado se descarta", () => {
    const words = [w("antes", 0, 0.5), w("eh", 0.6, 0.9), w("despues", 1, 1.5)];
    const result = remapWords(words, [{ start: 0.6, end: 0.9 }]);
    expect(result.map((word) => word.text)).toEqual(["antes", "despues"]);
  });

  it("las palabras después de un corte se desplazan hacia atrás por su duración", () => {
    const words = [w("antes", 0, 0.5), w("despues", 2, 2.5)];
    const result = remapWords(words, [{ start: 0.5, end: 1.5 }]);
    expect(result).toEqual([
      { text: "antes", start: 0, end: 0.5 },
      { text: "despues", start: 1, end: 1.5 },
    ]);
  });

  it("varios cortes antes de una palabra se acumulan", () => {
    const words = [w("final", 10, 10.5)];
    const cuts = [{ start: 1, end: 2 }, { start: 5, end: 6 }];
    const result = remapWords(words, cuts);
    expect(result).toEqual([{ text: "final", start: 8, end: 8.5 }]);
  });
});
