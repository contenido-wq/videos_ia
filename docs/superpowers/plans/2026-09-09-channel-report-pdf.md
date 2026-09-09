# Reporte de canal en PDF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `analyze:channel` deja de generar archivos sueltos y en su lugar produce un único `content/canales/<slug>/reporte.pdf` con portada, qué hace el canal, personaje, títulos más virales, disclaimer y metadatos.

**Architecture:** `youtubeService.ts` y `channelAnalysisService.ts` se extienden con los datos nuevos que necesita el reporte (banner, foto de perfil, métricas del canal, vistas por video, por qué funcionan los títulos más vistos); un servicio nuevo `channelReportPdfService.ts` arma el PDF con `jspdf`; `analyzeChannel.ts` orquesta todo y escribe el PDF final.

**Tech Stack:** TypeScript, tsx, vitest, YouTube Data API v3, Anthropic Messages API, kie.ai, `jspdf`.

**Spec:** `docs/superpowers/specs/2026-09-09-channel-report-pdf-design.md`

## Global Constraints

- El PDF reemplaza por completo `analisis.json`, `personaje.md`, `personaje.png` y `personaje-prompt.txt` — `analyze:channel` deja un único archivo de salida: `content/canales/<slug>/reporte.pdf`.
- "Títulos más virales" se ordena por `viewCount` en código, nunca pidiéndole a un LLM que ordene números.
- Diseño del PDF: funcional y legible, sin trabajo de marca — cajas de imagen de tamaño fijo (no se detecta el aspect ratio real de cada imagen).
- Si falla la descarga de una imagen (banner, foto de perfil, personaje), esa imagen puntual se omite — nunca aborta el resto del reporte.
- `jspdf` va en `dependencies` de `package.json`, no en `devDependencies`.

---

### Task 1: Agregar la dependencia `jspdf`

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json` (generado por `npm install`, no se edita a mano)

- [ ] **Step 1: Instalar la dependencia**

Run: `npm install jspdf@4.2.1 --save`
Expected: `package.json` gana `"jspdf": "^4.2.1"` (o el rango que agregue npm) dentro de `"dependencies"`, y `package-lock.json` se actualiza solo.

- [ ] **Step 2: Verificar que no rompe nada existente**

Run: `npm run lint`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add jspdf dependency for channel report PDF

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Y5ZwnTtT6vPq4GHh2VpJj7"
```

---

### Task 2: Extender `youtubeService.ts` con datos de branding/métricas y `selectTopVideosByViews`

**Files:**
- Modify: `src/services/youtubeService.ts`
- Modify: `src/services/youtubeService.test.ts`

**Interfaces:**
- Produces: `ChannelInfo` gana `description: string`, `profileImageUrl: string`, `bannerUrl: string | null`, `subscriberCount: number`, `viewCount: number`, `videoCount: number`, `publishedAt: string`, `country?: string`. `ChannelVideo` gana `viewCount: number`. Nueva función `selectTopVideosByViews(videos: ChannelVideo[], count: number): ChannelVideo[]` — consumida por Task 3.

- [ ] **Step 1: Escribir los tests nuevos que van a fallar**

En `src/services/youtubeService.test.ts`, cambiar la línea de import del inicio:

```ts
import { parseChannelInput, selectVideosForAnalysis, selectTopVideosByViews } from "./youtubeService";
import type { ChannelVideo } from "./youtubeService";
```

Y agregar, al final del archivo (después del último `describe`), este bloque nuevo:

```ts
describe("selectTopVideosByViews", () => {
  function video(overrides: Partial<ChannelVideo>): ChannelVideo {
    return {
      videoId: "v",
      title: "t",
      description: "",
      tags: [],
      publishedAt: "2026-01-01T00:00:00Z",
      thumbnailUrl: "https://example.com/thumb.jpg",
      viewCount: 0,
      ...overrides,
    };
  }

  it("ordena por vistas descendente y corta a count", () => {
    const videos = [
      video({ videoId: "a", viewCount: 10 }),
      video({ videoId: "b", viewCount: 100 }),
      video({ videoId: "c", viewCount: 50 }),
    ];

    const result = selectTopVideosByViews(videos, 2);

    expect(result.map((v) => v.videoId)).toEqual(["b", "c"]);
  });

  it("no rompe si count es mayor a la cantidad de videos", () => {
    const videos = [video({ videoId: "a", viewCount: 5 })];

    const result = selectTopVideosByViews(videos, 5);

    expect(result.map((v) => v.videoId)).toEqual(["a"]);
  });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run src/services/youtubeService.test.ts`
