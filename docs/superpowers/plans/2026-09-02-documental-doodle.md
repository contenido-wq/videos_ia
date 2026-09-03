# Documental Doodle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the new `type: "documental-doodle"` guion/pipeline/composition — a horizontal (16:9) narrated documentary format with no camera/avatar, AI-generated voice, doodle/cartoon illustrations cycling every 5s, and word-highlighted captions — so real videos in this style can be produced end-to-end without any raw footage.

**Architecture:** Extend the discriminated `Guion` union with a new `DocumentalDoodleGuion` type. Add a new `generateDocumentalDoodleAssets` pipeline branch that, per scene, generates TTS voice (`generateVoice`, reusing the same service `vox` uses), transcribes that scene's own generated audio (`transcribeWithTimestamps`) to get word-level timestamps for captions, and generates that many AI doodle images (`generateImage` at `aspectRatio: "16:9"`, same numCuts-per-duration pattern `vox` uses for `MAX_CUT_SECONDS`, but with its own `DOODLE_CUT_SECONDS = 5` constant). Concatenates all scenes' words (time-offset by cumulative scene start) into one array and reuses the existing `buildCaptionChunks` for word-highlighted subtitles, exactly like `youtube-noticias-avatar`. Add a new full-screen horizontal Remotion composition that reuses (via a fresh, self-contained copy — same convention `youtube-noticias-avatar` already follows) the illustration-cycling-with-Ken-Burns and karaoke-caption rendering logic.

**Tech Stack:** TypeScript, Remotion 4, React 19, Tailwind, vitest, ffmpeg (fixture generation only).

**Spec:** `docs/superpowers/specs/2026-09-02-documental-doodle-design.md`

## Global Constraints

- No raw video, no camera, no avatar — this type never touches `prepareTrimmedVideo`, `content/raw/`, or any silence/retake/filler detection. It is the first type in this project driven entirely by generated voice + generated images.
- New cadence constant `DOODLE_CUT_SECONDS = 5` for this type only — never reuse or modify `MAX_CUT_SECONDS = 2.5` (`vox`/`pantalla-dividida`) or `NEWS_AVATAR_CUT_SECONDS = 4` (`youtube-noticias-avatar`).
- Images are always AI-generated (`generateImage`, `aspectRatio: "16:9"`) — there is no `localImagePaths` field on this scene type. The doodle/cartoon art style (thick black outline, flat colors, etc.) is written directly into each scene's `visual` prompt when the guion is authored — never hardcoded as an automatic suffix in the pipeline.
- Captions are word-highlighted chunks built from the concatenated, time-offset transcript of every scene's own generated audio (`buildCaptionChunks`, reused as-is, same `(4, 0.6)` defaults as `youtube-noticias-avatar`) — independent of scene boundaries, never grouped by `scenes[].text`.
- No background music, no sound effects, no "SUBSCRIBE" button or any overlay — the image fills 100% of the frame for the entire video.
- Composition dimensions: 1920x1080 (16:9), 30fps — same as `youtube-noticias-avatar` (the two horizontal formats in this project).
- Rendering code is a fresh, self-contained component (`components/DocumentalDoodle.tsx`) — this project's established convention is to duplicate the small cycling/caption algorithms per style file rather than share them across styles (see the comment already in `components/YoutubeNoticiasAvatar.tsx` explaining it duplicated `PantallaDividida.tsx`'s algorithm on purpose).
- This plan does **not** author a real `documental-doodle` guion or produce the first real video — that happens in a follow-up, once the user picks a topic, using the `SKILL.md` this plan creates.

---

## Task 1: Guion schema — `DocumentalDoodle` types

**Files:**
- Modify: `src/types/guion.ts`

**Interfaces:**
- Consumes: `SceneImage`, `CaptionChunk` (already exist in this file, unchanged).
- Produces: `DocumentalDoodleScene`, `DocumentalDoodleGuion` (consumed by Task 2, Task 3), `RenderedDocumentalDoodleScene`, `RenderedDocumentalDoodleGuion` (consumed by Task 2, Task 3).

- [ ] **Step 1: Add the new types**

In `src/types/guion.ts`, change the `GuionType` line:

```ts
export type GuionType = "vox" | "social-checklist" | "youtube" | "pantalla-dividida" | "youtube-noticias-avatar" | "documental-doodle";
```

Change the `Guion` union:

```ts
export type Guion = VoxGuion | SocialChecklistGuion | PantallaDivididaGuion | YoutubeNoticiasAvatarGuion | DocumentalDoodleGuion;
```

Add these interfaces at the end of the file (after `RenderedYoutubeNoticiasAvatarGuion`):

```ts
export interface DocumentalDoodleScene {
  id: string;
  /** Texto que se narra en esta escena — se convierte a voz con ElevenLabs. */
  text: string;
  /** Descripción de la escena para generar la(s) imagen(es) con IA. El estilo
   * doodle/cartoon (contorno negro grueso, colores planos, etc.) se escribe
   * acá explícitamente al redactar el guion — no hay un sufijo automático. */
  visual: string;
}

export interface DocumentalDoodleGuion {
  type: "documental-doodle";
  slug: string;
  topic: string;
  /** Voz de ElevenLabs a usar; default si se omite (mismo default que vox). */
  voiceId?: string;
  scenes: DocumentalDoodleScene[];
}

export interface RenderedDocumentalDoodleScene {
  id: string;
  text: string;
  startSeconds: number;
  durationInSeconds: number;
  images: SceneImage[]; // se ciclan cada DOODLE_CUT_SECONDS (5s)
}

export interface RenderedDocumentalDoodleGuion {
  type: "documental-doodle";
  slug: string;
  topic: string;
  durationInSeconds: number;
  scenes: RenderedDocumentalDoodleScene[];
  captionChunks: CaptionChunk[];
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run lint`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/types/guion.ts
git commit -m "feat: add documental-doodle guion types"
```

---

## Task 2: Pipeline branch `generateDocumentalDoodleAssets`

**Files:**
- Modify: `src/services/generateAssets.ts`

**Interfaces:**
- Consumes: `generateVoice`, `transcribeWithTimestamps` (existing, from `elevenlabsService.ts`), `generateImage` (existing, from `kieAiService.ts`), `buildCaptionChunks` (existing, from `captionChunkService.ts`), `DocumentalDoodleGuion`/`RenderedDocumentalDoodleScene`/`RenderedDocumentalDoodleGuion` (Task 1).
- Produces: `generateDocumentalDoodleAssets(guion: DocumentalDoodleGuion): Promise<void>`, wired into `main()`. Writes `public/data/<slug>.json` shaped as `RenderedDocumentalDoodleGuion` — consumed by Task 3's composition at runtime (not a compile-time dependency).

- [ ] **Step 1: Add imports and the cadence constant**

In `src/services/generateAssets.ts`, add these to the existing `import type { ... } from "../types/guion";` block:

```ts
  DocumentalDoodleGuion,
  RenderedDocumentalDoodleScene,
  RenderedDocumentalDoodleGuion,
