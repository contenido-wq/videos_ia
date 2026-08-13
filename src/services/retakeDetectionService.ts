import { env } from "./env";
import type { TranscribedWord } from "./checklistSyncService";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-5";
const TOOL_NAME = "report_retake_candidates";

export type RetakeCandidateType = "retake" | "aside";

export interface RetakeCandidate {
  start: number;
  end: number;
  quote: string;
  type: RetakeCandidateType;
  reason: string;
}

interface RawCandidate {
  startIndex: number;
  endIndex: number;
  type: RetakeCandidateType;
  reason: string;
}

// El LLM nunca reporta segundos (los alucinaría) — reporta índices de palabra
// sobre la lista indexada que le mandamos en el prompt, y acá se resuelven a
// segundos reales con el array de palabras ya transcrito. Un índice fuera de
// rango se descarta en vez de tirar todo el batch, por si el modelo se
// equivoca en un solo candidato de varios.
export function resolveRetakeCandidates(
  raw: RawCandidate[],
  words: TranscribedWord[],
): RetakeCandidate[] {
  const resolved: RetakeCandidate[] = [];
  for (const c of raw) {
    if (c.startIndex < 0 || c.endIndex < c.startIndex || c.endIndex >= words.length) {
      continue;
    }
    const quote = words
      .slice(c.startIndex, c.endIndex + 1)
      .map((w) => w.text)
      .join(" ");
    resolved.push({
      start: words[c.startIndex].start,
      end: words[c.endIndex].end,
      quote,
      type: c.type,
      reason: c.reason,
    });
  }
  return resolved;
}

function buildPrompt(words: TranscribedWord[]): string {
  const indexed = words.map((w, i) => `${i}:${w.text}`).join(" ");
  return `Esta es la transcripción completa de un video donde una persona graba, hablando a cámara, el guion de un video corto (ranking de herramientas de IA). No hay guion escrito de referencia: la narración es improvisada, a veces dictada en vivo por otra persona fuera de cámara.

Cada palabra está indexada por su posición (empezando en 0) en formato "índice:palabra":
${indexed}

Tu tarea: identificar tramos de esta transcripción que NO deben quedar en el video final, en dos categorías:

- "retake": un intento fallido o incompleto de decir algo, que la persona corrige o repite inmediatamente después de forma más clara o completa. Ejemplo: "la herramienta... bueno, la herramienta que les traigo hoy..." — el primer "la herramienta..." es el retake, se corta; el resto queda.
- "aside": una interacción fuera de cámara con quien le dicta el guion o produce el video (instrucciones, agradecimientos, coordinación) que no es parte de la narración dirigida a la audiencia final. Ejemplo: "Hágale, Lina. Lina, muchas gracias." antes de arrancar la línea real.

IMPORTANTE — NO marques como candidato:
- Repetición retórica deliberada de una palabra o frase (ej. "ManyChat. ManyChat te va a ayudar..." es un recurso de guion, no un error).
- Cualquier tramo sin una señal clara de autocorrección, muletilla o cambio de tema/tono. Ante la duda, no lo marques.

CUIDADO CON LOS LÍMITES DEL CORTE en un "retake": si la persona corta una palabra a medias (ej. "in--") y esa palabra cortada es la continuación de unas palabras iniciales de la frase (ej. "Estas son las cinco in--"), y el segundo intento limpio que sigue vuelve a decir esas mismas palabras iniciales completas, el candidato tiene que incluir TODA la frase repetida desde su inicio (startIndex debe apuntar a la primera de esas palabras iniciales, no solo a la palabra cortada) — si no, el video final queda con esas palabras iniciales dichas dos veces seguidas ("Estas son las cinco... estas son las cinco herramientas...").

CUIDADO CON NO CORTAR LA ÚNICA VERSIÓN DISPONIBLE de una línea: cuando hay varios intentos seguidos de la misma frase y NINGUNO de ellos queda perfectamente limpio, marcá como retake SOLO los intentos anteriores al último — nunca cortes también el último intento disponible completo, salvo que exista un intento posterior más limpio. Es preferible dejar un tartamudeo leve en el video final a borrar por completo la única vez que se menciona algo importante (ej. el nombre de una herramienta).

PERO SÍ podés (y debés) cortar un tartamudeo o palabra cortada PUNTUAL que quede DENTRO de ese último intento, como su propio candidato de tipo "retake" separado, siempre que el resto de la frase quede intacta y con sentido — ejemplo: en "Puesto nu-puesto número tres, Notebook LM." el candidato debe ser solo la palabra "nu-puesto" (un intento cortado de decir "Puesto" de nuevo), dejando "Puesto número tres, Notebook LM." completo y limpio. La regla anterior es sobre no perder contenido importante (nombres, datos), no sobre tolerar tartamudeos sueltos que se pueden quitar sin perder nada.

Para cada candidato devolvé el rango de ÍNDICES de palabra (no segundos) que hay que cortar — startIndex y endIndex son inclusivos y se refieren a la lista indexada de arriba.`;
}

export async function detectRetakeCandidates(words: TranscribedWord[]): Promise<RetakeCandidate[]> {
  if (words.length === 0) return [];

  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": env.anthropicApiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8192,
      output_config: { effort: "medium" },
      tool_choice: { type: "tool", name: TOOL_NAME },
      tools: [
        {
          name: TOOL_NAME,
          description:
            "Reporta los tramos de la transcripción (por índice de palabra) que son retakes o asides fuera de guion y deben cortarse del video final.",
          strict: true,
          input_schema: {
            type: "object",
            properties: {
              candidates: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    startIndex: { type: "integer", description: "Índice de la primera palabra del tramo a cortar" },
                    endIndex: { type: "integer", description: "Índice de la última palabra del tramo a cortar (inclusive)" },
                    type: { type: "string", enum: ["retake", "aside"] },
                    reason: { type: "string", description: "Motivo breve de por qué este tramo es un retake/aside" },
                  },
                  required: ["startIndex", "endIndex", "type", "reason"],
                  additionalProperties: false,
                },
              },
            },
            required: ["candidates"],
            additionalProperties: false,
          },
        },
      ],
      messages: [{ role: "user", content: buildPrompt(words) }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Anthropic detectRetakeCandidates falló: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as {
    stop_reason: string;
    content: { type: string; name?: string; input?: { candidates: RawCandidate[] } }[];
  };

  if (data.stop_reason === "refusal") {
    throw new Error("Anthropic rechazó la solicitud de detección de retakes (safety refusal)");
  }

  const toolUse = data.content.find((b) => b.type === "tool_use" && b.name === TOOL_NAME);
  if (!toolUse?.input) {
    throw new Error("Anthropic no devolvió el tool_use esperado para detectar retakes");
  }

  return resolveRetakeCandidates(toolUse.input.candidates, words);
}

// Verificación barata de la API key (sin generar nada) para src/services/testConnections.ts.
export async function verifyAnthropicConnection(): Promise<void> {
  const res = await fetch(`https://api.anthropic.com/v1/models/${MODEL}`, {
    headers: {
      "x-api-key": env.anthropicApiKey,
      "anthropic-version": "2023-06-01",
    },
  });
  if (!res.ok) {
    throw new Error(`Anthropic verifyAnthropicConnection falló: ${res.status} ${await res.text()}`);
  }
}
