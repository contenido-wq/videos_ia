# Youtube Noticias Avatar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the new `type: "youtube-noticias-avatar"` guion/pipeline/composition — a horizontal (16:9) news format with the expert in a vertical strip on the right, a background illustration cycling every 4s on the left, and word-highlighted captions — so real videos in this style can be produced by reusing the existing silence/retake/aside processing pipeline.

**Architecture:** Extend the discriminated `Guion` union with a new `YoutubeNoticiasAvatarGuion` type. Generalize the existing `matchSceneTimestamps` (currently hardcoded to `PantallaDivididaScene`) to a generic function so this new type reuses it without duplicating the matching logic. Add a new pure `buildCaptionChunks` function that groups the real transcript into short word-level caption chunks, independent of the image-cycling scenes. Add a new `generateYoutubeNoticiasAvatarAssets` pipeline branch that reuses `prepareTrimmedVideo` as-is. Add a new horizontal Remotion composition with a two-panel layout (illustration + video) and a karaoke-style caption component.

**Tech Stack:** TypeScript, Remotion 4, React 19, Tailwind, vitest, ffmpeg (fixture generation only).

**Spec:** `docs/superpowers/specs/2026-08-28-youtube-noticias-avatar-design.md`

## Global Constraints

- Reuse the existing shared pipeline (`prepareTrimmedVideo`: transcription, silence/filler/retake/aside detection and cutting) with **zero behavior changes**.
- New cadence constant `NEWS_AVATAR_CUT_SECONDS = 4` for this type only — never reuse or modify the existing `MAX_CUT_SECONDS = 2.5` used by `vox`/`pantalla-dividida`.
- No automatic image generation for this type — illustrations always come from user-provided `localImagePaths`. Connecting this to an image-generation API is explicit future work, not built in this plan.
- If a scene is missing `localImagePaths` (empty or absent), the pipeline must fail explicitly, listing every affected scene and how many images it needs, before writing any output.
- `subscribeButton: true` without the shared asset at `public/assets/youtube-noticias-avatar/subscribe-button.png` must fail explicitly with that exact path.
- No background music, no sound effects, no closing act — split-screen runs for the entire video.
- Composition dimensions: 1920x1080 (16:9), 30fps — the first horizontal format in this project (every existing composition is 1080x1920).
- Captions are word-highlighted chunks derived from the full trimmed transcript (`buildCaptionChunks`) — independent of scene boundaries, never grouped by `scenes[].text`.
- This plan does **not** author a real `youtube-noticias-avatar` guion or produce the first real video — that happens in a follow-up, once the user hands over their raw video and prepared images, using the `SKILL.md` this plan creates.

---

## Task 1: Guion schema — `YoutubeNoticiasAvatar` types

**Files:**
- Modify: `src/types/guion.ts`

