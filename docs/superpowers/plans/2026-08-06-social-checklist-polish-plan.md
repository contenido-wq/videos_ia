# Social-checklist: silencios/titubeos + reveal grande con zoom — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el video `social-checklist` corte silencios y titubeos del video crudo del usuario (audio/video más orgánico), y que cada herramienta aparezca primero en una tarjeta grande centrada con zoom-in, antes de achicarse y aterrizar en su casilla de la lista con zoom-out — reemplazando el aterrizaje directo que existe hoy.

**Architecture:** Nuevo servicio puro-primero `videoTrimService.ts` (adaptado del trabajo ya hecho y probado en `.claude/worktrees/video-scenes-silence-removal`): detecta silencios (`ffmpeg silencedetect`) y titubeos (lista de muletillas + palabras repetidas, sobre la transcripción cruda), une ambos en una sola lista de cortes, recorta+concatena el video con `ffmpeg`, y re-mapea los timestamps de las palabras sobrevivientes a la nueva línea de tiempo — todo lo que ya existe (`matchItemTimestamps`) sigue funcionando sin cambios, solo cambian sus datos de entrada. En la composición, `SocialChecklist.tsx` gana un componente `RevealCard` (tarjeta grande con nombre + logo que se achica y vuela hacia la casilla chica) y una función de zoom sincronizada con esa misma ventana de tiempo.

**Tech Stack:** mismo del proyecto (Remotion 4 + TypeScript + ffmpeg/ffprobe + ElevenLabs Scribe + vitest).

## Global Constraints

- Silencios: `-20dB`, duración mínima **300ms** (más agresivo que los 500ms del trabajo original), padding **120ms**.
- Titubeos: lista fija de muletillas en español (`eh`, `ehh`, `eeh`, `este`, `esteee`, `digo`, `em`, `emm`, `mmm`, `o sea`) + palabras inmediatamente repetidas (se corta la primera ocurrencia). Automático, sin revisión humana.
- El video final queda recortado (`trimmed.<ext>`); el crudo (`source.<ext>`) se conserva sin tocar.
- El texto del nombre de la herramienta (`item.label`) solo se muestra durante el reveal grande — nunca en la casilla chica final (eso no cambia).
- Reveal grande: se sostiene **30 frames (1s @ 30fps)**, luego transiciona a la casilla chica en **10 frames (~0.33s)** adicionales. El ícono chico en la casilla aparece exactamente cuando termina esa transición.
- Zoom de cámara: sube a **1.08x**, sincronizado con la misma ventana (entra con el reveal, sale con la transición a la casilla).
- Slug de prueba para todo este plan: `5-herramientas-ia` (ya existe, `content/guiones/5-herramientas-ia.json`).

---

## Task 1: `videoTrimService` — detección y fusión de rangos de corte (TDD)

**Files:**
- Create: `src/services/videoTrimService.ts`
- Test: `src/services/videoTrimService.test.ts`

**Interfaces:**
- Consumes: `TranscribedWord` de `./checklistSyncService` (ya existe).
- Produces: `CutRange { start: number; end: number }`, `KeepRange { start: number; end: number }`, `parseSilenceDetectOutput(stderr: string, totalDurationSeconds?: number): CutRange[]`, `mergeCutRanges(ranges: CutRange[]): CutRange[]`, `computeKeepSegments(totalDurationSeconds: number, cutRanges: CutRange[], paddingSeconds?: number): KeepRange[]`. Tasks 2, 3 y 4 los usan.

- [ ] **Step 1: Escribir los tests (deben fallar: el archivo fuente no existe)**

Crear `src/services/videoTrimService.test.ts`:

```ts
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
```

- [ ] **Step 2: Correr los tests y confirmar que fallan**

Run: `npx vitest run src/services/videoTrimService.test.ts`
Expected: FAIL — `Cannot find module './videoTrimService'`.

- [ ] **Step 3: Implementar `src/services/videoTrimService.ts` (primera parte)**

```ts
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
```

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Run: `npx vitest run src/services/videoTrimService.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/videoTrimService.ts src/services/videoTrimService.test.ts
git commit -m "feat: add videoTrimService silence detection, ported and tested"
```

---

## Task 2: `videoTrimService` — titubeos y re-mapeo de palabras (TDD)

**Files:**
- Modify: `src/services/videoTrimService.ts`
- Modify: `src/services/videoTrimService.test.ts`

