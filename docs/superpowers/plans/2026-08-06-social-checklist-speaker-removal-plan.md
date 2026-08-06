# Social-checklist: quitar voz de fondo de otro hablante — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el pipeline `social-checklist` pueda quitar por completo la voz de una segunda persona hablando de fondo (eco/apuntador), dejando solo la voz del hablante principal, activable por guion con `removeOtherSpeakers: true`.

**Architecture:** Se transcribe con diarización (ElevenLabs Scribe, `diarize=true`, ya devuelve `speaker_id` por palabra — verificado en vivo). Dos funciones puras nuevas en `videoTrimService.ts` determinan quién es el hablante principal (quien habla primero) y agrupan los tramos de cualquier otro hablante en `CutRange[]`, que se suman a los cortes de silencio/muletillas ya existentes — todo el resto del pipeline (fusión de rangos, recorte con ffmpeg, re-mapeo de timestamps) no cambia, porque ya está diseñado para recibir una lista de cortes de cualquier origen.

**Tech Stack:** mismo del proyecto (Remotion 4 + TypeScript + ffmpeg/ffprobe + ElevenLabs Scribe + vitest).

## Global Constraints

- `removeOtherSpeakers` es opcional y por defecto `false` — ningún guion existente cambia de comportamiento.
- El hablante principal es quien dice la primera palabra transcrita del video (heurística validada contra el video real de este plan: se mantiene correcta durante los 6 minutos completos, sin cambiar de identidad).
- Cualquier palabra que no sea del hablante principal se trata exactamente igual que un silencio/muletilla: un `CutRange` más en la misma lista fusionada.
- No se implementa corte por volumen — la diarización es el único mecanismo para esto.
- Video y guion de prueba para este plan: `content/raw/5-herramientas-ranking.mov` (copiado desde `~/Downloads/5Herramientas.MOV`, 6:05min, contenido real: conteo regresivo de 5 herramientas de IA con una segunda persona repitiendo cada línea).

---

## Task 1: `DiarizedWord` + detección del hablante principal y sus tramos (TDD)

**Files:**
- Modify: `src/services/checklistSyncService.ts`
- Modify: `src/services/videoTrimService.ts`
- Modify: `src/services/videoTrimService.test.ts`

**Interfaces:**
- Produces: `DiarizedWord` (en `checklistSyncService.ts`, extiende `TranscribedWord` con `speakerId: string`), `findPrimarySpeakerId(words: DiarizedWord[]): string`, `detectOtherSpeakerRanges(words: DiarizedWord[], primarySpeakerId: string): CutRange[]` (en `videoTrimService.ts`). Tasks 2 y 3 los usan.

- [ ] **Step 1: Agregar `DiarizedWord` a `src/services/checklistSyncService.ts`**

Agregar justo después de la interfaz `TranscribedWord`:

```ts
export interface DiarizedWord extends TranscribedWord {
  speakerId: string;
}
```

- [ ] **Step 2: Escribir los tests (deben fallar: las funciones no existen)**

Reemplazar el bloque de imports al inicio de `src/services/videoTrimService.test.ts` por:

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
  findPrimarySpeakerId,
  detectOtherSpeakerRanges,
} from "./videoTrimService";
import type { TranscribedWord, DiarizedWord } from "./checklistSyncService";
import { getVideoDurationInSeconds } from "./ffmpegService";

const execFileAsync = promisify(execFile);
```

Agregar al final del archivo:

```ts
function dw(text: string, start: number, end: number, speakerId: string): DiarizedWord {
  return { text, start, end, speakerId };
}

describe("findPrimarySpeakerId", () => {
  it("devuelve el speakerId de la primera palabra", () => {
    const words = [dw("Hola", 0, 0.3, "speaker_0"), dw("Chao", 5, 5.3, "speaker_1")];
    expect(findPrimarySpeakerId(words)).toBe("speaker_0");
  });

  it("lanza un error si no hay palabras", () => {
    expect(() => findPrimarySpeakerId([])).toThrow();
  });
});

