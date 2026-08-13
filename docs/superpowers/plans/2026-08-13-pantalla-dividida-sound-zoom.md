# Pantalla Dividida Sound + Zoom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cinematic sound design (tension bed, whoosh, sting) and a synced "epic zoom" punch on image cuts (plus a subtle continuous zoom on the closing act) to the `pantalla-dividida` composition.

**Architecture:** Three sound assets are generated once per video (not per scene) via the existing ElevenLabs `generateSoundEffect` service and cached like every other asset in the pipeline. A new pure timing module computes the absolute frame of every image cut and the frame where the closing act starts, so the composition can place `<Sequence>`-wrapped `<Audio>` cues and a per-cut zoom spring without duplicating cumulative-duration math.

**Tech Stack:** TypeScript, Remotion 4, vitest.

## Global Constraints

- Reuse `generateSoundEffect(prompt, outputPath, durationSeconds?)` (`src/services/elevenlabsService.ts:69`) as-is — no changes to that function.
- The 3 sound assets are generated ONCE per video and reused at every trigger point — never one whoosh per cut, never one sfx per scene.
- Voice audio must always dominate the mix: tension bed volume ramps 0.08→0.22, whoosh ~0.4, sting ~0.5 — all below spoken voice.
- Zoom punch per cut: scale 1.18 → 1.0, spring config `{ damping: 9, stiffness: 180, mass: 0.7 }`, `durationInFrames: 18`.
- Closing-act zoom: subtle, continuous, scale 1.0 → 1.06 linearly across the closing scene's duration.
- This plan does not regenerate the existing real video (`content/guiones/pantalla-dividida.json` / `out/pantalla-dividida.mp4`) — that happens in a separate session.

---

## Task 1: Guion schema — `soundDesign` + `sfx` fields

**Files:**
- Modify: `src/types/guion.ts`

**Interfaces:**
- Consumes: nothing (pure type additions).
- Produces: `PantallaDivididaGuion.soundDesign` (optional), `RenderedPantallaDivididaGuion.sfx` (required) — consumed by Task 3 (generation) and Task 4 (composition).

- [ ] **Step 1: Add the fields**

In `src/types/guion.ts`, add `soundDesign` to `PantallaDivididaGuion`:

```ts
export interface PantallaDivididaGuion {
  type: "pantalla-dividida";
  slug: string;
  topic: string;
  rawVideoPath: string;
  removeOtherSpeakers?: boolean;
  scenes: PantallaDivididaScene[];
  /** Prompts para las 3 capas de sonido cinematográfico, generadas una vez por
   * video. Todos opcionales: si se omite alguno, se usa un prompt por defecto. */
  soundDesign?: {
    tensionBedPrompt?: string;
    whooshPrompt?: string;
    stingPrompt?: string;
  };
}
```

Add `sfx` to `RenderedPantallaDivididaGuion`:

```ts
export interface RenderedPantallaDivididaGuion {
  type: "pantalla-dividida";
  slug: string;
  topic: string;
  videoPath: string;
  durationInSeconds: number;
  scenes: RenderedPantallaDivididaScene[];
  sfx: {
    tensionBedPath: string;
    whooshPath: string;
    whooshDurationInSeconds: number;
    stingPath: string;
    stingDurationInSeconds: number;
  };
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run lint`
Expected: type errors in `generateAssets.ts` and any file that builds a `RenderedPantallaDivididaGuion` literal without `sfx` yet (this is expected — Task 3 fixes it) and in `PantallaDividida.tsx` reading `guion.sfx` (fixed by Task 4). If `lint` currently shows exactly those two files failing on missing/unknown `sfx`, that confirms Step 1 is correct — do not "fix" it here.

- [ ] **Step 3: Commit**

```bash
git add src/types/guion.ts
git commit -m "feat: add soundDesign/sfx fields to PantallaDividida guion types"
```

---

## Task 2: `pantallaDivididaTiming` — pure frame-timing helpers

**Files:**
- Create: `src/services/pantallaDivididaTiming.ts`
- Test: `src/services/pantallaDivididaTiming.test.ts`

