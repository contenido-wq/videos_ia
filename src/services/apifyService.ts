import fs from "fs";
import path from "path";
import { env } from "./env";

const BASE_URL = "https://api.apify.com/v2";

export interface GoogleImageResult {
  title?: string;
  image?: string;
  link?: string;
  domain?: string;
  [key: string]: unknown;
}

/**
 * Corre la tarea de Google Images Scraper (actor easyapi/google-images-scraper)
 * de forma síncrona y devuelve los items del dataset directamente.
 */
export async function searchGoogleImages(
  query: string,
  overrides: Record<string, unknown> = {},
): Promise<GoogleImageResult[]> {
  const url = `${BASE_URL}/actor-tasks/${env.apifyGoogleImagesTask}/run-sync-get-dataset-items?token=${env.apifyApiToken}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, maxItems: 100, ...overrides }),
  });

  if (!res.ok) {
    throw new Error(`Apify searchGoogleImages falló: ${res.status} ${await res.text()}`);
  }

  return (await res.json()) as GoogleImageResult[];
}

export async function downloadImageFromUrl(url: string, outputPath: string): Promise<string> {
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
 * Busca en Apify y devuelve hasta `count` URLs de imágenes reales distintas.
 * Úsalo solo para actores/logos/fotos reales que no se puedan recrear con IA.
 */
export async function findRealImageUrls(query: string, count: number): Promise<string[]> {
  const results = await searchGoogleImages(query);
  const urls = results
    .map((r) => r.image)
    .filter((url): url is string => typeof url === "string" && url.startsWith("http"));

  if (urls.length === 0) {
    throw new Error(`Apify no devolvió ninguna imagen real para "${query}"`);
  }

  const unique = Array.from(new Set(urls));
  const picked: string[] = [];
  for (let i = 0; i < count; i++) {
    picked.push(unique[i % unique.length]);
  }
  return picked;
}

/**
 * Busca en Apify y descarga la primera imagen real válida a outputPath.
 */
export async function downloadRealImage(query: string, outputPath: string): Promise<string> {
  const [url] = await findRealImageUrls(query, 1);
  return downloadImageFromUrl(url, outputPath);
}

export async function getAccountInfo(): Promise<{ username: string; plan: string }> {
  const res = await fetch(`${BASE_URL}/users/me?token=${env.apifyApiToken}`);
  if (!res.ok) {
    throw new Error(`Apify getAccountInfo falló: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { data: { username: string; plan: { id: string } } };
  return { username: data.data.username, plan: data.data.plan.id };
}