Expected: FAIL — `selectTopVideosByViews` no existe todavía, y los tests existentes fallan al fallar la importación del módulo (todo el archivo falla junto).

- [ ] **Step 3: Reemplazar `src/services/youtubeService.ts` completo por esta versión**

```ts
import { env } from "./env";

const BASE_URL = "https://www.googleapis.com/youtube/v3";
const RECENT_WINDOW_DAYS = 30;
const FALLBACK_VIDEO_COUNT = 10;

export interface ChannelInfo {
  channelId: string;
  title: string;
  handle?: string;
  uploadsPlaylistId: string;
  description: string;
  profileImageUrl: string;
  bannerUrl: string | null;
  subscriberCount: number;
  viewCount: number;
  videoCount: number;
  publishedAt: string;
  country?: string;
}

export interface ChannelVideo {
  videoId: string;
  title: string;
  description: string;
  tags: string[];
  publishedAt: string;
  thumbnailUrl: string;
  viewCount: number;
}

export interface ChannelVideosResult {
  videos: ChannelVideo[];
  usedFallback: boolean;
}

export interface ParsedChannelInput {
  forHandle?: string;
  id?: string;
  forUsername?: string;
}

export interface PlaylistItemRef {
  videoId: string;
  publishedAt: string;
}

export function parseChannelInput(input: string): ParsedChannelInput {
  const trimmed = input.trim();

  const handleMatch = trimmed.match(/(?:youtube\.com\/)?@([\w.-]+)/i);
  if (handleMatch) {
    return { forHandle: handleMatch[1] };
  }

  const channelIdMatch = trimmed.match(/(?:youtube\.com\/channel\/)?(UC[\w-]{22})/);
  if (channelIdMatch) {
    return { id: channelIdMatch[1] };
  }

  const userMatch = trimmed.match(/youtube\.com\/user\/([\w-]+)/i);
  if (userMatch) {
    return { forUsername: userMatch[1] };
  }

  const customMatch = trimmed.match(/youtube\.com\/c\/([\w-]+)/i);
  if (customMatch) {
    return { forUsername: customMatch[1] };
  }

  return { forUsername: trimmed };
}

export function selectVideosForAnalysis(
  items: PlaylistItemRef[],
  now: Date,
): { selected: PlaylistItemRef[]; usedFallback: boolean } {
  const cutoff = new Date(now.getTime() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const recent = items.filter((item) => new Date(item.publishedAt) >= cutoff);

  if (recent.length > 0) {
    return { selected: recent, usedFallback: false };
  }
  return { selected: items.slice(0, FALLBACK_VIDEO_COUNT), usedFallback: true };
}

export function selectTopVideosByViews(videos: ChannelVideo[], count: number): ChannelVideo[] {
  return [...videos].sort((a, b) => b.viewCount - a.viewCount).slice(0, count);
}

async function fetchChannelInfo(parsed: ParsedChannelInput): Promise<ChannelInfo | null> {
  const params = new URLSearchParams({
    part: "snippet,contentDetails,brandingSettings,statistics",
    key: env.youtubeApiKey,
  });
  if (parsed.forHandle) params.set("forHandle", parsed.forHandle);
  else if (parsed.id) params.set("id", parsed.id);
  else if (parsed.forUsername) params.set("forUsername", parsed.forUsername);
  else return null;

  const res = await fetch(`${BASE_URL}/channels?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`YouTube channels.list falló: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as {
    items: {
      id: string;
      snippet: {
        title: string;
        customUrl?: string;
        description: string;
        thumbnails: { high?: { url: string }; default: { url: string } };
        publishedAt: string;
        country?: string;
      };
      contentDetails: { relatedPlaylists: { uploads: string } };
      brandingSettings?: { image?: { bannerExternalUrl?: string } };
      statistics: { subscriberCount: string; viewCount: string; videoCount: string };
    }[];
  };
  const item = data.items[0];
  if (!item) return null;

  return {
    channelId: item.id,
    title: item.snippet.title,
    handle: item.snippet.customUrl,
    uploadsPlaylistId: item.contentDetails.relatedPlaylists.uploads,
    description: item.snippet.description,
    profileImageUrl: item.snippet.thumbnails.high?.url ?? item.snippet.thumbnails.default.url,
    bannerUrl: item.brandingSettings?.image?.bannerExternalUrl ?? null,
    subscriberCount: Number(item.statistics.subscriberCount),
    viewCount: Number(item.statistics.viewCount),
    videoCount: Number(item.statistics.videoCount),
    publishedAt: item.snippet.publishedAt,
    country: item.snippet.country,
  };
}

async function searchChannelIdByName(name: string): Promise<string | null> {
  const params = new URLSearchParams({
    part: "snippet",
    type: "channel",
    q: name,
    maxResults: "1",
    key: env.youtubeApiKey,
  });
  const res = await fetch(`${BASE_URL}/search?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`YouTube search.list falló: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { items: { snippet: { channelId: string } }[] };
  return data.items[0]?.snippet.channelId ?? null;
}

export async function resolveChannel(input: string): Promise<ChannelInfo> {
  const parsed = parseChannelInput(input);

  let info = await fetchChannelInfo(parsed);
  if (!info && parsed.forUsername) {
    const channelId = await searchChannelIdByName(parsed.forUsername);
    if (channelId) {
      info = await fetchChannelInfo({ id: channelId });
    }
  }

  if (!info) {
    throw new Error(`No se encontró el canal de YouTube para "${input}"`);
  }
  return info;
}

async function fetchVideoDetails(videoIds: string[]): Promise<ChannelVideo[]> {
  const params = new URLSearchParams({
    part: "snippet,statistics",
    id: videoIds.join(","),
    key: env.youtubeApiKey,
  });
  const res = await fetch(`${BASE_URL}/videos?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`YouTube videos.list falló: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as {
    items: {
      id: string;
      snippet: {
        title: string;
        description: string;
        tags?: string[];
        publishedAt: string;
        thumbnails: { high?: { url: string }; default: { url: string } };
      };
      statistics: { viewCount: string };
    }[];
  };

  return data.items.map((item) => ({
    videoId: item.id,
    title: item.snippet.title,
    description: item.snippet.description,
    tags: item.snippet.tags ?? [],
    publishedAt: item.snippet.publishedAt,
    thumbnailUrl: item.snippet.thumbnails.high?.url ?? item.snippet.thumbnails.default.url,
    viewCount: Number(item.statistics.viewCount),
  }));
}

export async function listRecentVideos(channel: ChannelInfo): Promise<ChannelVideosResult> {
  const params = new URLSearchParams({
    part: "contentDetails",
    playlistId: channel.uploadsPlaylistId,
    maxResults: "50",
    key: env.youtubeApiKey,
  });
  const res = await fetch(`${BASE_URL}/playlistItems?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`YouTube playlistItems.list falló: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as {
    items: { contentDetails: { videoId: string; videoPublishedAt: string } }[];
  };

  const refs: PlaylistItemRef[] = data.items.map((item) => ({
    videoId: item.contentDetails.videoId,
    publishedAt: item.contentDetails.videoPublishedAt,
  }));

  if (refs.length === 0) {
    throw new Error(`El canal "${channel.title}" no tiene ningún video`);
  }

  const { selected, usedFallback } = selectVideosForAnalysis(refs, new Date());
  const videos = await fetchVideoDetails(selected.map((v) => v.videoId));
  return { videos, usedFallback };
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run src/services/youtubeService.test.ts`
Expected: PASS (11 tests: los 9 de antes + los 2 nuevos de `selectTopVideosByViews`).