**Interfaces:**
- Consumes: `RenderedPantallaDivididaScene` (from `src/types/guion.ts`, already exists).
- Produces: `computeCutFrames(scenes: RenderedPantallaDivididaScene[], fps: number): number[]`, `computeActTwoStartFrame(scenes: RenderedPantallaDivididaScene[], fps: number): number` — both consumed by Task 4.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { computeCutFrames, computeActTwoStartFrame } from "./pantallaDivididaTiming";
import type { RenderedPantallaDivididaScene } from "../types/guion";

function scene(overrides: Partial<RenderedPantallaDivididaScene>): RenderedPantallaDivididaScene {
  return {
    id: "s",
    text: "",
    act: "split",
    startSeconds: 0,
    durationInSeconds: 0,
    matched: true,
    images: [],
    ...overrides,
  };
}

describe("computeCutFrames", () => {
  it("junta los cortes de todas las escenas split, en orden, con frames absolutos", () => {
    const scenes = [
      scene({
        id: "s1",
        durationInSeconds: 5,
        images: [
          { path: "a", durationInSeconds: 2.5 },
          { path: "b", durationInSeconds: 2.5 },
        ],
      }),
      scene({ id: "s2", durationInSeconds: 3, images: [{ path: "c", durationInSeconds: 3 }] }),
    ];

    const result = computeCutFrames(scenes, 30);

    expect(result).toEqual([0, 75, 150]);
  });

  it("ignora las escenas closing (no aportan cortes)", () => {
    const scenes = [
      scene({ id: "s1", durationInSeconds: 2, images: [{ path: "a", durationInSeconds: 2 }] }),
      scene({ id: "s2", act: "closing", durationInSeconds: 3, images: [] }),
    ];

    const result = computeCutFrames(scenes, 30);

    expect(result).toEqual([0]);
  });

  it("devuelve un array vacío si no hay escenas split", () => {
    const scenes = [scene({ id: "s1", act: "closing", durationInSeconds: 3, images: [] })];

    expect(computeCutFrames(scenes, 30)).toEqual([]);
  });
});

