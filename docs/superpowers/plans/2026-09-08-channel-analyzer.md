# Analizador de canal + referencia de personaje Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dado el link/handle de un canal de YouTube, generar automáticamente su análisis de temas recurrentes, la referencia visual+escrita de su personaje (si existe) y un disclaimer de contenido sintético, guardando todo en `content/canales/<slug>/`.

**Architecture:** Un servicio nuevo (`youtubeService.ts`) resuelve el canal y trae sus videos recientes vía YouTube Data API v3; otro (`channelAnalysisService.ts`) le pasa esos datos + thumbnails a Claude (Anthropic Messages API, tool use) para extraer temas/personaje/disclaimer; un script CLI (`analyzeChannel.ts`) orquesta ambos, genera la imagen de referencia con `kieAiService.editImage` (ya existente) y escribe los archivos de salida.

**Tech Stack:** TypeScript, tsx (ejecución de scripts), vitest (tests), YouTube Data API v3, Anthropic Messages API, kie.ai (`google/nano-banana-edit`).

**Spec:** `docs/superpowers/specs/2026-09-08-channel-analyzer-design.md`

## Global Constraints

- Fuente de datos del canal: exclusivamente YouTube Data API v3 (nada de scraping).
- Ventana de análisis: videos publicados en los últimos 30 días; si no hay ninguno, usar los últimos 10 del canal y marcar `usedFallback: true`.
- `personaje.md` debe incluir siempre la nota de copyright/moodboard (ver spec, sección "Salvaguardas", punto 1) cuando `character.present` es true.
- `analisis.json` debe incluir siempre `disclaimerNote` recordando que el disclaimer no reemplaza el toggle "Contenido alterado o sintético" de YouTube Studio.
- Nunca loguear ni imprimir el valor de ninguna API key.
- Seguir el estilo existente del repo: comillas dobles, `fetch` nativo, errores explícitos con `throw new Error(...)` incluyendo status + body de la respuesta fallida (mismo patrón que `ai33Service.ts`/`retakeDetectionService.ts`).

---

### Task 1: Variable de entorno `YOUTUBE_API_KEY`

**Files:**
- Modify: `src/services/env.ts`
- Modify: `.env.example`
- Modify: `README.md`

**Interfaces:**
- Produces: `env.youtubeApiKey: string` (getter, lanza si falta la variable — mismo patrón que `env.anthropicApiKey`).

- [ ] **Step 1: Agregar el getter a `env.ts`**

En `src/services/env.ts`, agregar dentro del objeto `env`, junto a los demás getters:

```ts
  get youtubeApiKey() {
    return required("YOUTUBE_API_KEY");
  },
```

- [ ] **Step 2: Agregar la variable a `.env.example`**

Agregar, después del bloque de `ANTHROPIC_API_KEY` (o donde tenga sentido cronológico), esta entrada:

```
# Requerida por el analizador de canal — trae videos/metadatos de un canal
# de YouTube (channels.list, playlistItems.list, videos.list)
YOUTUBE_API_KEY=
```

- [ ] **Step 3: Agregar la fila a la tabla del README**

En `README.md`, en la tabla de variables de entorno, agregar una fila:

```
| `YOUTUBE_API_KEY` | Trae videos/metadatos de un canal de YouTube | Vas a correr `npm run analyze:channel` |
```

- [ ] **Step 4: Verificar que compila**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add src/services/env.ts .env.example README.md
git commit -m "feat: add YOUTUBE_API_KEY env var for channel analyzer

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Y5ZwnTtT6vPq4GHh2VpJj7"
```

---

### Task 2: `youtubeService.ts` — resolver canal y listar videos recientes

**Files:**
- Create: `src/services/youtubeService.ts`
- Test: `src/services/youtubeService.test.ts`

**Interfaces:**
- Consumes: `env.youtubeApiKey` (de Task 1).
- Produces:
  - `parseChannelInput(input: string): { forHandle?: string; id?: string; forUsername?: string }`
  - `selectVideosForAnalysis(items: { videoId: string; publishedAt: string }[], now: Date): { selected: { videoId: string; publishedAt: string }[]; usedFallback: boolean }`
  - `interface ChannelInfo { channelId: string; title: string; handle?: string; uploadsPlaylistId: string }`
  - `interface ChannelVideo { videoId: string; title: string; description: string; tags: string[]; publishedAt: string; thumbnailUrl: string }`
  - `interface ChannelVideosResult { videos: ChannelVideo[]; usedFallback: boolean }`
  - `resolveChannel(input: string): Promise<ChannelInfo>`
  - `listRecentVideos(channel: ChannelInfo): Promise<ChannelVideosResult>`
  - Estas dos últimas son consumidas por Task 4.

- [ ] **Step 1: Escribir los tests que van a fallar**

Crear `src/services/youtubeService.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseChannelInput, selectVideosForAnalysis } from "./youtubeService";

