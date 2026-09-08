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