- [ ] **Step 5: Verificar que compila**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add src/services/youtubeService.ts src/services/youtubeService.test.ts
git commit -m "feat: add channel branding/stats and selectTopVideosByViews to youtubeService

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Y5ZwnTtT6vPq4GHh2VpJj7"
```

---

### Task 3: Extender `channelAnalysisService.ts` con `viralTitles`

**Files:**
- Modify: `src/services/channelAnalysisService.ts`
- Create: `src/services/channelAnalysisService.test.ts`

**Interfaces:**
- Consumes: `selectTopVideosByViews` (Task 2).
- Produces: `ViralTitleInsight { title: string; viewCount: number; reason: string }`; `ChannelAnalysisResult` gana `viralTitles: ViralTitleInsight[]`; `matchViralTitleReasons(topByViews: ChannelVideo[], rawReasons: { title: string; reason: string }[]): ViralTitleInsight[]` — consumida por Task 5 indirectamente (vía `analyzeChannel`).

- [ ] **Step 1: Escribir el test que va a fallar**

Crear `src/services/channelAnalysisService.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { matchViralTitleReasons } from "./channelAnalysisService";
import type { ChannelVideo } from "./youtubeService";

function video(overrides: Partial<ChannelVideo>): ChannelVideo {
  return {
    videoId: "v",
    title: "Título",
    description: "",
    tags: [],
    publishedAt: "2026-01-01T00:00:00Z",
    thumbnailUrl: "https://example.com/thumb.jpg",
    viewCount: 0,
    ...overrides,
  };
}

