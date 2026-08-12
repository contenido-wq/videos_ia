# Detección de retakes/asides fuera de guion — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El pipeline `social-checklist` detecta automáticamente (vía Claude) tramos de la transcripción donde el hablante principal se autocorrige ("retake") o se dirige a la persona que le dicta el guion ("aside"), los presenta para revisión humana en consola, y corta los aprobados junto con silencios/muletillas/otro-hablante antes de recortar el video final.

**Architecture:** Nuevo servicio `retakeDetectionService.ts` llama a la Anthropic Messages API directamente vía `fetch` (sin SDK, mismo patrón que `elevenlabsService.ts`/`apifyService.ts`), forzando tool-use con `tool_choice` para que la respuesta sea siempre `{candidates: [{startIndex, endIndex, type, reason}]}` — índices de palabra, no segundos, para que el resolver (`resolveRetakeCandidates`, función pura) los mapee a `{start, end}` reales usando el array de palabras ya transcrito. Un módulo separado `retakeReviewCli.ts` hace la revisión interactiva en consola. `generateAssets.ts` los invoca solo cuando el video recortado todavía no existe (mismo gate de caché que ya protege todo el pipeline).

**Tech Stack:** TypeScript + tsx (sin dependencias nuevas — `fetch` nativo de Node, igual que el resto de servicios del repo), vitest para tests.

## Global Constraints

- Modelo: `claude-opus-5` (default del proyecto, ver `shared/models.md` — no hay razón para usar otro).
- Endpoint: `https://api.anthropic.com/v1/messages`, headers `x-api-key`, `anthropic-version: 2023-06-01`, `content-type: application/json`.
- Sin SDK — llamadas `fetch` crudas, siguiendo el patrón exacto de `src/services/elevenlabsService.ts`.
- `tool_choice: {type: "tool", name: "report_retake_candidates"}` + `strict: true` en la definición del tool — la respuesta SIEMPRE es el tool call con el schema exacto, nunca texto libre a parsear.
- El LLM nunca reporta segundos directamente — reporta índices de palabra (`startIndex`/`endIndex`), resueltos a segundos por código, no por el modelo.
- Revisión humana obligatoria antes de cortar (consola, `[s/n/a/r]`) — nunca se corta un candidato sin aprobación explícita.
- Todo texto de logs/prompts/comentarios en español, siguiendo la convención del resto del repo.

---

### Task 1: `ANTHROPIC_API_KEY` + servicio de detección (`retakeDetectionService.ts`)

**Files:**
- Modify: `src/services/env.ts`
- Modify: `.env` (agregar la línea de la variable, vacía — el usuario pone su propia key)
- Create: `src/services/retakeDetectionService.ts`
- Test: `src/services/retakeDetectionService.test.ts`
- Modify: `src/services/testConnections.ts`

**Interfaces:**
- Produces: `export interface RetakeCandidate { start: number; end: number; quote: string; type: "retake" | "aside"; reason: string }`
- Produces: `export function resolveRetakeCandidates(raw: RawCandidate[], words: TranscribedWord[]): RetakeCandidate[]` (pura, exportada solo para el test — no se usa fuera de este archivo)
- Produces: `export async function detectRetakeCandidates(words: TranscribedWord[]): Promise<RetakeCandidate[]>`
- Produces: `export async function verifyAnthropicConnection(): Promise<void>` (lanza si la key no sirve)
- Consumes: `TranscribedWord` de `./checklistSyncService` (`{text, start, end}`)

- [ ] **Step 1: Agregar `ANTHROPIC_API_KEY` a `env.ts`**

En `src/services/env.ts`, agregar dentro del objeto `env` (después de `apifyGoogleImagesTask`):

```ts
  get anthropicApiKey() {
    return required("ANTHROPIC_API_KEY");
  },
```

- [ ] **Step 2: Agregar la variable vacía a `.env`**

Agregar una línea nueva al final de `.env`:

```
ANTHROPIC_API_KEY=
```

(El usuario debe completar su propia key ahí — no se commitea, `.env` está en `.gitignore`.)

- [ ] **Step 3: Escribir el test de `resolveRetakeCandidates` (falla primero)**

