# Tipo de video "pantalla dividida"

## Contexto

Referencia visual: `/Users/jheitrujillo/Downloads/PantallaDividida.MP4`
(@soycarlosflow_, "Leyenda Rey Salomón: Mente Serena", 120s, 576x1024 9:16).
Estructura de 3 actos:

1. **Narrativa con pantalla dividida** (mayoría del video): ~45% arriba =
   ilustración estilo "sombras chinas" (siluetas negras recortadas sobre
   fondo dorado/sepia texturizado) que ilustra lo narrado, con una barra
   negra de subtítulo justo debajo (texto blanco centrado, es el pie de foto
   de la ilustración); ~50% abajo = presentador real hablando a cámara.
2. **Cierre emocional a pantalla completa**: corta a solo el presentador,
   sin ilustración, con el subtítulo cambiando a texto blanco superpuesto
   directo sobre el video (sin fondo), centrado a media altura — es la
   moraleja/reflexión final.
3. Outro de plataforma — fuera de alcance (es branding del video de
   referencia, no de este proyecto).

El usuario ya grabó el video crudo del presentador para el primer video de
este tipo (`content/raw/pantalla-dividida.mp4`, nombre provisional) — es una
historia/leyenda con moraleja, mismo género que la referencia.

## Decisión de arquitectura (ya acordada, ver memoria de proyecto)

Cualquier tipo de guion nuevo con un video crudo como recurso principal debe
reusar tal cual el pipeline de procesamiento de audio/video que ya tiene
`social-checklist` (transcripción ElevenLabs Scribe con timestamps por
palabra, detección/corte de silencios, muletillas, retakes y asides,
recorte ffmpeg) — descrito en detalle en
`2026-08-06-video-types-social-checklist-design.md` y
`2026-08-12-retake-detection-design.md`. Este spec **no modifica esa parte
del pipeline** en absoluto; solo agrega una rama nueva en
`generateAssets.ts` que la reusa hasta el punto de tener `words` (remapeado
post-recorte) y `durationInSeconds`, y a partir de ahí diverge.

## Decisiones acordadas con el usuario

- **Origen del guion de escenas**: el video ya está grabado, así que primero
  se transcribe (reusando el pipeline compartido) y **después**, con la
  transcripción real en mano, se arma el guion de escenas — el texto de cada
  escena tiene que existir literalmente (como substring, con la misma
  normalización que ya usa `checklistSyncService.ts`) dentro de lo que el
  presentador dijo. Esto es responsabilidad de quien arma el guion (no del
  código): el código solo hace matching, no genera texto de escena.
- **Ilustraciones**: no se generan automáticamente con kie.ai. Se preparan
  a mano: por cada escena se calcula cuántas imágenes hacen falta (ver
  regla de los 2.5s abajo) y se entrega esa lista de prompts en texto plano
  para pegar en ChatGPT; el usuario genera cada imagen y la guarda en
  `content/personajes/<slug>/<scene-id>-<n>.png` (mismo patrón de carpeta
  que ya usa `content/personajes/planos/` para tomas locales del personaje;
  para el primer video, `<slug>` = `pantalla-dividida`). El guion referencia
  esas rutas por `localImagePaths`, igual que ya hace `imageSource:
  "character"` en el tipo `vox`.
- **Regla de los 2.5 segundos**: dentro de una escena `"split"`, la
  ilustración nunca queda estática más de `MAX_CUT_SECONDS` (2.5s, constante
  ya existente en `generateAssets.ts`) — se reusa el mismo mecanismo de
  cortes que ya aplican los guiones `vox`/`documental` (`numCuts =
  duración_escena / MAX_CUT_SECONDS`, ciclando por `localImagePaths`). La
  cantidad de imágenes que se piden por escena sale de esa cuenta.
- **Acto de cierre**: se marca explícitamente por escena (`act: "closing"`),
  no con una regla implícita de "la última escena" — puede haber una o
  varias escenas de cierre seguidas al final, según lo que efectivamente
  se dijo en el video real.
- **Compatibilidad**: es un tipo nuevo (`type: "pantalla-dividida"`), no
  reemplaza ni modifica `vox`/`social-checklist`/`documental` existentes.

## Cambios de datos (`src/types/guion.ts`)

