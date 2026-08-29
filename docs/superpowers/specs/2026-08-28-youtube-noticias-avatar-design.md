# Tipo de video "youtube-noticias-avatar"

## Contexto

Primer formato de una familia planeada de varios tipos de video para YouTube
(el usuario aclaró explícitamente que este es "uno de muchos" — por ahora
solo se desarrolla este). Referencia visual: capturas de un video real de
noticias estilo "breaking news" (16:9, ~19:49 de duración): panel izquierdo
grande con una ilustración de fondo (estilo pintura al óleo) que va
cambiando cada ~4 segundos según lo que se narra, panel derecho angosto y
vertical con el experto hablando a cámara, subtítulos grandes en la parte
inferior del panel izquierdo con la palabra que se está diciendo resaltada
en amarillo (el resto en blanco, mayúsculas, trazo negro), y opcionalmente
un botón "SUBSCRIBE" falso arriba a la izquierda como gancho de engagement.

Es el primer formato **horizontal (16:9)** del proyecto — `vox`,
`social-checklist` y `pantalla-dividida` son todos 1080x1920 (9:16).

## Decisión de arquitectura (ya acordada, ver memoria de proyecto)

Como cualquier tipo con un video crudo como recurso principal, reusa tal
cual el pipeline de audio/video ya existente (`prepareTrimmedVideo`:
transcripción ElevenLabs con timestamps por palabra, detección/corte de
silencios, muletillas, retakes y asides vía Claude con revisión humana
interactiva, recorte ffmpeg). Este spec no modifica esa parte; solo agrega
una rama nueva en `generateAssets.ts` a partir de `words` +
`durationInSeconds`.

## Decisiones acordadas con el usuario

- **Origen de las imágenes de fondo**: por ahora el usuario las prepara y
  las entrega en una carpeta ya numeradas (mismo patrón que
  `pantalla-dividida`: `content/personajes/<slug>/<scene-id>-<n>.png`,
  referenciadas por `localImagePaths`). **Queda anotado como trabajo
  futuro** (fuera de alcance de este spec) conectar esto a una API de
  generación de imágenes cuando el usuario decida qué plataforma usar — no
  se construye ahora.
- **Cadencia de cambio de imagen**: cada 4 segundos dentro de la duración
  real de cada escena — no negociable, y siempre debe corresponder a lo que
  se está diciendo en ese momento (de ahí que el `text` de cada escena deba
  existir literalmente en la transcripción real, igual que
  `pantalla-dividida`).
- **Estructura**: pantalla dividida de principio a fin, sin cierre especial
  (a diferencia de `pantalla-dividida`, acá no hay "acto 2").
- **Música de fondo**: no por ahora.
- **Botón "SUBSCRIBE"**: overlay opcional, se pregunta en cada video
  (`subscribeButton: true|false` en el guion) — no va fijo siempre.
- **Subtítulos**: a diferencia de `pantalla-dividida` (texto completo de la
  escena, estático durante toda su duración), acá son **palabra por
  palabra** tipo karaoke — la palabra que se está diciendo en ese instante
  resaltada, agrupadas en bloques cortos independientes de las escenas de
  imagen (las escenas controlan el fondo, no el agrupamiento de subtítulos).
- **Sin generación de voz**: el audio es 100% el real de la grabación,
  igual que `social-checklist`/`pantalla-dividida`.
- **Compatibilidad**: tipo nuevo (`type: "youtube-noticias-avatar"`), no
  reutiliza el valor `"youtube"` que ya existe reservado (y sin
  implementación) en `GuionType` — se deja libre para un futuro formato de
  YouTube distinto.

## Cambios de datos (`src/types/guion.ts`)

```ts
export type GuionType = "vox" | "social-checklist" | "youtube" | "pantalla-dividida" | "youtube-noticias-avatar";

export interface YoutubeNoticiasAvatarScene {
  id: string;
  /** Debe existir literalmente (substring normalizado) en la transcripción real del video. */
  text: string;
  /** Imágenes ya preparadas por el usuario, en orden. Se ciclan cada NEWS_AVATAR_CUT_SECONDS (4s)
   * dentro de la duración real de la escena (igual mecanismo que `pantalla-dividida`). */
  localImagePaths: string[];
}

export interface YoutubeNoticiasAvatarGuion {
  type: "youtube-noticias-avatar";
  slug: string;
  topic: string;
  /** Ruta al video crudo del experto, ej. "content/raw/mi-noticia.mp4". */
  rawVideoPath: string;
  removeOtherSpeakers?: boolean;
  scenes: YoutubeNoticiasAvatarScene[];
  /** Default false. Se pregunta explícitamente en cada video, no va fijo. */
  subscribeButton?: boolean;
}

export type Guion = VoxGuion | SocialChecklistGuion | PantallaDivididaGuion | YoutubeNoticiasAvatarGuion;

// Tras generar assets:
export interface RenderedYoutubeNoticiasAvatarScene {
  id: string;
  text: string;
  startSeconds: number;
  durationInSeconds: number;
  /** false = no se encontró el texto en la transcripción, se usó tiempo estimado. */
  matched: boolean;
  images: SceneImage[];
}

export interface CaptionWord {
  text: string;
  start: number;
  end: number;
}

export interface CaptionChunk {
  words: CaptionWord[];
  startSeconds: number;
  endSeconds: number;
}

export interface RenderedYoutubeNoticiasAvatarGuion {
  type: "youtube-noticias-avatar";
  slug: string;
  topic: string;
  videoPath: string; // relativo a public/, servible con staticFile()
  durationInSeconds: number;
  subscribeButton: boolean;
  scenes: RenderedYoutubeNoticiasAvatarScene[];
  captionChunks: CaptionChunk[];
}
```