Crear `src/services/retakeDetectionService.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveRetakeCandidates } from "./retakeDetectionService";
import type { TranscribedWord } from "./checklistSyncService";

function w(text: string, start: number, end: number): TranscribedWord {
  return { text, start, end };
}

describe("resolveRetakeCandidates", () => {
  const words = [
    w("La", 0.0, 0.2),
    w("herramienta.", 0.2, 0.6),
    w("Bueno,", 0.7, 0.9),
    w("la", 0.9, 1.0),
    w("herramienta", 1.0, 1.3),
    w("es", 1.3, 1.5),
    w("Gamma.", 1.5, 1.8),
  ];

  it("resuelve un rango de índices a start/end reales y arma el quote", () => {
    const result = resolveRetakeCandidates(
      [{ startIndex: 0, endIndex: 1, type: "retake", reason: "intento fallido" }],
      words,
    );
    expect(result).toEqual([
      { start: 0.0, end: 0.6, quote: "La herramienta.", type: "retake", reason: "intento fallido" },
    ]);
  });

  it("resuelve varios candidatos en el mismo batch", () => {
    const result = resolveRetakeCandidates(
      [
        { startIndex: 0, endIndex: 1, type: "retake", reason: "r1" },
        { startIndex: 2, endIndex: 2, type: "aside", reason: "r2" },
      ],
      words,
    );
    expect(result).toHaveLength(2);
    expect(result[1]).toEqual({ start: 0.7, end: 0.9, quote: "Bueno,", type: "aside", reason: "r2" });
  });

  it("descarta un candidato con endIndex fuera de rango en vez de fallar todo el batch", () => {
    const result = resolveRetakeCandidates(
      [
        { startIndex: 0, endIndex: 1, type: "retake", reason: "válido" },
        { startIndex: 5, endIndex: 99, type: "retake", reason: "índice inválido" },
      ],
      words,
    );
    expect(result).toEqual([
      { start: 0.0, end: 0.6, quote: "La herramienta.", type: "retake", reason: "válido" },
    ]);
  });

  it("descarta un candidato con endIndex menor que startIndex", () => {
    const result = resolveRetakeCandidates(
      [{ startIndex: 3, endIndex: 1, type: "retake", reason: "invertido" }],
      words,
    );
    expect(result).toEqual([]);
  });

  it("devuelve [] si no hay candidatos", () => {
    expect(resolveRetakeCandidates([], words)).toEqual([]);
  });
});
```

- [ ] **Step 4: Correr el test y confirmar que falla**

Run: `npx vitest run src/services/retakeDetectionService.test.ts`
Expected: FAIL — `retakeDetectionService.ts` no existe todavía (`Cannot find module`).

- [ ] **Step 5: Implementar `retakeDetectionService.ts`**

Crear `src/services/retakeDetectionService.ts`:

```ts
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
```

- [ ] **Step 6: Correr el test y confirmar que pasa**

Run: `npx vitest run src/services/retakeDetectionService.test.ts`
Expected: PASS — los 5 tests en verde.

- [ ] **Step 7: Agregar la verificación al script de `testConnections.ts`**

En `src/services/testConnections.ts`, agregar el import y el chequeo:

```ts
import { getAccountCredits } from "./kieAiService";
import { getAccountInfo } from "./apifyService";
import { listVoices } from "./elevenlabsService";
import { verifyAnthropicConnection } from "./retakeDetectionService";

async function main() {
  console.log("== ElevenLabs ==");
  const voices = await listVoices();
  console.log(`OK - ${voices.length} voces disponibles`);

  console.log("== kie.ai ==");
  const credits = await getAccountCredits();
  console.log(`OK - ${credits} créditos disponibles`);

  console.log("== Apify ==");
  const account = await getAccountInfo();
  console.log(`OK - usuario ${account.username}, plan ${account.plan}`);

  console.log("== Anthropic ==");
  await verifyAnthropicConnection();
  console.log("OK - API key válida");
}
```

- [ ] **Step 8: Correr `testConnections` en vivo para confirmar que la key funciona**

Requiere que el usuario haya completado `ANTHROPIC_API_KEY` en `.env` primero.

Run: `npx tsx src/services/testConnections.ts`
Expected: las 4 secciones (`ElevenLabs`, `kie.ai`, `Apify`, `Anthropic`) terminan en `OK`.

- [ ] **Step 9: Commit**

