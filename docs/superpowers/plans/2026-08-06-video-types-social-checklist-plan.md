# Tipos de video (`type`) + tipo "social-checklist" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar un campo `type` a los guiones (`"vox" | "social-checklist" | "youtube"`, abierto a más tipos futuros) sin romper el pipeline "vox" existente, y construir de punta a punta el tipo nuevo `social-checklist`: video real del usuario hablando a cámara + overlay de checklist numerado cuyo logo por item aparece animado en el momento exacto en que se menciona (detectado por transcripción automática).

**Architecture:** `Guion` pasa de interfaz única a unión discriminada por `type` (`VoxGuion | SocialChecklistGuion`, con `youtube` reservado para después). `generateAssets.ts` despacha por `type` a `generateVoxAssets` (el pipeline actual, sin cambios de comportamiento) o a la nueva `generateSocialChecklistAssets`, que: copia el video crudo a `public/`, mide su duración con `ffprobe`, extrae el audio y lo transcribe con ElevenLabs Scribe (timestamps por palabra), hace *matching* de cada item del checklist contra la transcripción (con reglas de fallback si no encuentra una mención y de orden si un match sale ilógico), resuelve el logo de cada item (Wikimedia Commons → kie.ai) y escribe `public/data/<slug>.json`. Una composición Remotion nueva (`SocialChecklistComposition` + `SocialChecklist`) reproduce el video con `OffthreadVideo` y superpone el checklist, animando cada logo a su casilla en el frame correspondiente.

**Tech Stack:** Remotion 4 + React 19 + TypeScript, ffmpeg/ffprobe (CLI local, ya instalados), ElevenLabs API (TTS ya en uso + Speech-to-Text/Scribe nuevo), Wikimedia Commons API + kie.ai (ya en uso), Vitest (nuevo, para la lógica pura).

## Global Constraints

- `type` ausente en un guion se trata como `"vox"` — ningún guion existente (`content/guiones/*.json`) se toca ni cambia de comportamiento.
- `social-checklist`: el audio es el real del video (nunca ElevenLabs TTS); el texto del `label` de cada item **no se muestra en pantalla**, solo su logo.
- Si un item no se encuentra en la transcripción, el render **nunca falla**: se le asigna un tiempo estimado y se loguea una advertencia.
- Los timestamps finales de los items son siempre **no decrecientes** en el orden de la lista (un match fuera de orden se descarta y se re-estima).
- Una vez que el logo de un item "aterriza" en su casilla, **se queda fijo** el resto del video (no se reemplaza ni desaparece).
- Fuente de logos: primero `wikimediaService.findWikimediaImageUrls` (ya existe), si no hay resultado cae a `kieAiService.generateImage` (ya existe) — mismo patrón que las escenas `"ai"` con `wikipediaQuery`.
- Formato de salida: 1080×1920 @ 30fps (igual que el resto del proyecto).
- `type` es una unión discriminada abierta: agregar un tipo nuevo en el futuro debe ser sumar código (interfaz + función `generate<Tipo>Assets` + composición), nunca modificar las ramas de los tipos existentes.
- Video de prueba para todo este plan: `content/raw/video-1-jhei.mov` (ya en el repo, gitignored, 72.09s reales confirmados con `ffprobe`, en español, sobre "5 herramientas de IA para tu negocio" — contenido real de producción, no un placeholder).

---

## Task 1: Unión discriminada de tipos + refactor de `generateAssets.ts` (sin cambiar comportamiento de "vox")

**Files:**
- Modify: `src/types/guion.ts`
- Modify: `src/services/generateAssets.ts`

**Interfaces:**
- Produces: `GuionType`, `VoxGuion`, `ChecklistItem`, `SocialChecklistGuion`, `Guion` (unión), `RenderedChecklistItem`, `RenderedSocialChecklistGuion` (todos en `src/types/guion.ts`). `generateVoxAssets(guion: VoxGuion): Promise<void>` en `generateAssets.ts` (el `main()` actual, extraído a función, sin cambios de lógica).

- [ ] **Step 1: Modificar `src/types/guion.ts`**

Reemplazar el bloque final del archivo (desde `export type VisualStyle` hasta el final) por:

```ts
export type VisualStyle = "neon" | "collage";

export type GuionType = "vox" | "social-checklist" | "youtube";

export interface VoxGuion {
  type?: "vox";
  slug: string;
  topic: string;
  voiceId?: string;
  characterImagePath?: string;
  /** "neon" (default, dark mode AIVI) o "collage" (scrapbook vintage: papel, halftone, marcador, garabatos). */
  style?: VisualStyle;
  scenes: GuionScene[];
}

export interface ChecklistItem {
  id: string;
  /** Texto a buscar en la transcripción del video (no se muestra en pantalla). */
  label: string;
  /** Query para buscar el logo/ícono en Wikimedia Commons, con fallback a kie.ai. */
  logoQuery: string;
}

export interface SocialChecklistGuion {
  type: "social-checklist";
  slug: string;
  topic: string;
  /** Ruta al video crudo del usuario hablando a cámara, ej. "content/raw/video-1-jhei.mov". */
  rawVideoPath: string;
  listTitle: string;
  items: ChecklistItem[];
}

export type Guion = VoxGuion | SocialChecklistGuion;

export interface SceneImage {
  path: string;
  durationInSeconds: number;
}

export interface RenderedScene extends GuionScene {
  audioPath: string;
  sfxPath?: string;
  images: SceneImage[];
  collageImagePaths?: string[];
  badgeImagePath?: string;
  durationInSeconds: number;
}

export interface RenderedGuion {
  slug: string;
  topic: string;
  style?: VisualStyle;
  scenes: RenderedScene[];
}

export interface RenderedChecklistItem extends ChecklistItem {
  startSeconds: number;
  /** false = no se encontró el label en la transcripción, se usó tiempo estimado. */
  matched: boolean;
  logoPath: string;
}

export interface RenderedSocialChecklistGuion {
  type: "social-checklist";
  slug: string;
  topic: string;
  videoPath: string;
  durationInSeconds: number;
  listTitle: string;
  items: RenderedChecklistItem[];
}
```

(`GuionScene`, `ImageSource` y los campos de arriba de `VisualStyle` no cambian.)

- [ ] **Step 2: Verificar que el resto del proyecto todavía compila roto (esperado)**

Run: `npx tsc --noEmit`
Expected: FAIL — errores en `generateAssets.ts` porque `Guion` ya no tiene `.scenes` directo (es unión). Confirma que el cambio de tipos se está usando de verdad en otro lado.

- [ ] **Step 3: Refactorizar `src/services/generateAssets.ts`**

Cambiar el import de tipos:

```ts
import type { Guion, VoxGuion, GuionScene, RenderedGuion, RenderedScene, SceneImage } from "../types/guion";
```

Cambiar la firma de `generateScene`:

```ts
async function generateScene(
  guion: VoxGuion,
  scene: GuionScene,
  characterImageUrl: string | null,
): Promise<RenderedScene> {
```

(el cuerpo de la función no cambia en nada más).

Extraer el cuerpo de `main()` a una función nueva `generateVoxAssets`, y dejar `main()` como despachador por `type`:

```ts
async function generateVoxAssets(guion: VoxGuion): Promise<void> {
  console.log(`Generando recursos para "${guion.topic}" (${guion.scenes.length} escenas)`);

  const needsCharacterUpload = guion.scenes.some(
    (s) => s.imageSource === "character" && !s.localImagePaths?.length,
  );

  let characterImageUrl: string | null = null;
  if (guion.characterImagePath && needsCharacterUpload) {
    console.log(`Subiendo imagen de personaje (${guion.characterImagePath})...`);
    characterImageUrl = await uploadImage(guion.characterImagePath);
    console.log(`Personaje subido: ${characterImageUrl}`);
  }

  const renderedScenes: RenderedScene[] = [];
  for (const scene of guion.scenes) {
    renderedScenes.push(await generateScene(guion, scene, characterImageUrl));
  }

  const rendered: RenderedGuion = {
    slug: guion.slug,
    topic: guion.topic,
    style: guion.style,
    scenes: renderedScenes,
  };

  const dataDir = path.join(PUBLIC_DIR, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const outputPath = path.join(dataDir, `${guion.slug}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(rendered, null, 2));

  const totalDuration = renderedScenes.reduce((acc, s) => acc + s.durationInSeconds, 0);
  const totalCuts = renderedScenes.reduce((acc, s) => acc + s.images.length, 0);
  console.log(`\nListo. Duración total: ${totalDuration.toFixed(1)}s en ${totalCuts} cortes visuales.`);
  console.log(`Datos guardados en ${outputPath}`);
}

async function main() {
  const guionPath = process.argv[2];
  if (!guionPath) {
    console.error("Uso: tsx src/services/generateAssets.ts content/guiones/<slug>.json");
    process.exit(1);
  }

  const guion = JSON.parse(fs.readFileSync(guionPath, "utf-8")) as Guion;

  if (guion.type === "social-checklist") {
    console.error(`El tipo "social-checklist" todavía no está implementado (Task 5 de este plan).`);
    process.exit(1);
  }

  await generateVoxAssets(guion);
}

