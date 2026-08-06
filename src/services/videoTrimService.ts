import { execFile } from "child_process";
import { promisify } from "util";

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
