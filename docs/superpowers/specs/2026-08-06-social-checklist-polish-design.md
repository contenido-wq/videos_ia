# Social-checklist: corte de silencios/titubeos + reveal grande con zoom

## Contexto

El tipo `social-checklist` (spec y plan del 2026-08-06, ya implementado y
mergeado a `main`) genera un video con el audio/video real del usuario y un
overlay de checklist animado. El usuario probó el resultado y pidió tres
ajustes sobre el video ya generado (`5-herramientas-ia`):

1. Que el video se sienta más orgánico: cortar los silencios entre frases y
   los titubeos (muletillas, palabras repetidas por error al hablar).
2. Un zoom-in sutil en la cámara cuando se empieza a mencionar una
   herramienta nueva, y zoom-out de vuelta al encuadre original cuando ya
   está dando la descripción.
3. Que el logo de cada herramienta no aparezca directo en su casilla chica:
   primero debe aparecer grande en el centro de la pantalla (con el número y
   el nombre, ej. "4. Gama", como en la referencia visual que subió — una
   captura de un reel existente suyo con ese patrón), y **después** achicarse
   y aterrizar en su casilla en la lista, donde se queda fijo como ya
   funciona hoy.

### Trabajo reusado

Ya existe, implementado y con tests, en otro worktree
(`.claude/worktrees/video-scenes-silence-removal`,
`src/services/silenceRemovalService.ts`, commits `339c0b5`..`9efb9b7`) un
servicio de corte de silencios vía `ffmpeg silencedetect` + `trim`/`concat`,
calibrado contra grabaciones reales de iPhone. Ese trabajo nunca se mergeó a
`main` (spec distinto, con revisión humana de escenas b-roll que no aplica
acá) pero su lógica de corte de silencio y de recorte de video con
`ffmpeg` es exactamente lo que este spec necesita — se **adapta**, no se
reescribe desde cero.

## Decisiones acordadas con el usuario

- Silencios: mismo umbral de ruido (**-20dB**, ya calibrado), pero
  **duración mínima de silencio bajada a 300ms** (antes 500ms) — corte más
  agresivo/rápido. Padding de aire: se mantiene en 120ms.
- Titubeos: automático, sin paso de revisión humana. Se cortan:
  - Una lista de muletillas comunes en español: "eh", "ehh", "eeh", "este",
    "esteee", "digo", "em", "emm", "mmm", "o sea".
  - Palabras inmediatamente repetidas (ej. "la la puerta" → se corta la
    primera "la", queda "la puerta").
- El video final queda **recortado** (silencios + titubeos fuera); el video
  crudo se conserva aparte sin tocar, para referencia.
- Reveal grande: aparece al momento exacto en que se menciona la
  herramienta (mismo timestamp que ya calcula `matchItemTimestamps`), se
  sostiene **1 segundo**, y luego transiciona (achica + vuela) a su casilla
  en ~0.33s. El texto del nombre solo se ve durante el reveal grande, nunca
  en la casilla chica (eso no cambia respecto a la implementación actual).
- Zoom: ~8% de zoom-in sobre el video de fondo, sincronizado con el reveal
  grande (entra cuando aparece la tarjeta, sale cuando la tarjeta ya
  transicionó a la casilla).

## Cambios al pipeline (`generateSocialChecklistAssets`)

El orden importa: hay que **transcribir el video crudo primero** (para poder
detectar titubeos con el texto real), y **recién después recortar** el
video combinando silencios + titubeos — al revés del otro worktree, donde no
había titubeos que depender del texto y por eso transcribían el video ya
recortado. Como acá el corte de titubeos si depende de la transcripción,
hace falta re-mapear los timestamps de las palabras que sobreviven a la
nueva línea de tiempo recortada.

Nuevo servicio `src/services/videoTrimService.ts` (adapta la lógica de
`silenceRemovalService.ts` del otro worktree):

