# Pantalla Dividida Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the new `type: "pantalla-dividida"` guion/pipeline/composition so future videos in this style (split-screen illustration + presenter, closing act at full screen) can be produced by reusing the existing silence/retake/aside processing pipeline.

**Architecture:** Extend the discriminated `Guion` union with a new `PantallaDivididaGuion` type. Extract the shared video-preparation block (copy raw video → transcribe → detect/cut silences, fillers, retakes, asides → trim) out of `generateSocialChecklistAssets` into a reusable `prepareTrimmedVideo` function, used by both `social-checklist` and the new type. Add a new pure matching function (`matchSceneTimestamps`) that locates each scene's real spoken timing in the transcript, mirroring the existing `matchItemTimestamps`. Add a new Remotion composition that renders one continuous presenter video with a switchable top-half illustration overlay.

**Tech Stack:** TypeScript, Remotion 4, React 19, Tailwind, vitest.

## Global Constraints

- Reuse the existing shared pipeline (transcription, silence/filler/retake/aside detection and cutting) with **zero behavior changes** — only extract it into a shared function, never modify its logic.
- Reuse the existing `MAX_CUT_SECONDS = 2.5` constant for image cycling inside a scene — do not redefine it.
- No automatic image generation (kie.ai) for this type — illustrations always come from user-provided `localImagePaths`.
- If a `"split"` scene is missing `localImagePaths`, the pipeline must fail explicitly, listing every affected scene, before writing any output — never a partial render.
- Composition dimensions: 1080x1920 (9:16), 30fps — matches every existing composition in this project.
- This plan does **not** author the real `pantalla-dividida` guion or produce the first real video — that happens in a separate session, after this code exists.

---

## Task 1: Guion schema — `PantallaDividida` types

**Files:**
- Modify: `src/types/guion.ts`

**Interfaces:**
- Consumes: nothing (pure type additions).
- Produces: `PantallaDivididaScene`, `PantallaDivididaGuion`, `RenderedPantallaDivididaScene`, `RenderedPantallaDivididaGuion` — consumed by Task 2 (`PantallaDivididaScene`), Task 4 (`PantallaDivididaGuion`, `RenderedPantallaDivididaGuion`), and Task 5 (`RenderedPantallaDivididaGuion`, `RenderedPantallaDivididaScene`).

- [ ] **Step 1: Add the new types**

In `src/types/guion.ts`, change the `GuionType` line:

```ts
export type GuionType = "vox" | "social-checklist" | "youtube" | "pantalla-dividida";
```

Add these interfaces after `RenderedSocialChecklistGuion` (end of file):

```ts
export interface PantallaDivididaScene {
  id: string;
  /** Debe existir literalmente (substring normalizado) en la transcripción real del video. */
  text: string;
  act: "split" | "closing";
  /** Solo aplica a act "split". Imágenes ya generadas a mano (ChatGPT), en orden.
   * Se ciclan cada MAX_CUT_SECONDS dentro de la duración real de la escena. */
  localImagePaths?: string[];
}

export interface PantallaDivididaGuion {
  type: "pantalla-dividida";
  slug: string;
  topic: string;
  /** Ruta al video crudo del presentador, ej. "content/raw/pantalla-dividida.mp4". */
  rawVideoPath: string;
  /** Igual semántica que en SocialChecklistGuion: corta cualquier tramo de otro hablante. */
  removeOtherSpeakers?: boolean;
  scenes: PantallaDivididaScene[];
}

export interface RenderedPantallaDivididaScene {
  id: string;
  text: string;
  act: "split" | "closing";
  startSeconds: number;
  durationInSeconds: number;
  /** false = no se encontró el texto en la transcripción, se usó tiempo estimado. */
  matched: boolean;
  /** Vacío en escenas "closing". */
  images: SceneImage[];
}

export interface RenderedPantallaDivididaGuion {
  type: "pantalla-dividida";
  slug: string;
  topic: string;
  videoPath: string;
  durationInSeconds: number;
  scenes: RenderedPantallaDivididaScene[];
}
```

Change the `Guion` union:

```ts
export type Guion = VoxGuion | SocialChecklistGuion | PantallaDivididaGuion;
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run lint`
Expected: no errors (this is a pure additive type change, nothing consumes the new types yet).

- [ ] **Step 3: Commit**

```bash
git add src/types/guion.ts
git commit -m "feat: add PantallaDividida guion types"
```

---

## Task 2: `matchSceneTimestamps` — scene timing matcher

**Files:**
- Modify: `src/services/checklistSyncService.ts`
- Test: `src/services/checklistSyncService.test.ts`