describe("detectOtherSpeakerRanges", () => {
  it("no detecta nada si todas las palabras son del hablante principal", () => {
    const words = [dw("Hola", 0, 0.3, "speaker_0"), dw("mundo", 0.4, 0.7, "speaker_0")];
    expect(detectOtherSpeakerRanges(words, "speaker_0")).toEqual([]);
  });

  it("agrupa un tramo consecutivo del otro hablante en un solo rango", () => {
    const words = [
      dw("Hola", 0, 0.3, "speaker_0"),
      dw("Repite", 0.5, 0.8, "speaker_1"),
      dw("esto", 0.8, 1.1, "speaker_1"),
      dw("chao", 1.5, 1.8, "speaker_0"),
    ];
    expect(detectOtherSpeakerRanges(words, "speaker_0")).toEqual([{ start: 0.5, end: 1.1 }]);
  });

  it("detecta varios tramos separados del otro hablante", () => {
    const words = [
      dw("Hola", 0, 0.3, "speaker_0"),
      dw("eco", 0.5, 0.8, "speaker_1"),
      dw("sigo", 1.0, 1.3, "speaker_0"),
      dw("otro", 1.5, 1.8, "speaker_2"),
      dw("fin", 2.0, 2.3, "speaker_0"),
    ];
    expect(detectOtherSpeakerRanges(words, "speaker_0")).toEqual([
      { start: 0.5, end: 0.8 },
      { start: 1.5, end: 1.8 },
    ]);
  });

  it("incluye un tramo del otro hablante que llega hasta el final", () => {
    const words = [dw("Hola", 0, 0.3, "speaker_0"), dw("eco", 0.5, 0.8, "speaker_1")];
    expect(detectOtherSpeakerRanges(words, "speaker_0")).toEqual([{ start: 0.5, end: 0.8 }]);
  });
});
```

- [ ] **Step 3: Correr los tests y confirmar que fallan**

Run: `npx vitest run src/services/videoTrimService.test.ts`
Expected: FAIL — `findPrimarySpeakerId`/`detectOtherSpeakerRanges` no exportadas.

- [ ] **Step 4: Implementar las funciones**

Agregar al final de `src/services/videoTrimService.ts` (agregar también
`DiarizedWord` al import existente de `"./checklistSyncService"` al inicio
del archivo, que queda `import type { TranscribedWord, DiarizedWord } from "./checklistSyncService";`):

```ts
export function findPrimarySpeakerId(words: DiarizedWord[]): string {
  if (words.length === 0) {
    throw new Error("findPrimarySpeakerId: no hay palabras para determinar el hablante principal");
  }
  return words[0].speakerId;
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
```

- [ ] **Step 5: Correr los tests y confirmar que pasan**

Run: `npx vitest run src/services/videoTrimService.test.ts`
Expected: PASS, 28 tests en total (22 existentes + 6 nuevos).

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/services/checklistSyncService.ts src/services/videoTrimService.ts src/services/videoTrimService.test.ts
git commit -m "feat: add DiarizedWord type and other-speaker range detection"
```

---

## Task 2: `transcribeWithSpeakers` — transcripción con diarización

**Files:**
- Modify: `src/services/elevenlabsService.ts`

**Interfaces:**
- Consumes: `DiarizedWord` de `./checklistSyncService` (Task 1).
- Produces: `transcribeWithSpeakers(audioFilePath: string): Promise<DiarizedWord[]>`. Task 3 la usa.

Llama a una API paga real — se verifica con una llamada real, mismo
criterio que `transcribeWithTimestamps`.

- [ ] **Step 1: Agregar el import de `DiarizedWord`**

Cambiar la línea de import existente:

```ts
import type { TranscribedWord } from "./checklistSyncService";
```

por:

```ts
import type { TranscribedWord, DiarizedWord } from "./checklistSyncService";
```

- [ ] **Step 2: Agregar la función al final de `src/services/elevenlabsService.ts`**

```ts
export async function transcribeWithSpeakers(audioFilePath: string): Promise<DiarizedWord[]> {
  const fileBuffer = fs.readFileSync(audioFilePath);
  const form = new FormData();
  form.append("model_id", "scribe_v1");
  form.append("timestamps_granularity", "word");
  form.append("diarize", "true");
  form.append("file", new Blob([fileBuffer]), audioFilePath.split("/").pop() ?? "audio.mp3");

  const res = await fetch(`${BASE_URL}/speech-to-text`, {
    method: "POST",
    headers: { "xi-api-key": env.elevenLabsApiKey },
    body: form,
  });

  if (!res.ok) {
    throw new Error(`ElevenLabs transcribeWithSpeakers falló: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as {
    words: { text: string; start: number; end: number; type: string; speaker_id?: string }[];
  };

  return data.words
    .filter((w) => w.type === "word")
    .map((w) => ({ text: w.text, start: w.start, end: w.end, speakerId: w.speaker_id ?? "unknown" }));
}
```

- [ ] **Step 3: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Verificación real contra un audio corto**

Run:
```bash
ffmpeg -y -i ~/Downloads/5Herramientas.MOV -t 15 -vn -acodec libmp3lame -q:a 4 /tmp/test-diarize.mp3
npx tsx -e '
import { transcribeWithSpeakers } from "./src/services/elevenlabsService";
transcribeWithSpeakers("/tmp/test-diarize.mp3").then((words) => {
  const speakers = new Set(words.map((w) => w.speakerId));
  console.log("speakers:", speakers);
  console.log(words.slice(0, 8));
}).catch((e) => console.error(e));
'
```

Expected: imprime al menos 2 `speakerId` distintos (`speaker_0`,
`speaker_1`) y las primeras palabras con `speakerId` asignado.

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/elevenlabsService.ts
git commit -m "feat: add transcribeWithSpeakers using ElevenLabs Scribe diarization"
```

