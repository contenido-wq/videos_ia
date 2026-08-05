import fs from "fs";
import path from "path";
import { env } from "./env";

const BASE_URL = "https://api.elevenlabs.io/v1";

// Voz multilingüe por defecto (funciona bien en español latino).
const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";

export interface Voice {
  voice_id: string;
  name: string;
  labels?: Record<string, string>;
}

export interface GenerateVoiceOptions {
  voiceId?: string;
  modelId?: string;
  outputPath: string;
  stability?: number;
  similarityBoost?: number;
}

export async function listVoices(): Promise<Voice[]> {
  const res = await fetch(`${BASE_URL}/voices`, {
    headers: { "xi-api-key": env.elevenLabsApiKey },
  });
  if (!res.ok) {
    throw new Error(`ElevenLabs listVoices falló: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { voices: Voice[] };
  return data.voices;
}

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

export async function generateSoundEffect(
  prompt: string,
  outputPath: string,
  durationSeconds?: number,
): Promise<string> {
  const res = await fetch(`${BASE_URL}/sound-generation`, {
    method: "POST",
    headers: {
      "xi-api-key": env.elevenLabsApiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: prompt,
      ...(durationSeconds ? { duration_seconds: durationSeconds } : {}),
    }),
  });

  if (!res.ok) {
    throw new Error(`ElevenLabs generateSoundEffect falló: ${res.status} ${await res.text()}`);
  }

  const audioBuffer = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, audioBuffer);
  return outputPath;
}
