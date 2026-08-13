# Pantalla Dividida Background Music Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the AI-generated "tension bed" loop with a real licensed background-music track the user picked, playing across the full video with a fade-in/fade-out envelope.

**Architecture:** The music file is a pre-selected, already-downloaded asset (`content/musica/motivation-paulyudin.mp3`), copied and cached by the pipeline exactly like `rawVideoPath` already is — no AI generation involved. The composition plays it in a single `<Sequence>` spanning the whole video (not just Act 1), with a declarative fade-in/fade-out volume envelope replacing the old rising-intensity ramp.

**Tech Stack:** TypeScript, Remotion 4, Node `fs`.

## Global Constraints

- `backgroundMusicPath` is a required field on `PantallaDivididaGuion` — this video type always has background music, there is no AI-generated default to fall back to.
- Music volume: fade in 0 → 0.15 over 20 frames, hold at 0.15, fade out 0.15 → 0 over the last 45 frames — never a hard cut.
- Reuse the exact copy+cache pattern already used for `rawVideoPath` in `prepareTrimmedVideo` (`src/services/generateAssets.ts`) — don't invent a new caching convention.
- This plan ends with the real video re-rendered and verified (ffprobe/volumedetect + `remotion still`) — not just "compiles clean."

---

## Task 1: Schema — `backgroundMusicPath` replaces `tensionBedPrompt`/`tensionBedPath`

**Files:**
- Modify: `src/types/guion.ts:132-178`

**Interfaces:**
- Consumes: nothing (pure type change).
- Produces: `PantallaDivididaGuion.backgroundMusicPath: string`, `RenderedPantallaDivididaGuion.sfx.backgroundMusicPath: string` — consumed by Task 2 (generation) and Task 3 (composition).

- [ ] **Step 1: Update `PantallaDivididaGuion`**

Change:

```ts
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

to:

```ts
  scenes: PantallaDivididaScene[];
  /** Ruta a un archivo de música de fondo ya elegido y con licencia
   * verificada por el usuario, ej. "content/musica/motivation-paulyudin.mp3".
   * Se reproduce desde el segundo 0, cortado a la duración total del video. */
  backgroundMusicPath: string;
  /** Prompts para whoosh/sting, generados una vez por video. Ambos opcionales:
   * si se omite alguno, se usa un prompt por defecto. */
  soundDesign?: {
    whooshPrompt?: string;
    stingPrompt?: string;
  };
}
```

- [ ] **Step 2: Update `RenderedPantallaDivididaGuion.sfx`**

Change:

```ts
  sfx: {
    tensionBedPath: string;
    whooshPath: string;
    whooshDurationInSeconds: number;
    stingPath: string;
    stingDurationInSeconds: number;
  };
```

to:

```ts
  sfx: {
    backgroundMusicPath: string;
    whooshPath: string;
    whooshDurationInSeconds: number;
    stingPath: string;
    stingDurationInSeconds: number;
  };
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run lint`
Expected: errors in `src/services/generateAssets.ts` (still builds the old `tensionBedPrompt`/`tensionBedPath` shape) and `src/components/PantallaDividida.tsx` (still reads `guion.sfx.tensionBedPath`) and `content/guiones/pantalla-dividida.json`/`public/data/pantalla-dividida-demo.json` are plain JSON so they won't show as TS errors, but the app will fail to load them at runtime until Task 4. The two TS errors are expected — fixed by Task 2 and Task 3. Do not "fix" them here.

- [ ] **Step 4: Commit**

```bash
git add src/types/guion.ts
git commit -m "feat: replace tensionBedPrompt with backgroundMusicPath in guion schema"
```

---

## Task 2: Pipeline — copy the music file instead of generating a tension bed

**Files:**
- Modify: `src/services/generateAssets.ts:640-693`

**Interfaces:**
- Consumes: `guion.backgroundMusicPath` (Task 1).
- Produces: `sfx.backgroundMusicPath` on the `rendered` object written to `public/data/<slug>.json` — consumed by Task 3.

- [ ] **Step 1: Replace the tension-bed generation block**

Change:

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
```

to:

```ts
  const sfxDir = path.join(PUBLIC_DIR, "assets", guion.slug, "sfx");
  fs.mkdirSync(sfxDir, { recursive: true });

  const whooshPrompt =
    guion.soundDesign?.whooshPrompt ?? "quick cinematic whoosh transition sound effect, sharp and short, trailer style";
  const stingPrompt =
    guion.soundDesign?.stingPrompt ??
    "dramatic cinematic impact hit, deep bass boom with a sharp metallic edge, trailer sting";

  const musicAbsPath = path.join(sfxDir, "background-music.mp3");
  if (fs.existsSync(musicAbsPath)) {
    console.log("música de fondo ya copiada, se reutiliza");
  } else {
    console.log(`copiando música de fondo desde ${guion.backgroundMusicPath}...`);
    fs.copyFileSync(guion.backgroundMusicPath, musicAbsPath);
  }

  const whooshAbsPath = path.join(sfxDir, "whoosh.mp3");
```

