# Video propio: corte de silencios + escenas de b-roll — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir `content/raw/video-1-jhei.mov` en un video documental con silencios eliminados y escenas de b-roll (collages de Wikimedia Commons) sincronizadas con lo que la persona va diciendo.

**Architecture:** Pipeline de 4 etapas ejecutado por un script CLI (`generateUserVideoAssets.ts`, mismo patrón que `generateAssets.ts` existente): (1) ffmpeg corta los silencios del video crudo, (2) ElevenLabs Scribe transcribe el video recortado con timestamps por palabra, (3) las palabras se agrupan en escenas de 3-6s con palabras clave, escribiendo un borrador para revisión humana, (4) tras la revisión, se buscan imágenes en Wikimedia Commons por escena y se arma el JSON final. Una composición nueva de Remotion (`UserVideoComposition.tsx`) reproduce el audio del video recortado de corrido mientras superpone un collage por escena en su rango exacto de tiempo (`Sequence` posicionado por timestamp real, sin `TransitionSeries`, para no desincronizar del audio).

**Tech Stack:** Remotion 4 + React 19 + TypeScript, ffmpeg/ffprobe (CLI local), ElevenLabs API (Scribe STT), Wikimedia Commons API (búsqueda pública, sin key), vitest (nuevo, para las funciones puras del pipeline).

## Global Constraints

- Silencio: umbral **-35dB**, duración mínima **500ms** para contar como silencio, **120ms** de aire agregado antes/después de cada tramo con voz.
- Escenas: **3 a 6 segundos**, cortadas en la pausa más cercana ≥250ms dentro de ese rango; si no hay pausa antes de los 6s, corte forzado igual.
- Formato de salida: **1080×1920 @ 30fps**.
- Fuente de imágenes: **Wikimedia Commons únicamente** (no Apify) para esta feature.
- Hay un punto de **revisión humana obligatorio** entre transcribir/segmentar y buscar imágenes — el pipeline se corre en dos pasadas separadas (`--hasta-borrador` / `--desde-borrador`).
- B-roll siempre a **pantalla completa** (nunca picture-in-picture).
- Un solo video por corrida. Slug de prueba: `video-1-jhei` (`content/raw/video-1-jhei.mov`, ya copiado, gitignored).

**Nota sobre una desviación del spec original:** el spec decía reusar `content/guiones/<slug>.json` (mismo tipo `Guion`) para el resultado final. Al planear se detectó que `CollageScene.tsx` siempre reproduce `scene.audioPath` como narración — eso chocaría con nuestro audio único y continuo. Este plan agrega un prop `narrationAudio` a `CollageScene` para desactivar esa reproducción por-escena, y usa tipos propios (`UserVideoDraft`/`UserVideoRenderedGuion`) en vez de forzar el tipo `Guion` con campos que no aplican (`apifyQuery`, `visual`, voz TTS). El archivo final queda en `public/data/<slug>-uservideo.json` en vez de `content/guiones/<slug>.json`. No cambia ninguna decisión que ya aprobaste, solo el detalle interno de dónde vive el dato.

---

## Task 1: Lógica pura de detección de silencios

**Files:**
- Create: `src/services/silenceRemovalService.ts`
- Test: `src/services/silenceRemovalService.test.ts`
- Modify: `package.json` (agregar `vitest` como devDependency y script `test`)

**Interfaces:**
- Produces: `SilenceRange { start: number; end: number }`, `SpeechRange { start: number; end: number }`, `parseSilenceDetectOutput(stderr: string, totalDurationSeconds?: number): SilenceRange[]`, `computeSpeechSegments(totalDurationSeconds: number, silences: SilenceRange[], paddingSeconds?: number): SpeechRange[]`

- [ ] **Step 1: Instalar vitest**

Run: `npm install -D vitest`

- [ ] **Step 2: Agregar script de test**

En `package.json`, dentro de `"scripts"`, agregar:

```json
"test": "vitest run"
```

- [ ] **Step 3: Escribir los tests (deben fallar: el archivo fuente no existe todavía)**

Crear `src/services/silenceRemovalService.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseSilenceDetectOutput, computeSpeechSegments } from "./silenceRemovalService";

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

describe("computeSpeechSegments", () => {
  it("sin silencios, devuelve un solo tramo con toda la duración", () => {
    expect(computeSpeechSegments(10, [])).toEqual([{ start: 0, end: 10 }]);
  });

  it("un silencio en el medio produce dos tramos de voz encogidos por el padding", () => {
    const result = computeSpeechSegments(10, [{ start: 4, end: 6 }], 0.12);
    expect(result).toEqual([
      { start: 0, end: 4.12 },
      { start: 5.88, end: 10 },
    ]);
  });

  it("silencio pegado al inicio no genera un tramo vacío antes", () => {
    const result = computeSpeechSegments(10, [{ start: 0, end: 2 }], 0.12);
    expect(result).toEqual([{ start: 1.88, end: 10 }]);
  });

  it("silencio que llega hasta el final no genera un tramo vacío al final", () => {
    const result = computeSpeechSegments(10, [{ start: 8, end: 10 }], 0.12);
    expect(result).toEqual([{ start: 0, end: 8.12 }]);
  });
});
```

- [ ] **Step 4: Correr los tests y confirmar que fallan**

Run: `npx vitest run src/services/silenceRemovalService.test.ts`
Expected: FAIL — `Cannot find module './silenceRemovalService'` (el archivo aún no existe).

- [ ] **Step 5: Implementar las dos funciones puras**

Crear `src/services/silenceRemovalService.ts`:

