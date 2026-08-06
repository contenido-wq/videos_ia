import type { ChecklistItem } from "../types/guion";

export interface TranscribedWord {
  text: string;
  start: number;
  end: number;
}

export interface MatchedItem {
  item: ChecklistItem;
  startSeconds: number;
  matched: boolean;
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function findFirstMatch(item: ChecklistItem, words: TranscribedWord[], normalizedWords: string[]): number | null {
  const labelWords = item.label.split(/\s+/).filter(Boolean).map(normalize);
  if (labelWords.length === 0) return null;

  const target = labelWords.join("");
  for (let i = 0; i <= normalizedWords.length - labelWords.length; i++) {
    const windowText = normalizedWords.slice(i, i + labelWords.length).join("");
    if (windowText === target) {
      return words[i].start;
    }
  }
  return null;
}

/**
 * Por cada item busca su primera mención en la transcripción. Si el match sale
 * antes que el del item anterior aceptado (falso positivo / fuera de orden),
 * se descarta. A los items sin match aceptado se les asigna un tiempo estimado,
 * interpolado entre el timestamp aceptado anterior y el siguiente (o el final
 * del video si no hay uno siguiente) — así el resultado nunca falla y los
 * timestamps finales siempre quedan en orden no decreciente.
 */
export function matchItemTimestamps(
  words: TranscribedWord[],
  items: ChecklistItem[],
  totalDurationSeconds: number,
): MatchedItem[] {
  const normalizedWords = words.map((w) => normalize(w.text));

  const rawMatches = items.map((item) => findFirstMatch(item, words, normalizedWords));

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

  return items.map((item, idx) => ({
    item,
    startSeconds: resolved[idx],
    matched: accepted[idx] !== null,
  }));
}