**Interfaces:**
- Consumes: `PantallaDivididaScene` (Task 1), `TranscribedWord` (already exported from this file).
- Produces: `matchSceneTimestamps(words: TranscribedWord[], scenes: PantallaDivididaScene[], totalDurationSeconds: number): MatchedScene[]`, where `MatchedScene = { scene: PantallaDivididaScene; startSeconds: number; durationInSeconds: number; matched: boolean }`. Consumed by Task 4.

This task refactors the file to extract two helpers (`findFirstMatchForText`, `resolveTimestamps`) out of the existing `matchItemTimestamps`, so the new function reuses the same matching/fallback logic instead of duplicating it. `matchItemTimestamps`'s public signature and behavior must not change — its existing tests must keep passing unmodified.

- [ ] **Step 1: Write the failing tests for `matchSceneTimestamps`**

Append to `src/services/checklistSyncService.test.ts` (keep the existing `matchItemTimestamps` describe block untouched, add a new one after it, and add the import):

```ts
import { matchItemTimestamps, matchSceneTimestamps, type TranscribedWord } from "./checklistSyncService";
import type { ChecklistItem, PantallaDivididaScene } from "../types/guion";
```

(replace the existing `import { matchItemTimestamps, type TranscribedWord } from "./checklistSyncService";` and `import type { ChecklistItem } from "../types/guion";` lines with the two lines above)

```ts
describe("matchSceneTimestamps", () => {
  it("encuentra una escena y calcula su duración hasta que arranca la siguiente", () => {
    const words = [w("Había", 0, 0.3), w("una", 0.3, 0.5), w("vez", 0.5, 0.8), w("un", 5, 5.2), w("rey", 5.2, 5.6)];
    const scenes: PantallaDivididaScene[] = [
      { id: "s1", text: "Había una vez", act: "split" },
      { id: "s2", text: "un rey", act: "split" },
    ];

    const result = matchSceneTimestamps(words, scenes, 10);

    expect(result[0]).toEqual({ scene: scenes[0], startSeconds: 0, durationInSeconds: 5, matched: true });
    expect(result[1]).toEqual({ scene: scenes[1], startSeconds: 5, durationInSeconds: 5, matched: true });
  });

  it("la última escena dura hasta el final del video", () => {
    const words = [w("Fin", 8, 8.5)];
    const scenes: PantallaDivididaScene[] = [{ id: "s1", text: "Fin", act: "closing" }];

    const result = matchSceneTimestamps(words, scenes, 12);

    expect(result[0]).toEqual({ scene: scenes[0], startSeconds: 8, durationInSeconds: 4, matched: true });
  });

  it("si no encuentra el texto de una escena, le asigna tiempo estimado sin fallar", () => {
    const words = [w("hola", 0, 0.3)];
    const scenes: PantallaDivididaScene[] = [{ id: "s1", text: "texto que no está en la transcripción", act: "split" }];

    const result = matchSceneTimestamps(words, scenes, 20);

    expect(result[0].matched).toBe(false);
    expect(result[0].durationInSeconds).toBeGreaterThan(0);
    expect(result[0].startSeconds).toBeLessThanOrEqual(20);
  });

  it("funciona igual para escenas de cierre (act closing)", () => {
    const words = [w("moraleja", 9, 9.6)];
    const scenes: PantallaDivididaScene[] = [{ id: "s1", text: "moraleja", act: "closing" }];

    const result = matchSceneTimestamps(words, scenes, 10);

    expect(result[0]).toEqual({ scene: scenes[0], startSeconds: 9, durationInSeconds: 1, matched: true });
  });

  it("descarta un match fuera de orden y re-estima esa escena", () => {
    const words = [w("Segunda", 0, 0.5), w("luego", 0.5, 0.8), w("Primera", 5, 5.5)];
    const scenes: PantallaDivididaScene[] = [
      { id: "s1", text: "Primera", act: "split" },
      { id: "s2", text: "Segunda", act: "split" },
    ];

    const result = matchSceneTimestamps(words, scenes, 10);

    expect(result[0]).toEqual({ scene: scenes[0], startSeconds: 5, durationInSeconds: expect.any(Number), matched: true });
    expect(result[1].matched).toBe(false);
    expect(result[1].startSeconds).toBeGreaterThanOrEqual(5);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/services/checklistSyncService.test.ts`
Expected: FAIL — `matchSceneTimestamps` is not exported yet.

- [ ] **Step 3: Refactor `checklistSyncService.ts` and add `matchSceneTimestamps`**