`SceneImage` ya existe, se reusa tal cual.

## Pipeline

### 1. `src/services/checklistSyncService.ts` — generalizar `matchSceneTimestamps`

Hoy está tipada específicamente a `PantallaDivididaScene[]`, pero la lógica
solo usa `.text`. Se generaliza a genérico para reusarla sin duplicar:

```ts
export function matchSceneTimestamps<T extends { text: string }>(
  words: TranscribedWord[],
  scenes: T[],
  totalDurationSeconds: number,
): { scene: T; startSeconds: number; durationInSeconds: number; matched: boolean }[]
```

Comportamiento idéntico al actual (normalización, fallback a tiempo
estimado, descarte de matches fuera de orden) — cambia solo la firma de
tipos. Los tests existentes de `pantalla-dividida` deben seguir pasando sin
modificación.

### 2. `src/services/captionChunkService.ts` (nuevo)

```ts
export function buildCaptionChunks(
  words: TranscribedWord[],
  maxWordsPerChunk: number,
  maxGapSeconds: number,
): CaptionChunk[]
```

Agrupa `words` (ya remapeadas post-recorte, mismas que usa
`matchSceneTimestamps`) en bloques cortos para los subtítulos: cierra el
bloque actual y arranca uno nuevo cuando llega a `maxWordsPerChunk`
palabras (default 4, según las referencias: "THREE DIFFERENT COUNTRIES",
"PEREIRA, MANIZALES") o cuando el hueco entre el fin de la palabra anterior
y el inicio de la siguiente supera `maxGapSeconds` (default 0.6s, pausa
natural). Es independiente de `scenes` — los subtítulos no están atados a
los cortes de imagen de fondo. Función pura, sin red, testeable con
`vitest`.

### 3. `src/services/generateAssets.ts` — nueva rama `generateYoutubeNoticiasAvatarAssets`

Reusa `prepareTrimmedVideo` (sin cambios) para obtener `words`, `videoPath`,
`durationInSeconds`. A partir de ahí:

1. `const NEWS_AVATAR_CUT_SECONDS = 4;` (constante propia de esta rama, no
   se toca `MAX_CUT_SECONDS` que usan `vox`/`pantalla-dividida`).
2. `matchSceneTimestamps(words, guion.scenes, durationInSeconds)`.
3. Si alguna escena no tiene `localImagePaths` (vacío o falta): el pipeline
   **falla explícito** listando qué escenas faltan y cuántas imágenes
   necesita cada una (`Math.ceil(duración / 4)`) — mismo criterio que
   `pantalla-dividida`.
4. Por cada escena: copia cada `localImagePaths[i % length]` a
   `public/assets/<slug>/images/<scene-id>-local<i>.<ext>` (mismo
   `fs.copyFileSync` que ya usan `vox`/`pantalla-dividida`), arma
   `images: SceneImage[]` con `cutDuration = sceneDuration / numCuts`.
5. `buildCaptionChunks(words, 4, 0.6)` sobre el `words` completo (no por
   escena).
6. Sin generación de sfx/música — esta rama no llama nada de
   `sound-generation` ni copia pistas de `content/musica/`.
7. Escribe `public/data/<slug>.json` con forma
   `RenderedYoutubeNoticiasAvatarGuion` (incluye `subscribeButton: guion.subscribeButton ?? false`).

Si `guion.subscribeButton` es `true` y no existe el asset compartido
`public/assets/youtube-noticias-avatar/subscribe-button.png`, el pipeline
falla explícito indicando esa ruta esperada (el usuario debe colocarlo ahí
una vez; no se genera automáticamente, ver "Fuera de alcance").

## Composición Remotion

### `src/YoutubeNoticiasAvatarComposition.tsx`

Mismo patrón que `PantallaDivididaComposition.tsx`, pero horizontal:

```ts
const FPS = 30;
const WIDTH = 1920;
const HEIGHT = 1080;
```