```ts
export interface CutRange { start: number; end: number; }
export interface KeepRange { start: number; end: number; }

// Igual a parseSilenceDetectOutput del otro worktree, sin cambios de lógica.
export function parseSilenceDetectOutput(stderr: string, totalDurationSeconds?: number): CutRange[];

// Detecta muletillas + palabras repetidas en la transcripción cruda.
export function detectFillerRanges(words: TranscribedWord[]): CutRange[];

// Une rangos de silencio + titubeos, fusiona los que se solapan o quedan
// pegados, y devuelve la lista ordenada final de "esto se corta".
export function mergeCutRanges(ranges: CutRange[]): CutRange[];

// Igual a computeSpeechSegments del otro worktree (incluye sus mismos
// casos de test), pero con nombre genérico porque ahora los rangos no son
// solo de silencio.
export function computeKeepSegments(totalDurationSeconds: number, cutRanges: CutRange[], paddingSeconds?: number): KeepRange[];

// Corta+concatena el video de entrada a los segmentos indicados (mismo
// filtro ffmpeg trim+concat ya probado en el otro worktree, parametrizado
// para recibir los segmentos en vez de calcularlos internamente).
export async function trimVideoToSegments(inputPath: string, outputPath: string, segments: KeepRange[]): Promise<void>;

// Descarta las palabras que caen dentro de un rango cortado, y desplaza el
// timestamp de las que sobreviven a la nueva línea de tiempo (resta la
// duración acumulada de los cortes que quedan antes de cada palabra).
export function remapWords(words: TranscribedWord[], cutRanges: CutRange[]): TranscribedWord[];
```

Nueva secuencia dentro de `generateSocialChecklistAssets`:

1. Copiar el video crudo (sin cambios respecto a hoy).
2. Extraer audio + transcribir el video **crudo** con
   `transcribeWithTimestamps` (cachear en `transcript.json`, sin cambios).
3. `detectFillerRanges(words)` + `ffmpeg silencedetect` sobre el video
   crudo → `mergeCutRanges(...)`.
4. `computeKeepSegments(duraciónCruda, cutRanges, 0.12)` →
   `trimVideoToSegments(...)` escribe
   `public/assets/<slug>/video/trimmed.<ext>` (cacheado: si ya existe, se
   reutiliza, igual que el resto del pipeline).
5. `remapWords(words, cutRanges)` → nueva lista de palabras ya limpia y con
   timestamps de la línea de tiempo recortada.
6. `matchItemTimestamps(palabrasRemapeadas, items, duraciónDelVideoRecortado)`
   — sin cambios en su lógica, solo cambian sus datos de entrada.
7. Resto del pipeline igual (logos, `public/data/<slug>.json`), pero
   `videoPath` apunta al **video recortado**, no al crudo.

## Cambios a la composición (`SocialChecklist.tsx`)

- Nuevo componente `RevealCard`: tarjeta blanca grande con el logo +
  "N. Label" en texto blanco arriba, centrada en pantalla. Aparece con
  spring en `item.startFrame`, se sostiene `REVEAL_HOLD_FRAMES` (30 frames
  = 1s @ 30fps), y transiciona (escala + posición) hacia las coordenadas de
  la casilla chica en `TRANSITION_FRAMES` (10 frames ≈ 0.33s) adicionales.
- El icono chico en la casilla (`ChecklistRow`, ya existente) ahora aparece
  recién en `item.startFrame + REVEAL_HOLD_FRAMES + TRANSITION_FRAMES` (antes
  aparecía directo en `item.startFrame`) — coincide exactamente con el
  momento en que `RevealCard` termina su transición y "aterriza" ahí.
- Zoom de cámara: función pura `computeZoomScale(frame, fps, items)` que
  devuelve el factor de escala del video de fondo — 1.0 en reposo, sube
  suave a 1.08 cuando `frame` cae dentro de la ventana `[item.startFrame,
  item.startFrame + REVEAL_HOLD_FRAMES]` de cualquier item, y vuelve a 1.0
  durante los `TRANSITION_FRAMES` siguientes. Se aplica como `transform:
  scale(...)` al `OffthreadVideo`.
- El texto del nombre (`item.label`) se muestra en `RevealCard` — esto es
  nuevo: el spec anterior decía "no se muestra el label en pantalla",
  ahora sí se muestra, pero **solo** durante el reveal grande, nunca en la
  casilla chica final (ahí sigue sin texto, como hoy).

## Fuera de alcance (por ahora)

- Revisión humana de los cortes de titubeos antes del render final (el
  usuario pidió automático).
- Aplicar este mismo tratamiento (silencios/titubeos/zoom/reveal) a
  guiones `vox` — es exclusivo del tipo `social-checklist`.
- Ajustar la lista de muletillas por idioma/región más allá del español
  genérico ya definido.