**Interfaces:**
- Produces: `detectFillerRanges(words: TranscribedWord[]): CutRange[]`, `remapWords(words: TranscribedWord[], cutRanges: CutRange[]): TranscribedWord[]`. Task 4 los usa.

- [ ] **Step 1: Agregar los tests (deben fallar: las funciones no existen)**

Reemplazar la línea de import de `"./videoTrimService"` al inicio de
`src/services/videoTrimService.test.ts` (la que quedó del Task 1) por:

```ts
import { describe, it, expect } from "vitest";
import {
  parseSilenceDetectOutput,
  mergeCutRanges,
  computeKeepSegments,
  detectFillerRanges,
  remapWords,
} from "./videoTrimService";
import type { TranscribedWord } from "./checklistSyncService";
```

Agregar al final del archivo:

```ts
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
    expect(result.map((w) => w.text)).toEqual(["antes", "despues"]);
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
```

- [ ] **Step 2: Correr los tests y confirmar que fallan**

Run: `npx vitest run src/services/videoTrimService.test.ts`
Expected: FAIL — `detectFillerRanges`/`remapWords` no exportados.

- [ ] **Step 3: Implementar las funciones**

Agregar al final de `src/services/videoTrimService.ts`:

```ts
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
```

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Run: `npx vitest run src/services/videoTrimService.test.ts`
Expected: PASS, 21 tests en total (12 del Task 1 + 9 nuevos).

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/videoTrimService.ts src/services/videoTrimService.test.ts
git commit -m "feat: detect filler words/repeats and remap word timestamps after trimming"
```

---

## Task 3: `trimVideoToSegments` — recorte real con ffmpeg (TDD)

**Files:**
- Modify: `src/services/videoTrimService.ts`
- Modify: `src/services/videoTrimService.test.ts`

**Interfaces:**
- Consumes: `getVideoDurationInSeconds` de `./ffmpegService` (ya existe).
- Produces: `trimVideoToSegments(inputPath: string, outputPath: string, segments: KeepRange[]): Promise<void>`. Task 4 la usa.

- [ ] **Step 1: Agregar los tests (deben fallar: la función no existe)**

Reemplazar el bloque de imports al inicio de
`src/services/videoTrimService.test.ts` (el que quedó del Task 2) por:

```ts
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
} from "./videoTrimService";
import type { TranscribedWord } from "./checklistSyncService";
import { getVideoDurationInSeconds } from "./ffmpegService";

const execFileAsync = promisify(execFile);
```

Agregar al final del archivo:

```ts
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
```

- [ ] **Step 2: Correr los tests y confirmar que fallan**

Run: `npx vitest run src/services/videoTrimService.test.ts`
Expected: FAIL — `trimVideoToSegments` no exportada.

- [ ] **Step 3: Implementar la función**

Agregar al final de `src/services/videoTrimService.ts`:

```ts
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
```

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Run: `npx vitest run src/services/videoTrimService.test.ts`
Expected: PASS, 23 tests en total.

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/videoTrimService.ts src/services/videoTrimService.test.ts
git commit -m "feat: add trimVideoToSegments, cuts and concatenates video with ffmpeg"
```

---

## Task 4: Integrar el recorte en `generateSocialChecklistAssets`

**Files:**
- Modify: `src/services/generateAssets.ts`

**Interfaces:**
- Consumes: todo lo de `videoTrimService.ts` (Tasks 1-3).
- Produces: `generateSocialChecklistAssets` ahora escribe un video **recortado**, y `public/data/5-herramientas-ia.json` con timestamps re-mapeados.

- [ ] **Step 1: Actualizar imports en `src/services/generateAssets.ts`**

Agregar esta línea inmediatamente después de la línea existente
`import { matchItemTimestamps, type TranscribedWord } from "./checklistSyncService";`:

```ts
import {
  detectSilenceRanges,
  detectFillerRanges,
  mergeCutRanges,
  computeKeepSegments,
  trimVideoToSegments,
  remapWords,
} from "./videoTrimService";
```

- [ ] **Step 2: Reescribir `generateSocialChecklistAssets`**

Reemplazar el cuerpo completo de la función (desde `async function
generateSocialChecklistAssets` hasta su cierre `}`) por:

```ts
async function generateSocialChecklistAssets(guion: SocialChecklistGuion): Promise<void> {
  console.log(`Generando recursos para "${guion.topic}" (social-checklist, ${guion.items.length} items)`);

  const rawExt = path.extname(guion.rawVideoPath) || ".mov";
  const rawVideoAbsPath = path.join(PUBLIC_DIR, "assets", guion.slug, "video", `source${rawExt}`);

  if (fs.existsSync(rawVideoAbsPath)) {
    console.log("video crudo ya copiado, se reutiliza");
  } else {
    console.log(`copiando video crudo desde ${guion.rawVideoPath}...`);
    fs.mkdirSync(path.dirname(rawVideoAbsPath), { recursive: true });
    fs.copyFileSync(guion.rawVideoPath, rawVideoAbsPath);
  }

  const rawDurationInSeconds = await getVideoDurationInSeconds(rawVideoAbsPath);

  const transcriptPath = path.join(PUBLIC_DIR, "assets", guion.slug, "transcript.json");
  let rawWords: TranscribedWord[];
  if (fs.existsSync(transcriptPath)) {
    console.log("transcripción ya existe, se reutiliza");
    rawWords = JSON.parse(fs.readFileSync(transcriptPath, "utf-8")) as TranscribedWord[];
  } else {
    const audioTmpPath = path.join(PUBLIC_DIR, "assets", guion.slug, "audio-for-transcription.mp3");
    console.log("extrayendo audio para transcribir...");
    await extractAudioTrack(rawVideoAbsPath, audioTmpPath);
    console.log("transcribiendo con ElevenLabs Scribe...");
    rawWords = await transcribeWithTimestamps(audioTmpPath);
    fs.writeFileSync(transcriptPath, JSON.stringify(rawWords, null, 2));
    fs.rmSync(audioTmpPath);
  }

  console.log("detectando silencios y titubeos...");
  const silenceRanges = await detectSilenceRanges(rawVideoAbsPath, rawDurationInSeconds);
  const fillerRanges = detectFillerRanges(rawWords);
  console.log(`  ${silenceRanges.length} silencio(s), ${fillerRanges.length} titubeo(s)/muletilla(s)`);
  const cutRanges = mergeCutRanges([...silenceRanges, ...fillerRanges]);
  const words = remapWords(rawWords, cutRanges);

  const trimmedVideoAbsPath = path.join(PUBLIC_DIR, "assets", guion.slug, "video", `trimmed${rawExt}`);
  if (fs.existsSync(trimmedVideoAbsPath)) {
    console.log("video recortado ya existe, se reutiliza");
  } else {
    const keepSegments = computeKeepSegments(rawDurationInSeconds, cutRanges, 0.12);
    console.log(`recortando video (${keepSegments.length} segmento(s) a conservar de ${cutRanges.length} corte(s))...`);
    await trimVideoToSegments(rawVideoAbsPath, trimmedVideoAbsPath, keepSegments);
  }

  const durationInSeconds = await getVideoDurationInSeconds(trimmedVideoAbsPath);
  console.log(`duración final: ${durationInSeconds.toFixed(1)}s (crudo: ${rawDurationInSeconds.toFixed(1)}s)`);

  const matches = matchItemTimestamps(words, guion.items, durationInSeconds);

  const renderedItems: RenderedChecklistItem[] = [];
  for (const { item, startSeconds, matched } of matches) {
    if (!matched) {
      console.log(
        `[${item.id}] no se encontró "${item.label}" en la transcripción, usando tiempo estimado (${startSeconds.toFixed(1)}s)`,
      );
    }

    const logoAbsPath = path.join(PUBLIC_DIR, "assets", guion.slug, "images", `item-${item.id}.png`);
    if (fs.existsSync(logoAbsPath)) {
      console.log(`[${item.id}] logo ya existe, se reutiliza`);
    } else {
      const wikimediaUrls = await findWikimediaImageUrls(item.logoQuery, 1);
      if (wikimediaUrls.length > 0) {
        console.log(`[${item.id}] descargando logo de Wikimedia...`);
        await downloadImageFromUrlWithRetry(wikimediaUrls[0], logoAbsPath);
      } else {
        console.log(`[${item.id}] sin resultados en Wikimedia, generando logo con kie.ai...`);
        await generateImage(
          `${item.logoQuery}, flat icon logo, centered, plain white background, no text`,
          logoAbsPath,
          { aspectRatio: "1:1" },
        );
      }
    }

    renderedItems.push({ ...item, startSeconds, matched, logoPath: toPublicRelPath(logoAbsPath) });
  }

  const rendered: RenderedSocialChecklistGuion = {
    type: "social-checklist",
    slug: guion.slug,
    topic: guion.topic,
    videoPath: toPublicRelPath(trimmedVideoAbsPath),
    durationInSeconds,
    listTitle: guion.listTitle,
    items: renderedItems,
  };

  const dataDir = path.join(PUBLIC_DIR, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, `${guion.slug}.json`), JSON.stringify(rendered, null, 2));

  const matchedCount = renderedItems.filter((i) => i.matched).length;
  console.log(
    `\nListo. Duración: ${durationInSeconds.toFixed(1)}s, ${renderedItems.length} items (${matchedCount} encontrados en transcripción).`,
  );
}
```