```ts
export interface SilenceRange {
  start: number;
  end: number;
}

export interface SpeechRange {
  start: number;
  end: number;
}

export function parseSilenceDetectOutput(
  stderr: string,
  totalDurationSeconds = Infinity,
): SilenceRange[] {
  const pendingStarts: number[] = [];
  const ranges: SilenceRange[] = [];

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

export function computeSpeechSegments(
  totalDurationSeconds: number,
  silences: SilenceRange[],
  paddingSeconds = 0.12,
): SpeechRange[] {
  const sorted = [...silences].sort((a, b) => a.start - b.start);
  const speech: SpeechRange[] = [];
  let cursor = 0;

  for (const silence of sorted) {
    const start = cursor;
    const end = Math.min(silence.start + paddingSeconds, totalDurationSeconds);
    if (end > start) {
      speech.push({ start, end });
    }
    cursor = Math.max(cursor, silence.end - paddingSeconds);
  }

  if (cursor < totalDurationSeconds) {
    speech.push({ start: cursor, end: totalDurationSeconds });
  }

  return speech.filter((r) => r.end > r.start);
}
```

- [ ] **Step 6: Correr los tests y confirmar que pasan**

Run: `npx vitest run src/services/silenceRemovalService.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/services/silenceRemovalService.ts src/services/silenceRemovalService.test.ts
git commit -m "feat: add pure silence-detection and speech-segment logic"
```

---

## Task 2: Corte real del video con ffmpeg

**Files:**
- Modify: `src/services/silenceRemovalService.ts`

**Interfaces:**
- Consumes: `parseSilenceDetectOutput`, `computeSpeechSegments` (Task 1)
- Produces: `getMediaDurationSeconds(filePath: string): Promise<number>`, `removeSilence(inputPath: string, outputVideoPath: string): Promise<{ trimmedDurationSeconds: number }>`, `extractAudioForTranscription(videoPath: string, outputAudioPath: string): Promise<string>`

No hay test unitario en este task (todo es I/O real contra ffmpeg/ffprobe); la verificación es correr el pipeline contra el video real.

- [ ] **Step 1: Agregar las funciones de I/O al final de `silenceRemovalService.ts`**

```ts
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const SILENCE_NOISE_DB = "-35dB";
const SILENCE_MIN_DURATION_SECONDS = 0.5;
const SPEECH_PADDING_SECONDS = 0.12;
const OUTPUT_WIDTH = 1080;
const OUTPUT_HEIGHT = 1920;
const OUTPUT_FPS = 30;

export async function getMediaDurationSeconds(filePath: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  return parseFloat(stdout.trim());
}

export async function removeSilence(
  inputPath: string,
  outputVideoPath: string,
): Promise<{ trimmedDurationSeconds: number }> {
  const totalDuration = await getMediaDurationSeconds(inputPath);

  const { stderr } = await execFileAsync("ffmpeg", [
    "-i", inputPath,
    "-af", `silencedetect=noise=${SILENCE_NOISE_DB}:d=${SILENCE_MIN_DURATION_SECONDS}`,
    "-f", "null", "-",
  ]);

  const silences = parseSilenceDetectOutput(stderr, totalDuration);
  const segments = computeSpeechSegments(totalDuration, silences, SPEECH_PADDING_SECONDS);

  if (segments.length === 0) {
    throw new Error(`No se detectó voz en ${inputPath} (todo por debajo de ${SILENCE_NOISE_DB})`);
  }

  const filterParts: string[] = [];
  segments.forEach((seg, i) => {
    filterParts.push(
      `[0:v]trim=start=${seg.start}:end=${seg.end},setpts=PTS-STARTPTS,scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}[v${i}]`,
    );
    filterParts.push(`[0:a]atrim=start=${seg.start}:end=${seg.end},asetpts=PTS-STARTPTS[a${i}]`);
  });
  const concatInputs = segments.map((_, i) => `[v${i}][a${i}]`).join("");
  filterParts.push(`${concatInputs}concat=n=${segments.length}:v=1:a=1[outv][outa]`);

  fs.mkdirSync(path.dirname(outputVideoPath), { recursive: true });

  await execFileAsync("ffmpeg", [
    "-y",
    "-i", inputPath,
    "-filter_complex", filterParts.join(";"),
    "-map", "[outv]",
    "-map", "[outa]",
    "-r", String(OUTPUT_FPS),
    outputVideoPath,
  ]);

  const trimmedDurationSeconds = segments.reduce((acc, s) => acc + (s.end - s.start), 0);
  return { trimmedDurationSeconds };
}

export async function extractAudioForTranscription(
  videoPath: string,
  outputAudioPath: string,
): Promise<string> {
  fs.mkdirSync(path.dirname(outputAudioPath), { recursive: true });
  await execFileAsync("ffmpeg", ["-y", "-i", videoPath, "-vn", "-acodec", "libmp3lame", outputAudioPath]);
  return outputAudioPath;
}
```

- [ ] **Step 2: Verificación manual contra el video real**

Run:

```bash
npx tsx -e '
import { removeSilence, extractAudioForTranscription } from "./src/services/silenceRemovalService";
(async () => {
  const r = await removeSilence("content/raw/video-1-jhei.mov", "public/assets/video-1-jhei/video/trimmed.mp4");
  console.log("trimmedDurationSeconds:", r.trimmedDurationSeconds);
  await extractAudioForTranscription("public/assets/video-1-jhei/video/trimmed.mp4", "public/assets/video-1-jhei/video/trimmed-audio.mp3");
  console.log("audio extraído");
})();
'
ffprobe -v error -show_entries format=duration -show_entries stream=width,height -of default=noprint_wrappers=1 public/assets/video-1-jhei/video/trimmed.mp4
```

Expected: `trimmedDurationSeconds` menor a 72.09 (duración original) si había pausas; `width=1080`, `height=1920` en el video de salida; el archivo `trimmed-audio.mp3` existe. Si `trimmedDurationSeconds` es prácticamente igual a la duración original, bajar el umbral (`SILENCE_NOISE_DB` a un valor menos negativo, ej. `-30dB`) y volver a correr.