```

Add the new constant right after `const NEWS_AVATAR_CUT_SECONDS = 4;`:

```ts
// Cadencia propia de documental-doodle (no confundir con MAX_CUT_SECONDS ni
// NEWS_AVATAR_CUT_SECONDS): una imagen doodle nueva cada 5 segundos.
const DOODLE_CUT_SECONDS = 5;
```

- [ ] **Step 2: Add `generateDocumentalDoodleAssets`**

Add this function right after `generateYoutubeNoticiasAvatarAssets` (before `async function main()`):

```ts
async function generateDocumentalDoodleAssets(guion: DocumentalDoodleGuion): Promise<void> {
  console.log(`Generando recursos para "${guion.topic}" (documental-doodle, ${guion.scenes.length} escena(s))`);

  const missingText = guion.scenes.filter((s) => s.text.trim().length === 0);
  if (missingText.length > 0) {
    throw new Error(
      `${missingText.length} escena(s) sin texto para narrar: ${missingText.map((s) => s.id).join(", ")}`,
    );
  }

  const renderedScenes: RenderedDocumentalDoodleScene[] = [];
  const allWords: TranscribedWord[] = [];
  let cursorSeconds = 0;

  for (const scene of guion.scenes) {
    const audioAbsPath = path.join(PUBLIC_DIR, "assets", guion.slug, "audio", `${scene.id}.mp3`);

    if (fs.existsSync(audioAbsPath)) {
      console.log(`[${scene.id}] voz ya existe, se reutiliza`);
    } else {
      console.log(`[${scene.id}] generando voz...`);
      await generateVoice(scene.text, { outputPath: audioAbsPath, voiceId: guion.voiceId });
    }

    const durationInSeconds = await getAudioDurationInSeconds(audioAbsPath);

    console.log(`[${scene.id}] transcribiendo para timestamps de subtítulo...`);
    const words = await transcribeWithTimestamps(audioAbsPath);
    for (const word of words) {
      allWords.push({ text: word.text, start: word.start + cursorSeconds, end: word.end + cursorSeconds });
    }

    const numCuts = Math.max(1, Math.ceil(durationInSeconds / DOODLE_CUT_SECONDS));
    const cutDuration = durationInSeconds / numCuts;
    const images: SceneImage[] = [];
    for (let i = 0; i < numCuts; i++) {
      const imageAbsPath = path.join(PUBLIC_DIR, "assets", guion.slug, "images", `${scene.id}-${i}.png`);
      if (fs.existsSync(imageAbsPath)) {
        console.log(`[${scene.id}] corte ${i} ya existe, se reutiliza`);
      } else {
        const prompt =
          numCuts > 1
            ? `${scene.visual}, alternate camera angle / closer framing, cut ${i + 1} of ${numCuts} in the same documentary sequence, same subject and art style`
            : scene.visual;
        console.log(`[${scene.id}] generando corte ${i} (doodle)...`);
        await generateImage(prompt, imageAbsPath, { aspectRatio: "16:9" });
      }
      images.push({ path: toPublicRelPath(imageAbsPath), durationInSeconds: cutDuration });
    }

    renderedScenes.push({
      id: scene.id,
      text: scene.text,
      startSeconds: cursorSeconds,
      durationInSeconds,
      images,
    });

    cursorSeconds += durationInSeconds;
  }

  const captionChunks = buildCaptionChunks(allWords, 4, 0.6);

  const rendered: RenderedDocumentalDoodleGuion = {
    type: "documental-doodle",
    slug: guion.slug,
    topic: guion.topic,
    durationInSeconds: cursorSeconds,
    scenes: renderedScenes,
    captionChunks,
  };

  const dataDir = path.join(PUBLIC_DIR, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, `${guion.slug}.json`), JSON.stringify(rendered, null, 2));

  const totalCuts = renderedScenes.reduce((acc, s) => acc + s.images.length, 0);
  console.log(
    `\nListo. Duración total: ${cursorSeconds.toFixed(1)}s en ${renderedScenes.length} escena(s), ${totalCuts} corte(s) visuales, ${captionChunks.length} bloque(s) de subtítulo.`,
  );
}
```

- [ ] **Step 3: Wire into `main()`**

In `main()`, change:

```ts
  if (guion.type === "youtube-noticias-avatar") {
    await generateYoutubeNoticiasAvatarAssets(guion);
    return;
  }

  await generateVoxAssets(guion);
```

to:

```ts
  if (guion.type === "youtube-noticias-avatar") {
    await generateYoutubeNoticiasAvatarAssets(guion);
    return;
  }

  if (guion.type === "documental-doodle") {
    await generateDocumentalDoodleAssets(guion);
    return;
  }

  await generateVoxAssets(guion);
```

- [ ] **Step 4: Verify it compiles and existing tests still pass**

Run: `npm run lint && npm test`
Expected: no type errors, all tests pass. (`generateDocumentalDoodleAssets` itself has no direct unit test — it's I/O orchestration like `generateVoxAssets`/`generateYoutubeNoticiasAvatarAssets`; its pure logic, `buildCaptionChunks`, is already covered by existing tests.)

- [ ] **Step 5: Commit**

```bash
git add src/services/generateAssets.ts
git commit -m "feat: add generateDocumentalDoodleAssets pipeline branch"
```

---

## Task 3: Remotion composition + visual fixture

**Files:**
- Create: `src/components/DocumentalDoodle.tsx`
- Create: `src/DocumentalDoodleComposition.tsx`
- Modify: `src/Root.tsx`
- Create (binary fixtures, generated via ffmpeg, not hand-written): `public/assets/documental-doodle-demo/images/s1-0.png`, `public/assets/documental-doodle-demo/images/s1-1.png`, `public/assets/documental-doodle-demo/images/s2-0.png`, `public/assets/documental-doodle-demo/images/s2-1.png`
- Create: `public/data/documental-doodle-demo.json`

**Interfaces:**
- Consumes: `RenderedDocumentalDoodleGuion`, `RenderedDocumentalDoodleScene`, `CaptionChunk` (Task 1).
- Produces: `DocumentalDoodle` component, `DocumentalDoodleComposition` composition, registered in `Root.tsx` as `id="DocumentalDoodleDemo"`.

There is no real `documental-doodle` guion yet (out of scope for this plan — see Global Constraints), so this task builds a small hand-authored fixture (`documental-doodle-demo`) to verify the composition renders correctly in Remotion Studio, without depending on any API call.

- [ ] **Step 1: Create `src/components/DocumentalDoodle.tsx`**

```tsx
import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { loadFont } from "@remotion/google-fonts/Poppins";
import type { RenderedDocumentalDoodleGuion, RenderedDocumentalDoodleScene, CaptionChunk } from "../types/guion";