describe("computeActTwoStartFrame", () => {
  it("devuelve el frame donde arranca la primera escena closing", () => {
    const scenes = [
      scene({ id: "s1", durationInSeconds: 5, images: [] }),
      scene({ id: "s2", durationInSeconds: 3, images: [] }),
      scene({ id: "s3", act: "closing", durationInSeconds: 2, images: [] }),
    ];

    expect(computeActTwoStartFrame(scenes, 30)).toBe(240);
  });

  it("funciona si la escena closing no es la última", () => {
    const scenes = [
      scene({ id: "s1", durationInSeconds: 2, images: [] }),
      scene({ id: "s2", act: "closing", durationInSeconds: 3, images: [] }),
      scene({ id: "s3", durationInSeconds: 1, images: [] }),
    ];

    expect(computeActTwoStartFrame(scenes, 30)).toBe(60);
  });

  it("si no hay ninguna escena closing, devuelve la duración total", () => {
    const scenes = [
      scene({ id: "s1", durationInSeconds: 4, images: [] }),
      scene({ id: "s2", durationInSeconds: 2, images: [] }),
    ];

    expect(computeActTwoStartFrame(scenes, 30)).toBe(180);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/services/pantallaDivididaTiming.test.ts`
Expected: FAIL — module `./pantallaDivididaTiming` does not exist.

- [ ] **Step 3: Write the implementation**

```ts
import type { RenderedPantallaDivididaScene } from "../types/guion";

/** Frame absoluto de arranque de cada corte de imagen, juntando todas las
 * escenas "split" en orden (las escenas "closing" no aportan cortes). */
export function computeCutFrames(scenes: RenderedPantallaDivididaScene[], fps: number): number[] {
  const cutFrames: number[] = [];
  let sceneCursorSeconds = 0;

  for (const scene of scenes) {
    const sceneStartSeconds = sceneCursorSeconds;
    sceneCursorSeconds += scene.durationInSeconds;
    if (scene.act !== "split") continue;

    let cutCursorSeconds = 0;
    for (const image of scene.images) {
      const cutStartSeconds = sceneStartSeconds + cutCursorSeconds;
      cutFrames.push(Math.round(cutStartSeconds * fps));
      cutCursorSeconds += image.durationInSeconds;
    }
  }

  return cutFrames;
}

/** Frame absoluto donde arranca la primera escena "closing". Si no hay
 * ninguna, devuelve la duración total (en frames). */
export function computeActTwoStartFrame(scenes: RenderedPantallaDivididaScene[], fps: number): number {
  let cursorSeconds = 0;
  for (const scene of scenes) {
    if (scene.act === "closing") {
      return Math.round(cursorSeconds * fps);
    }
    cursorSeconds += scene.durationInSeconds;
  }
  return Math.round(cursorSeconds * fps);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/services/pantallaDivididaTiming.test.ts`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/services/pantallaDivididaTiming.ts src/services/pantallaDivididaTiming.test.ts
git commit -m "feat: add pantallaDivididaTiming pure helpers for cut/act-two frames"
```

---

## Task 3: Generate the 3 sound assets in `generateAssets.ts`

**Files:**
- Modify: `src/services/generateAssets.ts`

**Interfaces:**
- Consumes: `generateSoundEffect` (already imported from `./elevenlabsService`), `getAudioDurationInSeconds` (already defined in this file), `guion.soundDesign` (Task 1).
- Produces: the `sfx` field on the `rendered: RenderedPantallaDivididaGuion` object written to `public/data/<slug>.json`.

- [ ] **Step 1: Add sound generation to `generatePantallaDivididaAssets`**

In `src/services/generateAssets.ts`, inside `generatePantallaDivididaAssets`, insert this block right before `const rendered: RenderedPantallaDivididaGuion = {` (currently the line building the final object):

```ts
  const sfxDir = path.join(PUBLIC_DIR, "assets", guion.slug, "sfx");
  fs.mkdirSync(sfxDir, { recursive: true });

  const tensionBedPrompt =
    guion.soundDesign?.tensionBedPrompt ??
    "low ominous cinematic tension drone, suspenseful ambient pad, subtle rising dread, seamless loop, no melody, no percussion";
  const whooshPrompt =
    guion.soundDesign?.whooshPrompt ?? "quick cinematic whoosh transition sound effect, sharp and short, trailer style";
  const stingPrompt =
    guion.soundDesign?.stingPrompt ??
    "dramatic cinematic impact hit, deep bass boom with a sharp metallic edge, trailer sting";

  const tensionBedAbsPath = path.join(sfxDir, "tension-bed.mp3");
  if (fs.existsSync(tensionBedAbsPath)) {
    console.log("cama de tensión ya existe, se reutiliza");
  } else {
    console.log("generando cama de tensión...");
    await generateSoundEffect(tensionBedPrompt, tensionBedAbsPath, 7);
  }

  const whooshAbsPath = path.join(sfxDir, "whoosh.mp3");
  if (fs.existsSync(whooshAbsPath)) {
    console.log("whoosh ya existe, se reutiliza");
  } else {
    console.log("generando whoosh...");
    await generateSoundEffect(whooshPrompt, whooshAbsPath);
  }

  const stingAbsPath = path.join(sfxDir, "sting.mp3");
  if (fs.existsSync(stingAbsPath)) {
    console.log("sting ya existe, se reutiliza");
  } else {
    console.log("generando sting...");
    await generateSoundEffect(stingPrompt, stingAbsPath);
  }

  const whooshDurationInSeconds = await getAudioDurationInSeconds(whooshAbsPath);
  const stingDurationInSeconds = await getAudioDurationInSeconds(stingAbsPath);

```

- [ ] **Step 2: Add `sfx` to the `rendered` object**

Change:

```ts
  const rendered: RenderedPantallaDivididaGuion = {
    type: "pantalla-dividida",
    slug: guion.slug,
    topic: guion.topic,
    videoPath,
    durationInSeconds,
    scenes: renderedScenes,
  };
```

to:

```ts
  const rendered: RenderedPantallaDivididaGuion = {
    type: "pantalla-dividida",
    slug: guion.slug,
    topic: guion.topic,
    videoPath,
    durationInSeconds,
    scenes: renderedScenes,
    sfx: {
      tensionBedPath: toPublicRelPath(tensionBedAbsPath),
      whooshPath: toPublicRelPath(whooshAbsPath),
      whooshDurationInSeconds,
      stingPath: toPublicRelPath(stingAbsPath),
      stingDurationInSeconds,
    },
  };
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run lint`
Expected: no errors in `generateAssets.ts` anymore (the `sfx`-related error from Task 1 is now fixed). `PantallaDividida.tsx` may still show an error reading `guion.sfx` — that's expected until Task 4.

- [ ] **Step 4: Verify the ElevenLabs duration risk with a real call**

The spec flags that `generateSoundEffect`'s behavior for a 7-second clip
is unverified (the project has only ever requested ≤3s clips before).
Confirm it with one real run against the existing real guion — everything
else (video, transcript, retakes) is already cached from the earlier
session, so this only spends API budget on the 3 new sfx clips:

Run: `npm run generate:assets -- content/guiones/pantalla-dividida.json`
Expected: console shows `generando cama de tensión...`, `generando
whoosh...`, `generando sting...` (each only once — re-running the command
afterward should print `ya existe, se reutiliza` for all three), and the
command exits 0. If the 7-second tension bed request fails or errors,
lower the `7` passed to `generateSoundEffect` for the tension bed in Step
1 above (e.g. to `5` or `3`) and re-run until it succeeds — a shorter
loop still works with `<Audio loop>` in Task 4.

- [ ] **Step 5: Commit**

```bash
git add src/services/generateAssets.ts
git commit -m "feat: generate tension bed, whoosh, and sting sound assets for pantalla-dividida"
```

---

## Task 4: Composition — zoom punch, closing zoom, and audio cues

**Files:**
- Modify: `src/components/PantallaDividida.tsx`

**Interfaces:**
- Consumes: `computeCutFrames`, `computeActTwoStartFrame` (Task 2), `guion.sfx` (Task 3), `Sequence`/`Audio` from `remotion`.
- Produces: the updated `PantallaDividida` component — no new exports.

- [ ] **Step 1: Replace the full file**

Replace the entire contents of `src/components/PantallaDividida.tsx` with:

```tsx
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/Poppins";
import { computeCutFrames, computeActTwoStartFrame } from "../services/pantallaDivididaTiming";
import type { RenderedPantallaDivididaGuion, RenderedPantallaDivididaScene } from "../types/guion";

const { fontFamily } = loadFont("normal", { weights: ["700", "800"] });

const ENTRANCE_FRAMES = 6;
const CUT_TRANSITION_FRAMES = 6;
// Zoom "punch" sincronizado con el whoosh de cada corte: arranca ampliado y
// cae rápido a tamaño normal, con un rebote leve (damping bajo, stiffness alto).
const ZOOM_PUNCH_START_SCALE = 1.18;
const ZOOM_PUNCH_FRAMES = 18;
const ZOOM_PUNCH_SPRING_CONFIG = { damping: 9, stiffness: 180, mass: 0.7 };
// Zoom sutil y continuo sobre el presentador durante todo el cierre.
const CLOSING_ZOOM_MAX_SCALE = 1.06;

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
// hay TransitionSeries acá: el video de abajo es continuo). Cada corte suma
// un zoom "punch" sincronizado con su whoosh (ver ZOOM_PUNCH_* arriba).
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

        const punchSpring = spring({
          frame: localFrame - cut.startFrame,
          fps,
          config: ZOOM_PUNCH_SPRING_CONFIG,
          durationInFrames: ZOOM_PUNCH_FRAMES,
        });
        const scale = ZOOM_PUNCH_START_SCALE - (ZOOM_PUNCH_START_SCALE - 1) * punchSpring;

        return (
          <Img
            key={cut.path}
            src={staticFile(cut.path)}
            className="absolute inset-0 h-full w-full object-cover"
            style={{ opacity, transform: `scale(${scale})` }}
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

  const closingProgress =
    active && !isSplit ? Math.min(localFrame / (active.scene.durationInSeconds * fps), 1) : 0;
  const videoScale = 1 + (CLOSING_ZOOM_MAX_SCALE - 1) * closingProgress;

  const cutFrames = computeCutFrames(guion.scenes, fps);
  const actTwoStartFrame = computeActTwoStartFrame(guion.scenes, fps);
  const whooshDurationInFrames = Math.round(guion.sfx.whooshDurationInSeconds * fps);
  const stingDurationInFrames = Math.round(guion.sfx.stingDurationInSeconds * fps);

  return (
    <AbsoluteFill className="bg-black">
      <div className="absolute inset-x-0 overflow-hidden" style={isSplit ? { bottom: 0, height: "50%" } : { inset: 0 }}>
        <OffthreadVideo
          src={staticFile(guion.videoPath)}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `scale(${videoScale})`,
          }}
        />
      </div>

      {active && isSplit && (
        <div className="absolute inset-x-0 top-0 overflow-hidden" style={{ height: "50%" }}>
          <SceneIllustration scene={active.scene} localFrame={localFrame} fps={fps} />
          <Caption text={active.scene.text} localFrame={localFrame} fps={fps} variant="bar" />
        </div>
      )}

      {active && !isSplit && <Caption text={active.scene.text} localFrame={localFrame} fps={fps} variant="overlay" />}

      <Sequence from={0} durationInFrames={actTwoStartFrame} layout="none">
        <Audio
          src={staticFile(guion.sfx.tensionBedPath)}
          loop
          volume={(f) => interpolate(f, [0, actTwoStartFrame], [0.08, 0.22], { extrapolateRight: "clamp" })}
        />
      </Sequence>

      {cutFrames.map((cutFrame) => (
        <Sequence key={cutFrame} from={cutFrame} durationInFrames={whooshDurationInFrames} layout="none">
          <Audio src={staticFile(guion.sfx.whooshPath)} volume={0.4} />
        </Sequence>
      ))}

      <Sequence from={actTwoStartFrame} durationInFrames={stingDurationInFrames} layout="none">
        <Audio src={staticFile(guion.sfx.stingPath)} volume={0.5} />
      </Sequence>
    </AbsoluteFill>
  );
};
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run lint`
Expected: no errors anywhere (this was the last file with a pending `sfx`-related error from Task 1).

- [ ] **Step 3: Commit**

```bash
git add src/components/PantallaDividida.tsx
git commit -m "feat: sync epic zoom punch + tension bed/whoosh/sting audio in PantallaDividida"
```

---

## Task 5: Update the visual fixture + verify by rendering

**Files:**
- Modify: `public/data/pantalla-dividida-demo.json`
- Create (binary, via ffmpeg): `public/assets/pantalla-dividida-demo/sfx/tension-bed.mp3`, `public/assets/pantalla-dividida-demo/sfx/whoosh.mp3`, `public/assets/pantalla-dividida-demo/sfx/sting.mp3`

**Interfaces:**
- Consumes: the `PantallaDividida` component (Task 4) — this task only supplies fixture data, no code changes.
- Produces: nothing consumed by later tasks (this is the last task).

`sfx` is now required on `RenderedPantallaDivididaGuion` (Task 1), so the existing demo fixture needs it or `PantallaDivididaDemo` will crash reading `guion.sfx.whooshDurationInSeconds` on a `undefined`.

- [ ] **Step 1: Generate 3 synthetic sfx files for the fixture**

```bash
mkdir -p public/assets/pantalla-dividida-demo/sfx

ffmpeg -y -f lavfi -i "sine=frequency=80:duration=6" public/assets/pantalla-dividida-demo/sfx/tension-bed.mp3
ffmpeg -y -f lavfi -i "sine=frequency=600:duration=0.6" public/assets/pantalla-dividida-demo/sfx/whoosh.mp3
ffmpeg -y -f lavfi -i "sine=frequency=150:duration=1.2" public/assets/pantalla-dividida-demo/sfx/sting.mp3
```

Expected: 3 new `.mp3` files under `public/assets/pantalla-dividida-demo/sfx/`.

- [ ] **Step 2: Add `sfx` to the fixture data file**

In `public/data/pantalla-dividida-demo.json`, add this field at the end of the top-level object (after `"scenes": [...]`, before the closing `}`):

```json
  "sfx": {
    "tensionBedPath": "assets/pantalla-dividida-demo/sfx/tension-bed.mp3",
    "whooshPath": "assets/pantalla-dividida-demo/sfx/whoosh.mp3",
    "whooshDurationInSeconds": 0.6,
    "stingPath": "assets/pantalla-dividida-demo/sfx/sting.mp3",
    "stingDurationInSeconds": 1.2
  }
```

The full file (9s duration, scenes `s1`/`s2`/`s3` as before — recall `s3` is `"closing"` starting at 7s) should read:

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
  ],
  "sfx": {
    "tensionBedPath": "assets/pantalla-dividida-demo/sfx/tension-bed.mp3",
    "whooshPath": "assets/pantalla-dividida-demo/sfx/whoosh.mp3",
    "whooshDurationInSeconds": 0.6,
    "stingPath": "assets/pantalla-dividida-demo/sfx/sting.mp3",
    "stingDurationInSeconds": 1.2
  }
}
```

- [ ] **Step 3: Run the full test suite and lint**

Run: `npm run lint && npm test`
Expected: no errors, all tests pass (including the 6 new ones from Task 2).

- [ ] **Step 4: Render the fixture and verify it doesn't crash**

Run: `npx remotion render PantallaDivididaDemo out/demo-sound-test.mp4`
Expected: exit code 0, `out/demo-sound-test.mp4` created. If it throws reading `guion.sfx` or an `Audio`/`Sequence` prop, fix `PantallaDividida.tsx` before continuing — do not skip this step.

- [ ] **Step 5: Confirm the rendered audio isn't silent**

Run: `ffmpeg -i out/demo-sound-test.mp4 -af volumedetect -f null - 2>&1 | grep mean_volume`
Expected: a `mean_volume` value well above silence (roughly above -50dB — silence/near-silence reads around -91dB). If it prints nothing or a near-silent value, the `<Audio>` cues aren't being mixed in — check the `<Sequence>`/`<Audio>` block in `PantallaDividida.tsx`.

- [ ] **Step 6: Visually confirm the zoom punch on a cut**

```bash
npx remotion still PantallaDivididaDemo /tmp/pd-cut-peak.png --frame=76
npx remotion still PantallaDivididaDemo /tmp/pd-cut-settled.png --frame=93
```

Look at both images (they cover scene `s1`'s second image cut, which starts at frame 75): `/tmp/pd-cut-peak.png` (1 frame after the cut) should show the illustration visibly larger/zoomed-in than `/tmp/pd-cut-settled.png` (18 frames after, spring settled to normal size). If they look the same size, the zoom punch spring isn't applying — check the `SceneIllustration` changes in `PantallaDividida.tsx`.

- [ ] **Step 7: Visually confirm the closing-act zoom**

```bash
npx remotion still PantallaDivididaDemo /tmp/pd-closing-start.png --frame=211
npx remotion still PantallaDivididaDemo /tmp/pd-closing-end.png --frame=269
```

Look at both: `/tmp/pd-closing-end.png` (near the end of the closing scene) should show the presenter video slightly more zoomed in than `/tmp/pd-closing-start.png` (just after the closing scene starts). The difference is subtle (up to 6% scale) — look at how much of the background is visible at the frame edges, not just the presenter's apparent size.

- [ ] **Step 8: Commit**

```bash
git add public/data/pantalla-dividida-demo.json public/assets/pantalla-dividida-demo/sfx
git commit -m "feat: add sfx to the pantalla-dividida demo fixture, verify zoom+audio by rendering"
```

---

## Final check

- [ ] Run `npm run lint && npm test` once more from the repo root — full green before considering this plan done.
