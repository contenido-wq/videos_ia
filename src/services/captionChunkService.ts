import type { TranscribedWord } from "./checklistSyncService";
import type { CaptionChunk } from "../types/guion";

/**
 * Agrupa palabras transcritas (ya remapeadas post-recorte) en bloques cortos de subtítulo,
 * independientes de las escenas de imagen: cierra el bloque actual y arranca uno nuevo al
 * llegar a `maxWordsPerChunk` palabras, o cuando el hueco entre el fin de una palabra y el
 * inicio de la siguiente supera `maxGapSeconds` (pausa natural).
 */
export function buildCaptionChunks(
  words: TranscribedWord[],
  maxWordsPerChunk: number,
  maxGapSeconds: number,
): CaptionChunk[] {
  const chunks: CaptionChunk[] = [];
  let current: TranscribedWord[] = [];

  const flush = () => {
    if (current.length === 0) return;
    chunks.push({
      words: current.map((word) => ({ text: word.text, start: word.start, end: word.end })),
      startSeconds: current[0].start,
      endSeconds: current[current.length - 1].end,
    });
    current = [];
  };

  for (const word of words) {
    if (current.length > 0) {
      const previous = current[current.length - 1];
      const gap = word.start - previous.end;
      if (current.length >= maxWordsPerChunk || gap > maxGapSeconds) {
        flush();
      }
    }
    current.push(word);
  }
  flush();

  return chunks;
}
