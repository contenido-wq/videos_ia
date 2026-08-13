import type { ChecklistItem, PantallaDivididaScene } from "../types/guion";

export interface TranscribedWord {
  text: string;
  start: number;
  end: number;
}

export interface DiarizedWord extends TranscribedWord {
  speakerId: string;
}

export interface MatchedItem {
  item: ChecklistItem;
  startSeconds: number;
  matched: boolean;
}

export interface MatchedScene {
  scene: PantallaDivididaScene;
  startSeconds: number;
  durationInSeconds: number;
  matched: boolean;
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function findFirstMatchForText(text: string, words: TranscribedWord[], normalizedWords: string[]): number | null {
  const targetWords = text.split(/\s+/).filter(Boolean).map(normalize);
  if (targetWords.length === 0) return null;

  const target = targetWords.join("");
  for (let i = 0; i <= normalizedWords.length - targetWords.length; i++) {
    const windowText = normalizedWords.slice(i, i + targetWords.length).join("");
    if (windowText === target) {
      return words[i].start;
    }
  }
  return null;
}

/**
 * Dada una lista de candidatos (uno por item/escena, en el orden en que deben aparecer),
 * descarta los que salen antes que el candidato aceptado anterior (falso positivo / fuera
 * de orden) y a los sin match aceptado les asigna un tiempo estimado, interpolado entre el
 * aceptado anterior y el siguiente (o el final del video si no hay uno siguiente) — el
 * resultado nunca falla y los timestamps finales siempre quedan en orden no decreciente.
 */
function resolveTimestamps(
  rawMatches: (number | null)[],
  totalDurationSeconds: number,
): { startSeconds: number; matched: boolean }[] {
  const accepted: (number | null)[] = [];
  let lastAccepted = -Infinity;
  for (const candidate of rawMatches) {
    if (candidate !== null && candidate >= lastAccepted) {
      accepted.push(candidate);
      lastAccepted = candidate;
    } else {
      accepted.push(null);
    }
  }

  const resolved: number[] = accepted.map((v) => v ?? 0);
  let i = 0;
  while (i < accepted.length) {
    if (accepted[i] !== null) {
      i++;
      continue;
    }
    let j = i;
    while (j < accepted.length && accepted[j] === null) j++;

    const rangeStart = i === 0 ? 0 : (accepted[i - 1] as number);
    const rangeEnd = j < accepted.length ? (accepted[j] as number) : totalDurationSeconds;
    const gapCount = j - i + 1;
    for (let k = i; k < j; k++) {
      const fraction = (k - i + 1) / gapCount;
      resolved[k] = rangeStart + (rangeEnd - rangeStart) * fraction;
    }
    i = j;
  }

  return resolved.map((startSeconds, idx) => ({ startSeconds, matched: accepted[idx] !== null }));
}

export function matchItemTimestamps(
  words: TranscribedWord[],
  items: ChecklistItem[],
  totalDurationSeconds: number,
): MatchedItem[] {
  const normalizedWords = words.map((w) => normalize(w.text));
  const rawMatches = items.map((item) => findFirstMatchForText(item.label, words, normalizedWords));
  const results = resolveTimestamps(rawMatches, totalDurationSeconds);

  return items.map((item, idx) => ({
    item,
    startSeconds: results[idx].startSeconds,
    matched: results[idx].matched,
  }));
}

/**
 * Igual que matchItemTimestamps, pero matcheando el texto completo de cada escena (no un
 * label corto) y devolviendo también la duración de cada escena: el tiempo hasta que
 * arranca la siguiente (o hasta el final del video para la última).
 */
export function matchSceneTimestamps(
  words: TranscribedWord[],
  scenes: PantallaDivididaScene[],
  totalDurationSeconds: number,
): MatchedScene[] {
  const normalizedWords = words.map((w) => normalize(w.text));
  const rawMatches = scenes.map((scene) => findFirstMatchForText(scene.text, words, normalizedWords));
  const results = resolveTimestamps(rawMatches, totalDurationSeconds);

  return scenes.map((scene, idx) => {
    const startSeconds = results[idx].startSeconds;
    const nextStart = idx + 1 < results.length ? results[idx + 1].startSeconds : totalDurationSeconds;
    return {
      scene,
      startSeconds,
      durationInSeconds: Math.max(nextStart - startSeconds, 0),
      matched: results[idx].matched,
    };
  });
}
