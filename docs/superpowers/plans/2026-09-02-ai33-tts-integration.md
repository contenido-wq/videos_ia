# Ai33 TTS Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ElevenLabs as the voice-generation provider for `vox` and `documental-doodle` with `ai33.pro`, keeping the exact same default voice, while leaving every other ElevenLabs usage (real-video transcription, sound effects) untouched.

**Architecture:** Add a new `ai33Service.ts` with a single `generateSpeech()` function that submits an async TTS task, polls it to completion, downloads the resulting audio, and (optionally) downloads and parses the word-level transcript into the project's existing `TranscribedWord` shape. Swap the two `generateVoice()` call sites in `generateAssets.ts` (`generateScene` for `vox`, `generateDocumentalDoodleAssets`) to call `ai33Service.generateSpeech()` instead — for `documental-doodle` this also removes the now-redundant separate `transcribeWithTimestamps` call, since `withTranscript: true` returns both in one round trip. Remove the now-dead `generateVoice`/`GenerateVoiceOptions`/`DEFAULT_VOICE_ID` from `elevenlabsService.ts`.

**Tech Stack:** TypeScript, Node `fetch`/`FormData`, vitest.

**Spec:** `docs/superpowers/specs/2026-09-02-ai33-tts-integration-design.md`

## Global Constraints