---

## Task 3: Integración completa + guion real de prueba

**Files:**
- Modify: `src/services/generateAssets.ts`
- Create: `content/guiones/5-herramientas-ranking.json`
- Create: `content/raw/5-herramientas-ranking.mov` (copia del video del usuario)

**Interfaces:**
- Consumes: todo lo de Tasks 1-2.
- Produces: `public/data/5-herramientas-ranking.json` (`RenderedSocialChecklistGuion`) con la voz de fondo ya quitada.

- [ ] **Step 1: Copiar el video crudo**

Run: `mkdir -p content/raw && cp ~/Downloads/5Herramientas.MOV content/raw/5-herramientas-ranking.mov`

- [ ] **Step 2: Crear `content/guiones/5-herramientas-ranking.json`**

```json
{
  "type": "social-checklist",
  "slug": "5-herramientas-ranking",
  "topic": "Ranking de 5 herramientas de IA",
  "rawVideoPath": "content/raw/5-herramientas-ranking.mov",
  "removeOtherSpeakers": true,
  "listTitle": "5 HERRAMIENTAS DE IA QUE USTED VA A NECESITAR PARA NO SER UN DINOSAURIO",
  "items": [
    { "id": "1", "label": "AiVi", "logoQuery": "AIVI logo" },
    { "id": "2", "label": "Claude Code", "logoQuery": "Claude Anthropic AI logo" },
    { "id": "3", "label": "Notebook LM", "logoQuery": "Google NotebookLM logo" },
    { "id": "4", "label": "Gamma", "logoQuery": "Gamma app logo" },
    { "id": "5", "label": "ChatGPT", "logoQuery": "ChatGPT logo" }
  ]
}
```

- [ ] **Step 3: Actualizar imports en `src/services/generateAssets.ts`**

Cambiar:

```ts
import { generateVoice, generateSoundEffect, transcribeWithTimestamps } from "./elevenlabsService";
```

por:

```ts
import { generateVoice, generateSoundEffect, transcribeWithTimestamps, transcribeWithSpeakers } from "./elevenlabsService";
```

Cambiar:

```ts
import { matchItemTimestamps, type TranscribedWord } from "./checklistSyncService";
```

por:

```ts
import { matchItemTimestamps, type TranscribedWord, type DiarizedWord } from "./checklistSyncService";
```

Cambiar:

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

por:

```ts
import {
  detectSilenceRanges,
  detectFillerRanges,
  mergeCutRanges,
  computeKeepSegments,
  trimVideoToSegments,
  remapWords,
  findPrimarySpeakerId,
  detectOtherSpeakerRanges,
  type CutRange,
} from "./videoTrimService";
```

- [ ] **Step 4: Modificar `generateSocialChecklistAssets`**

Reemplazar este bloque:

```ts
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
```

por:

```ts
  const transcriptPath = path.join(PUBLIC_DIR, "assets", guion.slug, "transcript.json");
  let rawWords: TranscribedWord[];
  if (fs.existsSync(transcriptPath)) {
    console.log("transcripción ya existe, se reutiliza");
    rawWords = JSON.parse(fs.readFileSync(transcriptPath, "utf-8")) as TranscribedWord[];
  } else {
    const audioTmpPath = path.join(PUBLIC_DIR, "assets", guion.slug, "audio-for-transcription.mp3");
    console.log("extrayendo audio para transcribir...");
    await extractAudioTrack(rawVideoAbsPath, audioTmpPath);
    if (guion.removeOtherSpeakers) {
      console.log("transcribiendo con ElevenLabs Scribe (con diarización)...");
      rawWords = await transcribeWithSpeakers(audioTmpPath);
    } else {
      console.log("transcribiendo con ElevenLabs Scribe...");
      rawWords = await transcribeWithTimestamps(audioTmpPath);
    }
    fs.writeFileSync(transcriptPath, JSON.stringify(rawWords, null, 2));
    fs.rmSync(audioTmpPath);
  }

  console.log("detectando silencios y titubeos...");
  const silenceRanges = await detectSilenceRanges(rawVideoAbsPath, rawDurationInSeconds);
  const fillerRanges = detectFillerRanges(rawWords);
  let otherSpeakerRanges: CutRange[] = [];
  if (guion.removeOtherSpeakers) {
    const diarizedWords = rawWords as DiarizedWord[];
    const primarySpeakerId = findPrimarySpeakerId(diarizedWords);
    otherSpeakerRanges = detectOtherSpeakerRanges(diarizedWords, primarySpeakerId);
    console.log(`  hablante principal: ${primarySpeakerId}, ${otherSpeakerRanges.length} tramo(s) de otra voz`);
  }
  console.log(`  ${silenceRanges.length} silencio(s), ${fillerRanges.length} titubeo(s)/muletilla(s)`);
  const cutRanges = mergeCutRanges([...silenceRanges, ...fillerRanges, ...otherSpeakerRanges]);
```

- [ ] **Step 5: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Correrlo de verdad contra el guion nuevo**

Run: `npm run generate:assets -- content/guiones/5-herramientas-ranking.json`

Expected: el log muestra el hablante principal detectado y cuántos
tramos de otra voz encontró (debe ser un número alto, del orden de 30+,
dado que la otra persona repite casi cada línea), más los silencios y
muletillas de siempre. Termina con `Listo. Duración: <X>s, 5 items (...)`.
`<X>` debe ser bastante menor a los ~365s del video crudo (se está
quitando aproximadamente la mitad del audio: todo lo de la otra persona).

- [ ] **Step 7: Inspeccionar el resultado**

Run: `cat public/data/5-herramientas-ranking.json`

Expected: JSON válido, `videoPath` apunta a
`assets/5-herramientas-ranking/video/trimmed.mov`, 5 items con
`startSeconds` en orden no decreciente.

- [ ] **Step 8: Lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/services/generateAssets.ts content/guiones/5-herramientas-ranking.json content/raw/5-herramientas-ranking.mov public/data/5-herramientas-ranking.json public/assets/5-herramientas-ranking
git commit -m "feat: remove background speaker from social-checklist videos"
```

(nota: `content/raw/` está en `.gitignore` — ese `git add` no agrega nada,
está bien, es solo la copia local de trabajo.)

---

## Task 4: Registrar composición + render final

**Files:**
- Modify: `src/Root.tsx`

- [ ] **Step 1: Registrar la composición en `src/Root.tsx`**

Agregar, junto a las demás composiciones:

```tsx
<SocialChecklistComposition id="CincoHerramientasRanking" slug="5-herramientas-ranking" />
```

- [ ] **Step 2: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Render completo**

Run: `npx remotion render CincoHerramientasRanking out/5-herramientas-ranking.mp4`
Expected: termina sin errores.

- [ ] **Step 4: Revisión manual**

Abrir `out/5-herramientas-ranking.mp4` y confirmar (esto requiere
escuchar el audio — no se puede verificar por código):
- Ya no se escucha la voz de la segunda persona repitiendo cada línea.
- No quedan cortes abruptos ni palabras del usuario cortadas a la mitad
  en los puntos donde antes hablaba la otra persona.
- El conteo regresivo (5 ChatGPT, 4 Gamma, 3 Notebook LM, 2 Claude Code,
  1 AiVi) se ve en el orden correcto de fila con el reveal grande +
  zoom ya construido antes.

- [ ] **Step 5: Correr toda la suite de tests una vez más de punta a punta**

Run: `npm run test && npm run lint`
Expected: ambos PASS.

- [ ] **Step 6: Commit**

```bash
git add src/Root.tsx
git commit -m "feat: register CincoHerramientasRanking composition"
```
