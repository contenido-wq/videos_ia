# Social-checklist: quitar voz de fondo de otro hablante

## Contexto

Nuevo video crudo del usuario (`~/Downloads/5Herramientas.MOV`, 6:05min,
3840×2160, HEVC) para procesar con el pipeline `social-checklist` ya
existente. A diferencia del primer video, este tiene una **segunda persona
(mujer) repitiendo cada línea del guion inmediatamente después del
usuario** (eco/apuntador fuera de cuadro), más algo de charla fuera de
guion con alguien más (mencionan a "Lina" por nombre). Confirmado con el
usuario: hay que quitar por completo la voz de la otra persona, quedándose
solo con la del usuario.

Investigación previa (sin escuchar audio, vía transcripción): ElevenLabs
Scribe soporta diarización (`diarize=true` en el request de
`/v1/speech-to-text`), devuelve `speaker_id` por palabra. Se probó contra
el audio real del video: identifica 3 hablantes (`speaker_0` = el usuario,
consistente en las 74 tomas de habla a lo largo de los 6 minutos;
`speaker_1` = la otra persona repitiendo cada línea; `speaker_2` = un
"de nada" suelto, ruido de diarización). `speaker_0` es quien habla
primero en el video (0.46s) y se mantiene como tal durante todo el
archivo — no hay ambigüedad de asignación a lo largo del video.

Este video es además, se confirmó comparando texto, la grabación fuente
del ejemplo "4. Gama" que el usuario mostró como referencia visual al
principio de este proyecto — mismo guion, mismo título
("5 HERRAMIENTAS DE IA QUE USTED VA A NECESITAR PARA NO SER UN
DINOSAURIO"), formato conteo regresivo de 5 a 1: ChatGPT, Gamma,
Notebook LM, Claude Code (transcrito "CloudCode"), AiVi.

## Decisiones acordadas con el usuario

- La voz de la otra persona se quita por completo, tratándola como un
  corte más (igual que silencios/muletillas) — reusa toda la
  infraestructura de `videoTrimService` ya existente.
- Es un comportamiento **opt-in por guion** (`removeOtherSpeakers: true`),
  no cambia nada para guiones que no lo activan (ej. el video anterior,
  que era un solo hablante).
- "Con un sonido más bajo" se interpreta como descripción de cómo se
  percibe la voz de fondo (más floja que la del usuario), no como un
  criterio técnico de corte por volumen aparte — no se construye un
  filtro de volumen independiente.
- El hablante principal se determina automáticamente: es quien dice la
  primera palabra del video (heurística validada contra este video real,
  donde se mantiene correcta durante los 6 minutos completos).

## Cambios de datos (`src/types/guion.ts`)

```ts
export interface SocialChecklistGuion {
  type: "social-checklist";
  slug: string;
  topic: string;
  rawVideoPath: string;
  listTitle: string;
  items: ChecklistItem[];
  /** Si hay una segunda persona hablando de fondo (eco/apuntador), se
   * transcribe con diarización y se corta todo lo que no diga el
   * hablante principal (quien habla primero en el video). Default: false. */
  removeOtherSpeakers?: boolean;
}
```

## Cambios de pipeline

### `src/services/checklistSyncService.ts` — nuevo tipo

```ts
export interface DiarizedWord extends TranscribedWord {
  speakerId: string;
}
```

### `src/services/elevenlabsService.ts` — nueva función

```ts
export async function transcribeWithSpeakers(audioFilePath: string): Promise<DiarizedWord[]>
```

Mismo patrón que `transcribeWithTimestamps`, pero con `diarize: "true"` en
el form-data y devolviendo `speakerId` (del campo `speaker_id` de la
respuesta) por palabra. Verificado en vivo contra el audio real del video
nuevo: la API devuelve `speaker_id` como `"speaker_0"`, `"speaker_1"`,
`"speaker_2"`.

### `src/services/videoTrimService.ts` — nuevas funciones puras

```ts
export function findPrimarySpeakerId(words: DiarizedWord[]): string;
export function detectOtherSpeakerRanges(words: DiarizedWord[], primarySpeakerId: string): CutRange[];
```

- `findPrimarySpeakerId`: devuelve el `speakerId` de la primera palabra
  (asume que el video arranca con el hablante principal, validado contra
  el video real).
- `detectOtherSpeakerRanges`: agrupa palabras consecutivas que NO son del
  hablante principal en un solo rango por tramo (no un rango por palabra
  — un tramo de "ella habla 3 segundos seguidos" da un solo `CutRange`,
  no varios pegados que haya que fusionar después).

### `src/services/generateAssets.ts` — rama condicional en `generateSocialChecklistAssets`

- Si `guion.removeOtherSpeakers`: transcribe con `transcribeWithSpeakers`
  en vez de `transcribeWithTimestamps` (se cachea igual en
  `transcript.json`, ahora con `speakerId` incluido). Calcula
  `primarySpeakerId` + `detectOtherSpeakerRanges`, y los suma a
  `cutRanges` junto con silencios y muletillas antes de fusionar/recortar.
- Si no está activado: comportamiento idéntico al actual, sin cambios.

## Guion nuevo

`content/guiones/5-herramientas-ranking.json`, `rawVideoPath` apuntando a
una copia local del video del usuario en `content/raw/`. Conteo regresivo
5→1, así que el array de items va en orden de fila 1 a 5 (no en orden de
aparición — cada item revela cuando se dice, independientemente de su
posición en la lista, como ya funciona hoy):

```json
{
  "type": "social-checklist",
  "slug": "5-herramientas-ranking",
  "topic": "Ranking de 5 herramientas de IA",
  "rawVideoPath": "content/raw/5-herramientas-ranking.mov",
  "removeOtherSpeakers": true,
  "listTitle": "5 HERRAMIENTAS DE IA QUE USTED VA A NECESITAR PARA NO SER UN DINOSAURIO",
  "items": [
    { "id": "1", "label": "AiVi", "logoQuery": "AIVI logo" },
    { "id": "2", "label": "Claude Code", "logoQuery": "Claude Anthropic AI logo" },
    { "id": "3", "label": "Notebook LM", "logoQuery": "Google NotebookLM logo" },
    { "id": "4", "label": "Gamma", "logoQuery": "Gamma app logo" },
    { "id": "5", "label": "ChatGPT", "logoQuery": "ChatGPT logo" }
  ]
}
```

Nota: igual que en el video anterior, es esperable que algunos labels no
tengan match exacto en la transcripción (ej. "Claude Code" transcrito
"CloudCode" en una sola palabra) — cae al tiempo estimado, comportamiento
ya existente y probado.

## Fuera de alcance (por ahora)

- Corte por volumen/nivel de audio independiente de la diarización.
- Detectar automáticamente cuál hablante es el "principal" con una
  heurística más robusta que "quien habla primero" (ej. por duración
  total, por posición de cámara) — no hace falta para este caso.
- Manejar más de dos hablantes de forma diferenciada (acá todo lo que no
  sea el hablante principal se corta igual, sin importar si es
  `speaker_1` o `speaker_2`).