```ts
export type GuionType = "vox" | "social-checklist" | "youtube" | "pantalla-dividida";

export interface PantallaDivididaScene {
  id: string;
  /** Debe existir literalmente (substring normalizado) en la transcripción real del video. */
  text: string;
  act: "split" | "closing";
  /** Solo aplica a act "split". Imágenes ya generadas a mano (ChatGPT), en orden.
   * Se ciclan cada MAX_CUT_SECONDS dentro de la duración real de la escena. */
  localImagePaths?: string[];
}

export interface PantallaDivididaGuion {
  type: "pantalla-dividida";
  slug: string;
  topic: string;
  /** Ruta al video crudo del presentador, ej. "content/raw/pantalla-dividida.mp4". */
  rawVideoPath: string;
  /** Igual semántica que en SocialChecklistGuion: corta cualquier tramo de otro hablante. */
  removeOtherSpeakers?: boolean;
  scenes: PantallaDivididaScene[];
}

export type Guion = VoxGuion | SocialChecklistGuion | PantallaDivididaGuion;

// Tras generar assets:
export interface RenderedPantallaDivididaScene {
  id: string;
  text: string;
  act: "split" | "closing";
  startSeconds: number;
  durationInSeconds: number;
  /** false = no se encontró el texto en la transcripción, se usó tiempo estimado. */
  matched: boolean;
  /** Vacío en escenas "closing". Rutas ya copiadas a public/, con su duración de corte cada una. */
  images: SceneImage[];
}

export interface RenderedPantallaDivididaGuion {
  type: "pantalla-dividida";
  slug: string;
  topic: string;
  videoPath: string; // relativo a public/, servible con staticFile()
  durationInSeconds: number;
  scenes: RenderedPantallaDivididaScene[];
}
```

`SceneImage` (`{ path, durationInSeconds }`) ya existe, se reusa tal cual.

## Pipeline

### 1. `src/services/checklistSyncService.ts` — nueva función de matching, agregada al archivo existente (reusa la normalización interna ya escrita para `matchItemTimestamps`)

```ts
export function matchSceneTimestamps(
  words: { text: string; start: number; end: number }[],
  scenes: PantallaDivididaScene[],
  totalDurationSeconds: number,
): { scene: PantallaDivididaScene; startSeconds: number; matched: boolean }[]
```

- Misma normalización que `matchItemTimestamps` (minúsculas, sin
  acentos/puntuación), pero busca la ventana de palabras consecutivas del
  **texto completo de la escena** (no un label corto) dentro de `words`.
- Mismas reglas de fallback: si no hay match, tiempo estimado repartido
  proporcionalmente + warning en consola; si un match da un timestamp
  anterior al de la escena previa, se descarta y usa tiempo estimado — nunca
  fuera de orden.
- `durationInSeconds` de cada escena = `startSeconds` de la siguiente menos
  el propio (la última escena llega hasta `totalDurationSeconds`).
- Función pura, sin red — testeable con `vitest`, igual que
  `matchItemTimestamps`.

### 2. `src/services/generateAssets.ts` — nueva rama `generatePantallaDivididaAssets`

Comparte con `generateSocialChecklistAssets` todo el bloque hasta tener
`words` (remapeado post-recorte) y `durationInSeconds` — copia del crudo,
extracción de audio, transcripción (cacheada en `transcript.json`),
detección de silencios/muletillas/retakes/asides con revisión humana
(`retakeReviewCli.ts`), `computeKeepSegments` + `subtractRanges` +
`remapWords`, recorte final con `trimVideoToSegments`. **Se extrae esa
porción compartida a una función auxiliar** (ej. `prepareTrimmedVideo(guion:
SocialChecklistGuion | PantallaDivididaGuion)`) para no duplicar el bloque
de ~100 líneas entre ambas ramas — ambos tipos comparten `rawVideoPath` y
`removeOtherSpeakers`.

A partir de ahí, la rama nueva diverge:

1. `matchSceneTimestamps(words, guion.scenes, durationInSeconds)`.
2. Por cada escena con `act === "split"`: `numCuts = Math.max(1,
   Math.ceil(durationInSeconds_escena / MAX_CUT_SECONDS))`; copia cada
   `localImagePaths[i % length]` a
   `public/assets/<slug>/images/<scene-id>-local<i>.<ext>` (mismo patrón
   `fs.copyFileSync` que ya usa la rama `"character"` de
   `generateVoxAssets`), arma el array `images: SceneImage[]` con
   `cutDuration = durationInSeconds_escena / numCuts`.
3. Por cada escena con `act === "closing"`: `images: []`.
4. Si a alguna escena `"split"` le falta `localImagePaths` (el usuario
   todavía no generó las imágenes en ChatGPT), el pipeline **falla con un
   error claro** listando qué escenas faltan y cuántas imágenes necesita
   cada una — no se genera un render a medias con huecos.
5. Escribe `public/data/<slug>.json` con forma `RenderedPantallaDivididaGuion`.

### 3. Herramienta para generar la lista de prompts