describe("parseChannelInput", () => {
  it("reconoce un @handle suelto", () => {
    expect(parseChannelInput("@TheCapitalExplained")).toEqual({ forHandle: "TheCapitalExplained" });
  });

  it("reconoce un @handle dentro de una URL", () => {
    expect(parseChannelInput("https://www.youtube.com/@TheCapitalExplained")).toEqual({
      forHandle: "TheCapitalExplained",
    });
  });

  it("reconoce una URL /channel/UCxxxx", () => {
    expect(parseChannelInput("https://www.youtube.com/channel/UC6vaWd0dpXVzU_D4jeeSAQg")).toEqual({
      id: "UC6vaWd0dpXVzU_D4jeeSAQg",
    });
  });

  it("reconoce un channelId crudo", () => {
    expect(parseChannelInput("UC6vaWd0dpXVzU_D4jeeSAQg")).toEqual({ id: "UC6vaWd0dpXVzU_D4jeeSAQg" });
  });

  it("reconoce una URL legacy /user/", () => {
    expect(parseChannelInput("https://www.youtube.com/user/SomeUser")).toEqual({ forUsername: "SomeUser" });
  });

  it("reconoce una URL legacy /c/", () => {
    expect(parseChannelInput("https://www.youtube.com/c/SomeCustomName")).toEqual({
      forUsername: "SomeCustomName",
    });
  });

  it("trata texto plano sin @ ni URL como username", () => {
    expect(parseChannelInput("SomeChannelName")).toEqual({ forUsername: "SomeChannelName" });
  });
});

