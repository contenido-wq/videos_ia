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
