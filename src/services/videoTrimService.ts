import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import type { TranscribedWord, DiarizedWord } from "./checklistSyncService";
import { measureMaxVolumeDb } from "./ffmpegService";

const execFileAsync = promisify(execFile);

// 300ms detectaba "silencios" a 27-96ms del borde de palabras reales cuando el
// umbral de dB todavía era fijo (evidencia: corte justo antes de "Número dos").
// Con el umbral de dB ya adaptativo (calibrado por archivo, ver
// computeAdaptiveNoiseFloorDb) ese riesgo baja bastante, así que 350ms recorta
// más pausas cortas sin repetir el problema original.
const SILENCE_MIN_DURATION_SECONDS = 0.35;
// Margen por debajo del pico de volumen del archivo para considerar "silencio".
const NOISE_FLOOR_MARGIN_DB = 25;
const NOISE_FLOOR_MIN_DB = -50;

// Un umbral fijo (ej. -20dB) solo funciona para grabaciones con un nivel de
// audio parecido al que se usó para calibrarlo. Evidencia real: un video con
// max_volume -2.2dB andaba bien con ~-20dB; otro con max_volume -11.5dB (mic
// más flojo) con ese mismo -20dB clasificaba el 85% del video como silencio,
// porque casi ninguna palabra llegaba a superarlo. Calcular el umbral como un
// margen fijo por debajo del pico de CADA archivo resuelve ambos casos.
export function computeAdaptiveNoiseFloorDb(maxVolumeDb: number): number {
  return Math.max(maxVolumeDb - NOISE_FLOOR_MARGIN_DB, NOISE_FLOOR_MIN_DB);
}

export interface CutRange {
  start: number;
  end: number;
}

export interface KeepRange {
  start: number;
  end: number;
}

export function parseSilenceDetectOutput(
  stderr: string,
  totalDurationSeconds = Infinity,
): CutRange[] {
  const pendingStarts: number[] = [];
  const ranges: CutRange[] = [];

  for (const line of stderr.split("\n")) {
    const startMatch = line.match(/silence_start:\s*(-?[\d.]+)/);
    if (startMatch) {
      pendingStarts.push(parseFloat(startMatch[1]));
      continue;
    }
    const endMatch = line.match(/silence_end:\s*(-?[\d.]+)/);
    if (endMatch) {
      const start = pendingStarts.shift();
      if (start !== undefined) {
        ranges.push({ start, end: parseFloat(endMatch[1]) });
      }
    }
  }

  for (const start of pendingStarts) {
    ranges.push({ start, end: totalDurationSeconds });
  }

  return ranges;
}

export async function detectSilenceRanges(
  videoPath: string,
  totalDurationSeconds: number,
): Promise<CutRange[]> {
  const maxVolumeDb = await measureMaxVolumeDb(videoPath);
  const noiseFloorDb = computeAdaptiveNoiseFloorDb(maxVolumeDb);
  // -map 0:a: solo lee el stream de audio, sin decodificar video (ver nota en
  // measureMaxVolumeDb) — evita decodificar 4K completo solo para leer audio.
  const { stderr } = await execFileAsync("ffmpeg", [
    "-i", videoPath,
    "-map", "0:a",
    "-af", `silencedetect=noise=${noiseFloorDb}dB:d=${SILENCE_MIN_DURATION_SECONDS}`,
    "-f", "null", "-",
  ]);
  return parseSilenceDetectOutput(stderr, totalDurationSeconds);
}

export function mergeCutRanges(ranges: CutRange[]): CutRange[] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: CutRange[] = [{ ...sorted[0] }];

  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const current = sorted[i];
    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push({ ...current });
    }
  }

  return merged;
}

export function computeKeepSegments(
  totalDurationSeconds: number,
  cutRanges: CutRange[],
  paddingSeconds = 0.12,
): KeepRange[] {
  const sorted = mergeCutRanges(cutRanges);
  const keep: KeepRange[] = [];
  let cursor = 0;
  let lastCutEnd = 0;

  for (const cut of sorted) {
    if (cut.start > cursor) {
      keep.push({ start: cursor, end: Math.min(cut.start + paddingSeconds, totalDurationSeconds) });
    }
    cursor = Math.max(cursor, cut.end - paddingSeconds);
    lastCutEnd = cut.end;
  }

  if (lastCutEnd < totalDurationSeconds) {
    keep.push({ start: cursor, end: totalDurationSeconds });
  }

  return keep.filter((r) => r.end > r.start);
}