- [ ] **Step 2: Update the `rendered.sfx` object**

Change:

```ts
    sfx: {
      tensionBedPath: toPublicRelPath(tensionBedAbsPath),
      whooshPath: toPublicRelPath(whooshAbsPath),
      whooshDurationInSeconds,
      stingPath: toPublicRelPath(stingAbsPath),
      stingDurationInSeconds,
    },
```

to:

```ts
    sfx: {
      backgroundMusicPath: toPublicRelPath(musicAbsPath),
      whooshPath: toPublicRelPath(whooshAbsPath),
      whooshDurationInSeconds,
      stingPath: toPublicRelPath(stingAbsPath),
      stingDurationInSeconds,
    },
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run lint`
Expected: no errors in `generateAssets.ts` anymore. `PantallaDividida.tsx` still shows an error reading `guion.sfx.tensionBedPath` — expected until Task 3.

- [ ] **Step 4: Commit**

```bash
git add src/services/generateAssets.ts
git commit -m "feat: copy licensed background music file instead of generating a tension bed"
```

---

## Task 3: Composition — play background music across the full video

**Files:**
- Modify: `src/components/PantallaDividida.tsx`

**Interfaces:**
- Consumes: `guion.sfx.backgroundMusicPath` (Task 2).
- Produces: updated `PantallaDividida` component — no new exports.

- [ ] **Step 1: Add the fade constants**

Change:

```ts
const ENTRANCE_FRAMES = 6;
const CUT_TRANSITION_FRAMES = 6;
// Zoom sutil y continuo sobre el presentador durante todo el cierre.
const CLOSING_ZOOM_MAX_SCALE = 1.06;
```

to:

```ts
const ENTRANCE_FRAMES = 6;
const CUT_TRANSITION_FRAMES = 6;
// Zoom sutil y continuo sobre el presentador durante todo el cierre.
const CLOSING_ZOOM_MAX_SCALE = 1.06;
// Música de fondo: nunca arranca ni corta seco.
const MUSIC_VOLUME = 0.15;
const MUSIC_FADE_IN_FRAMES = 20;
const MUSIC_FADE_OUT_FRAMES = 45;
```

- [ ] **Step 2: Destructure `durationInFrames` from `useVideoConfig`**

Change:

```ts
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
```

to:

```ts
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
```

- [ ] **Step 3: Replace the tension-bed `<Sequence>` with the background-music one**

Change:

```tsx
      <Sequence durationInFrames={actTwoStartFrame} layout="none">
        <Audio
          src={staticFile(guion.sfx.tensionBedPath)}
          loop
          volume={(f) => interpolate(f, [0, actTwoStartFrame], [0.08, 0.22], { extrapolateRight: "clamp" })}
        />
      </Sequence>
```

to:

```tsx
      <Sequence durationInFrames={durationInFrames} layout="none">
        <Audio
          src={staticFile(guion.sfx.backgroundMusicPath)}
          volume={(f) =>
            Math.min(
              interpolate(f, [0, MUSIC_FADE_IN_FRAMES], [0, MUSIC_VOLUME], { extrapolateRight: "clamp" }),
              interpolate(f, [durationInFrames - MUSIC_FADE_OUT_FRAMES, durationInFrames], [MUSIC_VOLUME, 0], {
                extrapolateLeft: "clamp",
              }),
            )
          }
        />
      </Sequence>
```

(the `<Sequence from={actTwoStartFrame} durationInFrames={stingDurationInFrames} layout="none">` block right after, for the sting sound, stays exactly as-is — `actTwoStartFrame` is still used there).

- [ ] **Step 4: Verify it compiles**

Run: `npm run lint`
Expected: no errors anywhere — this was the last file with a pending `tensionBedPath` reference.

- [ ] **Step 5: Commit**

```bash
git add src/components/PantallaDividida.tsx
git commit -m "feat: play background music across the full video with fade-in/fade-out"
```

---

## Task 4: Update guion data — real guion + demo fixture

**Files:**
- Modify: `content/guiones/pantalla-dividida.json`
- Modify: `public/data/pantalla-dividida-demo.json`

**Interfaces:**
- Consumes: schema from Task 1.
- Produces: valid guion/fixture data for Task 5's regeneration + render.

- [ ] **Step 1: Add `backgroundMusicPath` to the real guion**