describe("selectVideosForAnalysis", () => {
  const now = new Date("2026-09-08T00:00:00Z");

  it("selecciona los videos publicados en los últimos 30 días", () => {
    const items = [
      { videoId: "a", publishedAt: "2026-08-26T09:07:29Z" },
      { videoId: "b", publishedAt: "2026-06-01T00:00:00Z" },
    ];
    const result = selectVideosForAnalysis(items, now);
    expect(result).toEqual({ selected: [items[0]], usedFallback: false });
  });

  it("cae a los últimos 10 si no hay ninguno en los últimos 30 días", () => {
    const items = Array.from({ length: 15 }, (_, i) => ({
      videoId: `v${i}`,
      publishedAt: "2026-01-01T00:00:00Z",
    }));
    const result = selectVideosForAnalysis(items, now);
    expect(result.usedFallback).toBe(true);
    expect(result.selected).toHaveLength(10);
    expect(result.selected).toEqual(items.slice(0, 10));
  });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run src/services/youtubeService.test.ts`
Expected: FAIL — `Cannot find module './youtubeService'` (el archivo todavía no existe).

- [ ] **Step 3: Implementar `youtubeService.ts`**

Crear `src/services/youtubeService.ts`:

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
}

export interface ChannelVideo {
  videoId: string;
  title: string;
  description: string;
  tags: string[];
  publishedAt: string;
  thumbnailUrl: string;
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

async function fetchChannelInfo(parsed: ParsedChannelInput): Promise<ChannelInfo | null> {
  const params = new URLSearchParams({
    part: "snippet,contentDetails",
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
      snippet: { title: string; customUrl?: string };
      contentDetails: { relatedPlaylists: { uploads: string } };
    }[];
  };
  const item = data.items[0];
  if (!item) return null;

  return {
    channelId: item.id,
    title: item.snippet.title,
    handle: item.snippet.customUrl,
    uploadsPlaylistId: item.contentDetails.relatedPlaylists.uploads,
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
    part: "snippet",
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
    }[];
  };

  return data.items.map((item) => ({
    videoId: item.id,
    title: item.snippet.title,
    description: item.snippet.description,
    tags: item.snippet.tags ?? [],
    publishedAt: item.snippet.publishedAt,
    thumbnailUrl: item.snippet.thumbnails.high?.url ?? item.snippet.thumbnails.default.url,
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
Expected: PASS (9 tests).

- [ ] **Step 5: Verificar que compila**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add src/services/youtubeService.ts src/services/youtubeService.test.ts
git commit -m "feat: add youtubeService to resolve channels and list recent videos

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Y5ZwnTtT6vPq4GHh2VpJj7"
```

---

### Task 3: `channelAnalysisService.ts` — temas, personaje y disclaimer vía Claude

**Files:**
- Create: `src/services/channelAnalysisService.ts`

**Interfaces:**
- Consumes: `ChannelVideo` (de Task 2), `env.anthropicApiKey` (ya existe en `env.ts`).
- Produces:
  - `interface ChannelCharacter { present: boolean; description: string | null }`
  - `interface ChannelAnalysisResult { topics: string[]; character: ChannelCharacter; disclaimer: string }`
  - `analyzeChannel(videos: ChannelVideo[]): Promise<ChannelAnalysisResult>` — consumida por Task 4.

Sin tests unitarios en este task (llamada de red pura a un LLM — mismo criterio que `retakeDetectionService.ts`, que tampoco los tiene). Se valida en el Task 5 con una corrida real.

- [ ] **Step 1: Implementar `channelAnalysisService.ts`**

Crear `src/services/channelAnalysisService.ts`:

```ts
import { env } from "./env";
import type { ChannelVideo } from "./youtubeService";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-5";
const TOOL_NAME = "report_channel_analysis";
const MAX_THUMBNAILS = 5;
const DESCRIPTION_EXCERPT_LENGTH = 300;

export interface ChannelCharacter {
  present: boolean;
  description: string | null;
}

export interface ChannelAnalysisResult {
  topics: string[];
  character: ChannelCharacter;
  disclaimer: string;
}

interface RawAnalysis {
  topics: string[];
  character: { present: boolean; description?: string };
  disclaimer: string;
}

function buildPrompt(videos: ChannelVideo[]): string {
  const videoSummaries = videos
    .map((v, i) => {
      const excerpt = v.description.slice(0, DESCRIPTION_EXCERPT_LENGTH).replace(/\n/g, " ");
      return `${i + 1}. "${v.title}"\n   Descripción: ${excerpt}\n   Tags: ${v.tags.join(", ") || "(sin tags)"}`;
    })
    .join("\n\n");

  return `Estos son los videos recientes de un canal de YouTube. Te muestro también las miniaturas de algunos de ellos como imágenes adjuntas.

${videoSummaries}

Tu tarea, usando tanto el texto como las miniaturas:

1. "topics": los 3 a 8 temas o ángulos recurrentes del canal (en el mismo idioma que usan los títulos/descripciones).

2. "character": si las miniaturas muestran un personaje/avatar visual que se repite de forma reconocible en varios videos (mismo diseño de ilustración, no personas reales distintas en cada foto), poné "present": true y en "description" una descripción detallada y reutilizable de su apariencia (edad aproximada, pelo, expresión característica, vestuario, estilo de ilustración — plano/vector/realista/etc.) para poder recrearlo consistentemente en imágenes futuras. Si no hay ningún personaje recurrente (son fotos reales variadas, o miniaturas sin personaje), poné "present": false y omití "description".

3. "disclaimer": un texto breve (2-3 oraciones), en el mismo idioma del canal, para usar en la descripción de los videos, alineado con la política de YouTube de "contenido alterado o sintético": debe advertir con honestidad que el contenido (ilustraciones/voz/edición) puede estar generado o alterado con IA, sin sonar genérico ni robótico.`;
}

export async function analyzeChannel(videos: ChannelVideo[]): Promise<ChannelAnalysisResult> {
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
            "Reporta los temas recurrentes, el personaje visual (si existe) y un disclaimer de contenido sintético para este canal.",
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
            },
            required: ["topics", "character", "disclaimer"],
            additionalProperties: false,
          },
        },
      ],
      messages: [
        {
          role: "user",
          content: [...imageBlocks, { type: "text", text: buildPrompt(videos) }],
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
  };
}
```

- [ ] **Step 2: Verificar que compila**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/services/channelAnalysisService.ts
git commit -m "feat: add channelAnalysisService for topics/character/disclaimer extraction

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Y5ZwnTtT6vPq4GHh2VpJj7"
```

---

### Task 4: `analyzeChannel.ts` — script CLI que orquesta todo

**Files:**
- Create: `src/services/analyzeChannel.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `resolveChannel`, `listRecentVideos` (Task 2); `analyzeChannel` de `channelAnalysisService.ts` (Task 3, ojo: mismo nombre de función que el script — se importa con alias `analyzeChannelWithClaude` para evitar choque con la función `main` del script); `editImage` de `src/services/kieAiService.ts` (ya existente).
- Produces: comando `npm run analyze:channel -- <url-o-@handle>`; archivos en `content/canales/<slug>/`.

- [ ] **Step 1: Implementar `analyzeChannel.ts`**

Crear `src/services/analyzeChannel.ts`:

```ts
import fs from "fs";
import path from "path";
import { resolveChannel, listRecentVideos } from "./youtubeService";
import { analyzeChannel as analyzeChannelWithClaude } from "./channelAnalysisService";
import { editImage } from "./kieAiService";

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

  console.log("Analizando temas y personaje con Claude...");
  const analysis = await analyzeChannelWithClaude(videos);

  const slug = slugify(channel.title);
  const outputDir = path.join("content", "canales", slug);
  fs.mkdirSync(outputDir, { recursive: true });

  let imageGenerated = false;
  if (analysis.character.present && analysis.character.description) {
    console.log("Generando imagen de referencia del personaje...");
    const referenceUrls = videos.slice(0, CHARACTER_REFERENCE_COUNT).map((v) => v.thumbnailUrl);
    try {
      await editImage(
        buildCharacterImagePrompt(analysis.character.description),
        referenceUrls,
        path.join(outputDir, "personaje.png"),
        { aspectRatio: "3:2" },
      );
      imageGenerated = true;
    } catch (err) {
      console.error("No se pudo generar la imagen del personaje:", (err as Error).message);
    }
  }

  const personajeMd = analysis.character.present
    ? `# Personaje — ${channel.title}\n\n${analysis.character.description}\n\n---\n\nEsta imagen fue generada a partir de las miniaturas reales de este canal. Si el canal no es tuyo, es solo referencia interna de moodboard — no publiques esta imagen ni una copia visualmente idéntica; usala para inspirarte en un personaje propio y distinto.\n`
    : `# Personaje — ${channel.title}\n\nEste canal no muestra un personaje visual consistente en la muestra analizada.\n`;
  fs.writeFileSync(path.join(outputDir, "personaje.md"), personajeMd);

  const analisisJson = {
    channel: { channelId: channel.channelId, title: channel.title, handle: channel.handle ?? null },
    videosAnalyzed: videos.map((v) => ({ videoId: v.videoId, title: v.title, publishedAt: v.publishedAt })),
    usedFallback,
    topics: analysis.topics,
    disclaimer: analysis.disclaimer,
    disclaimerNote:
      'Este texto complementa la descripción del video, pero NO reemplaza activar el toggle "Contenido alterado o sintético" en YouTube Studio al subir el video.',
  };
  fs.writeFileSync(path.join(outputDir, "analisis.json"), JSON.stringify(analisisJson, null, 2));

  console.log(`\nListo. Archivos guardados en ${outputDir}/:`);
  console.log(`  - analisis.json`);
  console.log(`  - personaje.md`);
  if (imageGenerated) console.log(`  - personaje.png`);
  console.log(`\nTemas encontrados: ${analysis.topics.join(", ")}`);
}

main().catch((err) => {
  console.error("FALLÓ:", err.message);
  process.exit(1);
});
```

- [ ] **Step 2: Agregar el script a `package.json`**

En la sección `"scripts"` de `package.json`, agregar (junto a `generate:assets`):

```json
"analyze:channel": "tsx src/services/analyzeChannel.ts"
```

- [ ] **Step 3: Verificar que compila**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add src/services/analyzeChannel.ts package.json
git commit -m "feat: add analyze:channel CLI script

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Y5ZwnTtT6vPq4GHh2VpJj7"
```

---

### Task 5: Verificación end-to-end contra un canal real

**Files:** ninguno nuevo — solo verificación.

- [ ] **Step 1: Correr toda la suite de tests**

Run: `npm test`
Expected: todos los tests pasan, incluidos los nuevos de `youtubeService.test.ts`.

- [ ] **Step 2: Correr el lint completo**

Run: `npm run lint`
Expected: sin errores de eslint ni de tsc.

- [ ] **Step 3: Correr el comando real contra un canal**

Run: `npm run analyze:channel -- https://www.youtube.com/@TheCapitalExplained`
Expected: termina sin error, imprime el resumen de temas, y crea:
- `content/canales/capital-explained/analisis.json`
- `content/canales/capital-explained/personaje.md`
- `content/canales/capital-explained/personaje.png` (si detectó personaje)

- [ ] **Step 4: Inspeccionar el resultado**

Abrir `content/canales/capital-explained/analisis.json` y `personaje.md`, y ver `personaje.png`: confirmar que los temas son coherentes con el canal, que la nota de copyright está en `personaje.md`, y que la imagen generada mantiene el estilo del canal (mismo criterio que la imagen validada en el spike).

- [ ] **Step 5: Decidir si el resultado de prueba se commitea**

Esta carpeta de prueba (`content/canales/capital-explained/`) es contenido de un canal de terceros generado solo para validar el pipeline — no debe quedar commiteada como si fuera un asset real del proyecto. Borrarla:

```bash
rm -rf content/canales/capital-explained
```

- [ ] **Step 6: Confirmar el estado final de git**

Run: `git status`
Expected: working tree limpio (la carpeta de prueba ya no aparece, todo lo demás ya fue commiteado en los tasks anteriores).
