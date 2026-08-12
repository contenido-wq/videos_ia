# Social-checklist: detectar y cortar retakes/asides fuera de guion

## Contexto

El pipeline `social-checklist` (`generateAssets.ts` + `videoTrimService.ts`)
ya corta silencios, muletillas puntuales (`eh`, `este`, `o sea`) y, si
`removeOtherSpeakers` está activo, tramos donde habla alguien que no es el
hablante principal (diarización, ver
`2026-08-06-social-checklist-speaker-removal-design.md`).

Ese trabajo previo ya identificó que en el video real de este guion
(`5-herramientas-ranking`) el usuario menciona a "Lina" — la persona que le
dicta el guion fuera de cámara — y ese caso se resolvió cuando la charla es
de la OTRA persona (se corta como hablante secundario). Pero queda un caso
que la diarización no cubre: cuando es el propio hablante principal quien
se dirige a Lina ("Hágale, Lina. Lina, muchas gracias") o se autocorrige a
mitad de una frase ("la herramienta... bueno, la herramienta") — es su
misma voz, así que `detectOtherSpeakerRanges` no lo toca.

Confirmado con el usuario: la narración es completamente improvisada, no
existe un guion de referencia con el texto exacto por item (los `items`
del `guion.json` solo tienen `label` corto, ej. `"Gamma"`) — así que no se
puede resolver por diff contra un texto canónico. Se optó por clasificación
semántica vía LLM sobre la transcripción.

## Decisiones acordadas con el usuario

- **Detección vía Claude**, no reglas/regex: los asides tipo "Hágale,
  Lina" no generalizan como lista fija de palabras (a diferencia de
  `FILLER_WORDS`, que sí es una lista cerrada válida).
- El LLM recibe la transcripción como **lista de palabras indexada**
  (`{i, text, start, end}`), no como texto con segundos — así señala
  rangos por **índice de palabra**, que no puede alucinar, en vez de
  segundos flotantes, que sí. La resolución índice→segundos la hace el
  código con el array `words` real, igual que ya hace `detectFillerRanges`.
- Dos categorías de candidato:
  - `retake`: intento fallido/incompleto que se corrige después — se
    corta el intento fallido, se deja la versión final intacta.
  - `aside`: interacción fuera de cámara con quien dicta el guion — se
    corta el tramo completo.
- El prompt debe distinguir explícitamente esto de la **repetición
  retórica deliberada** que el código ya protege hoy (comentario en
  `detectFillerRanges`: "ManyChat. ManyChat te va a ayudar..." es recurso
  de guion, no titubeo) — un candidato solo aplica si hay señal de
  autocorrección (muletilla, frase inconclusa, cambio de tono/tema), no
  por el solo hecho de repetir una palabra.
- **Revisión humana obligatoria antes de cortar** (sigue la línea
  cautelosa ya establecida en este código — varios comentarios sobre bugs
  reales causados por cortar de más). Reporte en consola: cada candidato
  se imprime con texto, rango de tiempo, tipo y motivo; se confirma
  interactivamente con `[s/n]`, más atajos `a` (aprobar el resto) y `r`
  (rechazar el resto) para no hacerlo tedioso en videos con muchos
  candidatos.
- Los candidatos crudos del LLM se cachean en
  `public/assets/<slug>/retake-candidates.json` (mismo patrón
  "ya existe, se reutiliza" que `transcript.json`) para no repetir la
  llamada al LLM si se vuelve a correr el script. Las **aprobaciones no
  se cachean** — si se re-corre antes de que exista el video recortado,
  se vuelve a preguntar (mismo gate que ya protege todo el flujo: una vez
  existe `trimmed<ext>`, no se vuelve a tocar nada de esto).

## Cambios de datos

- `.env` / `src/services/env.ts`: nueva variable requerida
  `ANTHROPIC_API_KEY`.
- `package.json`: nueva dependencia `@anthropic-ai/sdk`.

## Cambios de pipeline

### `src/services/retakeDetectionService.ts` (nuevo)

```ts
export interface RetakeCandidate {
  start: number;
  end: number;
  quote: string;
  type: "retake" | "aside";
  reason: string;
}

export async function detectRetakeCandidates(
  words: TranscribedWord[],
): Promise<RetakeCandidate[]>;
```

- Arma la lista indexada de palabras, llama a Claude forzando tool-use con
  un schema que exige `{startIndex, endIndex, type, reason}` por
  candidato (evita parseo de JSON libre y sus fallos).
- Resuelve `startIndex`/`endIndex` a `{start, end}` en segundos usando
  `words[startIndex].start` / `words[endIndex].end`, y arma `quote`
  concatenando el texto de ese rango — función pura y testeable por
  separado de la llamada al LLM (mismo patrón que
  `parseSilenceDetectOutput` vs. `detectSilenceRanges`).
- Opera sobre `rawWords` (pre-trim), igual que `detectFillerRanges` y
  `detectOtherSpeakerRanges` hoy.

### `src/services/retakeReviewCli.ts` (nuevo)

```ts
export async function reviewRetakeCandidates(
  candidates: RetakeCandidate[],
): Promise<CutRange[]>;
```

- Usa `readline/promises` sobre stdin/stdout. Imprime cada candidato
  (texto, tiempo, tipo, motivo) y pide `[s/n/a/r]`. Devuelve solo los
  rangos aprobados como `CutRange[]`.

### `src/services/generateAssets.ts` — `generateSocialChecklistAssets`

- Después de obtener `rawWords` (transcripción) y antes de calcular
  `cutRanges`:
  - Si existe `retake-candidates.json`, se reutiliza; si no, se llama
    `detectRetakeCandidates(rawWords)` y se cachea.
  - Si el video recortado (`trimmed<ext>`) todavía no existe: se corre
    `reviewRetakeCandidates` para obtener los rangos aprobados.
  - Los rangos aprobados se suman a `cutRanges` junto con silencios,
    muletillas y tramos de otro hablante, antes de `mergeCutRanges` /
    `computeKeepSegments` (esas funciones ya son genéricas sobre
    cualquier lista de `CutRange`, no requieren cambios).
- Si el video recortado ya existe: comportamiento actual, no se llama al
  LLM ni se pregunta nada (mismo gate de caché que ya tiene todo el
  pipeline).

## Testing

- `retakeDetectionService.test.ts`: la función de resolución
  índice→segundos y armado de `quote` (pura, sin red).
- La llamada al LLM en sí no se testea unitariamente (mismo criterio que
  `elevenlabsService`, que tampoco tiene tests — se prueba en vivo contra
  contenido real).
- `retakeReviewCli.ts` no se testea unitariamente (I/O interactivo); se
  valida en vivo al correr el pipeline.

## Fuera de alcance (por ahora)

- Diff contra un guion de referencia escrito — no existe hoy, la
  narración es improvisada.
- Revisión visual del clip real (ver/escuchar el candidato) — la
  revisión es solo sobre el texto transcrito y sus timestamps.
- Cachear las aprobaciones entre corridas.
- Prompts u optimización para idiomas distintos a español.