`calculateMetadata` lee `public/data/<slug>.json` igual que los demás tipos.

### `src/components/YoutubeNoticiasAvatar.tsx`

- **Panel derecho** (franja vertical, ~38% del ancho, ej. `x: 62%..100%`,
  alto completo): un solo `<OffthreadVideo>` continuo del video ya
  recortado (`guion.videoPath`), `object-cover`, sin cortar en clips —
  misma técnica que el panel de video de `PantallaDividida.tsx`, pero
  ocupando una franja vertical a la derecha en vez de la mitad inferior.
- **Panel izquierdo** (~62% del ancho, alto completo): reusa el mismo
  algoritmo de ciclado con crossfade de `SceneIllustration` (ya existe en
  `PantallaDividida.tsx`) sobre `scene.images`, ubicando la escena activa
  con la misma lógica que `findActiveScene`.
- **Subtítulos palabra por palabra**: componente nuevo que, dado el frame
  actual, ubica el `CaptionChunk` activo en `guion.captionChunks` (por
  tiempo) y renderea sus palabras en una fila: la palabra cuyo
  `[start, end]` contiene el tiempo actual en amarillo, el resto en blanco
  — mayúsculas, bold, `-webkit-text-stroke` negro para el contorno (mismo
  estilo que las referencias). Posicionado en la franja inferior del panel
  izquierdo (no del video completo).
- **Botón "SUBSCRIBE"** (si `guion.subscribeButton`): `<Img
  src={staticFile("assets/youtube-noticias-avatar/subscribe-button.png")}
  />` posicionado arriba a la izquierda del panel izquierdo, tamaño fijo
  pequeño — asset compartido entre todos los videos de este tipo, no por
  slug.
- Registro en `src/Root.tsx`: `<YoutubeNoticiasAvatarComposition id="..."
  slug="..." />`, mismo patrón manual que las composiciones existentes.

## Convención de archivos

```
content/raw/<slug>.mp4                                    # gitignored
content/guiones/<slug>.json                               # type: "youtube-noticias-avatar"
content/personajes/<slug>/<scene-id>-<n>.png              # imágenes numeradas que entrega el usuario
public/assets/<slug>/video/source.<ext>
public/assets/<slug>/video/trimmed.<ext>
public/assets/<slug>/transcript.json
public/assets/<slug>/retake-candidates.json
public/assets/<slug>/approved-retake-ranges.json
public/assets/<slug>/images/<scene-id>-local<n>.png
public/assets/youtube-noticias-avatar/subscribe-button.png # asset compartido, no por slug
public/data/<slug>.json                                   # RenderedYoutubeNoticiasAvatarGuion
```

## Manejo de errores

- Escena sin `localImagePaths`: falla explícito antes de generar nada,
  listando escenas y cantidad de imágenes faltantes.
- `subscribeButton: true` sin el asset compartido en su ruta esperada:
  falla explícito con esa ruta.
- Texto de escena no encontrado en la transcripción: no rompe el render,
  usa tiempo estimado y loggea advertencia (igual que los demás tipos).
- Match fuera de orden: descartado, usa tiempo estimado (ya cubierto por
  `matchSceneTimestamps` generalizado).
- Retakes/asides/silencios: sin cambios, pipeline compartido existente.

## Testing

- `buildCaptionChunks`: función pura, tests con `vitest` — corte por
  `maxWordsPerChunk`, corte por `maxGapSeconds`, lista vacía, una sola
  palabra.
- `matchSceneTimestamps` generalizado: los tests existentes de
  `pantalla-dividida` deben seguir pasando sin cambios; agregar un caso
  mínimo con la forma de escena de `youtube-noticias-avatar` para confirmar
  que el genérico funciona igual.
- Resto del pipeline compartido (`prepareTrimmedVideo`) ya cubierto por los
  tests existentes de `social-checklist` — no se duplica.
- Verificación manual de la composición con `npm run dev`.

## Fuera de alcance (por ahora)

- Generación automática de las imágenes de fondo vía alguna API de
  generación de imágenes — el usuario las entrega manualmente por ahora;
  queda anotado como extensión futura para cuando decida qué plataforma
  usar.
- Música de fondo y cualquier efecto de sonido (whoosh/sting).
- Un cierre tipo "acto 2" (pantalla dividida corre todo el video).
- Crear el asset gráfico del botón "SUBSCRIBE" en sí — el mecanismo de
  overlay condicional sí se construye, pero el usuario provee la imagen una
  sola vez.
- El `SKILL.md` de este formato (`.claude/skills/youtube-noticias-avatar/`)
  se arma en el plan de implementación siguiente, con el mismo esqueleto
  que `vox`/`ranking`/`pantalla-dividida` (no se repite esa estructura acá).
- Otros formatos futuros de YouTube — este spec cubre únicamente
  "noticias contadas por un experto con avatar en pantalla dividida
  horizontal".