// Resta `cuts` (sin padding, exactos) de `base` (tramos ya calculados con
// computeKeepSegments). Se usa para los cortes de retake/aside: sumarlos al
// merge general de computeKeepSegments (junto con silencios/muletillas) hace
// que el padding de esa función filtre de más y deje pasar un fragmento del
// contenido MALO en el borde del corte — pero ensanchar el rango del retake
// para cancelar ese padding tiene su propio problema: en tramos con retakes
// muy pegados entre sí (ej. una toma buena de solo 2-3s entre dos cortes), el
// ensanchado se fusiona con el corte vecino y se traga la toma buena entera
// (bug real: así se perdió la única mención de "Notebook LM" en un video de
// prueba). Restar directo, sin padding ni fusión con otros cortes, corta
// exactamente lo aprobado sin arriesgar tomas buenas vecinas.
export function subtractRanges(base: KeepRange[], cuts: CutRange[]): KeepRange[] {
  const sortedCuts = [...cuts].sort((a, b) => a.start - b.start);
  const result: KeepRange[] = [];

  for (const segment of base) {
    let cursor = segment.start;
    for (const cut of sortedCuts) {
      if (cut.end <= cursor || cut.start >= segment.end) continue;
      const cutStart = Math.max(cut.start, cursor);
      const cutEnd = Math.min(cut.end, segment.end);
      if (cutStart > cursor) {
        result.push({ start: cursor, end: cutStart });
      }
      cursor = Math.max(cursor, cutEnd);
    }
    if (cursor < segment.end) {
      result.push({ start: cursor, end: segment.end });
    }
  }

  return result.filter((r) => r.end > r.start);
}

const FILLER_WORDS = ["eh", "ehh", "eeh", "este", "esteee", "digo", "em", "emm", "mmm"];
const FILLER_PHRASES = ["o sea"];

