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
