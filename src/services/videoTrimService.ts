import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import type { TranscribedWord } from "./checklistSyncService";

const execFileAsync = promisify(execFile);

const SILENCE_NOISE_DB = "-20dB";
const SILENCE_MIN_DURATION_SECONDS = 0.3;

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
  const { stderr } = await execFileAsync("ffmpeg", [
    "-i", videoPath,
    "-af", `silencedetect=noise=${SILENCE_NOISE_DB}:d=${SILENCE_MIN_DURATION_SECONDS}`,
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

const FILLER_WORDS = ["eh", "ehh", "eeh", "este", "esteee", "digo", "em", "emm", "mmm"];
const FILLER_PHRASES = ["o sea"];

function normalizeWord(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

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

  for (let i = 0; i < words.length - 1; i++) {
    if (normalized[i].length > 0 && normalized[i] === normalized[i + 1]) {
      ranges.push({ start: words[i].start, end: words[i].end });
    }
  }

  return ranges;
}

export function remapWords(words: TranscribedWord[], cutRanges: CutRange[]): TranscribedWord[] {
  const merged = mergeCutRanges(cutRanges);
  const result: TranscribedWord[] = [];

  for (const word of words) {
    const isCut = merged.some((r) => word.start >= r.start && word.start < r.end);
    if (isCut) continue;

    const removedBefore = merged
      .filter((r) => r.end <= word.start)
      .reduce((acc, r) => acc + (r.end - r.start), 0);

    result.push({
      text: word.text,
      start: word.start - removedBefore,
      end: word.end - removedBefore,
    });
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