describe("matchViralTitleReasons", () => {
  it("matchea cada video con su razón por título exacto, sin importar el orden", () => {
    const topByViews = [video({ title: "Título A", viewCount: 100 }), video({ title: "Título B", viewCount: 50 })];
    const rawReasons = [
      { title: "Título B", reason: "Razón B" },
      { title: "Título A", reason: "Razón A" },
    ];

    const result = matchViralTitleReasons(topByViews, rawReasons);

    expect(result).toEqual([
      { title: "Título A", viewCount: 100, reason: "Razón A" },
      { title: "Título B", viewCount: 50, reason: "Razón B" },
    ]);
  });

  it("deja reason vacío si no hay match para un título", () => {
    const topByViews = [video({ title: "Título A", viewCount: 100 })];
    const rawReasons: { title: string; reason: string }[] = [];

    const result = matchViralTitleReasons(topByViews, rawReasons);

    expect(result).toEqual([{ title: "Título A", viewCount: 100, reason: "" }]);
  });

  it("ignora razones devueltas que no matchean ningún video de la lista", () => {
    const topByViews = [video({ title: "Título A", viewCount: 100 })];
    const rawReasons = [{ title: "Título Inventado", reason: "no debería usarse" }];

    const result = matchViralTitleReasons(topByViews, rawReasons);

    expect(result).toEqual([{ title: "Título A", viewCount: 100, reason: "" }]);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/services/channelAnalysisService.test.ts`
Expected: FAIL — `matchViralTitleReasons` no existe todavía.

- [ ] **Step 3: Reemplazar `src/services/channelAnalysisService.ts` completo por esta versión**

```ts
import { env } from "./env";
import type { ChannelVideo } from "./youtubeService";
import { selectTopVideosByViews } from "./youtubeService";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-5";
const TOOL_NAME = "report_channel_analysis";
const MAX_THUMBNAILS = 5;
const DESCRIPTION_EXCERPT_LENGTH = 300;
const TOP_VIRAL_TITLES_COUNT = 5;

export interface ChannelCharacter {
  present: boolean;
  description: string | null;
}

export interface ViralTitleInsight {
  title: string;
  viewCount: number;
  reason: string;
}

export interface ChannelAnalysisResult {
  topics: string[];
  character: ChannelCharacter;
  disclaimer: string;
  viralTitles: ViralTitleInsight[];
}

interface RawAnalysis {
  topics: string[];
  character: { present: boolean; description?: string };
  disclaimer: string;
  viralTitleReasons: { title: string; reason: string }[];
}

export function matchViralTitleReasons(
  topByViews: ChannelVideo[],
  rawReasons: { title: string; reason: string }[],
): ViralTitleInsight[] {
  return topByViews.map((video) => ({
    title: video.title,
    viewCount: video.viewCount,
    reason: rawReasons.find((r) => r.title === video.title)?.reason ?? "",
  }));
}

function buildPrompt(videos: ChannelVideo[], topByViews: ChannelVideo[]): string {
  const videoSummaries = videos
    .map((v, i) => {
      const excerpt = v.description.slice(0, DESCRIPTION_EXCERPT_LENGTH).replace(/\n/g, " ");
      return `${i + 1}. "${v.title}"\n   Descripción: ${excerpt}\n   Tags: ${v.tags.join(", ") || "(sin tags)"}`;
    })
    .join("\n\n");

  const topTitlesList = topByViews.map((v, i) => `${i + 1}. "${v.title}" (${v.viewCount} vistas)`).join("\n");

  return `Estos son los videos recientes de un canal de YouTube. Te muestro también las miniaturas de algunos de ellos como imágenes adjuntas.

${videoSummaries}

Tu tarea, usando tanto el texto como las miniaturas:

1. "topics": los 3 a 8 temas o ángulos recurrentes del canal (en el mismo idioma que usan los títulos/descripciones).

2. "character": si las miniaturas muestran un personaje/avatar visual que se repite de forma reconocible en varios videos (mismo diseño de ilustración, no personas reales distintas en cada foto), poné "present": true y en "description" una descripción detallada y reutilizable de su apariencia (edad aproximada, pelo, expresión característica, vestuario, estilo de ilustración — plano/vector/realista/etc.) para poder recrearlo consistentemente en imágenes futuras. Si no hay ningún personaje recurrente (son fotos reales variadas, o miniaturas sin personaje), poné "present": false y omití "description".

3. "disclaimer": un texto breve (2-3 oraciones), en el mismo idioma del canal, para usar en la descripción de los videos, alineado con la política de YouTube de "contenido alterado o sintético": debe advertir con honestidad que el contenido (ilustraciones/voz/edición) puede estar generado o alterado con IA, sin sonar genérico ni robótico.

4. "viralTitleReasons": estos son los títulos con más vistas de la muestra, ya ordenados:
${topTitlesList}
Para cada uno, usando el texto EXACTO del título tal como aparece arriba (campo "title"), explicá en 1-2 oraciones por qué funciona / qué patrón de título sigue (campo "reason"). Devolvé una entrada por cada título de la lista, en cualquier orden, pero con el texto del título copiado exactamente tal como aparece arriba.`;
}

export async function analyzeChannel(videos: ChannelVideo[]): Promise<ChannelAnalysisResult> {
  const topByViews = selectTopVideosByViews(videos, TOP_VIRAL_TITLES_COUNT);
  const imageBlocks = videos.slice(0, MAX_THUMBNAILS).map((v) => ({
    type: "image",
    source: { type: "url", url: v.thumbnailUrl },
  }));

  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": env.anthropicApiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      output_config: { effort: "medium" },
      tool_choice: { type: "tool", name: TOOL_NAME },
      tools: [
        {
          name: TOOL_NAME,
          description:
            "Reporta los temas recurrentes, el personaje visual (si existe), un disclaimer de contenido sintético y por qué funcionan los títulos más vistos de este canal.",
          strict: true,
          input_schema: {
            type: "object",
            properties: {
              topics: {
                type: "array",
                items: { type: "string" },
                description: "Temas o ángulos recurrentes del canal",
              },
              character: {
                type: "object",
                properties: {
                  present: { type: "boolean" },
                  description: { type: "string" },
                },
                required: ["present"],
                additionalProperties: false,
              },
              disclaimer: { type: "string" },
              viralTitleReasons: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    reason: { type: "string" },
                  },
                  required: ["title", "reason"],
                  additionalProperties: false,
                },
              },
            },
            required: ["topics", "character", "disclaimer", "viralTitleReasons"],
            additionalProperties: false,
          },
        },
      ],
      messages: [
        {
          role: "user",
          content: [...imageBlocks, { type: "text", text: buildPrompt(videos, topByViews) }],
        },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`Anthropic analyzeChannel falló: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as {
    stop_reason: string;
    content: { type: string; name?: string; input?: RawAnalysis }[];
  };

  if (data.stop_reason === "refusal") {
    throw new Error("Anthropic rechazó la solicitud de análisis de canal (safety refusal)");
  }

  const toolUse = data.content.find((b) => b.type === "tool_use" && b.name === TOOL_NAME);
  if (!toolUse?.input) {
    throw new Error("Anthropic no devolvió un tool_use válido para el análisis de canal");
  }

  const raw = toolUse.input;
  return {
    topics: raw.topics,
    character: {
      present: raw.character.present,
      description: raw.character.present ? raw.character.description ?? null : null,
    },
    disclaimer: raw.disclaimer,
    viralTitles: matchViralTitleReasons(topByViews, raw.viralTitleReasons),
  };
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/services/channelAnalysisService.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Verificar que compila**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add src/services/channelAnalysisService.ts src/services/channelAnalysisService.test.ts
git commit -m "feat: add viral title insights to channelAnalysisService

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Y5ZwnTtT6vPq4GHh2VpJj7"
```

---

### Task 4: `channelReportPdfService.ts` — armar el PDF

**Files:**
- Create: `src/services/channelReportPdfService.ts`

**Interfaces:**
- Consumes: `ChannelInfo` (Task 2); `ChannelAnalysisResult` (Task 3).
- Produces: `interface ChannelReportData { channel: ChannelInfo; analysis: ChannelAnalysisResult; characterImageBuffer: Buffer | null; characterImagePrompt: string | null }`; `buildChannelReportPdf(data: ChannelReportData): Promise<Buffer>` — consumida por Task 5.

Sin tests unitarios en este task (generación binaria + descargas de red — mismo criterio que el resto de los servicios de este proyecto). Se valida en el Task 6 abriendo el PDF generado contra un canal real.

- [ ] **Step 1: Crear `src/services/channelReportPdfService.ts`**

```ts
import { jsPDF } from "jspdf";
import type { ChannelInfo } from "./youtubeService";
import type { ChannelAnalysisResult } from "./channelAnalysisService";

const PAGE_MARGIN = 15;
const CONTENT_WIDTH = 180;
const PAGE_BOTTOM = 280;

export interface ChannelReportData {
  channel: ChannelInfo;
  analysis: ChannelAnalysisResult;
  characterImageBuffer: Buffer | null;
  characterImagePrompt: string | null;
}

interface FetchedImage {
  data: string;
  format: "JPEG" | "PNG";
}

async function fetchImageAsBase64(url: string): Promise<FetchedImage | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    const format: "JPEG" | "PNG" = url.toLowerCase().includes(".png") ? "PNG" : "JPEG";
    return { data: buffer.toString("base64"), format };
  } catch {
    return null;
  }
}

function ensureSpace(doc: jsPDF, y: number, neededHeight: number): number {
  if (y + neededHeight > PAGE_BOTTOM) {
    doc.addPage();
    return PAGE_MARGIN;
  }
  return y;
}

function addSectionTitle(doc: jsPDF, text: string, y: number): number {
  const startY = ensureSpace(doc, y, 15);
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(text, PAGE_MARGIN, startY);
  doc.setFont("helvetica", "normal");
  return startY + 10;
}

function addWrappedText(doc: jsPDF, text: string, y: number, fontSize = 11): number {
  doc.setFontSize(fontSize);
  const lines = doc.splitTextToSize(text, CONTENT_WIDTH) as string[];
  const lineHeight = fontSize * 0.42;
  const blockHeight = lines.length * lineHeight;
  const startY = ensureSpace(doc, y, blockHeight);
  doc.text(lines, PAGE_MARGIN, startY);
  return startY + blockHeight + 6;
}

export async function buildChannelReportPdf(data: ChannelReportData): Promise<Buffer> {
  const { channel, analysis, characterImageBuffer, characterImagePrompt } = data;
  const doc = new jsPDF();
  let y = PAGE_MARGIN;

  // 1. Portada
  doc.setFontSize(24);
  doc.setFont("helvetica", "bold");
  doc.text(channel.title, PAGE_MARGIN, y + 10);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  doc.text(channel.handle ?? channel.channelId, PAGE_MARGIN, y + 20);
  y += 30;

  const banner = channel.bannerUrl ? await fetchImageAsBase64(channel.bannerUrl) : null;
  if (banner) {
    doc.addImage(`data:image/${banner.format.toLowerCase()};base64,${banner.data}`, banner.format, PAGE_MARGIN, y, CONTENT_WIDTH, 70);
    y += 78;
  }

  const profile = await fetchImageAsBase64(channel.profileImageUrl);
  if (profile) {
    doc.addImage(`data:image/${profile.format.toLowerCase()};base64,${profile.data}`, profile.format, PAGE_MARGIN, y, 30, 30);
    y += 38;
  }

  // 2. Qué hace el canal
  doc.addPage();
  y = PAGE_MARGIN;
  y = addSectionTitle(doc, "Qué hace el canal", y);
  y = addWrappedText(doc, channel.description || "(el canal no tiene descripción configurada)", y);
  y = ensureSpace(doc, y, 20);
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Temas recurrentes:", PAGE_MARGIN, y);
  doc.setFont("helvetica", "normal");
  y += 8;
  y = addWrappedText(doc, analysis.topics.map((t) => `• ${t}`).join("\n"), y);

  // 3. Personaje
  doc.addPage();
  y = PAGE_MARGIN;
  y = addSectionTitle(doc, "Personaje", y);
  if (analysis.character.present && analysis.character.description) {
    if (characterImageBuffer) {
      const base64 = characterImageBuffer.toString("base64");
      y = ensureSpace(doc, y, 88);
      doc.addImage(`data:image/png;base64,${base64}`, "PNG", PAGE_MARGIN, y, 120, 80);
      y += 88;
    } else {
      y = addWrappedText(doc, "(no se pudo generar la imagen — usá el prompt de abajo para generarla manualmente)", y);
    }
    y = addWrappedText(doc, analysis.character.description, y);
    if (characterImagePrompt) {
      y = ensureSpace(doc, y, 16);
      doc.setFont("helvetica", "bold");
      doc.text("Prompt para regenerar la imagen:", PAGE_MARGIN, y);
      doc.setFont("helvetica", "normal");
      y += 8;
      y = addWrappedText(doc, characterImagePrompt, y, 9);
    }
    y = addWrappedText(
      doc,
      "Esta imagen fue generada a partir de las miniaturas reales de este canal. Si el canal no es tuyo, es solo referencia interna de moodboard — no publiques esta imagen ni una copia visualmente idéntica; usala para inspirarte en un personaje propio y distinto.",
      y,
      9,
    );
  } else {
    y = addWrappedText(doc, "Este canal no muestra un personaje visual consistente en la muestra analizada.", y);
  }

  // 4. Títulos más virales
  doc.addPage();
  y = PAGE_MARGIN;
  y = addSectionTitle(doc, "Títulos más virales", y);
  for (const insight of analysis.viralTitles) {
    y = addWrappedText(doc, `"${insight.title}" — ${insight.viewCount.toLocaleString("es")} vistas`, y, 12);
    y = addWrappedText(doc, insight.reason || "(sin explicación disponible)", y, 10);
  }

  // 5. Disclaimer
  doc.addPage();
  y = PAGE_MARGIN;
  y = addSectionTitle(doc, "Disclaimer sugerido", y);
  y = addWrappedText(doc, analysis.disclaimer, y);
  y = addWrappedText(
    doc,
    'Este texto complementa la descripción del video, pero NO reemplaza activar el toggle "Contenido alterado o sintético" en YouTube Studio al subir el video.',
    y,
    9,
  );

  // 6. Metadatos del canal
  doc.addPage();
  y = PAGE_MARGIN;
  y = addSectionTitle(doc, "Metadatos del canal", y);
  const createdDate = new Date(channel.publishedAt).toLocaleDateString("es");
  const metadataLines = [
    `Suscriptores: ${channel.subscriberCount.toLocaleString("es")}`,
    `Vistas totales: ${channel.viewCount.toLocaleString("es")}`,
    `Cantidad de videos: ${channel.videoCount.toLocaleString("es")}`,
    `Canal creado: ${createdDate}`,
    `País: ${channel.country ?? "No especificado"}`,
  ].join("\n");
  y = addWrappedText(doc, metadataLines, y);

  const arrayBuffer = doc.output("arraybuffer");
  return Buffer.from(arrayBuffer);
}
```

- [ ] **Step 2: Verificar que compila**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/services/channelReportPdfService.ts
git commit -m "feat: add channelReportPdfService to build the channel report PDF

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Y5ZwnTtT6vPq4GHh2VpJj7"
```

---

### Task 5: Reescribir `analyzeChannel.ts` para producir el PDF

**Files:**
- Modify: `src/services/analyzeChannel.ts`

**Interfaces:**
- Consumes: `buildChannelReportPdf` (Task 4); `resolveChannel`/`listRecentVideos` (ya existían); `analyzeChannel` de `channelAnalysisService.ts` (ya existía, ahora devuelve también `viralTitles`); `editImage` de `kieAiService.ts` (ya existía).

- [ ] **Step 1: Reemplazar `src/services/analyzeChannel.ts` completo por esta versión**

```ts
import fs from "fs";
import os from "os";
import path from "path";
import { resolveChannel, listRecentVideos } from "./youtubeService";
import { analyzeChannel as analyzeChannelWithClaude } from "./channelAnalysisService";
import { editImage } from "./kieAiService";
import { buildChannelReportPdf } from "./channelReportPdfService";

const CHARACTER_REFERENCE_COUNT = 3;

function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildCharacterImagePrompt(description: string): string {
  return `Full-body character reference sheet of this exact recurring animated character: ${description}. Neutral standing pose, front-facing, arms relaxed at sides, plain flat light-gray background, no text, no other characters, no props.`;
}

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error("Uso: npm run analyze:channel -- <url-o-@handle-del-canal>");
    process.exit(1);
  }

  console.log(`Resolviendo canal "${input}"...`);
  const channel = await resolveChannel(input);
  console.log(`Canal: ${channel.title} (${channel.channelId})`);

  console.log("Listando videos recientes...");
  const { videos, usedFallback } = await listRecentVideos(channel);
  console.log(
    `${videos.length} videos analizados${
      usedFallback ? " (sin videos en los últimos 30 días, se usaron los más recientes)" : ""
    }.`,
  );

  console.log("Analizando temas, personaje y títulos con Claude...");
  const analysis = await analyzeChannelWithClaude(videos);

  let characterImageBuffer: Buffer | null = null;
  let characterImagePrompt: string | null = null;
  if (analysis.character.present && analysis.character.description) {
    characterImagePrompt = buildCharacterImagePrompt(analysis.character.description);
    const referenceUrls = videos.slice(0, CHARACTER_REFERENCE_COUNT).map((v) => v.thumbnailUrl);
    const tempImagePath = path.join(os.tmpdir(), `personaje-${Date.now()}.png`);

    console.log("Generando imagen de referencia del personaje...");
    try {
      await editImage(characterImagePrompt, referenceUrls, tempImagePath, { aspectRatio: "3:2" });
      characterImageBuffer = fs.readFileSync(tempImagePath);
      fs.unlinkSync(tempImagePath);
    } catch (err) {
      console.error("No se pudo generar la imagen del personaje:", (err as Error).message);
    }
  }

  console.log("Armando el PDF del reporte...");
  const pdfBuffer = await buildChannelReportPdf({
    channel,
    analysis,
    characterImageBuffer,
    characterImagePrompt,
  });

  const slug = slugify(channel.title);
  const outputDir = path.join("content", "canales", slug);
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, "reporte.pdf");
  fs.writeFileSync(outputPath, pdfBuffer);

  console.log(`\nListo. Reporte guardado en ${outputPath}`);
  console.log(`\nTemas encontrados: ${analysis.topics.join(", ")}`);
}