- [ ] **Step 3: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Correrlo de verdad contra el guion de prueba**

Run: `npm run generate:assets -- content/guiones/5-herramientas-ia.json`

Expected: el log muestra cuántos silencios y titubeos detectó, cuántos
segmentos va a conservar, recorta el video, y termina con `Listo. Duración:
<X>s, 5 items (...)`. `<X>` debe ser **menor** a los 72.1s del video crudo
(confirma que sí recortó algo).

- [ ] **Step 5: Inspeccionar el resultado**

Run: `cat public/data/5-herramientas-ia.json`

Expected: `videoPath` ahora apunta a
`assets/5-herramientas-ia/video/trimmed.mov`, `durationInSeconds` es menor
al crudo, y los 5 `startSeconds` siguen en orden no decreciente.

Run: `ls -la public/assets/5-herramientas-ia/video/`

Expected: existen tanto `source.mov` (crudo, sin tocar) como `trimmed.mov`
(más liviano/corto que el crudo).

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/services/generateAssets.ts public/data/5-herramientas-ia.json public/assets/5-herramientas-ia/video/trimmed.mov
git commit -m "feat: trim silence and filler words before matching checklist items"
```

---

## Task 5: `RevealCard` + zoom sincronizado en `SocialChecklist.tsx`

**Files:**
- Modify: `src/components/SocialChecklist.tsx`

**Interfaces:**
- Consumes: `RenderedSocialChecklistGuion`/`RenderedChecklistItem` (ya existen).
- Produces: componente `RevealCard`, función `computeZoomScale`, `ChecklistRow` actualizado para aparecer después del reveal grande.

- [ ] **Step 1: Reescribir `src/components/SocialChecklist.tsx` completo**

```tsx
import { AbsoluteFill, Img, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { loadFont } from "@remotion/google-fonts/Poppins";
import type { RenderedChecklistItem, RenderedSocialChecklistGuion } from "../types/guion";

const { fontFamily } = loadFont("normal", { weights: ["800", "900"] });

const REVEAL_HOLD_FRAMES = 30;
const TRANSITION_FRAMES = 10;
const ZOOM_SCALE = 1.08;

function getRowGeometry(index: number, total: number, width: number, height: number) {
  const topArea = height * 0.24;
  const bottomArea = height * 0.92;
  const rowHeight = (bottomArea - topArea) / total;
  const rowTop = topArea + rowHeight * index;
  const size = rowHeight * 0.72;
  const boxLeft = width * 0.06 + size + 16;
  return { centerX: boxLeft + size / 2, centerY: rowTop + size / 2, size };
}

function computeZoomScale(frame: number, fps: number, items: RenderedChecklistItem[]): number {
  for (const item of items) {
    const startFrame = Math.round(item.startSeconds * fps);
    const holdEndFrame = startFrame + REVEAL_HOLD_FRAMES;
    const windowEndFrame = holdEndFrame + TRANSITION_FRAMES;
    if (frame < startFrame || frame > windowEndFrame) continue;

    if (frame <= holdEndFrame) {
      const zoomIn = spring({
        frame: frame - startFrame,
        fps,
        config: { damping: 14, stiffness: 180, mass: 0.7 },
        durationInFrames: 10,
      });
      return 1 + (ZOOM_SCALE - 1) * zoomIn;
    }

    const zoomOut = interpolate(frame, [holdEndFrame, windowEndFrame], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    return 1 + (ZOOM_SCALE - 1) * zoomOut;
  }
  return 1;
}

const RevealCard: React.FC<{ item: RenderedChecklistItem; index: number; total: number }> = ({
  item,
  index,
  total,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const startFrame = Math.round(item.startSeconds * fps);
  const localFrame = frame - startFrame;
  const windowFrames = REVEAL_HOLD_FRAMES + TRANSITION_FRAMES;

  if (localFrame < 0 || localFrame > windowFrames) return null;

  const entrance = spring({
    frame: localFrame,
    fps,
    config: { damping: 14, stiffness: 200, mass: 0.6 },
    durationInFrames: 10,
  });

  const isTransitioning = localFrame > REVEAL_HOLD_FRAMES;
  const transitionProgress = isTransitioning
    ? interpolate(localFrame, [REVEAL_HOLD_FRAMES, windowFrames], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 0;

  const bigCenterX = width * 0.6;
  const bigCenterY = height * 0.45;
  const bigSize = width * 0.42;
  const target = getRowGeometry(index, total, width, height);

  const currentSize = bigSize + (target.size - bigSize) * transitionProgress;
  const currentCenterX = bigCenterX + (target.centerX - bigCenterX) * transitionProgress;
  const currentCenterY = bigCenterY + (target.centerY - bigCenterY) * transitionProgress;
  const cardOpacity = entrance * (1 - transitionProgress);

  return (
    <>
      {!isTransitioning && (
        <div
          className="absolute text-center text-white"
          style={{
            left: bigCenterX - bigSize,
            width: bigSize * 2,
            top: bigCenterY - bigSize / 2 - 60,
            fontFamily,
            fontWeight: 800,
            fontSize: 40,
            opacity: entrance,
            textShadow: "0 2px 12px rgba(0,0,0,0.6)",
          }}
        >
          {index + 1}. {item.label}
        </div>
      )}
      <div
        className="absolute flex items-center justify-center rounded-2xl bg-white"
        style={{
          left: currentCenterX - currentSize / 2,
          top: currentCenterY - currentSize / 2,
          width: currentSize,
          height: currentSize,
          opacity: cardOpacity,
          transform: `scale(${0.7 + entrance * 0.3})`,
        }}
      >
        <Img src={staticFile(item.logoPath)} style={{ width: "72%", height: "72%", objectFit: "contain" }} />
      </div>
    </>
  );
};

const ChecklistRow: React.FC<{
  index: number;
  total: number;
  landFrame: number;
  logoPath: string;
}> = ({ index, total, landFrame, logoPath }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const geometry = getRowGeometry(index, total, width, height);

  const localFrame = frame - landFrame;
  const hasArrived = localFrame >= 0;
  const entrance = spring({
    frame: Math.max(localFrame, 0),
    fps,
    config: { damping: 12, stiffness: 140, mass: 0.9 },
    durationInFrames: 18,
  });

  return (
    <div
      className="absolute flex items-center justify-center rounded-full bg-[#e5342b] text-white"
      style={{
        left: width * 0.06,
        top: geometry.centerY - geometry.size / 2,
        width: geometry.size,
        height: geometry.size,
        fontFamily,
        fontWeight: 900,
        fontSize: geometry.size * 0.5,
      }}
    >
      {index + 1}
      <div
        className="absolute flex items-center justify-center overflow-hidden rounded-2xl bg-white"
        style={{
          left: geometry.size + 16,
          top: 0,
          width: geometry.size,
          height: geometry.size,
        }}
      >
        {hasArrived && (
          <Img
            src={staticFile(logoPath)}
            style={{
              width: "72%",
              height: "72%",
              objectFit: "contain",
              opacity: entrance,
            }}
          />
        )}
      </div>
    </div>
  );
};

export const SocialChecklist: React.FC<{ slug: string; guion: RenderedSocialChecklistGuion | null }> = ({
  guion,
}) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();

  if (!guion) return null;

  const titleEntrance = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 200, mass: 0.6 },
    durationInFrames: 14,
  });

  const zoomScale = computeZoomScale(frame, fps, guion.items);

  return (
    <AbsoluteFill className="bg-black">
      <OffthreadVideo
        src={staticFile(guion.videoPath)}
        className="absolute inset-0 h-full w-full object-cover"
        style={{ transform: `scale(${zoomScale})` }}
      />

      <div
        className="absolute left-[6%] right-[6%] top-[4%] rounded-2xl bg-white px-6 py-4"
        style={{
          opacity: titleEntrance,
          transform: `translateY(${(1 - titleEntrance) * -20}px)`,
        }}
      >
        <p className="text-center uppercase text-black" style={{ fontFamily, fontWeight: 800, fontSize: 44, lineHeight: 1.15 }}>
          {guion.listTitle}
        </p>
      </div>

      {guion.items.map((item, i) => (
        <ChecklistRow
          key={item.id}
          index={i}
          total={guion.items.length}
          landFrame={Math.round(item.startSeconds * fps) + REVEAL_HOLD_FRAMES + TRANSITION_FRAMES}
          logoPath={item.logoPath}
        />
      ))}

      {guion.items.map((item, i) => (
        <RevealCard key={`reveal-${item.id}`} item={item} index={i} total={guion.items.length} />
      ))}
    </AbsoluteFill>
  );
};
```

Nota sobre el `ChecklistRow` reescrito: el número (círculo rojo) y la
casilla del logo ahora se posicionan con `getRowGeometry` (coordenadas
absolutas) en vez del `flex`/`gap` que usaba la versión anterior — es
necesario para que `RevealCard` pueda calcular exactamente a qué coordenada
tiene que volar, algo que no se puede leer de vuelta de un layout flex.

- [ ] **Step 2: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 4: Verificación visual — reveal grande en el momento de un item matcheado**

Abrir `public/data/5-herramientas-ia.json`, tomar el `startSeconds` del
item con `"matched": true`, multiplicarlo por 30 y sumarle 15 (para caer a
mitad del reveal grande, antes de que empiece a transicionar).

Run: `npx remotion still CincoHerramientasIA out/still-reveal.png --frame=<ese número>`

Leer `out/still-reveal.png`. Expected: se ve la tarjeta blanca grande
centrada con el logo y el texto "N. Label" arriba, el video de fondo con un
zoom-in sutil respecto al encuadre original, y la casilla chica de ese item
en la lista todavía vacía (no ha aterrizado).

- [ ] **Step 5: Verificación visual — logo ya aterrizado en la casilla**

Mismo `startSeconds` de arriba, esta vez `* 30 + 45` (después de
`REVEAL_HOLD_FRAMES + TRANSITION_FRAMES = 40`, con margen).

Run: `npx remotion still CincoHerramientasIA out/still-landed.png --frame=<ese número>`

Leer `out/still-landed.png`. Expected: la tarjeta grande ya no está, el
video volvió a su zoom original, y la casilla chica de ese item ya tiene el
logo (sin texto).

- [ ] **Step 6: Ajustar constantes si el resultado visual no cuadra**

Si el tamaño/posición de la tarjeta grande o la casilla chica se ve
recortada, superpuesta con el texto del título, o mal alineada con el
círculo numerado, ajustar `bigCenterX`/`bigCenterY`/`bigSize` en
`RevealCard` o el `boxLeft`/`size` de `getRowGeometry`, y repetir los Steps
4-5 hasta que se vea bien.

- [ ] **Step 7: Commit**

```bash
git add src/components/SocialChecklist.tsx
git commit -m "feat: add RevealCard with synced zoom, checklist icon lands after transition"
```

---

## Task 6: Render final de extremo a extremo

**Files:** ninguno nuevo — solo verificación.

- [ ] **Step 1: Render completo**

Run: `npx remotion render CincoHerramientasIA out/5-herramientas-ia-v2.mp4`
Expected: termina sin errores.

- [ ] **Step 2: Revisión manual**

Abrir `out/5-herramientas-ia-v2.mp4` y confirmar:
- El video se siente más fluido que la versión anterior (menos pausas,
  sin muletillas obvias).
- Cada vez que se menciona una herramienta, aparece la tarjeta grande con
  zoom-in, se sostiene ~1s, y se achica volando hacia su casilla con
  zoom-out.
- La casilla chica nunca muestra texto, solo el logo, una vez aterrizado
  se queda fijo.
- El audio sigue siendo el real de la persona (sin cortes audibles raros
  en los empalmes del recorte).

- [ ] **Step 3: Correr toda la suite de tests una vez más de punta a punta**

Run: `npm run test && npm run lint`
Expected: ambos PASS.

- [ ] **Step 4: Commit**

```bash
git add out/5-herramientas-ia-v2.mp4
```

(si `out/` está en `.gitignore`, este `git add` no agrega nada — está bien,
es solo el paso de verificación final.)