- Scope is exactly two call sites: `generateScene` (used by `vox`) and `generateDocumentalDoodleAssets` (`documental-doodle`). Nothing else in `generateAssets.ts` changes.
- `transcribeWithTimestamps`, `transcribeWithSpeakers`, `generateSoundEffect`, and `listVoices` in `elevenlabsService.ts` are **not touched** — they keep serving `social-checklist`, `pantalla-dividida`, `youtube-noticias-avatar`, and `testConnections.ts`.
- Default voice stays `elevenlabs_21m00Tcm4TlvDq8ikWAM` (same voice the project already uses, now served through ai33's proxy) unless a scene/guion explicitly overrides `voiceId`.
- Async handling is polling only (`GET /v3/task/{task_id}` every 2s, 120s total timeout) — no webhook/`receive_url`, no server to expose.
- **Security:** the API key lives only in `.env` as `AI33_API_KEY`, read through `env.ts` exactly like every other key in this project. Never hardcode it, never `console.log` it, never include it in an error message (errors carry only HTTP status + response body, which never contains the key). Never print the value of `AI33_API_KEY` to the terminal while implementing this plan (e.g. no `cat .env`, no echoing the key in verification commands).
- The transcript JSON downloaded from `json_url` has this shape (confirmed with a real test call): `[{ words: [{ text, start, end, type, speaker_id, logprob }], ... }]` — filter `type === "word"` and map to `{ text, start, end }`, exactly like `elevenlabsService.transcribeWithTimestamps` already does for its own response.

---

## Task 1: `AI33_API_KEY` in `env.ts`

**Files:**
- Modify: `src/services/env.ts`
- Modify: `.env` (not committed — gitignored; add the real key value here, never in a tracked file)

**Interfaces:**
- Consumes: nothing.
- Produces: `env.ai33ApiKey: string` (throws if `AI33_API_KEY` is missing) — consumed by Task 2.

- [ ] **Step 1: Add the getter**

In `src/services/env.ts`, add this getter to the `env` object, after `anthropicApiKey` and before the `logoDevApiKey` comment:

```ts
  get ai33ApiKey() {
    return required("AI33_API_KEY");
  },
```

- [ ] **Step 2: Add the key to `.env`**

Open `.env` (create it from `.env.example` first if it doesn't exist — check with `test -f .env`) and add a line:

```
AI33_API_KEY=<the key the user shared>
```

Do not print the file's contents back afterward, and do not echo the key value in any command output.

- [ ] **Step 3: Verify it compiles**

Run: `npm run lint`
Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/services/env.ts
git commit -m "feat: add AI33_API_KEY to env config"
```

(`.env` is gitignored — it will not show up in `git status` as a change to commit.)

---

## Task 2: `ai33Service.ts`

**Files:**
- Create: `src/services/ai33Service.ts`

**Interfaces:**
- Consumes: `env.ai33ApiKey` (Task 1), `TranscribedWord` (existing, from `checklistSyncService.ts`).
- Produces: `generateSpeech(text: string, options: GenerateSpeechOptions): Promise<GenerateSpeechResult>` — consumed by Task 3.

- [ ] **Step 1: Create the service**

Create `src/services/ai33Service.ts`:

```ts
import fs from "fs";
import path from "path";
import { env } from "./env";
import type { TranscribedWord } from "./checklistSyncService";

const BASE_URL = "https://api.ai33.pro/v3";

// Misma voz default que ya usaba el proyecto vía ElevenLabs directo — acá
// con el prefijo elevenlabs_ que exige el proxy de ai33.pro para elegir ese
// motor. Mantiene el mismo sonido, solo cambia quién sirve/factura la voz.
const DEFAULT_VOICE_ID = "elevenlabs_21m00Tcm4TlvDq8ikWAM";

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 120000;

export interface GenerateSpeechOptions {
  voiceId?: string;
  speed?: number;
  outputPath: string;
  /** Default false. Si es true, también descarga y parsea el transcript
   * con timestamps por palabra (mismo shape que TranscribedWord). */
  withTranscript?: boolean;
}

export interface GenerateSpeechResult {
  audioPath: string;
  /** Vacío si withTranscript es false. */
  words: TranscribedWord[];
}

interface Ai33TaskData {
  status: "pending" | "processing" | "done" | "failed";
  audio_url?: string;
  json_url?: string;
  error?: string;
}

async function submitTtsTask(text: string, options: GenerateSpeechOptions): Promise<string> {
  const form = new FormData();
  form.append("text", text);
  form.append("voice_id", options.voiceId ?? DEFAULT_VOICE_ID);
  form.append("speed", String(options.speed ?? 1));
  form.append("with_transcript", String(options.withTranscript ?? false));

  const res = await fetch(`${BASE_URL}/text-to-speech`, {
    method: "POST",
    headers: { "xi-api-key": env.ai33ApiKey },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`ai33 text-to-speech falló: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { success: boolean; task_id: string };
  return data.task_id;
}

async function pollTask(taskId: string): Promise<Ai33TaskData> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await fetch(`${BASE_URL}/task/${taskId}`, {
      headers: { "xi-api-key": env.ai33ApiKey },
    });
    if (!res.ok) {
      throw new Error(`ai33 consulta de task falló: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { success: boolean; data: Ai33TaskData };
    if (data.data.status === "done") return data.data;
    if (data.data.status === "failed") {
      throw new Error(`ai33 task ${taskId} falló: ${data.data.error ?? "sin detalle"}`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`ai33 task ${taskId} no terminó dentro de ${POLL_TIMEOUT_MS / 1000}s`);
}

export async function generateSpeech(text: string, options: GenerateSpeechOptions): Promise<GenerateSpeechResult> {
  const taskId = await submitTtsTask(text, options);
  const task = await pollTask(taskId);

  if (!task.audio_url) {
    throw new Error(`ai33 task ${taskId} terminó "done" pero sin audio_url`);
  }
  const audioRes = await fetch(task.audio_url);
  if (!audioRes.ok) {
    throw new Error(`Descarga de audio ai33 falló: ${audioRes.status}`);
  }
  const audioBuffer = Buffer.from(await audioRes.arrayBuffer());
  fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
  fs.writeFileSync(options.outputPath, audioBuffer);

  let words: TranscribedWord[] = [];
  if (options.withTranscript) {
    if (!task.json_url) {
      throw new Error(`ai33 task ${taskId} pidió with_transcript pero no devolvió json_url`);
    }
    const transcriptRes = await fetch(task.json_url);
    if (!transcriptRes.ok) {
      throw new Error(`Descarga de transcript ai33 falló: ${transcriptRes.status}`);
    }
    const transcriptData = (await transcriptRes.json()) as {
      words: { text: string; start: number; end: number; type: string }[];
    }[];
    words = (transcriptData[0]?.words ?? [])
      .filter((w) => w.type === "word")
      .map((w) => ({ text: w.text, start: w.start, end: w.end }));
  }

  return { audioPath: options.outputPath, words };
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run lint`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/services/ai33Service.ts
git commit -m "feat: add ai33Service for TTS generation via ai33.pro"
```

---

## Task 3: Wire `ai33Service` into `generateAssets.ts`, remove dead ElevenLabs code

**Files:**
- Modify: `src/services/generateAssets.ts`
- Modify: `src/services/elevenlabsService.ts`

**Interfaces:**
- Consumes: `ai33Service.generateSpeech` (Task 2).
- Produces: `generateScene` and `generateDocumentalDoodleAssets` now call `ai33Service.generateSpeech` instead of `elevenlabsService.generateVoice` (removed).

- [ ] **Step 1: Import `ai33Service` in `generateAssets.ts`**

Change the import line:

```ts
import { generateVoice, generateSoundEffect, transcribeWithTimestamps, transcribeWithSpeakers } from "./elevenlabsService";
```

to:

```ts
import { generateSoundEffect, transcribeWithTimestamps, transcribeWithSpeakers } from "./elevenlabsService";
import { generateSpeech } from "./ai33Service";
```

- [ ] **Step 2: Update `generateScene` (used by `vox`)**

Change:

```ts
    console.log(`[${scene.id}] generando voz...`);
    await generateVoice(scene.text, { outputPath: audioAbsPath, voiceId: guion.voiceId });
```

to:

```ts
    console.log(`[${scene.id}] generando voz...`);
    await generateSpeech(scene.text, { outputPath: audioAbsPath, voiceId: guion.voiceId, withTranscript: false });
```

This is the only change inside `generateScene` — `getAudioDurationInSeconds(audioAbsPath)` right below it, and everything after, stays exactly as-is.

- [ ] **Step 3: Update `generateDocumentalDoodleAssets`**

Change:

```ts
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
```

to:

```ts
    let words: TranscribedWord[] = [];
    if (fs.existsSync(audioAbsPath)) {
      console.log(`[${scene.id}] voz ya existe, se reutiliza (sin re-transcribir)`);
    } else {
      console.log(`[${scene.id}] generando voz + transcript...`);
      const result = await generateSpeech(scene.text, { outputPath: audioAbsPath, voiceId: guion.voiceId, withTranscript: true });
      words = result.words;
    }

    const durationInSeconds = await getAudioDurationInSeconds(audioAbsPath);

    for (const word of words) {
      allWords.push({ text: word.text, start: word.start + cursorSeconds, end: word.end + cursorSeconds });
    }
```

Note the behavior change versus the old code: if the audio file already exists on disk (re-running `generate:assets` after a partial failure), this skips re-generating it — but since ai33 doesn't give us a way to re-fetch a past task's transcript from just the mp3, `words` stays empty for that scene in that case, same tradeoff `youtube-noticias-avatar`'s "ya existe" reuse already accepts elsewhere in this file (reuse means trusting what's already on disk, not re-deriving side data from it). This only affects manual re-runs after interrupting a real render — not a concern for a fresh run.

- [ ] **Step 4: Remove the now-dead code from `elevenlabsService.ts`**

In `src/services/elevenlabsService.ts`, remove the `DEFAULT_VOICE_ID` constant and its comment:

```ts
// Voz multilingüe por defecto (funciona bien en español latino).
const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";
```

Remove the `GenerateVoiceOptions` interface:

```ts
export interface GenerateVoiceOptions {
  voiceId?: string;
  modelId?: string;
  outputPath: string;
  stability?: number;
  similarityBoost?: number;
}
```

Remove the `generateVoice` function:

```ts
export async function generateVoice(
  text: string,
  options: GenerateVoiceOptions,
): Promise<string> {
  const voiceId = options.voiceId ?? DEFAULT_VOICE_ID;

  const res = await fetch(`${BASE_URL}/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": env.elevenLabsApiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: options.modelId ?? "eleven_multilingual_v2",
      voice_settings: {
        stability: options.stability ?? 0.5,
        similarity_boost: options.similarityBoost ?? 0.75,
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`ElevenLabs generateVoice falló: ${res.status} ${await res.text()}`);
  }

  const audioBuffer = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
  fs.writeFileSync(options.outputPath, audioBuffer);
  return options.outputPath;
}
```

Leave everything else in the file (`BASE_URL`, `Voice`, `listVoices`, `generateSoundEffect`, `transcribeWithTimestamps`, `transcribeWithSpeakers`) untouched.

- [ ] **Step 5: Verify it compiles and existing tests still pass**

Run: `npm run lint && npm test`
Expected: no type errors, all tests pass (no test file references `generateVoice` or `GenerateVoiceOptions` — confirm with `grep -rn "generateVoice\b" src/` returning zero matches before moving on).

- [ ] **Step 6: Commit**

```bash
git add src/services/generateAssets.ts src/services/elevenlabsService.ts
git commit -m "feat: switch vox and documental-doodle to ai33Service for voice generation"
```

---

## Task 4: End-to-end verification against the real ai33.pro API

**Files:** none (verification only — no code changes).

- [ ] **Step 1: Run the pipeline on the `documental-doodle-demo` fixture guion**

The fixture at `public/data/documental-doodle-demo.json` is a *rendered* guion (output shape), not a *source* guion — there's no `content/guiones/documental-doodle-demo.json` to feed `generate:assets`. Create a minimal real one to exercise the new code path (2 short scenes keep API/credit usage low):

```bash
mkdir -p content/guiones
cat > content/guiones/documental-doodle-verify.json << 'EOF'
{
  "type": "documental-doodle",
  "slug": "documental-doodle-verify",
  "topic": "Verificación de integración ai33 (borrar después de probar)",
  "scenes": [
    { "id": "s1", "text": "Esta es una prueba corta.", "visual": "a simple test tube, flat 2D doodle illustration, thick black outline, minimal flat color palette, hand-drawn vector style, plain background, no text or watermarks" }
  ]
}
EOF
npm run generate:assets -- content/guiones/documental-doodle-verify.json
```

Expected: no thrown error; console shows `[s1] generando voz + transcript...` then ends with a "Listo." summary line reporting a duration > 0, 1+ visual cuts, and 1+ caption blocks. This exercises the full new path: submit → poll → download audio → download+parse transcript → `numCuts` from real duration → real `captionChunks`.

- [ ] **Step 2: Inspect the generated output**

```bash
cat public/data/documental-doodle-verify.json
```

Expected: valid JSON matching `RenderedDocumentalDoodleGuion` — `durationInSeconds > 0`, `scenes[0].images` has at least one entry pointing to an AI-generated doodle PNG under `public/assets/documental-doodle-verify/images/`, and `captionChunks` has real word-level timestamps (not the hand-authored ones from the `-demo` fixture).

- [ ] **Step 3: Run the pipeline on `vox` to confirm the other call site works**

Reuse an existing small `vox` guion if one exists in `content/guiones/` (check with `ls content/guiones/ | grep -v documental-doodle`); if none is small enough to run cheaply, skip this step and note it in the final report rather than spending real API credits on a large one.

- [ ] **Step 4: Clean up the verification-only fixture**

```bash
rm content/guiones/documental-doodle-verify.json
rm -rf public/assets/documental-doodle-verify
rm -f public/data/documental-doodle-verify.json
```

This fixture existed only to prove the real API call path works end-to-end — it's not part of the demo/preview fixtures the project keeps (`documental-doodle-demo`), so it doesn't get committed.

- [ ] **Step 5: Final full check**

Run: `npm run lint && npm test`
Expected: no type errors, all tests pass, working tree clean (`git status --short` shows nothing beyond what Task 1-3 already committed).
