import fs from "fs";
import path from "path";
import { env } from "./env";

const BASE_URL = "https://api.kie.ai/api/v1";

export type AspectRatio = "9:16" | "1:1" | "16:9" | "3:2" | "2:3";

export interface GenerateImageOptions {
  aspectRatio?: AspectRatio;
  outputFormat?: "png" | "jpeg";
  model?: string;
}

interface CreateTaskResponse {
  code: number;
  msg: string;
  data: { taskId: string };
}

interface RecordInfoResponse {
  code: number;
  msg: string;
  data: {
    taskId: string;
    state: "waiting" | "queuing" | "generating" | "success" | "fail";
    resultJson?: string;
    failMsg?: string;
  };
}

export async function getAccountCredits(): Promise<number> {
  const res = await fetch(`${BASE_URL}/chat/credit`, {
    headers: { Authorization: `Bearer ${env.kieAiApiKey}` },
  });
  if (!res.ok) {
    throw new Error(`kie.ai getAccountCredits falló: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { code: number; data: number };
  return data.data;
}

async function createTask(
  prompt: string,
  options: GenerateImageOptions,
  imageUrls?: string[],
): Promise<string> {
  const res = await fetch(`${BASE_URL}/jobs/createTask`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.kieAiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options.model ?? (imageUrls ? "google/nano-banana-edit" : "google/nano-banana"),
      input: {
        prompt,
        aspect_ratio: options.aspectRatio ?? "9:16",
        output_format: options.outputFormat ?? "png",
        ...(imageUrls ? { image_urls: imageUrls } : {}),
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`kie.ai createTask falló: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as CreateTaskResponse;
  return data.data.taskId;
}

async function pollTask(
  taskId: string,
  { pollIntervalMs = 3000, timeoutMs = 120_000 } = {},
): Promise<string[]> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${BASE_URL}/jobs/recordInfo?taskId=${taskId}`, {
      headers: { Authorization: `Bearer ${env.kieAiApiKey}` },
    });
    if (!res.ok) {
      throw new Error(`kie.ai recordInfo falló: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as RecordInfoResponse;

    if (data.data.state === "success") {
      const result = JSON.parse(data.data.resultJson ?? "{}") as { resultUrls?: string[] };
      return result.resultUrls ?? [];
    }
    if (data.data.state === "fail") {
      throw new Error(`kie.ai tarea ${taskId} falló: ${data.data.failMsg}`);
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  throw new Error(`kie.ai tarea ${taskId} superó el timeout de ${timeoutMs}ms`);
}

async function downloadTo(url: string, outputPath: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`No se pudo descargar ${url}: ${res.status}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buffer);
  return outputPath;
}

/**
 * Genera una ilustración con nano banana y la descarga a outputPath.
 * Por defecto usa 9:16 (regla de la plataforma AIVI).
 */
export async function generateImage(
  prompt: string,
  outputPath: string,
  options: GenerateImageOptions = {},
): Promise<string> {
  const taskId = await createTask(prompt, options);
  const [resultUrl] = await pollTask(taskId);
  if (!resultUrl) {
    throw new Error(`kie.ai tarea ${taskId} no devolvió ninguna URL de resultado`);
  }
  return downloadTo(resultUrl, outputPath);
}

/**
 * Sube una imagen local a kie.ai (hosting temporal, ~3 días) para poder
 * usarla como referencia en nano-banana-edit.
 */
export async function uploadImage(localPath: string, uploadPath = "aivi/uploads"): Promise<string> {
  const buffer = fs.readFileSync(localPath);
  const ext = path.extname(localPath).slice(1) || "jpg";
  const mime = ext === "png" ? "image/png" : "image/jpeg";
  const base64Data = `data:${mime};base64,${buffer.toString("base64")}`;

  const res = await fetch("https://kieai.redpandaai.co/api/file-base64-upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.kieAiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      base64Data,
      uploadPath,
      fileName: path.basename(localPath),
    }),
  });
  if (!res.ok) {
    throw new Error(`kie.ai uploadImage falló: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { data: { downloadUrl: string } };
  return data.data.downloadUrl;
}

/**
 * Edita/reubica una imagen de referencia (ej. un personaje) en una escena
 * nueva manteniendo su identidad visual, usando nano-banana-edit.
 */
export async function editImage(
  prompt: string,
  referenceImageUrls: string[],
  outputPath: string,
  options: GenerateImageOptions = {},
): Promise<string> {
  const taskId = await createTask(prompt, { ...options, model: "google/nano-banana-edit" }, referenceImageUrls);
  const [resultUrl] = await pollTask(taskId);
  if (!resultUrl) {
    throw new Error(`kie.ai tarea ${taskId} no devolvió ninguna URL de resultado`);
  }
  return downloadTo(resultUrl, outputPath);
}