const { fontFamily } = loadFont("normal", { weights: ["800"] });

const CUT_TRANSITION_FRAMES = 6;
// Zoom sutil tipo Ken Burns, uno por ESCENA completa (no por corte) — mismo
// criterio que components/YoutubeNoticiasAvatar.tsx: si reiniciara el zoom
// en cada corte se vería como un salto en vez de un movimiento continuo.
// Alterna dirección (in/out) por escena para que no se sienta repetitivo.
const ZOOM_SCALE_DELTA = 0.04;

function findActiveScene(
  scenes: RenderedDocumentalDoodleScene[],
  fps: number,
  frame: number,
): { scene: RenderedDocumentalDoodleScene; sceneStartFrame: number; sceneIndex: number } | null {
  let cursorSeconds = 0;
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const sceneStartFrame = Math.round(cursorSeconds * fps);
    cursorSeconds += scene.durationInSeconds;
    const sceneEndFrame = Math.round(cursorSeconds * fps);
    if (frame >= sceneStartFrame && frame < sceneEndFrame) {
      return { scene, sceneStartFrame, sceneIndex: i };
    }
  }
  return scenes.length > 0 ? { scene: scenes[scenes.length - 1], sceneStartFrame: 0, sceneIndex: scenes.length - 1 } : null;
}

function findActiveChunk(chunks: CaptionChunk[], currentSeconds: number): CaptionChunk | null {
  for (const chunk of chunks) {
    if (currentSeconds >= chunk.startSeconds && currentSeconds < chunk.endSeconds) {
      return chunk;
    }
  }
  return null;
}