- [ ] **Step 3: Commit**

```bash
git add src/services/silenceRemovalService.ts
git commit -m "feat: cut silence from source video with ffmpeg"
```

---

## Task 3: Transcripción con ElevenLabs Scribe

**Files:**
- Create: `src/types/userVideoGuion.ts`
- Modify: `src/services/elevenlabsService.ts`
- Test: `src/services/elevenlabsService.test.ts`

**Interfaces:**
- Produces: `TranscriptWord { text: string; start: number; end: number; type: "word" }` (en `userVideoGuion.ts`), `mapScribeResponseToWords(responseJson: unknown): TranscriptWord[]` y `transcribeAudio(filePath: string): Promise<TranscriptWord[]>` (en `elevenlabsService.ts`)

- [ ] **Step 1: Crear el archivo de tipos compartidos**

Crear `src/types/userVideoGuion.ts`:

```ts
import type { GuionScene } from "./guion";

export interface TranscriptWord {
  text: string;
  start: number;
  end: number;
  type: "word";
}

export interface UserVideoDraftScene {
  id: string;
  startSeconds: number;
  endSeconds: number;
  text: string;
  keywords: string[];
  layout?: GuionScene["layout"];
}

export interface UserVideoDraft {
  slug: string;
  sourceVideoPath: string;
  totalDurationSeconds: number;
  scenes: UserVideoDraftScene[];
}

export interface UserVideoRenderedScene extends UserVideoDraftScene {
  collageImagePaths: string[];
}

export interface UserVideoRenderedGuion {
  slug: string;
  sourceVideoPath: string;
  totalDurationSeconds: number;
  scenes: UserVideoRenderedScene[];
}
```

- [ ] **Step 2: Escribir el test de mapeo (debe fallar: la función no existe todavía)**

Crear `src/services/elevenlabsService.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mapScribeResponseToWords } from "./elevenlabsService";

describe("mapScribeResponseToWords", () => {
  it("se queda solo con las entradas type=word y convierte start/end a número", () => {
    const response = {
      language_code: "spa",
      text: "hola mundo",
      words: [
        { text: "hola", start: 0.0, end: 0.42, type: "word" },
        { text: " ", start: 0.42, end: 0.5, type: "spacing" },
        { text: "mundo", start: 0.5, end: 1.1, type: "word" },
      ],
    };

    expect(mapScribeResponseToWords(response)).toEqual([
      { text: "hola", start: 0.0, end: 0.42, type: "word" },
      { text: "mundo", start: 0.5, end: 1.1, type: "word" },
    ]);
  });

  it("lanza error si la respuesta no tiene un array 'words'", () => {
    expect(() => mapScribeResponseToWords({})).toThrow();
  });
});
```

- [ ] **Step 3: Correr el test y confirmar que falla**

Run: `npx vitest run src/services/elevenlabsService.test.ts`
Expected: FAIL — `mapScribeResponseToWords is not a function` o import error.

- [ ] **Step 4: Implementar `mapScribeResponseToWords` y `transcribeAudio`**

En `src/services/elevenlabsService.ts`, agregar al inicio del archivo el import del tipo y al final las dos funciones:

```ts
import type { TranscriptWord } from "../types/userVideoGuion";
```

```ts
export function mapScribeResponseToWords(responseJson: unknown): TranscriptWord[] {
  const data = responseJson as { words?: unknown };
  if (!data || !Array.isArray(data.words)) {
    throw new Error("Respuesta de ElevenLabs Scribe sin campo 'words' válido");
  }

  return (data.words as Array<Record<string, unknown>>)
    .filter((w) => w.type === "word" && typeof w.text === "string")
    .map((w) => ({
      text: w.text as string,
      start: Number(w.start),
      end: Number(w.end),
      type: "word" as const,
    }));
}

export async function transcribeAudio(filePath: string): Promise<TranscriptWord[]> {
  const fileBuffer = fs.readFileSync(filePath);
  const form = new FormData();
  form.append("model_id", "scribe_v1");
  form.append("timestamps_granularity", "word");
  form.append("file", new Blob([fileBuffer]), path.basename(filePath));

  const res = await fetch(`${BASE_URL}/speech-to-text`, {
    method: "POST",
    headers: { "xi-api-key": env.elevenLabsApiKey },
    body: form,
  });

  if (!res.ok) {
    throw new Error(`ElevenLabs transcribeAudio falló: ${res.status} ${await res.text()}`);
  }

  return mapScribeResponseToWords(await res.json());
}
```

(`fs` y `path` ya están importados al inicio del archivo; `BASE_URL` y `env` también ya existen ahí.)

- [ ] **Step 5: Correr el test y confirmar que pasa**

Run: `npx vitest run src/services/elevenlabsService.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Smoke test real contra la API de ElevenLabs**

Run:

```bash
npx tsx -e '
import { transcribeAudio } from "./src/services/elevenlabsService";
(async () => {
  const words = await transcribeAudio("public/assets/video-1-jhei/video/trimmed-audio.mp3");
  console.log("palabras:", words.length);
  console.log(JSON.stringify(words.slice(0, 10), null, 2));
})();
'
```

Expected: una lista de palabras con `start`/`end` crecientes que, leídas en orden, arman frases coherentes en español. Si el campo `words` no viene en la respuesta (revisa el JSON completo con `console.log(JSON.stringify(await res.json()))` temporalmente dentro de `transcribeAudio`), ajustar `mapScribeResponseToWords` al nombre real del campo que use la API en ese momento y repetir este step.

- [ ] **Step 7: Commit**

```bash
git add src/types/userVideoGuion.ts src/services/elevenlabsService.ts src/services/elevenlabsService.test.ts
git commit -m "feat: transcribe trimmed video with ElevenLabs Scribe"
```

---

## Task 4: Segmentación en escenas + palabras clave

**Files:**
- Create: `src/services/sceneSegmentationService.ts`
- Test: `src/services/sceneSegmentationService.test.ts`

**Interfaces:**
- Consumes: `TranscriptWord` (Task 3), `UserVideoDraftScene` (Task 3)
- Produces: `extractKeywords(text: string, max?: number): string[]`, `segmentIntoScenes(words: TranscriptWord[], opts?: { minSeconds?: number; maxSeconds?: number; pauseThresholdSeconds?: number }): UserVideoDraftScene[]`

- [ ] **Step 1: Escribir los tests (deben fallar: el archivo no existe todavía)**

Crear `src/services/sceneSegmentationService.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { extractKeywords, segmentIntoScenes } from "./sceneSegmentationService";
import type { TranscriptWord } from "../types/userVideoGuion";