```bash
git add src/services/env.ts src/services/retakeDetectionService.ts src/services/retakeDetectionService.test.ts src/services/testConnections.ts
git commit -m "$(cat <<'EOF'
feat: detectar retakes y asides fuera de guion vía Anthropic API

Nuevo servicio que llama la Messages API directo (sin SDK, mismo
patrón que elevenlabsService) forzando tool-use para clasificar
tramos de la transcripción como retake/aside por índice de palabra,
resuelto a segundos con una función pura y testeada aparte.
EOF
)"
```

(`.env` NO se agrega al commit — está en `.gitignore` y `git add .env` explícito falla porque es un path ignorado. El cambio del Step 2 queda solo local; cada quien completa su propia key.)

---

### Task 2: Revisión interactiva en consola (`retakeReviewCli.ts`)

**Files:**
- Create: `src/services/retakeReviewCli.ts`

**Interfaces:**
- Consumes: `RetakeCandidate` de `./retakeDetectionService` (`{start, end, quote, type, reason}`), `CutRange` de `./videoTrimService` (`{start, end}`)
- Produces: `export async function reviewRetakeCandidates(candidates: RetakeCandidate[]): Promise<CutRange[]>`

No lleva test automático (I/O interactivo por stdin/stdout) — se valida en vivo en la Tarea 4. Mismo criterio que `elevenlabsService.ts`, que tampoco tiene tests.

- [ ] **Step 1: Implementar `retakeReviewCli.ts`**

```ts
import readline from "readline/promises";
import type { RetakeCandidate } from "./retakeDetectionService";
import type { CutRange } from "./videoTrimService";

export async function reviewRetakeCandidates(candidates: RetakeCandidate[]): Promise<CutRange[]> {
  if (candidates.length === 0) return [];

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const approved: CutRange[] = [];
  let approveRest = false;
  let rejectRest = false;

  try {
    for (const [i, c] of candidates.entries()) {
      console.log(`\n[${i + 1}/${candidates.length}] (${c.type}) ${c.start.toFixed(1)}s - ${c.end.toFixed(1)}s`);
      console.log(`  "${c.quote}"`);
      console.log(`  motivo: ${c.reason}`);

      if (approveRest) {
        approved.push({ start: c.start, end: c.end });
        continue;
      }
      if (rejectRest) {
        continue;
      }

      const answer = (await rl.question("  ¿cortar este tramo? [s/n/a=aprobar el resto/r=rechazar el resto]: "))
        .trim()
        .toLowerCase();

      if (answer === "a") {
        approveRest = true;
        approved.push({ start: c.start, end: c.end });
      } else if (answer === "r") {
        rejectRest = true;
      } else if (answer === "s") {
        approved.push({ start: c.start, end: c.end });
      }
      // cualquier otra respuesta (incluido "n") = no se corta
    }
  } finally {
    rl.close();
  }

  return approved;
}
```

- [ ] **Step 2: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sin errores relacionados a `retakeReviewCli.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/services/retakeReviewCli.ts
git commit -m "$(cat <<'EOF'
feat: revisión interactiva en consola para candidatos a retake

Imprime cada candidato (texto, tiempo, tipo, motivo) y pide
aprobación uno por uno, con atajos para aprobar/rechazar el resto —
nada se corta sin confirmación explícita.
EOF
)"
```

---

### Task 3: Integrar en el pipeline (`generateAssets.ts`)

**Files:**
- Modify: `src/services/generateAssets.ts`

**Interfaces:**
- Consumes: `detectRetakeCandidates`, `RetakeCandidate` de `./retakeDetectionService`; `reviewRetakeCandidates` de `./retakeReviewCli`
- No produce nada nuevo — es la tarea de wiring.

- [ ] **Step 1: Agregar los imports**

En `src/services/generateAssets.ts`, junto a los demás imports de servicios (después de la línea que importa de `./checklistSyncService`):

```ts
import { detectRetakeCandidates, type RetakeCandidate } from "./retakeDetectionService";
import { reviewRetakeCandidates } from "./retakeReviewCli";
```

- [ ] **Step 2: Mover `trimmedVideoAbsPath` antes del bloque de detección de cortes**

En `generateSocialChecklistAssets`, el bloque actual es:

```ts
  console.log("detectando silencios y titubeos...");
  const silenceRanges = await detectSilenceRanges(rawVideoAbsPath, rawDurationInSeconds);
  const fillerRanges = detectFillerRanges(rawWords);
  let otherSpeakerRanges: CutRange[] = [];
  if (guion.removeOtherSpeakers) {
    const diarizedWords = rawWords as DiarizedWord[];
    const primarySpeakerId = findPrimarySpeakerId(diarizedWords);
    otherSpeakerRanges = detectOtherSpeakerRanges(diarizedWords, primarySpeakerId);
    console.log(`  hablante principal: ${primarySpeakerId}, ${otherSpeakerRanges.length} tramo(s) de otra voz`);
  }
  console.log(`  ${silenceRanges.length} silencio(s), ${fillerRanges.length} titubeo(s)/muletilla(s)`);
  const cutRanges = mergeCutRanges([...silenceRanges, ...fillerRanges, ...otherSpeakerRanges]);
  const keepSegments = computeKeepSegments(rawDurationInSeconds, cutRanges, TRIM_PADDING_SECONDS);
```

Reemplazar por:

```ts
  const trimmedVideoAbsPath = path.join(PUBLIC_DIR, "assets", guion.slug, "video", `trimmed${rawExt}`);

  console.log("detectando silencios y titubeos...");
  const silenceRanges = await detectSilenceRanges(rawVideoAbsPath, rawDurationInSeconds);
  const fillerRanges = detectFillerRanges(rawWords);
  let otherSpeakerRanges: CutRange[] = [];
  if (guion.removeOtherSpeakers) {
    const diarizedWords = rawWords as DiarizedWord[];
    const primarySpeakerId = findPrimarySpeakerId(diarizedWords);
    otherSpeakerRanges = detectOtherSpeakerRanges(diarizedWords, primarySpeakerId);
    console.log(`  hablante principal: ${primarySpeakerId}, ${otherSpeakerRanges.length} tramo(s) de otra voz`);
  }
  console.log(`  ${silenceRanges.length} silencio(s), ${fillerRanges.length} titubeo(s)/muletilla(s)`);

  // Solo se detecta/pregunta si el video recortado todavía no existe — mismo
  // gate de caché que ya protege el resto del pipeline. Una vez recortado, no
  // se vuelve a llamar al LLM ni a preguntar nada.
  let approvedRetakeRanges: CutRange[] = [];
  if (!fs.existsSync(trimmedVideoAbsPath)) {
    const retakeCandidatesPath = path.join(PUBLIC_DIR, "assets", guion.slug, "retake-candidates.json");
    let retakeCandidates: RetakeCandidate[];
    if (fs.existsSync(retakeCandidatesPath)) {
      console.log("candidatos a retake ya existen, se reutilizan");
      retakeCandidates = JSON.parse(fs.readFileSync(retakeCandidatesPath, "utf-8")) as RetakeCandidate[];
    } else {
      console.log("detectando retakes y asides fuera de guion con Claude...");
      retakeCandidates = await detectRetakeCandidates(rawWords);
      fs.mkdirSync(path.dirname(retakeCandidatesPath), { recursive: true });
      fs.writeFileSync(retakeCandidatesPath, JSON.stringify(retakeCandidates, null, 2));
    }
    console.log(`  ${retakeCandidates.length} candidato(s) a retake/aside`);
    approvedRetakeRanges = await reviewRetakeCandidates(retakeCandidates);
    console.log(`  ${approvedRetakeRanges.length} aprobado(s) para cortar`);
  }

  const cutRanges = mergeCutRanges([...silenceRanges, ...fillerRanges, ...otherSpeakerRanges, ...approvedRetakeRanges]);
  const keepSegments = computeKeepSegments(rawDurationInSeconds, cutRanges, TRIM_PADDING_SECONDS);
```

- [ ] **Step 3: Quitar la declaración duplicada de `trimmedVideoAbsPath` más abajo**

Más abajo en la misma función, el bloque:

```ts
  const trimmedVideoAbsPath = path.join(PUBLIC_DIR, "assets", guion.slug, "video", `trimmed${rawExt}`);
  if (fs.existsSync(trimmedVideoAbsPath)) {
    console.log("video recortado ya existe, se reutiliza");
  } else {
    console.log(`recortando video (${keepSegments.length} segmento(s) a conservar de ${cutRanges.length} corte(s))...`);
    await trimVideoToSegments(rawVideoAbsPath, trimmedVideoAbsPath, keepSegments);
  }
```