Antes de correr `generateAssets.ts`, hace falta poder ver "cuántas imágenes
y de qué corte necesito por escena" para pedírselas al usuario. Esto se
resuelve en el momento de armar el guion a mano (yo leo la transcripción
real, escribo `scene.text` y calculo `numCuts` con la misma fórmula) — no
requiere una herramienta de código nueva, es parte del proceso de escribir
`content/guiones/<slug>.json`.

## Composición Remotion

### `src/PantallaDivididaComposition.tsx`

Mismo patrón que `SocialChecklistComposition.tsx`: `calculateMetadata` lee
`public/data/<slug>.json`, `durationInFrames` sale de `durationInSeconds`
del video.

### `src/components/PantallaDividida.tsx`

- **Un solo `<OffthreadVideo>` continuo** con el video ya recortado
  (`guion.videoPath`), posicionado absoluto — no se corta en clips por
  escena. Su tamaño/posición cambia según el acto de la escena activa en el
  frame actual:
  - Escena `"split"`: contenedor de 50% de alto, anclado abajo,
    `object-cover` (igual técnica que ya usa `SocialChecklist.tsx` a
    pantalla completa, pero limitada a la mitad inferior).
  - Escena `"closing"`: contenedor a pantalla completa, `object-cover`
    (igual que `SocialChecklist.tsx`).
- **Mitad superior** (solo durante escenas `"split"`): reusa el mismo
  algoritmo de ciclado de `scene.images` por duración que ya usa
  `FullBleedVisual` en `components/Scene.tsx` (busca qué imagen del array
  corresponde al frame actual dentro de la escena, crossfade entre cortes).
- **Subtítulo**: un componente compartido con dos variantes de estilo,
  reusando el spring de entrada que ya existe en `Scene.tsx`:
  - `variant="bar"` (escenas `"split"`): barra negra pegada justo debajo de
    la ilustración (borde inferior de la mitad superior), texto blanco
    centrado.
  - `variant="overlay"` (escenas `"closing"`): texto blanco sin fondo,
    superpuesto directo sobre el video, centrado a media altura de la
    pantalla completa.
  - En ambos casos el texto es `scene.text` completo, visible durante toda
    la duración de la escena (no palabra por palabra).
- Registro en `src/Root.tsx`: `<PantallaDivididaComposition id="..."
  slug="..." />`, mismo patrón manual que las composiciones existentes.

## Convención de archivos

```
content/raw/<slug>.mp4                              # ya gitignored
content/guiones/<slug>.json                         # type: "pantalla-dividida"
content/personajes/<slug>/<scene-id>-<n>.png         # imágenes generadas a mano en ChatGPT
public/assets/<slug>/video/source.<ext>              # copia del crudo
public/assets/<slug>/video/trimmed.<ext>             # video recortado (silencios/retakes/asides)
public/assets/<slug>/transcript.json                 # cache de transcripción
public/assets/<slug>/retake-candidates.json          # cache de candidatos (LLM)
public/assets/<slug>/approved-retake-ranges.json     # cache de rangos aprobados (revisión humana)
public/assets/<slug>/images/<scene-id>-local<n>.png  # copia de las imágenes locales, ya procesadas
public/data/<slug>.json                              # RenderedPantallaDivididaGuion
```

## Manejo de errores

- Escena `"split"` sin `localImagePaths`: el pipeline falla explícito antes
  de generar nada, listando qué escenas/cuántas imágenes faltan (ver punto
  4 del pipeline arriba).
- Escena cuyo `text` no se encuentra en la transcripción: no rompe el
  render — usa tiempo estimado y loggea advertencia (igual que
  `social-checklist` con items no encontrados).
- Match fuera de orden (timestamp anterior a la escena previa): se descarta
  y usa tiempo estimado, nunca se muestran escenas fuera de orden.
- Retakes/asides/silencios: sin cambios, ya cubierto por el pipeline
  compartido existente.

## Testing

- `matchSceneTimestamps` es función pura (sin red) — se testea con
  `vitest` igual que `matchItemTimestamps`: casos con match exacto, sin
  match (fallback estimado), match fuera de orden (se descarta), escena
  `"closing"` sin imágenes.
- El resto del pipeline compartido (`prepareTrimmedVideo`) ya tiene su
  cobertura existente vía los tests de `social-checklist` — no se duplica.

## Fuera de alcance (por ahora)

- Herramienta de código para generar automáticamente la lista de prompts
  de imagen desde el guion (se hace a mano por ahora, ver sección de
  pipeline).
- Generación automática de ilustraciones vía kie.ai para este tipo (se
  decidió explícitamente que no, ver decisiones acordadas).
- Outro de plataforma (branding ajeno, no aplica a este proyecto).
- Renombrar `content/raw/pantalla-dividida.mp4` a su slug final — se define
  cuando se arme el guion real a partir de la transcripción.