main().catch((err) => {
  console.error("FALLÓ:", err);
  process.exit(1);
});
```

(Task 5 reemplaza el `console.error`/`process.exit(1)` de la rama `social-checklist` por la llamada real a `generateSocialChecklistAssets`.)

- [ ] **Step 4: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: PASS, sin errores.

- [ ] **Step 5: Verificar que el pipeline "vox" sigue funcionando igual (regresión)**

Run: `npm run generate:assets -- content/guiones/mitos-claude-negocio.json`
Expected: todas las líneas dicen "ya existe, se reutiliza" (nada se regenera) y termina con `Listo. Duración total: 47.6s en 26 cortes visuales.` — igual que antes del refactor, confirma que no se rompió nada.

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: PASS sin errores.

- [ ] **Step 7: Commit**

```bash
git add src/types/guion.ts src/services/generateAssets.ts
git commit -m "refactor: type field as discriminated union, extract generateVoxAssets"
```

---

## Task 2: `checklistSyncService` — matching de items contra transcripción (TDD)

**Files:**
- Create: `src/services/checklistSyncService.ts`
- Test: `src/services/checklistSyncService.test.ts`
- Modify: `package.json` (agregar `vitest`)

**Interfaces:**
- Consumes: `ChecklistItem` de `src/types/guion.ts` (Task 1).
- Produces: `TranscribedWord { text: string; start: number; end: number }`, `MatchedItem { item: ChecklistItem; startSeconds: number; matched: boolean }`, `matchItemTimestamps(words: TranscribedWord[], items: ChecklistItem[], totalDurationSeconds: number): MatchedItem[]` — todo exportado desde `checklistSyncService.ts`. Tasks 4 y 5 importan `TranscribedWord` y `matchItemTimestamps` desde acá.

- [ ] **Step 1: Instalar vitest**

Run: `npm install -D vitest`

- [ ] **Step 2: Agregar script de test a `package.json`**

Dentro de `"scripts"`, agregar:

```json
"test": "vitest run"
```

- [ ] **Step 3: Escribir los tests (deben fallar: el archivo fuente no existe)**

Crear `src/services/checklistSyncService.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { matchItemTimestamps, type TranscribedWord } from "./checklistSyncService";
import type { ChecklistItem } from "../types/guion";

function w(text: string, start: number, end: number): TranscribedWord {
  return { text, start, end };
}

