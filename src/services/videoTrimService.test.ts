import { describe, it, expect } from "vitest";
import { parseSilenceDetectOutput, mergeCutRanges, computeKeepSegments } from "./videoTrimService";

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