// Mismo algoritmo de ciclado con crossfade + Ken Burns que BackgroundIllustration
// en components/YoutubeNoticiasAvatar.tsx, adaptado a pantalla completa (no hay
// panel de avatar que le quite espacio a la imagen).
const SceneIllustration: React.FC<{
  scene: RenderedDocumentalDoodleScene;
  localFrame: number;
  fps: number;
  sceneIndex: number;
}> = ({ scene, localFrame, fps, sceneIndex }) => {
  let cursorSeconds = 0;
  const cuts = scene.images.map((image) => {
    const startFrame = Math.round(cursorSeconds * fps);
    cursorSeconds += image.durationInSeconds;
    const endFrame = Math.round(cursorSeconds * fps);
    return { ...image, startFrame, endFrame };
  });

  const sceneDurationFrames = Math.round(scene.durationInSeconds * fps);
  const zoomIn = sceneIndex % 2 === 0;
  const scale = interpolate(localFrame, [0, sceneDurationFrames], zoomIn ? [1, 1 + ZOOM_SCALE_DELTA] : [1 + ZOOM_SCALE_DELTA, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
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
            key={`${cut.path}-${i}`}
            src={staticFile(cut.path)}
            className="absolute inset-0 h-full w-full object-cover"
            style={{ opacity, transform: `scale(${scale})` }}
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
      <p className="text-center uppercase" style={{ fontFamily, fontWeight: 800, fontSize: 56, lineHeight: 1.2 }}>
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

export const DocumentalDoodle: React.FC<{ slug: string; guion: RenderedDocumentalDoodleGuion | null }> = ({ guion }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  if (!guion) return null;

  const active = findActiveScene(guion.scenes, fps, frame);
  const localFrame = active ? frame - active.sceneStartFrame : 0;
  const currentSeconds = frame / fps;
  const activeChunk = findActiveChunk(guion.captionChunks, currentSeconds);

  return (
    <AbsoluteFill className="bg-black">
      {active && (
        <SceneIllustration scene={active.scene} localFrame={localFrame} fps={fps} sceneIndex={active.sceneIndex} />
      )}
      {activeChunk && <WordHighlightCaption chunk={activeChunk} currentSeconds={currentSeconds} />}
    </AbsoluteFill>
  );
};
```

- [ ] **Step 2: Create `src/DocumentalDoodleComposition.tsx`**

```tsx
import { CalculateMetadataFunction, Composition, staticFile } from "remotion";
import { DocumentalDoodle } from "./components/DocumentalDoodle";
import type { RenderedDocumentalDoodleGuion } from "./types/guion";

const FPS = 30;
const WIDTH = 1920;
const HEIGHT = 1080;

type Props = { slug: string; guion: RenderedDocumentalDoodleGuion | null };

async function loadGuion(slug: string): Promise<RenderedDocumentalDoodleGuion> {
  const response = await fetch(staticFile(`data/${slug}.json`));
  return (await response.json()) as RenderedDocumentalDoodleGuion;
}

const calculateMetadata: CalculateMetadataFunction<Props> = async ({ props }) => {
  const guion = await loadGuion(props.slug);
  const durationInFrames = Math.ceil(guion.durationInSeconds * FPS);

  return {
    props: { ...props, guion },
    durationInFrames: Math.max(durationInFrames, FPS),
  };
};

export const DocumentalDoodleComposition: React.FC<{ id: string; slug: string }> = ({ id, slug }) => {
  return (
    <Composition
      id={id}
      component={DocumentalDoodle}
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

Add the import, after the `YoutubeNoticiasAvatarComposition` import:

```tsx
import { DocumentalDoodleComposition } from "./DocumentalDoodleComposition";
```

Add the composition entry, after the last existing one:

```tsx
      <DocumentalDoodleComposition id="DocumentalDoodleDemo" slug="documental-doodle-demo" />
```

- [ ] **Step 4: Generate the fixture binary assets**

```bash
mkdir -p public/assets/documental-doodle-demo/images

ffmpeg -y -f lavfi -i color=c=0xFFD966:size=1920x1080:d=1 -frames:v 1 public/assets/documental-doodle-demo/images/s1-0.png
ffmpeg -y -f lavfi -i color=c=0x2E2E2E:size=1920x1080:d=1 -frames:v 1 public/assets/documental-doodle-demo/images/s1-1.png
ffmpeg -y -f lavfi -i color=c=0x87CEEB:size=1920x1080:d=1 -frames:v 1 public/assets/documental-doodle-demo/images/s2-0.png
ffmpeg -y -f lavfi -i color=c=0xE07A5F:size=1920x1080:d=1 -frames:v 1 public/assets/documental-doodle-demo/images/s2-1.png
```

Expected: 4 new solid-color 1920x1080 PNG files.

- [ ] **Step 5: Create the fixture data file `public/data/documental-doodle-demo.json`**

```json
{
  "type": "documental-doodle",
  "slug": "documental-doodle-demo",
  "topic": "Demo de documental-doodle (fixture de prueba, sin audio real)",
  "durationInSeconds": 17,
  "scenes": [
    {
      "id": "s1",
      "text": "La oscuridad forjó a la humanidad",
      "startSeconds": 0,
      "durationInSeconds": 10,
      "images": [
        { "path": "assets/documental-doodle-demo/images/s1-0.png", "durationInSeconds": 5 },
        { "path": "assets/documental-doodle-demo/images/s1-1.png", "durationInSeconds": 5 }
      ]
    },
    {
      "id": "s2",
      "text": "Hoy encendés la luz sin pensarlo",
      "startSeconds": 10,
      "durationInSeconds": 7,
      "images": [
        { "path": "assets/documental-doodle-demo/images/s2-0.png", "durationInSeconds": 3.5 },
        { "path": "assets/documental-doodle-demo/images/s2-1.png", "durationInSeconds": 3.5 }
      ]
    }
  ],
  "captionChunks": [
    {
      "words": [
        { "text": "LA", "start": 0, "end": 0.2 },
        { "text": "OSCURIDAD", "start": 0.2, "end": 0.9 },
        { "text": "FORJÓ", "start": 0.9, "end": 1.3 },
        { "text": "A", "start": 1.3, "end": 1.4 }
      ],
      "startSeconds": 0,
      "endSeconds": 1.4
    },
    {
      "words": [
        { "text": "LA", "start": 1.4, "end": 1.5 },
        { "text": "HUMANIDAD", "start": 1.5, "end": 2.3 }
      ],
      "startSeconds": 1.4,
      "endSeconds": 2.3
    },
    {
      "words": [
        { "text": "HOY", "start": 10, "end": 10.3 },
        { "text": "ENCENDÉS", "start": 10.3, "end": 10.9 },
        { "text": "LA", "start": 10.9, "end": 11.0 },
        { "text": "LUZ", "start": 11.0, "end": 11.3 }
      ],
      "startSeconds": 10,
      "endSeconds": 11.3
    },
    {
      "words": [
        { "text": "SIN", "start": 11.3, "end": 11.5 },
        { "text": "PENSARLO", "start": 11.5, "end": 12.2 }
      ],
      "startSeconds": 11.3,
      "endSeconds": 12.2
    }
  ]
}
```

- [ ] **Step 6: Verify it compiles**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 7: Visually verify in Remotion Studio**

Run: `npm run dev` (skip if Remotion Studio is already running — check with `lsof -i :3000`).

Open `http://localhost:3000/DocumentalDoodleDemo` and scrub through the timeline. Confirm:
- The frame is horizontal (1920x1080), image fills the entire frame edge-to-edge (no panels, no split).
- 0s-5s: solid yellow (`s1-0`) with a very subtle continuous zoom-in; 5s-10s: crossfades to solid dark-gray (`s1-1`), zoom-in continues smoothly across the cut (no jump/pulse at the crossfade).
- 10s-13.5s: crossfades to solid sky-blue (`s2-0`) with a subtle continuous zoom-**out** this time (alternates direction per scene); 13.5s-17s: crossfades to solid terracotta (`s2-1`).
- Captions (bottom-center, bold uppercase, black outline): "LA OSCURIDAD FORJÓ A" 0s-1.4s with each word turning yellow as it's "spoken"; "LA HUMANIDAD" 1.4s-2.3s; nothing shown 2.3s-10s (gap); "HOY ENCENDÉS LA LUZ" 10s-11.3s; "SIN PENSARLO" 11.3s-12.2s; nothing shown 12.2s-17s.
- No video panel, no avatar, no subscribe button, no split screen anywhere.

This is a manual visual check (no assertion to automate — there's no existing React component test setup in this project). If anything looks wrong, fix `components/DocumentalDoodle.tsx` and re-check before moving on.

- [ ] **Step 8: Commit**

```bash
git add src/components/DocumentalDoodle.tsx src/DocumentalDoodleComposition.tsx src/Root.tsx public/assets/documental-doodle-demo public/data/documental-doodle-demo.json
git commit -m "feat: add DocumentalDoodle composition with a visual fixture"
```

---

## Task 4: `SKILL.md` for this format

**Files:**
- Create: `.claude/skills/documental-doodle/SKILL.md`

**Interfaces:**
- Consumes: nothing (documentation only — references the real type/commands from Tasks 1-3).
- Produces: a project-scoped Claude Code skill, following the same skeleton as `.claude/skills/youtube-noticias-avatar/SKILL.md`, `.claude/skills/vox/SKILL.md`.

- [ ] **Step 1: Create the skill file**

Create `.claude/skills/documental-doodle/SKILL.md`:

```markdown
---
name: documental-doodle
description: Crea videos documentales narrados para YouTube en formato horizontal (16:9) — sin cámara ni avatar, con voz generada por IA y una ilustración estilo doodle/cartoon (contorno negro grueso, colores planos) que cambia cada 5 segundos siguiendo la narración, con subtítulos grandes palabra por palabra resaltados en amarillo. Usar cuando el usuario quiera un video narrado tipo documental horizontal sin grabarse, con este estilo de ilustración doodle.
---

# Documental doodle — documental horizontal narrado, sin cámara

## Qué es este estilo

Un video horizontal (16:9) narrado por una voz generada con IA — nadie habla
a cámara, no hay avatar ni panel dividido. La imagen ocupa el 100% de la
pantalla en todo momento: una ilustración estilo doodle/cartoon plano
(contorno negro grueso, colores planos, sin fotorrealismo) que cambia cada 5
segundos dentro de cada escena, con un zoom Ken Burns sutil y continuo.
Abajo, centrados, subtítulos grandes en mayúsculas que resaltan en amarillo
la palabra exacta que se está diciendo (el resto en blanco, contorno negro).

30fps, 1920x1080 (16:9) — mismo formato horizontal que
`youtube-noticias-avatar`. Sin música de fondo, sin botón "SUBSCRIBE".

## Qué necesitás antes de empezar

- **`ELEVENLABS_API_KEY`** — genera la voz narrada de cada escena y la
  transcribe con timestamps por palabra (para los subtítulos). Conseguila en
  elevenlabs.io.
- **`KIE_AI_API_KEY`** — genera las ilustraciones doodle de cada escena.
  Conseguila en kie.ai.
- **No hace falta grabar nada** — a diferencia de `youtube-noticias-avatar`,
  este tipo no usa cámara ni recorta silencios/retakes; todo el pipeline
  corre sin intervención manual (podés correrlo vos mismo con una tool call,
  no necesitás que la persona lo corra en su propia terminal).

## Flujo paso a paso (instrucciones para Claude)

Cuando alguien te pida un video de este estilo:

1. Preguntale el tema del documental.
2. Redactá el guion en escenas: dividí la narración en bloques naturales por
   idea/tema. Para cada escena escribí:
   - `text`: lo que se narra (se convierte a voz tal cual, sin parafrasear
     después).
   - `visual`: descripción de la escena para generar la imagen, **incluyendo
     siempre y explícitamente el estilo doodle** en el prompt (ej. "flat 2D
     doodle illustration, thick black outline, minimal flat color palette,
     hand-drawn vector style, plain background, no text or watermarks") —
     el pipeline no agrega ningún estilo automáticamente.
3. Guardá el guion en `content/guiones/<slug>.json` con
   `type: "documental-doodle"`.
4. Corré vos mismo (podés hacerlo con una tool call, no requiere terminal
   interactiva):
   ```
   npm run generate:assets -- content/guiones/<slug>.json
   ```
   Esto genera la voz, transcribe cada escena, y genera las imágenes doodle
   (cuántas por escena = duración real de esa escena ÷ 5s, redondeado hacia
   arriba) — todo automático.
5. Agregá una línea en `src/Root.tsx` registrando la composición.
6. Sugerile `npm run dev` para previsualizar, y
   `npx remotion render <CompositionId> out/<slug>.mp4` para renderizar.

## Estructura del guion

```ts
interface DocumentalDoodleGuion {
  type: "documental-doodle";
  slug: string;
  topic: string;
  voiceId?: string;             // opcional, usa un default si se omite
  scenes: DocumentalDoodleScene[];
}

interface DocumentalDoodleScene {
  id: string;
  text: string;    // lo que se narra en esta escena
  visual: string;   // prompt de imagen; escribí el estilo doodle acá siempre
}
```

Ejemplo (fixture de prueba usada para verificar la composición — no un video
real todavía; cuando armes el primero de este tipo, reemplazá este ejemplo
por ese guion real, igual que en las otras skills):

```json
{
  "type": "documental-doodle",
  "slug": "documental-doodle-demo",
  "topic": "Demo de documental-doodle (fixture de prueba, sin audio real)",
  "scenes": [
    {
      "id": "s1",
      "text": "La oscuridad forjó a la humanidad",
      "visual": "early humans huddled around a fire at night, flat 2D doodle illustration, thick black outline, minimal flat color palette, hand-drawn vector style, plain background, no text or watermarks"
    },
    {
      "id": "s2",
      "text": "Hoy encendés la luz sin pensarlo",
      "visual": "a hand flipping a modern light switch, flat 2D doodle illustration, thick black outline, minimal flat color palette, hand-drawn vector style, plain background, no text or watermarks"
    }
  ]
}
```

## Registrar la composición

En `src/Root.tsx`, agregar una línea dentro del `<>...</>`:

```tsx
<DocumentalDoodleComposition id="<UnNombreUnico>" slug="<slug-del-guion>" />
```

(`DocumentalDoodleComposition` ya está importado en ese archivo si ya hay
otra línea de este tipo).
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/documental-doodle/SKILL.md
git commit -m "docs: add documental-doodle SKILL.md"
```

---

## Final check

- [ ] Run `npm run lint && npm test` once more from the repo root — full green before considering this plan done.