describe("matchItemTimestamps", () => {
  it("encuentra un item de una sola palabra y devuelve su timestamp real", () => {
    const words = [w("Hola", 0, 0.3), w("ManyChat", 0.3, 0.9), w("es", 0.9, 1.0)];
    const items: ChecklistItem[] = [{ id: "1", label: "ManyChat", logoQuery: "ManyChat logo" }];

    const result = matchItemTimestamps(words, items, 10);

    expect(result).toEqual([{ item: items[0], startSeconds: 0.3, matched: true }]);
  });

  it("encuentra un item de varias palabras consecutivas", () => {
    const words = [w("usa", 0, 0.2), w("Claude", 0.2, 0.5), w("Code", 0.5, 0.8), w("ya", 0.8, 0.9)];
    const items: ChecklistItem[] = [{ id: "1", label: "Claude Code", logoQuery: "Claude logo" }];

    const result = matchItemTimestamps(words, items, 10);

    expect(result[0]).toEqual({ item: items[0], startSeconds: 0.2, matched: true });
  });

  it("ignora mayúsculas/acentos al comparar", () => {
    const words = [w("cloud", 0, 0.4)];
    const items: ChecklistItem[] = [{ id: "1", label: "CLOUD", logoQuery: "q" }];

    const result = matchItemTimestamps(words, items, 10);

    expect(result[0].matched).toBe(true);
    expect(result[0].startSeconds).toBe(0);
  });

  it("si no encuentra un item, le asigna tiempo estimado y matched=false, sin fallar", () => {
    const words = [w("hola", 0, 0.3), w("mundo", 0.3, 0.6)];
    const items: ChecklistItem[] = [{ id: "1", label: "Claude", logoQuery: "q" }];

    const result = matchItemTimestamps(words, items, 20);

    expect(result[0].matched).toBe(false);
    expect(result[0].startSeconds).toBeGreaterThan(0);
    expect(result[0].startSeconds).toBeLessThanOrEqual(20);
  });

  it("reparte varios items sin match en orden entre 0 y la duración total", () => {
    const words: TranscribedWord[] = [];
    const items: ChecklistItem[] = [
      { id: "1", label: "Uno", logoQuery: "q" },
      { id: "2", label: "Dos", logoQuery: "q" },
      { id: "3", label: "Tres", logoQuery: "q" },
    ];

    const result = matchItemTimestamps(words, items, 30);

    expect(result.every((r) => !r.matched)).toBe(true);
    expect(result[0].startSeconds).toBeLessThan(result[1].startSeconds);
    expect(result[1].startSeconds).toBeLessThan(result[2].startSeconds);
    expect(result[2].startSeconds).toBeLessThanOrEqual(30);
  });

  it("descarta un match que sale antes que el del item anterior aceptado (falso positivo) y lo re-estima", () => {
    // "Segundo" aparece ANTES que "Primero" en la transcripción (caso raro/ruidoso) —
    // no debe hacer que el item 2 se muestre antes que el item 1 en pantalla.
    const words = [w("Segundo", 0, 0.5), w("luego", 0.5, 0.8), w("Primero", 5, 5.5)];
    const items: ChecklistItem[] = [
      { id: "1", label: "Primero", logoQuery: "q" },
      { id: "2", label: "Segundo", logoQuery: "q" },
    ];

    const result = matchItemTimestamps(words, items, 10);

    expect(result[0]).toEqual({ item: items[0], startSeconds: 5, matched: true });
    expect(result[1].matched).toBe(false);
    expect(result[1].startSeconds).toBeGreaterThanOrEqual(5);
    expect(result[1].startSeconds).toBeLessThanOrEqual(10);
  });

  it("nunca produce timestamps decrecientes en la lista completa, mezclando matches y estimados", () => {
    const words = [w("ManyChat", 8, 8.5)];
    const items: ChecklistItem[] = [
      { id: "1", label: "Claude", logoQuery: "q" }, // no está -> estimado
      { id: "2", label: "ManyChat", logoQuery: "q" }, // sí está en 8
      { id: "3", label: "AIVI", logoQuery: "q" }, // no está -> estimado, debe quedar >= 8
    ];

    const result = matchItemTimestamps(words, items, 20);

    for (let i = 1; i < result.length; i++) {
      expect(result[i].startSeconds).toBeGreaterThanOrEqual(result[i - 1].startSeconds);
    }
    expect(result[1]).toEqual({ item: items[1], startSeconds: 8, matched: true });
  });
});
```

- [ ] **Step 4: Correr los tests y confirmar que fallan**

Run: `npx vitest run src/services/checklistSyncService.test.ts`
Expected: FAIL — `Cannot find module './checklistSyncService'`.

- [ ] **Step 5: Implementar `src/services/checklistSyncService.ts`**

```ts
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
    .replace(/[̀-ͯ]/g, "")
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
```

- [ ] **Step 6: Correr los tests y confirmar que pasan**

Run: `npx vitest run src/services/checklistSyncService.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 7: Lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/services/checklistSyncService.ts src/services/checklistSyncService.test.ts
git commit -m "feat: add checklistSyncService with vitest, matches items against transcript"
```

---

## Task 3: `ffmpegService` — duración de video + extracción de audio (TDD)

**Files:**
- Create: `src/services/ffmpegService.ts`
- Test: `src/services/ffmpegService.test.ts`

**Interfaces:**
- Produces: `getVideoDurationInSeconds(filePath: string): Promise<number>`, `extractAudioTrack(videoPath: string, outputMp3Path: string): Promise<string>`. Task 5 usa ambas.

- [ ] **Step 1: Escribir los tests (deben fallar: el archivo fuente no existe)**

Crear `src/services/ffmpegService.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { getVideoDurationInSeconds, extractAudioTrack } from "./ffmpegService";

const execFileAsync = promisify(execFile);
const FIXTURE_DIR = path.join(__dirname, "__fixtures__");
const FIXTURE_VIDEO = path.join(FIXTURE_DIR, "tiny-test-video.mp4");

beforeAll(async () => {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  // Video sintético de 2s con tono de audio, generado con ffmpeg (sin depender
  // de ningún archivo del usuario, que además está gitignored).
  await execFileAsync("ffmpeg", [
    "-y",
    "-f", "lavfi", "-i", "color=c=black:s=64x64:d=2",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
    "-shortest",
    FIXTURE_VIDEO,
  ]);
}, 20000);

