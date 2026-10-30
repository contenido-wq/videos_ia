import fs from "fs";
import path from "path";

const BASE_URL = "https://image.pollinations.ai/prompt";

export interface GeneratePollinationsImageOptions {
  width?: number;
  height?: number;
}

/**
 * Fallback gratuito y sin API key para cuando kie.ai se queda sin créditos.
 * Menor consistencia de estilo entre llamadas que nano-banana, pero sirve
 * para no bloquear el pipeline por falta de saldo.
 */
export async function generatePollinationsImage(
  prompt: string,
  outputPath: string,
  { width = 1024, height = 576 }: GeneratePollinationsImageOptions = {},
): Promise<string> {
  const seed = Math.floor(Math.random() * 1_000_000);
  const url = `${BASE_URL}/${encodeURIComponent(prompt)}?width=${width}&height=${height}&nologo=true&seed=${seed}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`pollinations.ai falló: ${res.status} ${await res.text()}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buffer);
  return outputPath;
}