main().catch((err) => {
  console.error("FALLÓ:", err.message);
  process.exit(1);
});
```

- [ ] **Step 2: Verificar que compila**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/services/analyzeChannel.ts
git commit -m "feat: generate a single PDF report from analyze:channel

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Y5ZwnTtT6vPq4GHh2VpJj7"
```

---

### Task 6: Verificación end-to-end contra un canal real

**Files:** ninguno nuevo — solo verificación.

- [ ] **Step 1: Correr toda la suite de tests**

Run: `npm test`
Expected: todos los tests pasan (los existentes + los `11 + 3` nuevos de `youtubeService.test.ts`/`channelAnalysisService.test.ts`).

- [ ] **Step 2: Correr el lint completo**

Run: `npm run lint`
Expected: sin errores de eslint ni de tsc.

- [ ] **Step 3: Correr el comando real contra un canal**

Run: `npm run analyze:channel -- https://www.youtube.com/@TheCapitalExplained`
Expected: termina sin error, imprime el resumen de temas, y crea únicamente `content/canales/capital-explained/reporte.pdf` (ningún `.json`/`.md`/`.png`/`.txt` suelto).

- [ ] **Step 4: Abrir e inspeccionar el PDF**

Leer `content/canales/capital-explained/reporte.pdf` y confirmar que las 6 secciones existen, tienen contenido coherente con el canal, las imágenes (banner/perfil/personaje, las que hayan podido descargarse/generarse) se ven razonablemente bien ubicadas, y no hay texto cortado a la mitad entre páginas.

- [ ] **Step 5: Decidir si el resultado de prueba se commitea**

Es contenido de un canal de terceros generado solo para validar el pipeline — no debe quedar commiteado. Borrarlo:

```bash
rm -rf content/canales/capital-explained
```

- [ ] **Step 6: Confirmar el estado final de git**

Run: `git status`
Expected: working tree limpio salvo el cambio preexistente y no relacionado en `src/services/ai33Service.ts` (pendiente de una conversación anterior, fuera del alcance de este plan).