function word(text: string, start: number, end: number): TranscriptWord {
  return { text, start, end, type: "word" };
}

describe("extractKeywords", () => {
  it("descarta stopwords y prioriza nombres propios y palabras largas", () => {
    const keywords = extractKeywords("El Mundial 2026 hizo historia en Norteamérica", 3);
    expect(keywords).toEqual(["Mundial", "Norteamérica", "historia"]);
  });

  it("no repite la misma palabra en distinto casing", () => {
    const keywords = extractKeywords("Claude Claude claude es una inteligencia artificial", 5);
    expect(keywords.filter((k) => k.toLowerCase() === "claude")).toHaveLength(1);
  });
});

describe("segmentIntoScenes", () => {
  it("corta en la pausa cuando ya pasaron al menos minSeconds", () => {
    const words: TranscriptWord[] = [
      word("El", 0, 0.2),
      word("Mundial", 0.2, 0.8),
      word("2026", 0.8, 1.3),
      word("hizo", 1.3, 1.6),
      word("historia", 1.6, 3.3), // duración acumulada ya pasa minSeconds=3 aquí
      // pausa de 0.4s (>= pauseThresholdSeconds=0.25)
      word("Fue", 3.7, 3.9),
      word("un", 3.9, 4.0),
      word("torneo", 4.0, 4.6),
      word("histórico", 4.6, 5.4),
    ];

    const scenes = segmentIntoScenes(words, { minSeconds: 3, maxSeconds: 6, pauseThresholdSeconds: 0.25 });

    expect(scenes).toHaveLength(2);
    expect(scenes[0].text).toBe("El Mundial 2026 hizo historia");
    expect(scenes[0].startSeconds).toBe(0);
    expect(scenes[0].endSeconds).toBe(3.3);
    expect(scenes[1].text).toBe("Fue un torneo histórico");
    expect(scenes[1].startSeconds).toBe(3.7);
    expect(scenes[1].endSeconds).toBe(5.4);
  });

  it("fuerza un corte a los maxSeconds si no hay pausas", () => {
    const words: TranscriptWord[] = [];
    for (let i = 0; i < 20; i++) {
      words.push(word(`palabra${i}`, i * 0.4, i * 0.4 + 0.35));
    }
    // 20 palabras de ~0.4s cada una, sin pausas >= pauseThresholdSeconds -> 8s corridos

    const scenes = segmentIntoScenes(words, { minSeconds: 3, maxSeconds: 6, pauseThresholdSeconds: 0.25 });

    expect(scenes.length).toBeGreaterThan(1);
    for (const scene of scenes) {
      expect(scene.endSeconds - scene.startSeconds).toBeLessThanOrEqual(6.4);
    }
  });

  it("pega un remanente corto al final a la escena anterior en vez de dejarlo huérfano", () => {
    const words: TranscriptWord[] = [
      word("Uno", 0, 1.5),
      word("dos", 1.5, 3.2),
      word("tres", 3.2, 4.9),
      // pausa
      word("fin", 5.3, 5.6), // remanente de 0.3s, menor a minSeconds=3
    ];

    const scenes = segmentIntoScenes(words, { minSeconds: 3, maxSeconds: 6, pauseThresholdSeconds: 0.25 });

    expect(scenes).toHaveLength(1);
    expect(scenes[0].text).toBe("Uno dos tres fin");
    expect(scenes[0].endSeconds).toBe(5.6);
  });

  it("devuelve [] si no hay palabras", () => {
    expect(segmentIntoScenes([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Correr los tests y confirmar que fallan**

Run: `npx vitest run src/services/sceneSegmentationService.test.ts`
Expected: FAIL — `Cannot find module './sceneSegmentationService'`

- [ ] **Step 3: Implementar `extractKeywords` y `segmentIntoScenes`**

Crear `src/services/sceneSegmentationService.ts`:

```ts
import type { TranscriptWord, UserVideoDraftScene } from "../types/userVideoGuion";

const SPANISH_STOPWORDS = new Set([
  "el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del", "en",
  "y", "o", "que", "es", "son", "con", "por", "para", "se", "su", "sus",
  "lo", "al", "a", "mi", "tu", "este", "esta", "esto", "estos", "estas",
  "como", "más", "pero", "si", "no", "ya", "fue", "era", "les", "le", "nos",
  "yo", "tú", "él", "ella", "ellos", "ellas", "muy", "también", "así",
  "eso", "esa", "ese", "cuando", "donde", "porque", "entre", "sobre", "hay",
  "he", "ha", "vamos", "voy", "va", "están", "está", "soy", "eres", "desde",
  "hasta", "sin", "todo", "toda", "todos", "todas",
]);

// Heurística simple sin NLP: si el transcript trae mayúsculas, las palabras
// con mayúscula inicial (nombres propios) van primero; si no, esto no hace
// nada y cae directo al fallback de "palabras más largas sin stopwords".
export function extractKeywords(text: string, max = 4): string[] {
  const words = text
    .replace(/[.,;:!?¿¡"'()]/g, "")
    .split(/\s+/)
    .filter(Boolean);

  const candidates = words.filter(
    (w) => w.length > 2 && !SPANISH_STOPWORDS.has(w.toLowerCase()),
  );

  const properNouns = candidates.filter((w) => /^[A-ZÁÉÍÓÚÑ]/.test(w));
  const rest = candidates
    .filter((w) => !properNouns.includes(w))
    .sort((a, b) => b.length - a.length);

  const unique: string[] = [];
  for (const word of [...properNouns, ...rest]) {
    const normalized = word.toLowerCase();
    if (!unique.some((u) => u.toLowerCase() === normalized)) {
      unique.push(word);
    }
    if (unique.length >= max) break;
  }
  return unique;
}

export function segmentIntoScenes(
  words: TranscriptWord[],
  opts: { minSeconds?: number; maxSeconds?: number; pauseThresholdSeconds?: number } = {},
): UserVideoDraftScene[] {
  const minSeconds = opts.minSeconds ?? 3;
  const maxSeconds = opts.maxSeconds ?? 6;
  const pauseThresholdSeconds = opts.pauseThresholdSeconds ?? 0.25;

  if (words.length === 0) return [];

  const groups: TranscriptWord[][] = [];
  let current: TranscriptWord[] = [words[0]];

  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    const prev = words[i - 1];
    const gap = w.start - prev.end;
    const currentDuration = prev.end - current[0].start;

    const atNaturalPause = currentDuration >= minSeconds && gap >= pauseThresholdSeconds;
    const mustCut = currentDuration >= maxSeconds;

    if (atNaturalPause || mustCut) {
      groups.push(current);
      current = [w];
    } else {
      current.push(w);
    }
  }
  groups.push(current);

  if (groups.length > 1) {
    const last = groups[groups.length - 1];
    const lastDuration = last[last.length - 1].end - last[0].start;
    if (lastDuration < minSeconds) {
      const merged = groups.pop()!;
      groups[groups.length - 1].push(...merged);
    }
  }

  return groups.map((group, i) => {
    const text = group.map((w) => w.text).join(" ");
    return {
      id: `s${String(i + 1).padStart(2, "0")}`,
      startSeconds: group[0].start,
      endSeconds: group[group.length - 1].end,
      text,
      keywords: extractKeywords(text),
    };
  });
}
```

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Run: `npx vitest run src/services/sceneSegmentationService.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/sceneSegmentationService.ts src/services/sceneSegmentationService.test.ts
git commit -m "feat: segment transcript into scenes with keywords"
```

---

## Task 5: Script orquestador — modo `--hasta-borrador`

**Files:**
- Create: `src/services/generateUserVideoAssets.ts`
- Modify: `package.json` (agregar script `generate:user-video`)

**Interfaces:**
- Consumes: `removeSilence`, `extractAudioForTranscription` (Task 2), `transcribeAudio` (Task 3), `segmentIntoScenes` (Task 4), `UserVideoDraft` (Task 3)
- Produces: archivo `content/guiones/<slug>-borrador.json`

- [ ] **Step 1: Crear el script orquestador**

Crear `src/services/generateUserVideoAssets.ts`:

```ts
import fs from "fs";
import path from "path";
import { removeSilence, extractAudioForTranscription } from "./silenceRemovalService";
import { transcribeAudio } from "./elevenlabsService";
import { segmentIntoScenes } from "./sceneSegmentationService";
import type { UserVideoDraft } from "../types/userVideoGuion";

const PUBLIC_DIR = path.join(process.cwd(), "public");
const CONTENT_DIR = path.join(process.cwd(), "content");

function findRawVideoPath(slug: string): string {
  const candidates = [".mov", ".mp4", ".MOV", ".MP4"].map((ext) =>
    path.join(CONTENT_DIR, "raw", `${slug}${ext}`),
  );
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error(`No se encontró content/raw/${slug}.mov (ni .mp4)`);
  }
  return found;
}

async function runHastaBorrador(slug: string): Promise<void> {
  const rawVideoPath = findRawVideoPath(slug);
  const trimmedVideoPath = path.join(PUBLIC_DIR, "assets", slug, "video", "trimmed.mp4");
  const trimmedAudioPath = path.join(PUBLIC_DIR, "assets", slug, "video", "trimmed-audio.mp3");

  console.log(`[${slug}] cortando silencios de ${rawVideoPath}...`);
  const { trimmedDurationSeconds } = await removeSilence(rawVideoPath, trimmedVideoPath);
  console.log(`[${slug}] video recortado: ${trimmedDurationSeconds.toFixed(2)}s`);

  console.log(`[${slug}] extrayendo audio para transcripción...`);
  await extractAudioForTranscription(trimmedVideoPath, trimmedAudioPath);

  console.log(`[${slug}] transcribiendo con ElevenLabs Scribe...`);
  const words = await transcribeAudio(trimmedAudioPath);
  console.log(`[${slug}] ${words.length} palabras transcritas`);

  const scenes = segmentIntoScenes(words);
  scenes[0].startSeconds = 0;
  scenes[scenes.length - 1].endSeconds = trimmedDurationSeconds;

  const draft: UserVideoDraft = {
    slug,
    sourceVideoPath: `assets/${slug}/video/trimmed.mp4`,
    totalDurationSeconds: trimmedDurationSeconds,
    scenes,
  };

  const guionesDir = path.join(CONTENT_DIR, "guiones");
  fs.mkdirSync(guionesDir, { recursive: true });
  const borradorPath = path.join(guionesDir, `${slug}-borrador.json`);
  fs.writeFileSync(borradorPath, JSON.stringify(draft, null, 2));

  console.log(`\n${scenes.length} escenas escritas en ${borradorPath}`);
  console.log("Revisa/ajusta texto, keywords y layout de cada escena.");
  console.log(`Cuando esté listo: tsx src/services/generateUserVideoAssets.ts ${slug} --desde-borrador`);
}

async function main() {
  const slug = process.argv[2];
  const mode = process.argv[3];

  if (!slug || mode !== "--hasta-borrador") {
    console.error("Uso: tsx src/services/generateUserVideoAssets.ts <slug> --hasta-borrador");
    process.exit(1);
  }

  await runHastaBorrador(slug);
}

main().catch((err) => {
  console.error("FALLÓ:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Agregar el script npm**

En `package.json`, dentro de `"scripts"`, agregar:

```json
"generate:user-video": "tsx src/services/generateUserVideoAssets.ts"
```

- [ ] **Step 3: Correr contra el video real**

Run: `npm run generate:user-video -- video-1-jhei --hasta-borrador`

Expected: termina sin error, imprime la cantidad de escenas, y crea `content/guiones/video-1-jhei-borrador.json`. Abrir ese archivo y confirmar que: los tiempos de cada escena son crecientes y contiguos, el texto de cada escena tiene sentido en español, y cada escena trae entre 1 y 4 keywords.

- [ ] **Step 4: Commit**

```bash
git add package.json src/services/generateUserVideoAssets.ts
git commit -m "feat: orchestrator script for silence removal + transcription + draft scenes"
```

(El archivo `content/guiones/video-1-jhei-borrador.json` generado NO se commitea todavía — se revisa/edita a mano primero; se commitea junto con el resultado final en el Task 7.)

---

## Task 6: Búsqueda de imágenes en Wikimedia Commons

**Files:**
- Create: `src/services/wikimediaService.ts`
- Test: `src/services/wikimediaService.test.ts`

**Interfaces:**
- Produces: `buildCommonsSearchUrl(keywords: string[], limit?: number): string`, `extractFilePathUrls(response: CommonsSearchResponse, limit?: number): string[]`, `searchCommonsImages(keywords: string[], limit?: number): Promise<string[]>`

- [ ] **Step 1: Escribir los tests (deben fallar: el archivo no existe todavía)**

Crear `src/services/wikimediaService.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildCommonsSearchUrl, extractFilePathUrls } from "./wikimediaService";

describe("buildCommonsSearchUrl", () => {
  it("arma la URL de búsqueda contra el namespace de archivos (6)", () => {
    const url = buildCommonsSearchUrl(["Mundial", "2026"], 6);
    expect(url).toContain("https://commons.wikimedia.org/w/api.php?");
    expect(url).toContain("srnamespace=6");
    expect(url).toContain("srlimit=6");
    expect(url).toContain("filetype%3Abitmap");
    expect(url).toContain("Mundial+2026");
  });
});

describe("extractFilePathUrls", () => {
  it("convierte títulos File: en URLs de Special:FilePath, respetando el límite", () => {
    const response = {
      query: {
        search: [
          { title: "File:Kylian Mbappe 2026.jpg" },
          { title: "File:Lamine Yamal.png" },
          { title: "File:Otra imagen.jpg" },
        ],
      },
    };

    const urls = extractFilePathUrls(response, 2);

    expect(urls).toHaveLength(2);
    expect(urls[0]).toBe(
      "https://commons.wikimedia.org/wiki/Special:FilePath/Kylian%20Mbappe%202026.jpg?width=1600",
    );
    expect(urls[1]).toBe(
      "https://commons.wikimedia.org/wiki/Special:FilePath/Lamine%20Yamal.png?width=1600",
    );
  });

  it("devuelve [] si la respuesta no trae resultados", () => {
    expect(extractFilePathUrls({})).toEqual([]);
  });
});
```

- [ ] **Step 2: Correr los tests y confirmar que fallan**

Run: `npx vitest run src/services/wikimediaService.test.ts`
Expected: FAIL — `Cannot find module './wikimediaService'`

- [ ] **Step 3: Implementar el servicio**

Crear `src/services/wikimediaService.ts`:

```ts
export interface CommonsSearchResponse {
  query?: { search?: Array<{ title?: string }> };
}

export function buildCommonsSearchUrl(keywords: string[], limit = 6): string {
  const params = new URLSearchParams({
    action: "query",
    list: "search",
    srnamespace: "6",
    srlimit: String(limit),
    format: "json",
    srsearch: `${keywords.join(" ")} filetype:bitmap`,
  });
  return `https://commons.wikimedia.org/w/api.php?${params.toString()}`;
}

export function extractFilePathUrls(response: CommonsSearchResponse, limit = 4): string[] {
  const titles = (response.query?.search ?? [])
    .map((r) => r.title)
    .filter((t): t is string => typeof t === "string" && t.startsWith("File:"));

  return titles.slice(0, limit).map((title) => {
    const filename = title.replace(/^File:/, "");
    return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}?width=1600`;
  });
}

export async function searchCommonsImages(keywords: string[], limit = 4): Promise<string[]> {
  const res = await fetch(buildCommonsSearchUrl(keywords, limit * 2));
  if (!res.ok) {
    throw new Error(`Wikimedia Commons search falló: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as CommonsSearchResponse;
  const urls = extractFilePathUrls(data, limit);
  if (urls.length === 0) {
    throw new Error(`Wikimedia Commons no devolvió resultados para: ${keywords.join(", ")}`);
  }
  return urls;
}
```

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Run: `npx vitest run src/services/wikimediaService.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Smoke test real contra la API pública**

Run:

```bash
npx tsx -e '
import { searchCommonsImages } from "./src/services/wikimediaService";
(async () => {
  const urls = await searchCommonsImages(["Mundial", "2026", "fútbol"]);
  console.log(urls);
})();
'
```

Expected: entre 1 y 4 URLs `https://commons.wikimedia.org/wiki/Special:FilePath/...` que al abrirlas en el navegador muestran fotos reales relacionadas.

- [ ] **Step 6: Commit**

```bash
git add src/services/wikimediaService.ts src/services/wikimediaService.test.ts
git commit -m "feat: search Wikimedia Commons for scene images"
```

---

## Task 7: Script orquestador — modo `--desde-borrador`

**Files:**
- Modify: `src/services/apifyService.ts` (mover el helper de descarga-con-reintentos aquí, exportado)
- Modify: `src/services/generateAssets.ts` (usar el helper movido en vez de la copia local)
- Modify: `src/services/generateUserVideoAssets.ts`

**Interfaces:**
- Consumes: `downloadImageFromUrl` (ya existe en `apifyService.ts`), `searchCommonsImages` (Task 6), `UserVideoDraft`/`UserVideoRenderedGuion` (Task 3)
- Produces: `downloadImageFromUrlWithRetry(url: string, outputPath: string, attempts?: number): Promise<string>` exportado desde `apifyService.ts`; archivo `public/data/<slug>-uservideo.json`

- [ ] **Step 1: Mover `downloadImageFromUrlWithRetry` a `apifyService.ts`**

En `src/services/apifyService.ts`, agregar después de `downloadImageFromUrl`:

```ts
// Wikimedia (y otras fuentes) devuelven 429 si se pide muchas imágenes
// seguidas sin pausa: reintenta con backoff antes de fallar la escena.
export async function downloadImageFromUrlWithRetry(
  url: string,
  outputPath: string,
  attempts = 4,
): Promise<string> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await downloadImageFromUrl(url, outputPath);
    } catch (err) {
      if (i === attempts - 1) throw err;
      const waitMs = 800 * (i + 1);
      console.log(`  reintentando en ${waitMs}ms (${err instanceof Error ? err.message : err})...`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw new Error("unreachable");
}
```

- [ ] **Step 2: Quitar la copia local en `generateAssets.ts` e importar la movida**

En `src/services/generateAssets.ts`:
- Borrar la función `downloadImageFromUrlWithRetry` local (líneas 30-42 del archivo actual).
- Cambiar el import existente `import { findRealImageUrls, downloadImageFromUrl } from "./apifyService";` por:

```ts
import { findRealImageUrls, downloadImageFromUrlWithRetry } from "./apifyService";
```

(el resto del archivo ya llama a `downloadImageFromUrlWithRetry(...)` por nombre, así que no hace falta tocar nada más)

- [ ] **Step 3: Verificar que `generateAssets.ts` sigue compilando**

Run: `npx tsc --noEmit`
Expected: sin errores nuevos relacionados a `generateAssets.ts` ni `apifyService.ts`.

- [ ] **Step 4: Agregar el modo `--desde-borrador` al orquestador**

En `src/services/generateUserVideoAssets.ts`, agregar los imports:

```ts
import { downloadImageFromUrlWithRetry } from "./apifyService";
import { searchCommonsImages } from "./wikimediaService";
import type { UserVideoDraft, UserVideoRenderedGuion, UserVideoRenderedScene } from "../types/userVideoGuion";
```

Agregar la función (antes de `main`):

```ts
function toPublicRelPath(absPath: string): string {
  return path.relative(PUBLIC_DIR, absPath).split(path.sep).join("/");
}

async function runDesdeBorrador(slug: string): Promise<void> {
  const borradorPath = path.join(CONTENT_DIR, "guiones", `${slug}-borrador.json`);
  if (!fs.existsSync(borradorPath)) {
    throw new Error(`No existe ${borradorPath}. Corre primero --hasta-borrador.`);
  }
  const draft = JSON.parse(fs.readFileSync(borradorPath, "utf-8")) as UserVideoDraft;

  const renderedScenes: UserVideoRenderedScene[] = [];
  for (const scene of draft.scenes) {
    console.log(`[${scene.id}] buscando imágenes en Wikimedia (${scene.keywords.join(", ")})...`);
    const urls = await searchCommonsImages(scene.keywords, 4);

    const collageImagePaths: string[] = [];
    for (let i = 0; i < urls.length; i++) {
      const imageAbsPath = path.join(PUBLIC_DIR, "assets", slug, "images", `${scene.id}-collage${i}.jpg`);
      if (fs.existsSync(imageAbsPath)) {
        console.log(`[${scene.id}] imagen ${i} ya existe, se reutiliza`);
      } else {
        await downloadImageFromUrlWithRetry(urls[i], imageAbsPath);
        await new Promise((r) => setTimeout(r, 400));
      }
      collageImagePaths.push(toPublicRelPath(imageAbsPath));
    }

    renderedScenes.push({ ...scene, collageImagePaths });
  }

  const rendered: UserVideoRenderedGuion = {
    slug: draft.slug,
    sourceVideoPath: draft.sourceVideoPath,
    totalDurationSeconds: draft.totalDurationSeconds,
    scenes: renderedScenes,
  };

  const dataDir = path.join(PUBLIC_DIR, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const outputPath = path.join(dataDir, `${slug}-uservideo.json`);
  fs.writeFileSync(outputPath, JSON.stringify(rendered, null, 2));

  console.log(`\nListo. ${renderedScenes.length} escenas con imágenes en ${outputPath}`);
}
```

Reemplazar la función `main()` para soportar ambos modos:

```ts
async function main() {
  const slug = process.argv[2];
  const mode = process.argv[3];

  if (!slug || (mode !== "--hasta-borrador" && mode !== "--desde-borrador")) {
    console.error("Uso: tsx src/services/generateUserVideoAssets.ts <slug> --hasta-borrador|--desde-borrador");
    process.exit(1);
  }

  if (mode === "--hasta-borrador") {
    await runHastaBorrador(slug);
  } else {
    await runDesdeBorrador(slug);
  }
}
```

- [ ] **Step 5: Correr contra el borrador real ya revisado**

Run: `npm run generate:user-video -- video-1-jhei --desde-borrador`

Expected: termina sin error, descarga entre 1 y 4 imágenes por escena en `public/assets/video-1-jhei/images/`, y crea `public/data/video-1-jhei-uservideo.json` con `collageImagePaths` poblado en cada escena.

- [ ] **Step 6: Commit**

```bash
git add src/services/apifyService.ts src/services/generateAssets.ts src/services/generateUserVideoAssets.ts content/guiones/video-1-jhei-borrador.json
git commit -m "feat: fetch Wikimedia images per scene and write final render data"
```

---

## Task 8: Composición de Remotion y registro

**Files:**
- Modify: `src/components/CollageScene.tsx`
- Create: `src/UserVideoComposition.tsx`
- Modify: `src/Root.tsx`

**Interfaces:**
- Consumes: `UserVideoRenderedGuion` (Task 3/7), `CollageScene` (existente, modificado en este task)
- Produces: composición Remotion registrada con `id="VideoJhei"`

- [ ] **Step 1: Agregar el prop `narrationAudio` a `CollageScene`**

En `src/components/CollageScene.tsx`, cambiar la firma del componente (línea 257):

```tsx
export const CollageScene: React.FC<{ scene: RenderedScene; accent?: string; narrationAudio?: boolean }> = ({
  scene,
  accent = "#f4c430",
  narrationAudio = true,
}) => {
```

Y cambiar el bloque `Audios` (líneas 362-368) para que la narración por-escena sea opcional:

```tsx
  const Audios = (
    <>
      {narrationAudio && <Audio src={staticFile(scene.audioPath)} />}
      <Audio src={staticFile(SHARED_LAND_SFX)} volume={0.4} />
      {scene.sfxPath && <Audio src={staticFile(scene.sfxPath)} volume={0.5} />}
    </>
  );
```

- [ ] **Step 2: Verificar que las composiciones existentes no cambiaron de comportamiento**

Run: `npx tsc --noEmit`
Expected: sin errores. (El default `narrationAudio = true` mantiene el comportamiento actual para `DocumentalComposition`, que no pasa ese prop.)

- [ ] **Step 3: Crear la composición nueva**

Crear `src/UserVideoComposition.tsx`:

```tsx
import { CalculateMetadataFunction, Composition, Sequence, Audio, staticFile } from "remotion";
import { CollageScene } from "./components/CollageScene";
import type { RenderedScene } from "./types/guion";
import type { UserVideoRenderedGuion, UserVideoRenderedScene } from "./types/userVideoGuion";

const FPS = 30;
const WIDTH = 1080;
const HEIGHT = 1920;

type Props = { slug: string; guion: UserVideoRenderedGuion | null };

async function loadUserVideoGuion(slug: string): Promise<UserVideoRenderedGuion> {
  const response = await fetch(staticFile(`data/${slug}-uservideo.json`));
  return (await response.json()) as UserVideoRenderedGuion;
}

const calculateMetadata: CalculateMetadataFunction<Props> = async ({ props }) => {
  const guion = await loadUserVideoGuion(props.slug);
  return {
    props: { ...props, guion },
    durationInFrames: Math.max(Math.round(guion.totalDurationSeconds * FPS), FPS),
  };
};

function toRenderedScene(scene: UserVideoRenderedScene): RenderedScene {
  const durationInSeconds = scene.endSeconds - scene.startSeconds;
  return {
    id: scene.id,
    text: scene.text,
    visual: "",
    imageSource: "real",
    layout: scene.layout ?? "silhouette-collage",
    audioPath: "",
    images: scene.collageImagePaths.length
      ? [{ path: scene.collageImagePaths[0], durationInSeconds }]
      : [],
    collageImagePaths: scene.collageImagePaths,
    durationInSeconds,
  };
}

export const UserVideoVideo: React.FC<Props> = ({ slug, guion }) => {
  if (!guion) return null;

  return (
    <>
      <Audio src={staticFile(`assets/${slug}/video/trimmed.mp4`)} />
      {guion.scenes.map((scene) => (
        <Sequence
          key={scene.id}
          from={Math.round(scene.startSeconds * FPS)}
          durationInFrames={Math.round((scene.endSeconds - scene.startSeconds) * FPS)}
        >
          <CollageScene scene={toRenderedScene(scene)} narrationAudio={false} />
        </Sequence>
      ))}
    </>
  );
};

export const UserVideoComposition: React.FC<{ id: string; slug: string }> = ({ id, slug }) => {
  return (
    <Composition
      id={id}
      component={UserVideoVideo}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      durationInFrames={FPS * 10}
      defaultProps={{ slug, guion: null }}
      calculateMetadata={calculateMetadata}
    />
  );
};
```

- [ ] **Step 4: Registrar la composición en `Root.tsx`**

En `src/Root.tsx`, agregar el import:

```tsx
import { UserVideoComposition } from "./UserVideoComposition";
```

Y agregar dentro del fragment, junto a las demás:

```tsx
<UserVideoComposition id="VideoJhei" slug="video-1-jhei" />
```

- [ ] **Step 5: Verificación manual en Remotion Studio**

Run: `npm run dev`

En el Studio, abrir la composición `VideoJhei` y confirmar: el audio suena de corrido sin cortes raros, cada collage aparece exactamente cuando empieza a sonar el fragmento de voz que le corresponde (usar el scrubber para saltar a 2-3 puntos distintos y comparar lo que se oye contra lo que se ve), y no aparece la cámara del usuario en ningún momento.

- [ ] **Step 6: Commit**

```bash
git add src/components/CollageScene.tsx src/UserVideoComposition.tsx src/Root.tsx
git commit -m "feat: add UserVideoComposition rendering synced b-roll over continuous audio"
```