Replace the entire contents of `src/services/checklistSyncService.ts` with:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/services/checklistSyncService.test.ts`
Expected: PASS — all `matchItemTimestamps` tests (unchanged) and all new `matchSceneTimestamps` tests green.

- [ ] **Step 5: Commit**

```bash
git add src/services/checklistSyncService.ts src/services/checklistSyncService.test.ts
git commit -m "feat: add matchSceneTimestamps for pantalla-dividida scene timing"
```

---

## Task 3: `prepareTrimmedVideo` — shared video prep, extracted from `generateSocialChecklistAssets`

**Files:**
- Modify: `src/services/generateAssets.ts`

**Interfaces:**
- Consumes: nothing new (uses only already-imported services in this file).
- Produces: `prepareTrimmedVideo(params: { slug: string; rawVideoPath: string; removeOtherSpeakers?: boolean }): Promise<{ words: TranscribedWord[]; videoPath: string; durationInSeconds: number }>`. Consumed by Task 4 (`generatePantallaDivididaAssets`) and by the now-refactored `generateSocialChecklistAssets`.

This task must not change `generateSocialChecklistAssets`'s external behavior — same cache files, same console output, same final `public/data/<slug>.json` shape for existing videos.

- [ ] **Step 1: Add `prepareTrimmedVideo`, above `generateSocialChecklistAssets`**

In `src/services/generateAssets.ts`, insert this function right before `async function generateSocialChecklistAssets(...)`:

```ts
interface PrepareTrimmedVideoParams {
  slug: string;
  rawVideoPath: string;
  removeOtherSpeakers?: boolean;
}

interface TrimmedVideoResult {
  words: TranscribedWord[];
  videoPath: string;
  durationInSeconds: number;
}