In `content/guiones/pantalla-dividida.json`, change:

```json
  "rawVideoPath": "content/raw/pantalla-dividida.mp4",
  "removeOtherSpeakers": true,
  "scenes": [
```

to:

```json
  "rawVideoPath": "content/raw/pantalla-dividida.mp4",
  "removeOtherSpeakers": true,
  "backgroundMusicPath": "content/musica/motivation-paulyudin.mp3",
  "scenes": [
```

- [ ] **Step 2: Rename the field in the demo fixture**

In `public/data/pantalla-dividida-demo.json`, change:

```json
  "sfx": {
    "tensionBedPath": "assets/pantalla-dividida-demo/sfx/tension-bed.mp3",
    "whooshPath": "assets/pantalla-dividida-demo/sfx/whoosh.mp3",
```

to:

```json
  "sfx": {
    "backgroundMusicPath": "assets/pantalla-dividida-demo/sfx/tension-bed.mp3",
    "whooshPath": "assets/pantalla-dividida-demo/sfx/whoosh.mp3",
```

(the fixture keeps pointing at the existing synthetic tone file — no need to use the real licensed track for the fixture, and no need to rename the file on disk, only the JSON key).

- [ ] **Step 3: Verify with lint and tests**

Run: `npm run lint && npm test`
Expected: no errors, all tests pass (this task touches no `.ts`/`.tsx` files, this just confirms nothing else broke).

- [ ] **Step 4: Commit**

```bash
git add content/guiones/pantalla-dividida.json public/data/pantalla-dividida-demo.json
git commit -m "feat: wire backgroundMusicPath into the real guion and demo fixture"
```

---

## Task 5: Regenerate, re-render, and verify the real video

**Files:**
- None (no code changes — this task runs the pipeline and inspects its output).

**Interfaces:**
- Consumes: everything from Tasks 1-4.
- Produces: updated `public/data/pantalla-dividida.json`, updated `out/pantalla-dividida.mp4`.

- [ ] **Step 1: Regenerate the data (free — only the music file is new, everything else is cached)**

Run: `npm run generate:assets -- content/guiones/pantalla-dividida.json`
Expected: console shows `copiando música de fondo desde content/musica/motivation-paulyudin.mp3...` (once), `whoosh ya existe, se reutiliza`, `sting ya existe, se reutiliza`, `video recortado ya existe, se reutiliza`, and exits 0. If it prints `generando cama de tensión...` anywhere, Task 2 wasn't applied correctly — stop and check.

- [ ] **Step 2: Confirm the music file landed where expected**

Run: `ls -la public/assets/pantalla-dividida/sfx/background-music.mp3 && ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1 public/assets/pantalla-dividida/sfx/background-music.mp3`
Expected: file exists, duration ≈ 75.5 seconds (the full licensed track — it gets truncated at render time by the Sequence, not by this copy step).

- [ ] **Step 3: Render the real video**

Run: `npx remotion render PantallaDividida out/pantalla-dividida.mp4`
Expected: exit code 0, `out/pantalla-dividida.mp4` is rewritten.

- [ ] **Step 4: Verify the rendered audio is present and not clipping**

Run: `ffmpeg -i out/pantalla-dividida.mp4 -af volumedetect -f null - 2>&1 | grep -i "mean_volume\|max_volume"`
Expected: `max_volume` at or below `0.0 dB` (no clipping) and a `mean_volume` reading (confirms audio is present — compare informally to the pre-change render, should be in a similar ballpark since voice still dominates the mix).

- [ ] **Step 5: Visually/aurally spot-check the fade-in and fade-out with real frames**

```bash
npx remotion still PantallaDividida /tmp/pd-music-start.png --frame=0
npx remotion still PantallaDividida /tmp/pd-music-end.png --frame=895
```

(`895` ≈ last frame of the video at 30fps for a ~29.9s render — check the actual `durationInSeconds` printed in Step 1's output and adjust if the real video length differs). Look at both stills: they should render normally (no crash, no black frame) — this doesn't visually prove the audio fade, but confirms the `<Sequence>` boundaries didn't break rendering at the very start and very end of the timeline, which is where an off-by-one in `durationInFrames` would show up as a dropped last frame or an error.

- [ ] **Step 6: Final full-suite check**

Run: `npm run lint && npm test`
Expected: no errors, all tests pass.

## Final check

- [ ] Confirm `out/pantalla-dividida.mp4` was regenerated (check its file modification time is after this task started).
- [ ] Report to the user: what changed, the verification results from Steps 2-5, and that the tension-bed code path no longer exists in the codebase (`grep -rn "tensionBed" src/` should return nothing).
