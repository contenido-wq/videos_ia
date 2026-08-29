import { describe, it, expect } from "vitest";
import { buildCaptionChunks } from "./captionChunkService";
import type { TranscribedWord } from "./checklistSyncService";

function w(text: string, start: number, end: number): TranscribedWord {
  return { text, start, end };
}

describe("buildCaptionChunks", () => {
  it("devuelve una lista vacía si no hay palabras", () => {
    expect(buildCaptionChunks([], 4, 0.6)).toEqual([]);
  });

  it("agrupa una sola palabra en un solo chunk", () => {
    const words = [w("Hola", 0, 0.3)];
    const result = buildCaptionChunks(words, 4, 0.6);
    expect(result).toEqual([{ words: [{ text: "Hola", start: 0, end: 0.3 }], startSeconds: 0, endSeconds: 0.3 }]);
  });

  it("corta un chunk nuevo al llegar a maxWordsPerChunk", () => {
    const words = [w("uno", 0, 0.2), w("dos", 0.2, 0.4), w("tres", 0.4, 0.6), w("cuatro", 0.6, 0.8), w("cinco", 0.8, 1.0)];
    const result = buildCaptionChunks(words, 4, 0.6);
    expect(result).toHaveLength(2);
    expect(result[0].words.map((word) => word.text)).toEqual(["uno", "dos", "tres", "cuatro"]);
    expect(result[1].words.map((word) => word.text)).toEqual(["cinco"]);
  });

  it("corta un chunk nuevo cuando el hueco entre palabras supera maxGapSeconds", () => {
    const words = [w("Hola", 0, 0.3), w("mundo", 2, 2.3)];
    const result = buildCaptionChunks(words, 4, 0.6);
    expect(result).toHaveLength(2);
    expect(result[0].endSeconds).toBe(0.3);
    expect(result[1].startSeconds).toBe(2);
  });

  it("calcula startSeconds/endSeconds del chunk desde la primera y última palabra", () => {
    const words = [w("a", 1, 1.2), w("b", 1.2, 1.5)];
    const result = buildCaptionChunks(words, 4, 0.6);
    expect(result[0].startSeconds).toBe(1);
    expect(result[0].endSeconds).toBe(1.5);
  });
});