async function prepareTrimmedVideo({
  slug,
  rawVideoPath,
  removeOtherSpeakers,
}: PrepareTrimmedVideoParams): Promise<TrimmedVideoResult> {
  const rawExt = path.extname(rawVideoPath) || ".mov";
  const rawVideoAbsPath = path.join(PUBLIC_DIR, "assets", slug, "video", `source${rawExt}`);

  if (fs.existsSync(rawVideoAbsPath)) {
    console.log("video crudo ya copiado, se reutiliza");
  } else {
    console.log(`copiando video crudo desde ${rawVideoPath}...`);
    fs.mkdirSync(path.dirname(rawVideoAbsPath), { recursive: true });
    fs.copyFileSync(rawVideoPath, rawVideoAbsPath);
  }

  const rawDurationInSeconds = await getVideoDurationInSeconds(rawVideoAbsPath);

  const transcriptPath = path.join(PUBLIC_DIR, "assets", slug, "transcript.json");
  let rawWords: TranscribedWord[];
  if (fs.existsSync(transcriptPath)) {
    console.log("transcripción ya existe, se reutiliza");
    rawWords = JSON.parse(fs.readFileSync(transcriptPath, "utf-8")) as TranscribedWord[];
  } else {
    const audioTmpPath = path.join(PUBLIC_DIR, "assets", slug, "audio-for-transcription.mp3");
    console.log("extrayendo audio para transcribir...");
    await extractAudioTrack(rawVideoAbsPath, audioTmpPath);
    if (removeOtherSpeakers) {
      console.log("transcribiendo con ElevenLabs Scribe (con diarización)...");
      rawWords = await transcribeWithSpeakers(audioTmpPath);
    } else {
      console.log("transcribiendo con ElevenLabs Scribe...");
      rawWords = await transcribeWithTimestamps(audioTmpPath);
    }
    fs.writeFileSync(transcriptPath, JSON.stringify(rawWords, null, 2));
    fs.rmSync(audioTmpPath);
  }

  const trimmedVideoAbsPath = path.join(PUBLIC_DIR, "assets", slug, "video", `trimmed${rawExt}`);

  console.log("detectando silencios y titubeos...");
  const silenceRanges = await detectSilenceRanges(rawVideoAbsPath, rawDurationInSeconds);
  const fillerRanges = detectFillerRanges(rawWords);
  let otherSpeakerRanges: CutRange[] = [];
  if (removeOtherSpeakers) {
    const diarizedWords = rawWords as DiarizedWord[];
    const primarySpeakerId = findPrimarySpeakerId(diarizedWords);
    otherSpeakerRanges = detectOtherSpeakerRanges(diarizedWords, primarySpeakerId);
    console.log(`  hablante principal: ${primarySpeakerId}, ${otherSpeakerRanges.length} tramo(s) de otra voz`);
  }
  console.log(`  ${silenceRanges.length} silencio(s), ${fillerRanges.length} titubeo(s)/muletilla(s)`);

  // Los rangos APROBADOS se persisten en su propio archivo, separado de
  // trimmedVideoAbsPath: ese gate solo controla si hace falta volver a correr
  // ffmpeg, pero words/matches/duración se recalculan en CADA corrida (incluso
  // si el video ya está recortado). Ver generateAssets.ts (versión anterior a
  // este refactor) para el detalle completo de por qué importa el orden.
  const approvedRetakeRangesPath = path.join(PUBLIC_DIR, "assets", slug, "approved-retake-ranges.json");
  let approvedRetakeRanges: CutRange[];
  if (fs.existsSync(approvedRetakeRangesPath)) {
    console.log("rangos de retake ya aprobados, se reutilizan");
    approvedRetakeRanges = JSON.parse(fs.readFileSync(approvedRetakeRangesPath, "utf-8")) as CutRange[];
  } else {
    const retakeCandidatesPath = path.join(PUBLIC_DIR, "assets", slug, "retake-candidates.json");
    let retakeCandidates: RetakeCandidate[];
    if (fs.existsSync(retakeCandidatesPath)) {
      console.log("candidatos a retake ya existen, se reutilizan");
      retakeCandidates = JSON.parse(fs.readFileSync(retakeCandidatesPath, "utf-8")) as RetakeCandidate[];
    } else {
      console.log("detectando retakes y asides fuera de guion con Claude...");
      retakeCandidates = await detectRetakeCandidates(rawWords);
      fs.mkdirSync(path.dirname(retakeCandidatesPath), { recursive: true });
      fs.writeFileSync(retakeCandidatesPath, JSON.stringify(retakeCandidates, null, 2));
    }
    console.log(`  ${retakeCandidates.length} candidato(s) a retake/aside`);
    approvedRetakeRanges = await reviewRetakeCandidates(retakeCandidates);
    console.log(`  ${approvedRetakeRanges.length} aprobado(s) para cortar`);
    fs.mkdirSync(path.dirname(approvedRetakeRangesPath), { recursive: true });
    fs.writeFileSync(approvedRetakeRangesPath, JSON.stringify(approvedRetakeRanges, null, 2));
  }

  const cutRanges = mergeCutRanges([...silenceRanges, ...fillerRanges]);
  const keepSegmentsBeforePrecise = computeKeepSegments(rawDurationInSeconds, cutRanges, TRIM_PADDING_SECONDS);
  const keepSegments = subtractRanges(keepSegmentsBeforePrecise, [...otherSpeakerRanges, ...approvedRetakeRanges]);
  const words = remapWords(rawWords, keepSegments);

  const repeatedPhrases = detectRepeatedPhrases(words);
  if (repeatedPhrases.length > 0) {
    console.log(`\n⚠️  ${repeatedPhrases.length} frase(s) posiblemente duplicada(s) en el video final (revisar):`);
    for (const r of repeatedPhrases) {
      console.log(`  ${r.start.toFixed(1)}s-${r.end.toFixed(1)}s: "${r.phrase}"`);
    }
    console.log("");
  }

  if (fs.existsSync(trimmedVideoAbsPath)) {
    console.log("video recortado ya existe, se reutiliza");
  } else {
    console.log(
      `recortando video (${keepSegments.length} segmento(s) a conservar de ${cutRanges.length + otherSpeakerRanges.length + approvedRetakeRanges.length} corte(s): ${cutRanges.length} de silencio/muletilla, ${otherSpeakerRanges.length} de otro-hablante, ${approvedRetakeRanges.length} de retake/aside)...`,
    );
    await trimVideoToSegments(rawVideoAbsPath, trimmedVideoAbsPath, keepSegments);
  }

  const durationInSeconds = await getVideoDurationInSeconds(trimmedVideoAbsPath);
  console.log(`duración final: ${durationInSeconds.toFixed(1)}s (crudo: ${rawDurationInSeconds.toFixed(1)}s)`);

  return { words, videoPath: toPublicRelPath(trimmedVideoAbsPath), durationInSeconds };
}
```

- [ ] **Step 2: Replace the inline block in `generateSocialChecklistAssets` with a call to `prepareTrimmedVideo`**

In `generateSocialChecklistAssets`, find this block (everything from the `rawExt` line through the `console.log` of `duración final`, right before `const matches = matchItemTimestamps(...)`):

```ts
  const rawExt = path.extname(guion.rawVideoPath) || ".mov";
  const rawVideoAbsPath = path.join(PUBLIC_DIR, "assets", guion.slug, "video", `source${rawExt}`);

  if (fs.existsSync(rawVideoAbsPath)) {
```
... (through) ...
```ts
  const durationInSeconds = await getVideoDurationInSeconds(trimmedVideoAbsPath);
  console.log(`duración final: ${durationInSeconds.toFixed(1)}s (crudo: ${rawDurationInSeconds.toFixed(1)}s)`);

  const matches = matchItemTimestamps(words, guion.items, durationInSeconds);
```

Replace that whole block with:

```ts
  const { words, videoPath, durationInSeconds } = await prepareTrimmedVideo({
    slug: guion.slug,
    rawVideoPath: guion.rawVideoPath,
    removeOtherSpeakers: guion.removeOtherSpeakers,
  });

  const matches = matchItemTimestamps(words, guion.items, durationInSeconds);
```

Then, further down in the same function, find:

```ts
  const rendered: RenderedSocialChecklistGuion = {
    type: "social-checklist",
    slug: guion.slug,
    topic: guion.topic,
    videoPath: toPublicRelPath(trimmedVideoAbsPath),
    durationInSeconds,
```

and change `videoPath: toPublicRelPath(trimmedVideoAbsPath),` to `videoPath,` (the variable from the destructured result now holds it).

- [ ] **Step 3: Verify it compiles and existing tests still pass**

Run: `npm run lint && npm test`
Expected: no type errors (no unused variables left over — `rawExt`, `rawVideoAbsPath`, `trimmedVideoAbsPath`, etc. no longer exist in `generateSocialChecklistAssets`'s scope), all existing tests pass unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/services/generateAssets.ts
git commit -m "refactor: extract prepareTrimmedVideo shared by social-checklist and pantalla-dividida"
```

---

## Task 4: `generatePantallaDivididaAssets` — new pipeline branch

**Files:**
- Modify: `src/services/generateAssets.ts`

**Interfaces:**
- Consumes: `prepareTrimmedVideo` (Task 3), `matchSceneTimestamps` (Task 2), `PantallaDivididaGuion`, `RenderedPantallaDivididaGuion`, `RenderedPantallaDivididaScene` (Task 1), `MAX_CUT_SECONDS` (already exists in this file).
- Produces: `generatePantallaDivididaAssets(guion: PantallaDivididaGuion): Promise<void>`, wired into `main()`'s type dispatch, writes `public/data/<slug>.json` as `RenderedPantallaDivididaGuion`.

- [ ] **Step 1: Update imports**

At the top of `src/services/generateAssets.ts`, change:

```ts
import { matchItemTimestamps, type TranscribedWord, type DiarizedWord } from "./checklistSyncService";
```

to:

```ts
import { matchItemTimestamps, matchSceneTimestamps, type TranscribedWord, type DiarizedWord } from "./checklistSyncService";
```

And change the type import block:

```ts
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

to:

```ts
import type {
  Guion,
  VoxGuion,
  SocialChecklistGuion,
  RenderedChecklistItem,
  RenderedSocialChecklistGuion,
  PantallaDivididaGuion,
  RenderedPantallaDivididaScene,
  RenderedPantallaDivididaGuion,
  GuionScene,
  RenderedGuion,
  RenderedScene,
  SceneImage,
} from "../types/guion";
```

- [ ] **Step 2: Add `generatePantallaDivididaAssets`, after `generateSocialChecklistAssets`**

```ts
async function generatePantallaDivididaAssets(guion: PantallaDivididaGuion): Promise<void> {
  console.log(`Generando recursos para "${guion.topic}" (pantalla-dividida, ${guion.scenes.length} escena(s))`);

  const { words, videoPath, durationInSeconds } = await prepareTrimmedVideo({
    slug: guion.slug,
    rawVideoPath: guion.rawVideoPath,
    removeOtherSpeakers: guion.removeOtherSpeakers,
  });

  const matches = matchSceneTimestamps(words, guion.scenes, durationInSeconds);

  const missing: string[] = [];
  for (const { scene, durationInSeconds: sceneDuration } of matches) {
    if (scene.act !== "split") continue;
    if (scene.localImagePaths && scene.localImagePaths.length > 0) continue;
    const numCuts = Math.max(1, Math.ceil(sceneDuration / MAX_CUT_SECONDS));
    missing.push(`  [${scene.id}] necesita ${numCuts} imagen(es) en "localImagePaths" (dura ${sceneDuration.toFixed(1)}s)`);
  }
  if (missing.length > 0) {
    throw new Error(
      `Faltan imágenes locales para ${missing.length} escena(s) antes de generar el video:\n${missing.join("\n")}`,
    );
  }

  const renderedScenes: RenderedPantallaDivididaScene[] = [];
  for (const { scene, startSeconds, durationInSeconds: sceneDuration, matched } of matches) {
    if (!matched) {
      console.log(
        `[${scene.id}] no se encontró el texto en la transcripción, usando tiempo estimado (${startSeconds.toFixed(1)}s)`,
      );
    }

    const images: SceneImage[] = [];
    if (scene.act === "split") {
      const localImagePaths = scene.localImagePaths as string[];
      const numCuts = Math.max(1, Math.ceil(sceneDuration / MAX_CUT_SECONDS));
      const cutDuration = sceneDuration / numCuts;
      for (let i = 0; i < numCuts; i++) {
        const sourcePath = localImagePaths[i % localImagePaths.length];
        const ext = path.extname(sourcePath) || ".png";
        const imageAbsPath = path.join(PUBLIC_DIR, "assets", guion.slug, "images", `${scene.id}-local${i}${ext}`);
        if (fs.existsSync(imageAbsPath)) {
          console.log(`[${scene.id}] corte ${i} ya existe, se reutiliza`);
        } else {
          console.log(`[${scene.id}] copiando corte ${i}: ${sourcePath}`);
          fs.mkdirSync(path.dirname(imageAbsPath), { recursive: true });
          fs.copyFileSync(sourcePath, imageAbsPath);
        }
        images.push({ path: toPublicRelPath(imageAbsPath), durationInSeconds: cutDuration });
      }
    }

    renderedScenes.push({
      id: scene.id,
      text: scene.text,
      act: scene.act,
      startSeconds,
      durationInSeconds: sceneDuration,
      matched,
      images,
    });
  }

  const rendered: RenderedPantallaDivididaGuion = {
    type: "pantalla-dividida",
    slug: guion.slug,
    topic: guion.topic,
    videoPath,
    durationInSeconds,
    scenes: renderedScenes,
  };

  const dataDir = path.join(PUBLIC_DIR, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, `${guion.slug}.json`), JSON.stringify(rendered, null, 2));

  const matchedCount = renderedScenes.filter((s) => s.matched).length;
  console.log(
    `\nListo. Duración: ${durationInSeconds.toFixed(1)}s, ${renderedScenes.length} escena(s) (${matchedCount} encontrada(s) en transcripción).`,
  );
}
```

- [ ] **Step 3: Wire it into `main()`**

Change:

```ts
  if (guion.type === "social-checklist") {
    await generateSocialChecklistAssets(guion);
    return;
  }

  await generateVoxAssets(guion);
```

to:

```ts
  if (guion.type === "social-checklist") {
    await generateSocialChecklistAssets(guion);
    return;
  }

  if (guion.type === "pantalla-dividida") {
    await generatePantallaDivididaAssets(guion);
    return;
  }

  await generateVoxAssets(guion);
```

- [ ] **Step 4: Verify it compiles and existing tests still pass**

Run: `npm run lint && npm test`
Expected: no type errors, all tests pass. (`generatePantallaDivididaAssets` itself has no direct unit test — it's I/O orchestration like its `social-checklist` counterpart; its pure logic, `matchSceneTimestamps`, is already covered by Task 2's tests.)

- [ ] **Step 5: Commit**

```bash
git add src/services/generateAssets.ts
git commit -m "feat: add generatePantallaDivididaAssets pipeline branch"
```

---

## Task 5: Remotion composition + visual fixture

**Files:**
- Create: `src/components/PantallaDividida.tsx`
- Create: `src/PantallaDivididaComposition.tsx`
- Modify: `src/Root.tsx`
- Create (binary fixtures, generated via ffmpeg, not hand-written): `public/assets/pantalla-dividida-demo/video/demo.mp4`, `public/assets/pantalla-dividida-demo/images/s1-a.png`, `public/assets/pantalla-dividida-demo/images/s1-b.png`, `public/assets/pantalla-dividida-demo/images/s2-a.png`
- Create: `public/data/pantalla-dividida-demo.json`

**Interfaces:**
- Consumes: `RenderedPantallaDivididaGuion`, `RenderedPantallaDivididaScene` (Task 1).
- Produces: `PantallaDividida` component, `PantallaDivididaComposition` composition, registered in `Root.tsx` as `id="PantallaDivididaDemo"`.

There is no real `pantalla-dividida` guion yet (out of scope for this plan — see Global Constraints), so this task builds a small hand-authored fixture (`pantalla-dividida-demo`) purely to verify the composition renders correctly in Remotion Studio, without depending on real footage, real transcription, or any API call.

- [ ] **Step 1: Create `src/components/PantallaDividida.tsx`**

```tsx
import { AbsoluteFill, Img, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { loadFont } from "@remotion/google-fonts/Poppins";
import type { RenderedPantallaDivididaGuion, RenderedPantallaDivididaScene } from "../types/guion";

const { fontFamily } = loadFont("normal", { weights: ["700", "800"] });

const ENTRANCE_FRAMES = 6;
const CUT_TRANSITION_FRAMES = 6;

function findActiveScene(
  scenes: RenderedPantallaDivididaScene[],
  fps: number,
  frame: number,
): { scene: RenderedPantallaDivididaScene; sceneStartFrame: number } | null {
  let cursorSeconds = 0;
  for (const scene of scenes) {
    const sceneStartFrame = Math.round(cursorSeconds * fps);
    cursorSeconds += scene.durationInSeconds;
    const sceneEndFrame = Math.round(cursorSeconds * fps);
    if (frame >= sceneStartFrame && frame < sceneEndFrame) {
      return { scene, sceneStartFrame };
    }
  }
  return scenes.length > 0 ? { scene: scenes[scenes.length - 1], sceneStartFrame: 0 } : null;
}

// Mismo algoritmo de ciclado por duración con crossfade que FullBleedVisual
// en components/Scene.tsx, adaptado a frame local de la escena activa (no
// hay TransitionSeries acá: el video de abajo es continuo).
const SceneIllustration: React.FC<{ scene: RenderedPantallaDivididaScene; localFrame: number; fps: number }> = ({
  scene,
  localFrame,
  fps,
}) => {
  let cursorSeconds = 0;
  const cuts = scene.images.map((image) => {
    const startFrame = Math.round(cursorSeconds * fps);
    cursorSeconds += image.durationInSeconds;
    const endFrame = Math.round(cursorSeconds * fps);
    return { ...image, startFrame, endFrame };
  });

  return (
    <>
      {cuts.map((cut, i) => {
        let opacity = 1;
        if (i > 0) {
          opacity = Math.min(
            opacity,
            interpolate(localFrame, [cut.startFrame, cut.startFrame + CUT_TRANSITION_FRAMES], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          );
        }
        if (i < cuts.length - 1) {
          opacity = Math.min(
            opacity,
            interpolate(localFrame, [cut.endFrame - CUT_TRANSITION_FRAMES, cut.endFrame], [1, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          );
        }

        return (
          <Img
            key={cut.path}
            src={staticFile(cut.path)}
            className="absolute inset-0 h-full w-full object-cover"
            style={{ opacity }}
          />
        );
      })}
    </>
  );
};

const Caption: React.FC<{ text: string; localFrame: number; fps: number; variant: "bar" | "overlay" }> = ({
  text,
  localFrame,
  fps,
  variant,
}) => {
  const entrance = spring({
    frame: localFrame - 2,
    fps,
    config: { damping: 12, stiffness: 260, mass: 0.5 },
    durationInFrames: ENTRANCE_FRAMES,
  });

  if (variant === "bar") {
    return (
      <div className="absolute inset-x-0 bottom-0 flex justify-center bg-black px-8 py-6" style={{ opacity: entrance }}>
        <p className="text-center text-white" style={{ fontFamily, fontWeight: 700, fontSize: 34, lineHeight: 1.2 }}>
          {text}
        </p>
      </div>
    );
  }

  return (
    <div
      className="absolute inset-x-0 top-1/2 flex justify-center px-10"
      style={{ opacity: entrance, transform: `translateY(-50%)` }}
    >
      <p
        className="text-center text-white"
        style={{ fontFamily, fontWeight: 800, fontSize: 54, lineHeight: 1.2, textShadow: "0 2px 18px rgba(0,0,0,0.65)" }}
      >
        {text}
      </p>
    </div>
  );
};

export const PantallaDividida: React.FC<{ slug: string; guion: RenderedPantallaDivididaGuion | null }> = ({ guion }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  if (!guion) return null;

  const active = findActiveScene(guion.scenes, fps, frame);
  const isSplit = active?.scene.act === "split";
  const localFrame = active ? frame - active.sceneStartFrame : 0;

  return (
    <AbsoluteFill className="bg-black">
      <div className="absolute inset-x-0 overflow-hidden" style={isSplit ? { bottom: 0, height: "50%" } : { inset: 0 }}>
        <OffthreadVideo src={staticFile(guion.videoPath)} className="absolute inset-0 h-full w-full object-cover" />
      </div>

      {active && isSplit && (
        <div className="absolute inset-x-0 top-0 overflow-hidden" style={{ height: "50%" }}>
          <SceneIllustration scene={active.scene} localFrame={localFrame} fps={fps} />
          <Caption text={active.scene.text} localFrame={localFrame} fps={fps} variant="bar" />
        </div>
      )}

      {active && !isSplit && <Caption text={active.scene.text} localFrame={localFrame} fps={fps} variant="overlay" />}
    </AbsoluteFill>
  );
};
```

- [ ] **Step 2: Create `src/PantallaDivididaComposition.tsx`**

```tsx
import { CalculateMetadataFunction, Composition, staticFile } from "remotion";
import { PantallaDividida } from "./components/PantallaDividida";
import type { RenderedPantallaDivididaGuion } from "./types/guion";

const FPS = 30;
const WIDTH = 1080;
const HEIGHT = 1920;

type Props = { slug: string; guion: RenderedPantallaDivididaGuion | null };

async function loadGuion(slug: string): Promise<RenderedPantallaDivididaGuion> {
  const response = await fetch(staticFile(`data/${slug}.json`));
  return (await response.json()) as RenderedPantallaDivididaGuion;
}

const calculateMetadata: CalculateMetadataFunction<Props> = async ({ props }) => {
  const guion = await loadGuion(props.slug);
  const durationInFrames = Math.ceil(guion.durationInSeconds * FPS);

  return {
    props: { ...props, guion },
    durationInFrames: Math.max(durationInFrames, FPS),
  };
};

export const PantallaDivididaComposition: React.FC<{ id: string; slug: string }> = ({ id, slug }) => {
  return (
    <Composition
      id={id}
      component={PantallaDividida}
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

- [ ] **Step 3: Register in `src/Root.tsx`**

Add the import:

```tsx
import { PantallaDivididaComposition } from "./PantallaDivididaComposition";
```

Add the composition entry, after the last existing one:

```tsx
      <PantallaDivididaComposition id="PantallaDivididaDemo" slug="pantalla-dividida-demo" />
```

- [ ] **Step 4: Generate the fixture binary assets**

```bash
mkdir -p public/assets/pantalla-dividida-demo/video public/assets/pantalla-dividida-demo/images

ffmpeg -y -f lavfi -i testsrc=size=1080x1920:rate=30:duration=9 \
  -f lavfi -i sine=frequency=440:duration=9 \
  -pix_fmt yuv420p -shortest \
  public/assets/pantalla-dividida-demo/video/demo.mp4

ffmpeg -y -f lavfi -i color=c=0xB8860B:size=1080x960:d=1 -frames:v 1 public/assets/pantalla-dividida-demo/images/s1-a.png
ffmpeg -y -f lavfi -i color=c=0x8B4513:size=1080x960:d=1 -frames:v 1 public/assets/pantalla-dividida-demo/images/s1-b.png
ffmpeg -y -f lavfi -i color=c=0x2F4F4F:size=1080x960:d=1 -frames:v 1 public/assets/pantalla-dividida-demo/images/s2-a.png
```

Expected: 4 new files under `public/assets/pantalla-dividida-demo/` (a ~9s synthetic test-pattern video with tone, and 3 solid-color PNGs).

- [ ] **Step 5: Create the fixture data file `public/data/pantalla-dividida-demo.json`**

```json
{
  "type": "pantalla-dividida",
  "slug": "pantalla-dividida-demo",
  "topic": "Demo de pantalla dividida (fixture de prueba, sin audio real)",
  "videoPath": "assets/pantalla-dividida-demo/video/demo.mp4",
  "durationInSeconds": 9,
  "scenes": [
    {
      "id": "s1",
      "text": "Había una vez un rey que buscaba sabiduría.",
      "act": "split",
      "startSeconds": 0,
      "durationInSeconds": 5,
      "matched": true,
      "images": [
        { "path": "assets/pantalla-dividida-demo/images/s1-a.png", "durationInSeconds": 2.5 },
        { "path": "assets/pantalla-dividida-demo/images/s1-b.png", "durationInSeconds": 2.5 }
      ]
    },
    {
      "id": "s2",
      "text": "Un día, un mendigo tocó su puerta.",
      "act": "split",
      "startSeconds": 5,
      "durationInSeconds": 2,
      "matched": true,
      "images": [{ "path": "assets/pantalla-dividida-demo/images/s2-a.png", "durationInSeconds": 2 }]
    },
    {
      "id": "s3",
      "text": "La verdadera riqueza no está en lo que tienes, sino en lo que compartes.",
      "act": "closing",
      "startSeconds": 7,
      "durationInSeconds": 2,
      "matched": true,
      "images": []
    }
  ]
}
```

- [ ] **Step 6: Verify it compiles**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 7: Visually verify in Remotion Studio**

Run: `npm run dev` (skip if Remotion Studio is already running — check with `lsof -i :3000`).

Open `http://localhost:3000/PantallaDivididaDemo` in a browser and scrub through the timeline. Confirm:
- 0s-5s (scene `s1`, split): top half shows a solid-color image that crossfades to a second color partway through; bottom half shows the moving test-pattern video; a black bar with white text sits at the bottom of the top half.
- 5s-7s (scene `s2`, split): top half shows a single solid color (no crossfade, only one image); bottom half still the test video.
- 7s-9s (scene `s3`, closing): video fills the entire frame; white text is centered vertically with no background bar.

This is a manual visual check (no assertion to automate — there's no existing React component test setup in this project). If anything looks wrong, fix `components/PantallaDividida.tsx` and re-check before moving on.

- [ ] **Step 8: Commit**

```bash
git add src/components/PantallaDividida.tsx src/PantallaDivididaComposition.tsx src/Root.tsx public/assets/pantalla-dividida-demo public/data/pantalla-dividida-demo.json
git commit -m "feat: add PantallaDividida composition with a visual fixture"
```

---

## Final check

- [ ] Run `npm run lint && npm test` once more from the repo root — full green before considering this plan done.