**Interfaces:**
- Consumes: nothing (pure type additions).
- Produces: `YoutubeNoticiasAvatarScene`, `YoutubeNoticiasAvatarGuion` (consumed by Task 4, and Task 2's test), `CaptionWord`, `CaptionChunk` (consumed by Task 3, Task 4, Task 5), `RenderedYoutubeNoticiasAvatarScene`, `RenderedYoutubeNoticiasAvatarGuion` (consumed by Task 4, Task 5).

- [ ] **Step 1: Add the new types**

In `src/types/guion.ts`, change the `GuionType` line:

```ts
export type GuionType = "vox" | "social-checklist" | "youtube" | "pantalla-dividida" | "youtube-noticias-avatar";
```

Change the `Guion` union:

```ts
export type Guion = VoxGuion | SocialChecklistGuion | PantallaDivididaGuion | YoutubeNoticiasAvatarGuion;
```

Add these interfaces at the end of the file (after `RenderedPantallaDivididaGuion`):

```ts
export interface YoutubeNoticiasAvatarScene {
  id: string;
  /** Debe existir literalmente (substring normalizado) en la transcripción real del video. */
  text: string;
  /** Imágenes ya preparadas por el usuario, en orden. Se ciclan cada NEWS_AVATAR_CUT_SECONDS (4s)
   * dentro de la duración real de la escena. */
  localImagePaths: string[];
}

export interface YoutubeNoticiasAvatarGuion {
  type: "youtube-noticias-avatar";
  slug: string;
  topic: string;
  /** Ruta al video crudo del experto, ej. "content/raw/mi-noticia.mp4". */
  rawVideoPath: string;
  removeOtherSpeakers?: boolean;
  scenes: YoutubeNoticiasAvatarScene[];
  /** Default false. Se pregunta explícitamente en cada video, no va fijo. */
  subscribeButton?: boolean;
}

export interface RenderedYoutubeNoticiasAvatarScene {
  id: string;
  text: string;
  startSeconds: number;
  durationInSeconds: number;
  /** false = no se encontró el texto en la transcripción, se usó tiempo estimado. */
  matched: boolean;
  images: SceneImage[];
}

export interface CaptionWord {
  text: string;
  start: number;
  end: number;
}

export interface CaptionChunk {
  words: CaptionWord[];
  startSeconds: number;
  endSeconds: number;
}

export interface RenderedYoutubeNoticiasAvatarGuion {
  type: "youtube-noticias-avatar";
  slug: string;
  topic: string;
  videoPath: string;
  durationInSeconds: number;
  subscribeButton: boolean;
  scenes: RenderedYoutubeNoticiasAvatarScene[];
  captionChunks: CaptionChunk[];
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run lint`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/types/guion.ts
git commit -m "feat: add youtube-noticias-avatar guion types"
```

---

## Task 2: Generalize `matchSceneTimestamps`

**Files:**
- Modify: `src/services/checklistSyncService.ts`
- Modify: `src/services/checklistSyncService.test.ts`

**Interfaces:**
- Consumes: `YoutubeNoticiasAvatarScene` (Task 1, test only).
- Produces: `matchSceneTimestamps<T extends { text: string }>(words, scenes: T[], totalDurationSeconds): MatchedScene<T>[]` — consumed by Task 4.

- [ ] **Step 1: Write the failing test**

In `src/services/checklistSyncService.test.ts`, add this test inside the existing `describe("matchSceneTimestamps", ...)` block, after the last test:

```ts
  it("funciona con cualquier forma de escena que tenga id y text (reuso genérico)", () => {
    const words = [w("Terremoto", 0, 0.5), w("en", 0.5, 0.6), w("Chile", 0.6, 1.0)];
    const scenes = [{ id: "s1", text: "Terremoto en Chile", localImagePaths: ["a.png"] }];

    const result = matchSceneTimestamps(words, scenes, 10);

    expect(result[0]).toEqual({ scene: scenes[0], startSeconds: 0, durationInSeconds: 10, matched: true });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAILS to compile — `matchSceneTimestamps` currently requires `PantallaDivididaScene[]` (which has a required `act` field), and the new test's scene object doesn't have `act`.

- [ ] **Step 3: Generalize the function**

In `src/services/checklistSyncService.ts`, change the import line (drop the now-unneeded `PantallaDivididaScene`):

```ts
import type { ChecklistItem } from "../types/guion";
```

Change the `MatchedScene` interface and `matchSceneTimestamps` function:

```ts
export interface MatchedScene<T> {
  scene: T;
  startSeconds: number;
  durationInSeconds: number;
  matched: boolean;
}

/**
 * Igual que matchItemTimestamps, pero matcheando el texto completo de cada escena (no un
 * label corto) y devolviendo también la duración de cada escena: el tiempo hasta que
 * arranca la siguiente (o hasta el final del video para la última). Genérico en T para
 * reusarse con cualquier tipo de escena que tenga `text` (pantalla-dividida, youtube-noticias-avatar).
 */
export function matchSceneTimestamps<T extends { text: string }>(
  words: TranscribedWord[],
  scenes: T[],
  totalDurationSeconds: number,
): MatchedScene<T>[] {
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run lint && npm test`
Expected: no type errors, all tests pass (existing `pantalla-dividida` tests included, unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/services/checklistSyncService.ts src/services/checklistSyncService.test.ts
git commit -m "refactor: generalize matchSceneTimestamps to reuse across scene types"
```

---

## Task 3: Caption chunking (`captionChunkService.ts`)

**Files:**
- Create: `src/services/captionChunkService.ts`
- Create: `src/services/captionChunkService.test.ts`

**Interfaces:**
- Consumes: `TranscribedWord` (from `checklistSyncService.ts`), `CaptionChunk`/`CaptionWord` (Task 1).
- Produces: `buildCaptionChunks(words: TranscribedWord[], maxWordsPerChunk: number, maxGapSeconds: number): CaptionChunk[]` — consumed by Task 4.

- [ ] **Step 1: Write the failing tests**

Create `src/services/captionChunkService.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildCaptionChunks } from "./captionChunkService";
import type { TranscribedWord } from "./checklistSyncService";

function w(text: string, start: number, end: number): TranscribedWord {
  return { text, start, end };
}

describe("buildCaptionChunks", () => {
  it("devuelve una lista vacía si no hay palabras", () => {
    expect(buildCaptionChunks([], 4, 0.6)).toEqual([]);
  });

  it("agrupa una sola palabra en un solo chunk", () => {
    const words = [w("Hola", 0, 0.3)];
    const result = buildCaptionChunks(words, 4, 0.6);
    expect(result).toEqual([{ words: [{ text: "Hola", start: 0, end: 0.3 }], startSeconds: 0, endSeconds: 0.3 }]);
  });

  it("corta un chunk nuevo al llegar a maxWordsPerChunk", () => {
    const words = [w("uno", 0, 0.2), w("dos", 0.2, 0.4), w("tres", 0.4, 0.6), w("cuatro", 0.6, 0.8), w("cinco", 0.8, 1.0)];
    const result = buildCaptionChunks(words, 4, 0.6);
    expect(result).toHaveLength(2);
    expect(result[0].words.map((word) => word.text)).toEqual(["uno", "dos", "tres", "cuatro"]);
    expect(result[1].words.map((word) => word.text)).toEqual(["cinco"]);
  });

  it("corta un chunk nuevo cuando el hueco entre palabras supera maxGapSeconds", () => {
    const words = [w("Hola", 0, 0.3), w("mundo", 2, 2.3)];
    const result = buildCaptionChunks(words, 4, 0.6);
    expect(result).toHaveLength(2);
    expect(result[0].endSeconds).toBe(0.3);
    expect(result[1].startSeconds).toBe(2);
  });

  it("calcula startSeconds/endSeconds del chunk desde la primera y última palabra", () => {
    const words = [w("a", 1, 1.2), w("b", 1.2, 1.5)];
    const result = buildCaptionChunks(words, 4, 0.6);
    expect(result[0].startSeconds).toBe(1);
    expect(result[0].endSeconds).toBe(1.5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './captionChunkService'`.

- [ ] **Step 3: Implement `buildCaptionChunks`**

Create `src/services/captionChunkService.ts`:

```ts
import type { TranscribedWord } from "./checklistSyncService";
import type { CaptionChunk } from "../types/guion";

/**
 * Agrupa palabras transcritas (ya remapeadas post-recorte) en bloques cortos de subtítulo,
 * independientes de las escenas de imagen: cierra el bloque actual y arranca uno nuevo al
 * llegar a `maxWordsPerChunk` palabras, o cuando el hueco entre el fin de una palabra y el
 * inicio de la siguiente supera `maxGapSeconds` (pausa natural).
 */
export function buildCaptionChunks(
  words: TranscribedWord[],
  maxWordsPerChunk: number,
  maxGapSeconds: number,
): CaptionChunk[] {
  const chunks: CaptionChunk[] = [];
  let current: TranscribedWord[] = [];

  const flush = () => {
    if (current.length === 0) return;
    chunks.push({
      words: current.map((word) => ({ text: word.text, start: word.start, end: word.end })),
      startSeconds: current[0].start,
      endSeconds: current[current.length - 1].end,
    });
    current = [];
  };

  for (const word of words) {
    if (current.length > 0) {
      const previous = current[current.length - 1];
      const gap = word.start - previous.end;
      if (current.length >= maxWordsPerChunk || gap > maxGapSeconds) {
        flush();
      }
    }
    current.push(word);
  }
  flush();

  return chunks;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run lint && npm test`
Expected: no type errors, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/captionChunkService.ts src/services/captionChunkService.test.ts
git commit -m "feat: add buildCaptionChunks for word-highlight captions"
```

---

## Task 4: Pipeline branch `generateYoutubeNoticiasAvatarAssets`

**Files:**
- Modify: `src/services/generateAssets.ts`

**Interfaces:**
- Consumes: `prepareTrimmedVideo` (existing), `matchSceneTimestamps<T>` (Task 2), `buildCaptionChunks` (Task 3), `YoutubeNoticiasAvatarGuion`/`RenderedYoutubeNoticiasAvatarScene`/`RenderedYoutubeNoticiasAvatarGuion` (Task 1).
- Produces: `generateYoutubeNoticiasAvatarAssets(guion: YoutubeNoticiasAvatarGuion): Promise<void>`, wired into `main()`. Writes `public/data/<slug>.json` shaped as `RenderedYoutubeNoticiasAvatarGuion` — consumed by Task 5's composition at runtime (not a compile-time dependency).

- [ ] **Step 1: Add imports and the cadence constant**

In `src/services/generateAssets.ts`, add to the existing `import { matchItemTimestamps, matchSceneTimestamps, ... } from "./checklistSyncService";` line — it already imports `matchSceneTimestamps`, no change needed there.

Add a new import line:

```ts
import { buildCaptionChunks } from "./captionChunkService";
```

Add these to the existing `import type { ... } from "../types/guion";` block:

```ts
  YoutubeNoticiasAvatarGuion,
  RenderedYoutubeNoticiasAvatarScene,
  RenderedYoutubeNoticiasAvatarGuion,
```

Add the new constant right after `const MAX_CUT_SECONDS = 2.5;`:

```ts
// Cadencia propia de youtube-noticias-avatar (no confundir con MAX_CUT_SECONDS,
// que usan vox/pantalla-dividida): una imagen de fondo nueva cada 4 segundos.
const NEWS_AVATAR_CUT_SECONDS = 4;
```

- [ ] **Step 2: Add `generateYoutubeNoticiasAvatarAssets`**

Add this function right after `generatePantallaDivididaAssets` (before `async function main()`):

```ts
async function generateYoutubeNoticiasAvatarAssets(guion: YoutubeNoticiasAvatarGuion): Promise<void> {
  console.log(`Generando recursos para "${guion.topic}" (youtube-noticias-avatar, ${guion.scenes.length} escena(s))`);

  const { words, videoPath, durationInSeconds } = await prepareTrimmedVideo({
    slug: guion.slug,
    rawVideoPath: guion.rawVideoPath,
    removeOtherSpeakers: guion.removeOtherSpeakers,
  });

  const matches = matchSceneTimestamps(words, guion.scenes, durationInSeconds);

  const missing: string[] = [];
  for (const { scene, durationInSeconds: sceneDuration } of matches) {
    if (scene.localImagePaths && scene.localImagePaths.length > 0) continue;
    const numCuts = Math.max(1, Math.ceil(sceneDuration / NEWS_AVATAR_CUT_SECONDS));
    missing.push(`  [${scene.id}] necesita ${numCuts} imagen(es) en "localImagePaths" (dura ${sceneDuration.toFixed(1)}s)`);
  }
  if (missing.length > 0) {
    throw new Error(
      `Faltan imágenes locales para ${missing.length} escena(s) antes de generar el video:\n${missing.join("\n")}`,
    );
  }

  if (guion.subscribeButton) {
    const subscribeButtonAbsPath = path.join(PUBLIC_DIR, "assets", "youtube-noticias-avatar", "subscribe-button.png");
    if (!fs.existsSync(subscribeButtonAbsPath)) {
      throw new Error(
        `subscribeButton está en true pero falta el asset compartido en ${subscribeButtonAbsPath}. Colocalo ahí una vez (se reusa en todos los videos de este tipo).`,
      );
    }
  }

  const renderedScenes: RenderedYoutubeNoticiasAvatarScene[] = [];
  for (const { scene, startSeconds, durationInSeconds: sceneDuration, matched } of matches) {
    if (!matched) {
      console.log(
        `[${scene.id}] no se encontró el texto en la transcripción, usando tiempo estimado (${startSeconds.toFixed(1)}s)`,
      );
    }

    const numCuts = Math.max(1, Math.ceil(sceneDuration / NEWS_AVATAR_CUT_SECONDS));
    const cutDuration = sceneDuration / numCuts;
    const images: SceneImage[] = [];
    for (let i = 0; i < numCuts; i++) {
      const sourcePath = scene.localImagePaths[i % scene.localImagePaths.length];
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

    renderedScenes.push({
      id: scene.id,
      text: scene.text,
      startSeconds,
      durationInSeconds: sceneDuration,
      matched,
      images,
    });
  }

  const captionChunks = buildCaptionChunks(words, 4, 0.6);

  const rendered: RenderedYoutubeNoticiasAvatarGuion = {
    type: "youtube-noticias-avatar",
    slug: guion.slug,
    topic: guion.topic,
    videoPath,
    durationInSeconds,
    subscribeButton: guion.subscribeButton ?? false,
    scenes: renderedScenes,
    captionChunks,
  };

  const dataDir = path.join(PUBLIC_DIR, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, `${guion.slug}.json`), JSON.stringify(rendered, null, 2));

  const matchedCount = renderedScenes.filter((s) => s.matched).length;
  console.log(
    `\nListo. Duración: ${durationInSeconds.toFixed(1)}s, ${renderedScenes.length} escena(s) (${matchedCount} encontrada(s) en transcripción), ${captionChunks.length} bloque(s) de subtítulo.`,
  );
}
```

- [ ] **Step 3: Wire into `main()`**

In `main()`, change:

```ts
  if (guion.type === "pantalla-dividida") {
    await generatePantallaDivididaAssets(guion);
    return;
  }

  await generateVoxAssets(guion);
```

to:

```ts
  if (guion.type === "pantalla-dividida") {
    await generatePantallaDivididaAssets(guion);
    return;
  }

  if (guion.type === "youtube-noticias-avatar") {
    await generateYoutubeNoticiasAvatarAssets(guion);
    return;
  }

  await generateVoxAssets(guion);
```

- [ ] **Step 4: Verify it compiles and existing tests still pass**

Run: `npm run lint && npm test`
Expected: no type errors, all tests pass. (`generateYoutubeNoticiasAvatarAssets` itself has no direct unit test — it's I/O orchestration like its `pantalla-dividida`/`social-checklist` counterparts; its pure logic, `matchSceneTimestamps` and `buildCaptionChunks`, is already covered by Task 2 and Task 3's tests.)

- [ ] **Step 5: Commit**

```bash
git add src/services/generateAssets.ts
git commit -m "feat: add generateYoutubeNoticiasAvatarAssets pipeline branch"
```

---

## Task 5: Remotion composition + visual fixture

**Files:**
- Create: `src/components/YoutubeNoticiasAvatar.tsx`
- Create: `src/YoutubeNoticiasAvatarComposition.tsx`
- Modify: `src/Root.tsx`
- Create (binary fixtures, generated via ffmpeg, not hand-written): `public/assets/youtube-noticias-avatar-demo/video/demo.mp4`, `public/assets/youtube-noticias-avatar-demo/images/s1-local0.png`, `public/assets/youtube-noticias-avatar-demo/images/s1-local1.png`, `public/assets/youtube-noticias-avatar-demo/images/s2-local0.png`, `public/assets/youtube-noticias-avatar/subscribe-button.png`
- Create: `public/data/youtube-noticias-avatar-demo.json`

**Interfaces:**
- Consumes: `RenderedYoutubeNoticiasAvatarGuion`, `RenderedYoutubeNoticiasAvatarScene`, `CaptionChunk` (Task 1).
- Produces: `YoutubeNoticiasAvatar` component, `YoutubeNoticiasAvatarComposition` composition, registered in `Root.tsx` as `id="YoutubeNoticiasAvatarDemo"`.

There is no real `youtube-noticias-avatar` guion yet (out of scope for this plan — see Global Constraints), so this task builds a small hand-authored fixture (`youtube-noticias-avatar-demo`) to verify the composition renders correctly in Remotion Studio, without depending on real footage, real transcription, or any API call. The fixture also exercises the optional `subscribeButton` overlay with a placeholder graphic (not the final asset — see spec's "Fuera de alcance").

- [ ] **Step 1: Create `src/components/YoutubeNoticiasAvatar.tsx`**

```tsx
import { AbsoluteFill, Img, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import type { RenderedYoutubeNoticiasAvatarGuion, RenderedYoutubeNoticiasAvatarScene, CaptionChunk } from "../types/guion";

const CUT_TRANSITION_FRAMES = 6;

function findActiveScene(
  scenes: RenderedYoutubeNoticiasAvatarScene[],
  fps: number,
  frame: number,
): { scene: RenderedYoutubeNoticiasAvatarScene; sceneStartFrame: number } | null {
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

function findActiveChunk(chunks: CaptionChunk[], currentSeconds: number): CaptionChunk | null {
  for (const chunk of chunks) {
    if (currentSeconds >= chunk.startSeconds && currentSeconds < chunk.endSeconds) {
      return chunk;
    }
  }
  return null;
}

// Mismo algoritmo de ciclado por duración con crossfade que SceneIllustration
// en components/PantallaDividida.tsx, adaptado a este layout (panel izquierdo
// en vez de mitad superior).
const BackgroundIllustration: React.FC<{ scene: RenderedYoutubeNoticiasAvatarScene; localFrame: number; fps: number }> = ({
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

const WordHighlightCaption: React.FC<{ chunk: CaptionChunk; currentSeconds: number }> = ({ chunk, currentSeconds }) => {
  let activeIndex = -1;
  chunk.words.forEach((word, i) => {
    if (word.start <= currentSeconds) activeIndex = i;
  });

  return (
    <div className="absolute inset-x-0 bottom-16 flex justify-center px-10">
      <p className="text-center uppercase" style={{ fontWeight: 800, fontSize: 56, lineHeight: 1.2 }}>
        {chunk.words.map((word, i) => (
          <span
            key={`${word.text}-${word.start}`}
            style={{
              color: i === activeIndex ? "#FFD400" : "#FFFFFF",
              WebkitTextStroke: "3px black",
              paintOrder: "stroke fill",
              marginRight: 14,
            }}
          >
            {word.text}
          </span>
        ))}
      </p>
    </div>
  );
};

export const YoutubeNoticiasAvatar: React.FC<{ slug: string; guion: RenderedYoutubeNoticiasAvatarGuion | null }> = ({
  guion,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  if (!guion) return null;

  const active = findActiveScene(guion.scenes, fps, frame);
  const localFrame = active ? frame - active.sceneStartFrame : 0;
  const currentSeconds = frame / fps;
  const activeChunk = findActiveChunk(guion.captionChunks, currentSeconds);

  return (
    <AbsoluteFill className="bg-black">
      <div className="absolute inset-0 overflow-hidden" style={{ right: "38%" }}>
        {active && <BackgroundIllustration scene={active.scene} localFrame={localFrame} fps={fps} />}
        {activeChunk && <WordHighlightCaption chunk={activeChunk} currentSeconds={currentSeconds} />}
        {guion.subscribeButton && (
          <Img
            src={staticFile("assets/youtube-noticias-avatar/subscribe-button.png")}
            className="absolute left-8 top-8"
            style={{ width: 220 }}
          />
        )}
      </div>

      <div className="absolute inset-0 overflow-hidden" style={{ left: "62%" }}>
        <OffthreadVideo src={staticFile(guion.videoPath)} className="absolute inset-0 h-full w-full object-cover" />
      </div>
    </AbsoluteFill>
  );
};
```

- [ ] **Step 2: Create `src/YoutubeNoticiasAvatarComposition.tsx`**

```tsx
import { CalculateMetadataFunction, Composition, staticFile } from "remotion";
import { YoutubeNoticiasAvatar } from "./components/YoutubeNoticiasAvatar";
import type { RenderedYoutubeNoticiasAvatarGuion } from "./types/guion";

const FPS = 30;
const WIDTH = 1920;
const HEIGHT = 1080;

type Props = { slug: string; guion: RenderedYoutubeNoticiasAvatarGuion | null };

async function loadGuion(slug: string): Promise<RenderedYoutubeNoticiasAvatarGuion> {
  const response = await fetch(staticFile(`data/${slug}.json`));
  return (await response.json()) as RenderedYoutubeNoticiasAvatarGuion;
}

const calculateMetadata: CalculateMetadataFunction<Props> = async ({ props }) => {
  const guion = await loadGuion(props.slug);
  const durationInFrames = Math.ceil(guion.durationInSeconds * FPS);

  return {
    props: { ...props, guion },
    durationInFrames: Math.max(durationInFrames, FPS),
  };
};

export const YoutubeNoticiasAvatarComposition: React.FC<{ id: string; slug: string }> = ({ id, slug }) => {
  return (
    <Composition
      id={id}
      component={YoutubeNoticiasAvatar}
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
import { YoutubeNoticiasAvatarComposition } from "./YoutubeNoticiasAvatarComposition";
```

Add the composition entry, after the last existing one:

```tsx
      <YoutubeNoticiasAvatarComposition id="YoutubeNoticiasAvatarDemo" slug="youtube-noticias-avatar-demo" />
```

- [ ] **Step 4: Generate the fixture binary assets**

```bash
mkdir -p public/assets/youtube-noticias-avatar-demo/video public/assets/youtube-noticias-avatar-demo/images public/assets/youtube-noticias-avatar

ffmpeg -y -f lavfi -i testsrc=size=1920x1080:rate=30:duration=9 \
  -f lavfi -i sine=frequency=440:duration=9 \
  -pix_fmt yuv420p -shortest \
  public/assets/youtube-noticias-avatar-demo/video/demo.mp4

ffmpeg -y -f lavfi -i color=c=0xB8860B:size=1190x1080:d=1 -frames:v 1 public/assets/youtube-noticias-avatar-demo/images/s1-local0.png
ffmpeg -y -f lavfi -i color=c=0x8B4513:size=1190x1080:d=1 -frames:v 1 public/assets/youtube-noticias-avatar-demo/images/s1-local1.png
ffmpeg -y -f lavfi -i color=c=0x2F4F4F:size=1190x1080:d=1 -frames:v 1 public/assets/youtube-noticias-avatar-demo/images/s2-local0.png

ffmpeg -y -f lavfi -i color=c=red:size=220x80:d=1 -frames:v 1 public/assets/youtube-noticias-avatar/subscribe-button.png
```

Expected: 5 new files (a ~9s synthetic test-pattern video with tone at 1920x1080, 3 solid-color 1190x1080 PNGs, and a small red placeholder button PNG).

- [ ] **Step 5: Create the fixture data file `public/data/youtube-noticias-avatar-demo.json`**

```json
{
  "type": "youtube-noticias-avatar",
  "slug": "youtube-noticias-avatar-demo",
  "topic": "Demo de youtube-noticias-avatar (fixture de prueba, sin audio real)",
  "videoPath": "assets/youtube-noticias-avatar-demo/video/demo.mp4",
  "durationInSeconds": 9,
  "subscribeButton": true,
  "scenes": [
    {
      "id": "s1",
      "text": "Terremoto sacude la costa",
      "startSeconds": 0,
      "durationInSeconds": 6,
      "matched": true,
      "images": [
        { "path": "assets/youtube-noticias-avatar-demo/images/s1-local0.png", "durationInSeconds": 3 },
        { "path": "assets/youtube-noticias-avatar-demo/images/s1-local1.png", "durationInSeconds": 3 }
      ]
    },
    {
      "id": "s2",
      "text": "Autoridades piden calma",
      "startSeconds": 6,
      "durationInSeconds": 3,
      "matched": true,
      "images": [{ "path": "assets/youtube-noticias-avatar-demo/images/s2-local0.png", "durationInSeconds": 3 }]
    }
  ],
  "captionChunks": [
    {
      "words": [
        { "text": "TERREMOTO", "start": 0, "end": 0.6 },
        { "text": "SACUDE", "start": 0.6, "end": 1.1 }
      ],
      "startSeconds": 0,
      "endSeconds": 1.1
    },
    {
      "words": [
        { "text": "LA", "start": 1.1, "end": 1.3 },
        { "text": "COSTA", "start": 1.3, "end": 1.9 }
      ],
      "startSeconds": 1.1,
      "endSeconds": 1.9
    },
    {
      "words": [
        { "text": "AUTORIDADES", "start": 6, "end": 6.8 },
        { "text": "PIDEN", "start": 6.8, "end": 7.2 },
        { "text": "CALMA", "start": 7.2, "end": 7.8 }
      ],
      "startSeconds": 6,
      "endSeconds": 7.8
    }
  ]
}
```

- [ ] **Step 6: Verify it compiles**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 7: Visually verify in Remotion Studio**

Run: `npm run dev` (skip if Remotion Studio is already running — check with `lsof -i :3000`).

Open `http://localhost:3000/YoutubeNoticiasAvatarDemo` and scrub through the timeline. Confirm:
- The frame is horizontal (1920x1080): a wide left panel (~62% of the width) and a narrower right panel (~38%).
- Right panel: the moving test-pattern video fills it edge-to-edge for the entire 9s, `object-cover`.
- Left panel, 0s-3s: solid dark-goldenrod background (`s1-local0`); 3s-6s: crossfades to solid saddle-brown (`s1-local1`); 6s-9s: solid dark-slate-gray (`s2-local0`), no crossfade (only one image).
- Captions (bottom of the left panel, bold uppercase, black outline): "TERREMOTO SACUDE" appears 0s-1.1s with each word turning yellow as it's "spoken" then back to white as the next word activates; "LA COSTA" 1.1s-1.9s; nothing shown 1.9s-6s (gap); "AUTORIDADES PIDEN CALMA" 6s-7.8s; nothing shown 7.8s-9s.
- A small red rectangle (placeholder subscribe button) sits in the top-left corner of the left panel for the entire video.

This is a manual visual check (no assertion to automate — there's no existing React component test setup in this project). If anything looks wrong, fix `components/YoutubeNoticiasAvatar.tsx` and re-check before moving on.

- [ ] **Step 8: Commit**

```bash
git add src/components/YoutubeNoticiasAvatar.tsx src/YoutubeNoticiasAvatarComposition.tsx src/Root.tsx public/assets/youtube-noticias-avatar-demo public/assets/youtube-noticias-avatar public/data/youtube-noticias-avatar-demo.json
git commit -m "feat: add YoutubeNoticiasAvatar composition with a visual fixture"
```

---

## Task 6: `SKILL.md` for this format

**Files:**
- Create: `.claude/skills/youtube-noticias-avatar/SKILL.md`

**Interfaces:**
- Consumes: nothing (documentation only — references the real type/commands from Tasks 1-5).
- Produces: a project-scoped Claude Code skill, following the same skeleton as `.claude/skills/vox/SKILL.md`, `.claude/skills/ranking/SKILL.md`, `.claude/skills/pantalla-dividida/SKILL.md`.

- [ ] **Step 1: Create the skill file**

Create `.claude/skills/youtube-noticias-avatar/SKILL.md`:

```markdown
---
name: youtube-noticias-avatar
description: Crea videos de noticias para YouTube en formato horizontal (16:9) — el experto habla a cámara en una franja vertical a la derecha, mientras a la izquierda una ilustración de fondo va cambiando cada 4 segundos junto con lo que se narra, con subtítulos grandes palabra por palabra resaltados en amarillo. Usar cuando el usuario quiera un video de noticias/informativo horizontal con este layout de "experto + fondo ilustrado".
---

# Youtube noticias avatar — noticiero horizontal con experto

## Qué es este estilo

Un video horizontal (16:9) de noticias contadas por un experto real hablando
a cámara: a la derecha, en una franja vertical angosta, el experto; a la
izquierda, a pantalla completa, una ilustración de fondo que cambia cada 4
segundos y siempre corresponde a lo que se está diciendo en ese momento.
Abajo a la izquierda, subtítulos grandes en mayúsculas que resaltan en
amarillo la palabra exacta que se está diciendo (el resto en blanco).
Opcionalmente, un botón "SUBSCRIBE" falso arriba a la izquierda como gancho
de engagement.

30fps, 1920x1080 (16:9) — primer formato horizontal del proyecto (los demás
son 1080x1920). El audio es el real de la grabación, no se genera voz.

## Qué necesitás antes de empezar

- **Un video crudo** grabado por el experto hablando a cámara, contando la
  noticia de principio a fin (con errores/repeticiones — se cortan
  automáticamente).
- **`ELEVENLABS_API_KEY`** — transcribe el video con timestamps por palabra.
  Conseguila en elevenlabs.io.
- **`ANTHROPIC_API_KEY`** — detecta y corta automáticamente intentos
  fallidos y tramos fuera de guion. Conseguila en console.anthropic.com.
- **Las ilustraciones de fondo**: por ahora se preparan a mano (por ejemplo
  generándolas en ChatGPT/Midjourney con los prompts que arme Claude a
  partir de la transcripción real) y se guardan en
  `content/personajes/<slug>/` — no se generan automáticamente todavía.
  Avisale esto a la persona antes de pedirle el video (más adelante se va a
  conectar a una API de generación de imágenes, pero eso todavía no está
  construido).
- **Si querés el botón "SUBSCRIBE"**: la imagen tiene que existir una sola
  vez en `public/assets/youtube-noticias-avatar/subscribe-button.png` (se
  reusa en todos los videos de este tipo) — si no existe y pedís
  `subscribeButton: true`, el pipeline falla explícito pidiéndola.

## Flujo paso a paso (instrucciones para Claude)

Cuando alguien te pida un video de este estilo:

1. Preguntale la noticia/tema y pedile el video crudo ya grabado — copiálo a
   `content/raw/<slug>.<ext>`.
2. Preguntale explícitamente (no asumas) si las ilustraciones las va a
   generar él mismo y dártelas en una carpeta, o si más adelante querría
   conectarlas a una API de generación — hoy solo está construido el flujo
   manual (carpeta con imágenes numeradas).
3. Preguntale si quiere el botón "SUBSCRIBE" en este video
   (`subscribeButton: true|false`) — no va fijo, se pregunta cada vez.
4. Armá un guion BORRADOR con `scenes: []` solo para disparar la
   transcripción — no se pueden escribir las escenas sin la transcripción
   real primero.
5. **Paso interactivo:** decile a la persona que corra ella misma, en su
   propia terminal:
   ```
   npm run generate:assets -- content/guiones/<slug>.json
   ```
   Va a pausar pidiendo revisar candidatos a retake/aside — no lo intentes
   desde una tool call sin TTY.
6. Con la transcripción real ya generada
   (`public/assets/<slug>/transcript.json`), leela y armá las escenas
   reales: dividí la narración en bloques naturales (por idea/tema), y para
   cada bloque escribí `text` como copia EXACTA de las palabras dichas ahí
   (matching literal, normalizado — no parafrasees).
7. Para cada escena, calculá cuántas imágenes hacen falta (duración real de
   la escena ÷ 4 segundos, redondeado hacia arriba) y armale a la persona la
   lista de prompts para generar esa cantidad de ilustraciones, en el mismo
   orden — pedile que las guarde en `content/personajes/<slug>/` y te pase
   las rutas.
8. Con las imágenes ya listas, corré
   `npm run generate:assets -- content/guiones/<slug>.json` de nuevo (esta
   vez sin candidatos pendientes).
9. Agregá una línea en `src/Root.tsx` registrando la composición.
10. Sugerile `npm run dev` para previsualizar, y
    `npx remotion render <CompositionId> out/<slug>.mp4` para renderizar.

## Estructura del guion

```ts
interface YoutubeNoticiasAvatarGuion {
  type: "youtube-noticias-avatar";
  slug: string;
  topic: string;
  rawVideoPath: string;
  removeOtherSpeakers?: boolean;
  scenes: YoutubeNoticiasAvatarScene[];
  subscribeButton?: boolean;   // default false, se pregunta cada vez
}

interface YoutubeNoticiasAvatarScene {
  id: string;
  text: string;                // debe existir literalmente en la transcripción real
  localImagePaths: string[];   // imágenes ya preparadas, en orden; se ciclan cada 4s
}
```

Ejemplo (fixture de prueba usada para verificar la composición — no un video
real todavía; cuando armes el primero de este tipo, reemplazá este ejemplo
por ese guion real, igual que en las otras skills):

```json
{
  "type": "youtube-noticias-avatar",
  "slug": "youtube-noticias-avatar-demo",
  "topic": "Demo de youtube-noticias-avatar (fixture de prueba, sin audio real)",
  "rawVideoPath": "content/raw/youtube-noticias-avatar-demo.mp4",
  "subscribeButton": true,
  "scenes": [
    {
      "id": "s1",
      "text": "Terremoto sacude la costa",
      "localImagePaths": [
        "content/personajes/youtube-noticias-avatar-demo/s1-a.png",
        "content/personajes/youtube-noticias-avatar-demo/s1-b.png"
      ]
    },
    {
      "id": "s2",
      "text": "Autoridades piden calma",
      "localImagePaths": ["content/personajes/youtube-noticias-avatar-demo/s2-a.png"]
    }
  ]
}
```

## Registrar la composición

En `src/Root.tsx`, agregar una línea dentro del `<>...</>`:

```tsx
<YoutubeNoticiasAvatarComposition id="<UnNombreUnico>" slug="<slug-del-guion>" />
```

(`YoutubeNoticiasAvatarComposition` ya está importado en ese archivo si ya
hay otra línea de este tipo).
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/youtube-noticias-avatar/SKILL.md
git commit -m "docs: add youtube-noticias-avatar SKILL.md"
```

---

## Final check

- [ ] Run `npm run lint && npm test` once more from the repo root — full green before considering this plan done.