afterAll(() => {
  fs.rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

describe("getVideoDurationInSeconds", () => {
  it("lee la duración real de un video de 2 segundos", async () => {
    const duration = await getVideoDurationInSeconds(FIXTURE_VIDEO);
    expect(duration).toBeGreaterThan(1.9);
    expect(duration).toBeLessThan(2.1);
  });

  it("rechaza con un mensaje claro si el archivo no existe", async () => {
    await expect(getVideoDurationInSeconds(path.join(FIXTURE_DIR, "no-existe.mp4"))).rejects.toThrow();
  });
});

describe("extractAudioTrack", () => {
  it("extrae el audio a un mp3 que existe y no está vacío", async () => {
    const outputPath = path.join(FIXTURE_DIR, "extracted.mp3");
    const result = await extractAudioTrack(FIXTURE_VIDEO, outputPath);

    expect(result).toBe(outputPath);
    expect(fs.existsSync(outputPath)).toBe(true);
    expect(fs.statSync(outputPath).size).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Correr los tests y confirmar que fallan**

Run: `npx vitest run src/services/ffmpegService.test.ts`
Expected: FAIL — `Cannot find module './ffmpegService'`.

- [ ] **Step 3: Implementar `src/services/ffmpegService.ts`**

```ts
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";

const execFileAsync = promisify(execFile);

export async function getVideoDurationInSeconds(filePath: string): Promise<number> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`ffprobe: el archivo no existe: ${filePath}`);
  }

  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "quiet",
    "-print_format", "json",
    "-show_format",
    filePath,
  ]);

  const data = JSON.parse(stdout) as { format?: { duration?: string } };
  const duration = Number(data.format?.duration);
  if (!Number.isFinite(duration)) {
    throw new Error(`ffprobe no devolvió una duración válida para ${filePath}`);
  }
  return duration;
}

export async function extractAudioTrack(videoPath: string, outputMp3Path: string): Promise<string> {
  await execFileAsync("ffmpeg", [
    "-y",
    "-i", videoPath,
    "-vn",
    "-acodec", "libmp3lame",
    "-q:a", "4",
    outputMp3Path,
  ]);
  return outputMp3Path;
}
```

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Run: `npx vitest run src/services/ffmpegService.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/ffmpegService.ts src/services/ffmpegService.test.ts
git commit -m "feat: add ffmpegService for video duration and audio extraction"
```

---

## Task 4: Transcripción con ElevenLabs Scribe

**Files:**
- Modify: `src/services/elevenlabsService.ts`

**Interfaces:**
- Consumes: `TranscribedWord` de `./checklistSyncService` (Task 2).
- Produces: `transcribeWithTimestamps(audioFilePath: string): Promise<TranscribedWord[]>`. Task 5 la usa.

Este servicio llama a una API paga real — no se mockea (mismo criterio que el
resto del proyecto: `wikimediaService`, `kieAiService`, etc. tampoco tienen
tests con mocks). Se verifica con una llamada real de bajo costo contra un
audio corto.

- [ ] **Step 1: Agregar la función a `src/services/elevenlabsService.ts`**

El archivo ya importa `fs` en la línea 1 (`import fs from "fs";`) — no hace
falta tocar ese import. Agregar el import de `TranscribedWord` junto a los
demás imports, al inicio del archivo (después de `import { env } from "./env";`):

```ts
import type { TranscribedWord } from "./checklistSyncService";
```

Agregar la función al final del archivo (después de `generateSoundEffect`):

```ts
export async function transcribeWithTimestamps(audioFilePath: string): Promise<TranscribedWord[]> {
  const fileBuffer = fs.readFileSync(audioFilePath);
  const form = new FormData();
  form.append("model_id", "scribe_v1");
  form.append("timestamps_granularity", "word");
  form.append("file", new Blob([fileBuffer]), audioFilePath.split("/").pop() ?? "audio.mp3");

  const res = await fetch(`${BASE_URL}/speech-to-text`, {
    method: "POST",
    headers: { "xi-api-key": env.elevenLabsApiKey },
    body: form,
  });

  if (!res.ok) {
    throw new Error(`ElevenLabs transcribeWithTimestamps falló: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as {
    words: { text: string; start: number; end: number; type: string }[];
  };

  return data.words
    .filter((w) => w.type === "word")
    .map((w) => ({ text: w.text, start: w.start, end: w.end }));
}
```

- [ ] **Step 2: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Verificación real contra un audio corto**

Extraer un audio de prueba del video ya existente en el repo y transcribirlo:

Run:
```bash
ffmpeg -y -i content/raw/video-1-jhei.mov -vn -acodec libmp3lame -q:a 4 /tmp/test-audio.mp3
npx tsx -e '
import { transcribeWithTimestamps } from "./src/services/elevenlabsService";
transcribeWithTimestamps("/tmp/test-audio.mp3").then((words) => {
  console.log("total palabras:", words.length);
  console.log(words.slice(0, 5));
}).catch((e) => console.error(e));
'
```

Expected: imprime `total palabras: 411` (aprox. — puede variar levemente entre
corridas de Scribe) y las primeras 5 palabras con `text`/`start`/`end`
numéricos razonables (la primera debería ser `"Te"` cerca de `start: 1.18`).

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/elevenlabsService.ts
git commit -m "feat: add transcribeWithTimestamps using ElevenLabs Scribe"
```

---

## Task 5: `generateSocialChecklistAssets` — integración completa + guion de prueba real

**Files:**
- Modify: `src/services/generateAssets.ts`
- Create: `content/guiones/5-herramientas-ia.json`

**Interfaces:**
- Consumes: `getVideoDurationInSeconds`, `extractAudioTrack` (Task 3); `transcribeWithTimestamps` (Task 4); `matchItemTimestamps` (Task 2); `findWikimediaImageUrls` (ya existe); `generateImage` (ya existe).
- Produces: `generateSocialChecklistAssets(guion: SocialChecklistGuion): Promise<void>`, y el archivo `public/data/5-herramientas-ia.json` (`RenderedSocialChecklistGuion`) como fixture real para el Task 6.

- [ ] **Step 1: Crear el guion de prueba `content/guiones/5-herramientas-ia.json`**

```json
{
  "type": "social-checklist",
  "slug": "5-herramientas-ia",
  "topic": "5 herramientas de IA para tu negocio",
  "rawVideoPath": "content/raw/video-1-jhei.mov",
  "listTitle": "5 HERRAMIENTAS DE IA PARA HACER CRECER TU NEGOCIO EN 2026",
  "items": [
    { "id": "1", "label": "Claude", "logoQuery": "Claude Anthropic AI logo" },
    { "id": "2", "label": "AIVI", "logoQuery": "AIVI logo" },
    { "id": "3", "label": "Lovable", "logoQuery": "Lovable logo" },
    { "id": "4", "label": "ManyChat", "logoQuery": "ManyChat logo" },
    { "id": "5", "label": "Claude Code", "logoQuery": "Claude Anthropic AI logo" }
  ]
}
```

Nota: la transcripción real de este video dice "CloudCode"/"Cloud" en vez de
"Claude" y "Ivy" en vez de "AIVI" (Scribe confunde esos nombres de marca) —
es intencional dejarlo así para el Step 4: sirve para probar en un caso real
que el fallback a tiempo estimado funciona sin romper nada, no solo el caso
feliz. El item 4 ("ManyChat") sí aparece tal cual en la transcripción y debe
dar `matched: true`.

- [ ] **Step 2: Agregar `generateSocialChecklistAssets` a `src/services/generateAssets.ts`**

Agregar los imports nuevos al inicio del archivo:

```ts
import { generateVoice, generateSoundEffect, transcribeWithTimestamps } from "./elevenlabsService";
import { getVideoDurationInSeconds, extractAudioTrack } from "./ffmpegService";
import { matchItemTimestamps, type TranscribedWord } from "./checklistSyncService";
import type {
  Guion,
  VoxGuion,
  SocialChecklistGuion,
  RenderedChecklistItem,
  RenderedSocialChecklistGuion,
  GuionScene,
  RenderedGuion,
  RenderedScene,
  SceneImage,
} from "../types/guion";
```

(reemplaza los imports de tipos y de `elevenlabsService` ya existentes en el
archivo — no dejar dos imports separados del mismo módulo).

Agregar la función, antes de `main()`:

```ts
async function generateSocialChecklistAssets(guion: SocialChecklistGuion): Promise<void> {
  console.log(`Generando recursos para "${guion.topic}" (social-checklist, ${guion.items.length} items)`);

  const rawExt = path.extname(guion.rawVideoPath) || ".mov";
  const videoAbsPath = path.join(PUBLIC_DIR, "assets", guion.slug, "video", `source${rawExt}`);

  if (fs.existsSync(videoAbsPath)) {
    console.log("video ya copiado, se reutiliza");
  } else {
    console.log(`copiando video crudo desde ${guion.rawVideoPath}...`);
    fs.mkdirSync(path.dirname(videoAbsPath), { recursive: true });
    fs.copyFileSync(guion.rawVideoPath, videoAbsPath);
  }

  const durationInSeconds = await getVideoDurationInSeconds(videoAbsPath);
  console.log(`duración del video: ${durationInSeconds.toFixed(1)}s`);

  const transcriptPath = path.join(PUBLIC_DIR, "assets", guion.slug, "transcript.json");
  let words: TranscribedWord[];
  if (fs.existsSync(transcriptPath)) {
    console.log("transcripción ya existe, se reutiliza");
    words = JSON.parse(fs.readFileSync(transcriptPath, "utf-8")) as TranscribedWord[];
  } else {
    const audioTmpPath = path.join(PUBLIC_DIR, "assets", guion.slug, "audio-for-transcription.mp3");
    console.log("extrayendo audio para transcribir...");
    await extractAudioTrack(videoAbsPath, audioTmpPath);
    console.log("transcribiendo con ElevenLabs Scribe...");
    words = await transcribeWithTimestamps(audioTmpPath);
    fs.writeFileSync(transcriptPath, JSON.stringify(words, null, 2));
    fs.rmSync(audioTmpPath);
  }

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
    videoPath: toPublicRelPath(videoAbsPath),
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

Reemplazar la rama de `social-checklist` en `main()` (el `console.error` +
`process.exit(1)` puesto en el Task 1) por:

```ts
  if (guion.type === "social-checklist") {
    await generateSocialChecklistAssets(guion);
    return;
  }
```

- [ ] **Step 3: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Correrlo de verdad contra el guion de prueba**

Run: `npm run generate:assets -- content/guiones/5-herramientas-ia.json`

Expected: termina con una línea `Listo. Duración: 72.1s, 5 items (1 encontrados en transcripción).`
(el 1 es el item "ManyChat" — ver nota del Step 1; si Scribe transcribe distinto
en esta corrida y da un número distinto de matches, no es un fallo del
pipeline, es variabilidad del modelo — lo que sí debe cumplirse siempre es que
termine sin error y que `public/data/5-herramientas-ia.json` quede escrito).

- [ ] **Step 5: Inspeccionar el resultado**

Run: `cat public/data/5-herramientas-ia.json`

Expected: JSON válido con `videoPath` apuntando a
`assets/5-herramientas-ia/video/source.mov`, `durationInSeconds` ≈ 72.1,
5 items con `startSeconds` en orden no decreciente, cada uno con `logoPath`
apuntando a un archivo que existe de verdad en
`public/assets/5-herramientas-ia/images/`.

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/services/generateAssets.ts content/guiones/5-herramientas-ia.json public/data/5-herramientas-ia.json public/assets/5-herramientas-ia
git commit -m "feat: implement generateSocialChecklistAssets end to end"
```

---

## Task 6: Composición Remotion `SocialChecklist`

**Files:**
- Create: `src/components/SocialChecklist.tsx`
- Create: `src/SocialChecklistComposition.tsx`
- Modify: `src/Root.tsx`

**Interfaces:**
- Consumes: `RenderedSocialChecklistGuion` de `src/types/guion.ts` (Task 1), datos reales en `public/data/5-herramientas-ia.json` (Task 5).
- Produces: componente `SocialChecklist`, composición `SocialChecklistComposition`, registrada en `Root.tsx` con `id="CincoHerramientasIA"`, `slug="5-herramientas-ia"`.

- [ ] **Step 1: Crear `src/components/SocialChecklist.tsx`**

```tsx
import { AbsoluteFill, Img, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig, spring } from "remotion";
import { loadFont } from "@remotion/google-fonts/Poppins";
import type { RenderedSocialChecklistGuion } from "../types/guion";

const { fontFamily } = loadFont("normal", { weights: ["800", "900"] });

const ITEM_ENTRANCE_FRAMES = 18;

const ChecklistRow: React.FC<{
  index: number;
  total: number;
  startFrame: number;
  logoPath: string;
}> = ({ index, total, startFrame, logoPath }) => {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();

  const topArea = height * 0.24;
  const bottomArea = height * 0.92;
  const rowHeight = (bottomArea - topArea) / total;
  const rowTop = topArea + rowHeight * index;

  const localFrame = frame - startFrame;
  const hasArrived = localFrame >= 0;
  const entrance = spring({
    frame: Math.max(localFrame, 0),
    fps,
    config: { damping: 12, stiffness: 140, mass: 0.9 },
    durationInFrames: ITEM_ENTRANCE_FRAMES,
  });

  return (
    <div className="absolute left-[6%] flex items-center gap-4" style={{ top: rowTop, height: rowHeight }}>
      <div
        className="flex items-center justify-center rounded-full bg-[#e5342b] text-white"
        style={{
          width: rowHeight * 0.72,
          height: rowHeight * 0.72,
          fontFamily,
          fontWeight: 900,
          fontSize: rowHeight * 0.36,
        }}
      >
        {index + 1}
      </div>
      <div
        className="flex items-center justify-center overflow-hidden rounded-2xl bg-white"
        style={{ width: rowHeight * 0.72, height: rowHeight * 0.72 }}
      >
        {hasArrived && (
          <Img
            src={staticFile(logoPath)}
            style={{
              width: "72%",
              height: "72%",
              objectFit: "contain",
              opacity: entrance,
              transform: `translateY(${(1 - entrance) * -40}px) scale(${0.6 + entrance * 0.4})`,
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

  return (
    <AbsoluteFill className="bg-black">
      <OffthreadVideo src={staticFile(guion.videoPath)} className="absolute inset-0 h-full w-full object-cover" />

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
          startFrame={Math.round(item.startSeconds * fps)}
          logoPath={item.logoPath}
        />
      ))}
    </AbsoluteFill>
  );
};
```

- [ ] **Step 2: Crear `src/SocialChecklistComposition.tsx`**

```tsx
import { CalculateMetadataFunction, Composition, staticFile } from "remotion";
import { SocialChecklist } from "./components/SocialChecklist";
import type { RenderedSocialChecklistGuion } from "./types/guion";

const FPS = 30;
const WIDTH = 1080;
const HEIGHT = 1920;

type Props = { slug: string; guion: RenderedSocialChecklistGuion | null };

async function loadGuion(slug: string): Promise<RenderedSocialChecklistGuion> {
  const response = await fetch(staticFile(`data/${slug}.json`));
  return (await response.json()) as RenderedSocialChecklistGuion;
}

const calculateMetadata: CalculateMetadataFunction<Props> = async ({ props }) => {
  const guion = await loadGuion(props.slug);
  const durationInFrames = Math.ceil(guion.durationInSeconds * FPS);

  return {
    props: { ...props, guion },
    durationInFrames: Math.max(durationInFrames, FPS),
  };
};

export const SocialChecklistComposition: React.FC<{ id: string; slug: string }> = ({ id, slug }) => {
  return (
    <Composition
      id={id}
      component={SocialChecklist}
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

- [ ] **Step 3: Registrar en `src/Root.tsx`**

Agregar el import:

```ts
import { SocialChecklistComposition } from "./SocialChecklistComposition";
```

Agregar dentro del fragment, junto a las demás composiciones:

```tsx
      <SocialChecklistComposition id="CincoHerramientasIA" slug="5-herramientas-ia" />
```

- [ ] **Step 4: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 6: Verificación visual — still del inicio**

Run: `npx remotion still CincoHerramientasIA out/still-inicio.png --frame=0`

Leer `out/still-inicio.png` (herramienta de lectura de imágenes / abrir el
archivo). Expected: se ve el video de fondo, el título blanco arriba con el
texto en mayúscula, y las 5 filas numeradas (1-5) con casillas blancas
**vacías** (ningún logo debería haber aparecido todavía en el frame 0).

- [ ] **Step 7: Verificación visual — still con al menos un logo puesto**

Abrir `public/data/5-herramientas-ia.json`, tomar el `startSeconds` del item
con `"matched": true` (el de "ManyChat" si Scribe lo detectó igual que en el
Step 4 del Task 5), multiplicarlo por 30 y sumarle 20 (para pasar la
animación de entrada). Si ningún item dio `matched: true` en esta corrida,
usar el `startSeconds` del último item de la lista en su lugar.

Run: `npx remotion still CincoHerramientasIA out/still-logo.png --frame=<ese número>`

Leer `out/still-logo.png`. Expected: la casilla correspondiente a ese item ya
tiene su logo dentro (no vacía), y las casillas de items con `startSeconds`
mayor todavía están vacías.

- [ ] **Step 8: Commit**

```bash
git add src/components/SocialChecklist.tsx src/SocialChecklistComposition.tsx src/Root.tsx
git commit -m "feat: add SocialChecklist composition with animated logo checklist overlay"
```

---

## Task 7: Render final de extremo a extremo

**Files:** ninguno nuevo — solo verificación.

- [ ] **Step 1: Render completo**

Run: `npx remotion render CincoHerramientasIA out/5-herramientas-ia.mp4`
Expected: termina sin errores, `out/5-herramientas-ia.mp4` existe y pesa más
de unos pocos MB (video de 72s en 1080×1920 con audio).

- [ ] **Step 2: Revisión manual**

Abrir `out/5-herramientas-ia.mp4` y confirmar:
- El audio es el real del video original (la voz de la persona, no TTS).
- El título se ve fijo arriba durante todo el video.
- Cada logo entra animado y se queda fijo en su casilla en el momento
  correcto (o, para los items sin match real, en un momento razonablemente
  distribuido, sin verse repentino/aleatorio ni fuera de orden).
- No hay ningún salto ni congelamiento del video de fondo.

- [ ] **Step 3: Correr toda la suite de tests una vez más de punta a punta**

Run: `npm run test && npm run lint`
Expected: ambos PASS.

- [ ] **Step 4: Commit**

```bash
git add out/5-herramientas-ia.mp4
git commit -m "chore: add end-to-end rendered sample for social-checklist type"
```

(si `out/` está en `.gitignore` como parece por el README, este último `git add` no va a agregar nada — está bien, es solo el paso de verificación final, no hace falta versionar el mp4 de salida.)