function normalizeWord(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

// No se cortan palabras repetidas inmediatas: en contenido real, repetir el nombre
// de la herramienta ("ManyChat. ManyChat te va a ayudar...", "Lobbo. Lobbo es
// absurdo...") es un recurso retórico deliberado del guion, no un titubeo — cortarlo
// borraba palabras reales del audio. Solo se cortan muletillas de esta lista fija.
export function detectFillerRanges(words: TranscribedWord[]): CutRange[] {
  const ranges: CutRange[] = [];
  const normalized = words.map((w) => normalizeWord(w.text));

  for (const phrase of FILLER_PHRASES) {
    const phraseWords = phrase.split(" ").map(normalizeWord);
    for (let i = 0; i <= normalized.length - phraseWords.length; i++) {
      const window = normalized.slice(i, i + phraseWords.length);
      if (window.every((word, j) => word === phraseWords[j])) {
        ranges.push({ start: words[i].start, end: words[i + phraseWords.length - 1].end });
      }
    }
  }

  normalized.forEach((word, i) => {
    if (FILLER_WORDS.includes(word)) {
      ranges.push({ start: words[i].start, end: words[i].end });
    }
  });

  return ranges;
}

// Detecta frases de 3+ palabras que quedan repetidas de forma consecutiva en el
// video YA recortado — señal de que un retake se cortó a medias (se quitó el
// tartamudeo pero no las palabras iniciales de la frase, que vuelven a aparecer
// cuando arranca el segundo intento limpio). No corta nada automáticamente, solo
// avisa para revisión manual: 3+ palabras es lo bastante largo para no confundirse
// con la repetición retórica deliberada de una sola palabra que sí se protege en
// detectFillerRanges (ej. "ManyChat. ManyChat te va a ayudar...").
export function detectRepeatedPhrases(
  words: TranscribedWord[],
  minWords = 3,
  maxWords = 8,
): { start: number; end: number; phrase: string }[] {
  const normalized = words.map((w) => normalizeWord(w.text));
  const found: { start: number; end: number; phrase: string }[] = [];

  let i = 0;
  while (i < normalized.length) {
    let matchLength = 0;
    const longestPossible = Math.min(maxWords, Math.floor((normalized.length - i) / 2));
    // Se prueba de más largo a más corto: un match largo es mucho menos probable
    // que sea coincidencia que uno corto, así que gana el más largo disponible.
    for (let len = longestPossible; len >= minWords; len--) {
      const a = normalized.slice(i, i + len);
      const b = normalized.slice(i + len, i + 2 * len);
      if (a.every((word) => word.length > 0) && a.every((word, j) => word === b[j])) {
        matchLength = len;
        break;
      }
    }

    if (matchLength > 0) {
      found.push({
        start: words[i].start,
        end: words[i + 2 * matchLength - 1].end,
        phrase: words.slice(i, i + 2 * matchLength).map((w) => w.text).join(" "),
      });
      i += 2 * matchLength;
    } else {
      i++;
    }
  }

  return found;
}

// Re-mapea cada palabra a su posición en el video ya recortado. Usa exactamente los
// mismos `keepSegments` que arma `trimVideoToSegments` (no los `cutRanges` crudos):
// computeKeepSegments deja `paddingSeconds` de aire a cada lado de un corte, así que
// la duración realmente eliminada de cada corte es `(end-start) - 2*padding`, no
// `(end-start)`. Restar la duración cruda del corte desincroniza el resultado — con
// 24 cortes antes de una palabra y 120ms de padding, el error acumulado llega a
// varios segundos (bug real detectado: un item aparecía ~5.6s antes de lo que se
// decía en el video).
export function remapWords(words: TranscribedWord[], keepSegments: KeepRange[]): TranscribedWord[] {
  const sorted = [...keepSegments].sort((a, b) => a.start - b.start);
  const result: TranscribedWord[] = [];
  let cumulativeKeptBefore = 0;

  for (const segment of sorted) {
    for (const word of words) {
      if (word.start >= segment.start && word.start < segment.end) {
        result.push({
          text: word.text,
          start: word.start - segment.start + cumulativeKeptBefore,
          end: Math.min(word.end, segment.end) - segment.start + cumulativeKeptBefore,
        });
      }
    }
    cumulativeKeptBefore += segment.end - segment.start;
  }

  return result;
}

export async function trimVideoToSegments(
  inputPath: string,
  outputPath: string,
  segments: KeepRange[],
): Promise<void> {
  if (segments.length === 0) {
    throw new Error(`trimVideoToSegments: no hay segmentos para conservar de ${inputPath}`);
  }

  const filterParts: string[] = [];
  segments.forEach((seg, i) => {
    filterParts.push(`[0:v]trim=start=${seg.start}:end=${seg.end},setpts=PTS-STARTPTS[v${i}]`);
    filterParts.push(`[0:a]atrim=start=${seg.start}:end=${seg.end},asetpts=PTS-STARTPTS[a${i}]`);
  });
  const concatInputs = segments.map((_, i) => `[v${i}][a${i}]`).join("");
  filterParts.push(`${concatInputs}concat=n=${segments.length}:v=1:a=1[outv][outa]`);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  await execFileAsync("ffmpeg", [
    "-y",
    "-i", inputPath,
    "-filter_complex", filterParts.join(";"),
    "-map", "[outv]",
    "-map", "[outa]",
    outputPath,
  ]);
}

// "Quien habla primero" no es confiable: en contenido real, otra persona
// puede decir algo ("Listo.") de referencia antes de que el hablante
// principal empiece. Quien más habla en total sí lo es de forma consistente
// — la entrega completa (con asides, interacciones, etc.) siempre pesa más
// que una lectura de referencia o interjecciones puntuales.
export function findPrimarySpeakerId(words: DiarizedWord[]): string {
  if (words.length === 0) {
    throw new Error("findPrimarySpeakerId: no hay palabras para determinar el hablante principal");
  }

  const durationBySpeaker = new Map<string, number>();
  for (const word of words) {
    durationBySpeaker.set(word.speakerId, (durationBySpeaker.get(word.speakerId) ?? 0) + (word.end - word.start));
  }

  let primarySpeakerId = words[0].speakerId;
  let maxDuration = -Infinity;
  for (const [speakerId, duration] of durationBySpeaker) {
    if (duration > maxDuration) {
      maxDuration = duration;
      primarySpeakerId = speakerId;
    }
  }

  return primarySpeakerId;
}

export function detectOtherSpeakerRanges(words: DiarizedWord[], primarySpeakerId: string): CutRange[] {
  const ranges: CutRange[] = [];
  let runStart: number | null = null;
  let runEnd: number | null = null;

  for (const word of words) {
    if (word.speakerId !== primarySpeakerId) {
      if (runStart === null) runStart = word.start;
      runEnd = word.end;
    } else if (runStart !== null) {
      ranges.push({ start: runStart, end: runEnd as number });
      runStart = null;
      runEnd = null;
    }
  }
  if (runStart !== null) {
    ranges.push({ start: runStart, end: runEnd as number });
  }

  return ranges;
}