pasa a (se quita solo la primera línea, ya declarada arriba):

```ts
  if (fs.existsSync(trimmedVideoAbsPath)) {
    console.log("video recortado ya existe, se reutiliza");
  } else {
    console.log(`recortando video (${keepSegments.length} segmento(s) a conservar de ${cutRanges.length} corte(s))...`);
    await trimVideoToSegments(rawVideoAbsPath, trimmedVideoAbsPath, keepSegments);
  }
```

- [ ] **Step 4: Verificar que compila y el resto de tests siguen pasando**

Run: `npx tsc --noEmit && npx vitest run`
Expected: sin errores de tipo; todos los tests existentes (`videoTrimService.test.ts`, `ffmpegService.test.ts`, `checklistSyncService.test.ts`, `retakeDetectionService.test.ts`) en verde.

- [ ] **Step 5: Commit**

```bash
git add src/services/generateAssets.ts
git commit -m "$(cat <<'EOF'
feat: integrar detección de retakes al pipeline de social-checklist

Se ejecuta solo cuando el video recortado todavía no existe (mismo
gate de caché que ya tiene el resto del pipeline); los rangos
aprobados se suman a silencios/muletillas/otro-hablante antes de
recortar.
EOF
)"
```

---

### Task 4: Verificación end-to-end contra el video real

**Files:** ninguno (solo ejecución + inspección manual)

Esta tarea corre el pipeline completo contra `5-herramientas-ranking` — el mismo video donde se identificó el problema de "Lina" y las autocorrecciones. Usa la API real de Anthropic (costo real, aunque bajo — una sola llamada sobre una transcripción corta).

- [ ] **Step 1: Confirmar que la transcripción ya está cacheada (no hace falta re-transcribir)**

Run: `ls public/assets/5-herramientas-ranking/transcript.json`
Expected: el archivo existe (se generó en una corrida anterior del pipeline).

- [ ] **Step 2: Confirmar que el video recortado actual existe, y decidir si se re-corre desde cero**

Run: `ls public/assets/5-herramientas-ranking/video/trimmed.mov`

Si existe (probable, ya se generó antes de este feature), el gate de caché va a saltarse toda la detección de retakes — hace falta borrarlo para forzar la corrida completa con el feature nuevo:

```bash
rm public/assets/5-herramientas-ranking/video/trimmed.mov
```

- [ ] **Step 3: Correr el pipeline**

Run: `npx tsx src/services/generateAssets.ts content/guiones/5-herramientas-ranking.json`

Expected:
- Se reutiliza la transcripción cacheada (no vuelve a llamar a ElevenLabs).
- Aparece `detectando retakes y asides fuera de guion con Claude...`.
- Se imprime al menos un candidato con `type: aside` que incluye "Lina" en el `quote` (el caso documentado en `2026-08-06-social-checklist-speaker-removal-design.md`).
- Cada candidato pide `[s/n/a=aprobar el resto/r=rechazar el resto]` — responder según corresponda revisando el `quote` y el `reason` de cada uno.
- El pipeline termina recortando el video y generando `public/data/5-herramientas-ranking.json`.

- [ ] **Step 4: Revisar el resultado**

- Confirmar en `public/assets/5-herramientas-ranking/retake-candidates.json` que quedó el registro completo de candidatos (aprobados y rechazados).
- Ver el video recortado (`public/assets/5-herramientas-ranking/video/trimmed.mov`) en Remotion Studio (`npm run dev`) y confirmar que los tramos aprobados efectivamente no están, y que no se cortó nada que debía quedar.

- [ ] **Step 5: Si algo se cortó de más o de menos, ajustar el prompt en `retakeDetectionService.ts` y repetir desde el Step 2**

Borrar también `retake-candidates.json` en ese caso para forzar una nueva clasificación (no solo una nueva revisión):

```bash
rm public/assets/5-herramientas-ranking/retake-candidates.json
rm public/assets/5-herramientas-ranking/video/trimmed.mov
```

- [ ] **Step 6: Commit (si se ajustó el prompt)**

```bash
git add src/services/retakeDetectionService.ts
git commit -m "fix: ajustar prompt de detección de retakes tras probar contra video real"
```
