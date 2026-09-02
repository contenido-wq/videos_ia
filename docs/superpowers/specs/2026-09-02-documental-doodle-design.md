# Tipo de video "documental-doodle"

## Contexto

Nuevo formato de YouTube, hermano de `youtube-noticias-avatar` pero sin
experto en cámara. Referencia visual: canal "Zenn" en YouTube (ej.
`https://www.youtube.com/watch?v=st_Ah6Ykbh4`, "¿Qué hacían los primeros
humanos por la noche?") — video horizontal narrado en off, sin nadie
hablando a cámara, con ilustraciones estilo doodle/cartoon plano (contorno
negro grueso, colores planos, tipo dibujo explicativo) que cambian cada
pocos segundos siguiendo la narración. El reproductor no llegó a cargar
frames durante la investigación (buffering persistente en el navegador
remoto), así que el estilo se confirmó por la miniatura del canal y por
preguntas directas al usuario — ver "Decisiones acordadas con el usuario".

Segundo formato **horizontal (16:9)** del proyecto, junto con
`youtube-noticias-avatar` (`vox`, `social-checklist` y `pantalla-dividida`
son 1080x1920, 9:16).

## Decisión de arquitectura (acordada con el usuario)

Skill nuevo y separado (`documental-doodle`), **no** un tercer estilo
visual dentro de `vox` — aunque el mecanismo de fondo (voz IA + imágenes
generadas por escena) es el mismo que usa `vox`, el layout horizontal, los
subtítulos palabra por palabra y la ausencia total de avatar/cámara lo
hacen lo bastante distinto como para justificar un tipo propio, siguiendo
el mismo criterio ya usado para separar `youtube-noticias-avatar` de
`pantalla-dividida`.

A diferencia de `youtube-noticias-avatar` (que reusa `prepareTrimmedVideo`
porque su recurso principal es un video crudo real), acá **no hay video
crudo**: la narración se genera con voz IA por escena, igual mecanismo que
ya usa `generateScene` en `vox` (`generateVoice` + `MAX_CUT_SECONDS` para
repartir la duración en cortes de imagen) — pero con su propia cadencia de
corte (5s en vez de 2.5s), su propio aspect ratio de imagen (16:9 en vez de
9:16), y agregando transcripción por escena para poder armar subtítulos
palabra por palabra (cosa que `vox` no hace hoy).

## Decisiones acordadas con el usuario

- **Origen de las imágenes**: generadas automáticamente con IA (kie.ai, vía
  `generateImage` — mismo servicio que ya usa `vox`), no las provee el
  usuario en una carpeta. El estilo doodle/cartoon se define en el texto
  del prompt (`scene.visual`) al redactar cada guion real, **no**
  hardcodeado en el pipeline — mismo criterio que ya usan `vox`/`collage`
  (el estilo visual vive en el prompt, no en código).
- **Cadencia de cambio de imagen**: cada 5 segundos dentro de la duración
  real de cada escena (`Math.ceil(duración / 5)` imágenes), con el mismo
  zoom Ken Burns sutil + crossfade entre cortes que ya usa
  `youtube-noticias-avatar` (alterna in/out por escena).
- **Narración**: 100% voz generada con IA (ElevenLabs `generateVoice`), no
  hay grabación del usuario — por lo tanto no aplica nada del pipeline de
  recorte de silencios/retakes/asides (`prepareTrimmedVideo`), que es
  exclusivo de tipos con video crudo real.
- **Formato**: horizontal 16:9, 1920x1080, 30fps — igual que
  `youtube-noticias-avatar`.
- **Subtítulos**: palabra por palabra tipo karaoke, resaltados en amarillo
  (el resto en blanco, mayúsculas, contorno negro) — mismo componente
  visual que `youtube-noticias-avatar`, pero centrados abajo de la pantalla
  completa (no hay panel de video que los empuje a un costado).
- **Música de fondo**: no.
- **Sin avatar, sin panel dividido, sin botón "SUBSCRIBE"**: a diferencia
  de `youtube-noticias-avatar`, acá la imagen ocupa el 100% de la pantalla
  todo el tiempo.

## Cambios de datos (`src/types/guion.ts`)

```ts
export type GuionType =
  | "vox"
  | "social-checklist"
  | "youtube"
  | "pantalla-dividida"
  | "youtube-noticias-avatar"
  | "documental-doodle";

export interface DocumentalDoodleScene {
  id: string;
  /** Texto que se narra en esta escena — se convierte a voz con ElevenLabs. */
  text: string;
  /** Descripción de la escena para generar la(s) imagen(es) con IA. El estilo
   * doodle/cartoon (contorno negro grueso, colores planos, etc.) se escribe
   * acá explícitamente al redactar el guion — no hay un sufijo automático. */
  visual: string;
}

export interface DocumentalDoodleGuion {
  type: "documental-doodle";
  slug: string;
  topic: string;
  /** Voz de ElevenLabs a usar; default si se omite (mismo default que `vox`). */
  voiceId?: string;
  scenes: DocumentalDoodleScene[];
}

export type Guion =
  | VoxGuion
  | SocialChecklistGuion
  | PantallaDivididaGuion
  | YoutubeNoticiasAvatarGuion
  | DocumentalDoodleGuion;

// Tras generar assets:
export interface RenderedDocumentalDoodleScene {
  id: string;
  text: string;
  startSeconds: number;
  durationInSeconds: number;
  images: SceneImage[]; // se ciclan cada DOODLE_CUT_SECONDS (5s)
}

export interface RenderedDocumentalDoodleGuion {
  type: "documental-doodle";
  slug: string;
  topic: string;
  durationInSeconds: number;
  scenes: RenderedDocumentalDoodleScene[];
  captionChunks: CaptionChunk[]; // tipo ya existente, reusado tal cual
}
```

`SceneImage` y `CaptionChunk` ya existen (agregados en el spec de
`youtube-noticias-avatar`), se reusan tal cual sin cambios.

## Pipeline

### `src/services/generateAssets.ts` — nueva rama `generateDocumentalDoodleAssets`

No reusa `prepareTrimmedVideo` (no hay video crudo). Flujo:

1. `const DOODLE_CUT_SECONDS = 5;` (constante propia de esta rama — no se
   toca `MAX_CUT_SECONDS` de `vox`/`pantalla-dividida` ni
   `NEWS_AVATAR_CUT_SECONDS` de `youtube-noticias-avatar`).
2. Por cada escena, **en orden** (la siguiente necesita saber dónde termina
   la anterior para el offset de tiempo):
   a. Generar voz: `generateVoice(scene.text, { outputPath, voiceId:
      guion.voiceId })` → `public/assets/<slug>/audio/<scene-id>.mp3` (si ya
      existe, se reusa, mismo criterio que `generateScene` en `vox`).
   b. `durationInSeconds = getAudioDurationInSeconds(audioAbsPath)`.
   c. Transcribir esa misma escena con timestamps por palabra:
      `transcribeWithTimestamps(audioAbsPath)` (ya existe, usado hoy solo
      para video real — acá se aplica al audio TTS recién generado).
      Offsetear cada palabra sumando el `startSeconds` acumulado de las
      escenas anteriores, y acumular todas en un array `allWords` que
      cruza todas las escenas.
   d. `numCuts = Math.max(1, Math.ceil(durationInSeconds /
      DOODLE_CUT_SECONDS))`, `cutDuration = durationInSeconds / numCuts`.
   e. Generar `numCuts` imágenes con `generateImage(prompt, imageAbsPath, {
      aspectRatio: "16:9" })` → `public/assets/<slug>/images/<scene-id>-<i>.png`
      (reusa si ya existe). Mismo patrón de prompt que `vox` cuando
      `numCuts > 1`: `` `${scene.visual}, alternate camera angle / closer
      framing, cut ${i+1} of ${numCuts} in the same documentary sequence,
      same subject and art style` `` para mantener consistencia visual
      entre cortes de la misma escena.
   f. Arma `RenderedDocumentalDoodleScene` con `startSeconds` (offset
      acumulado), `durationInSeconds`, `images: SceneImage[]`.
3. Con `allWords` ya completo (todas las escenas): `buildCaptionChunks(allWords,
   4, 0.6)` — mismos parámetros default que `youtube-noticias-avatar`.
4. Sin generación de sfx/música — esta rama no llama nada de
   `sound-generation` ni copia pistas de `content/musica/`.
5. Escribe `public/data/<slug>.json` con forma `RenderedDocumentalDoodleGuion`.

## Composición Remotion

### `src/DocumentalDoodleComposition.tsx`

Mismo patrón que `YoutubeNoticiasAvatarComposition.tsx`:

```ts
const FPS = 30;
const WIDTH = 1920;
const HEIGHT = 1080;
```

`calculateMetadata` lee `public/data/<slug>.json` y suma
`scene.durationInSeconds` de todas las escenas para la duración total.

### `src/components/DocumentalDoodle.tsx`

Componente nuevo y autocontenido — sigue el mismo criterio ya establecido
en el proyecto de no compartir componentes entre estilos (el propio
`YoutubeNoticiasAvatar.tsx` duplicó a propósito el algoritmo de
`PantallaDividida.tsx` en vez de extraerlo a un módulo común; acá se repite
el criterio):

- **Imagen a pantalla completa**: copia adaptada de `BackgroundIllustration`
  (de `YoutubeNoticiasAvatar.tsx`) ocupando el 100% del frame (`inset-0`) en
  vez del panel izquierdo al 62% — mismo ciclado con crossfade
  (`CUT_TRANSITION_FRAMES`) y mismo Ken Burns (`ZOOM_SCALE_DELTA`,
  alternando in/out por escena vía `sceneIndex % 2`).
- **Subtítulos palabra por palabra**: copia adaptada de
  `WordHighlightCaption` (de `YoutubeNoticiasAvatar.tsx`), centrada abajo de
  la pantalla completa (`inset-x-0 bottom-16`, ya lo está — no necesita
  ajuste de ancho porque ya no compite con ningún panel).
- Sin panel de video, sin botón "SUBSCRIBE".
- `findActiveScene`/`findActiveChunk`: mismas funciones, copiadas tal cual
  (ya son puras, sin dependencia del layout).
- Registro en `src/Root.tsx`: `<DocumentalDoodleComposition id="..."
  slug="..." />`, mismo patrón manual que las composiciones existentes.

## Convención de archivos

```
content/guiones/<slug>.json                        # type: "documental-doodle"
public/assets/<slug>/audio/<scene-id>.mp3           # voz TTS por escena
public/assets/<slug>/images/<scene-id>-<n>.png      # imágenes doodle generadas con IA
public/data/<slug>.json                             # RenderedDocumentalDoodleGuion
```

No hay `content/raw/`, `content/personajes/` ni `content/musica/` para este
tipo (no hay video crudo, imágenes locales, ni música).

## Manejo de errores

- `generateVoice`/`generateImage`/`transcribeWithTimestamps` ya tiran error
  explícito si la API falla (`res.ok` check existente en cada servicio) —
  sin manejo adicional necesario, se propaga tal cual como en `vox`.
- Escena con `text` vacío: falla explícito antes de llamar a la API (evita
  gastar créditos generando voz de una escena sin contenido).
- Nada que "matchear" contra una transcripción real (no hay video crudo),
  así que no aplica el concepto de `matched: false` que sí tienen
  `pantalla-dividida`/`youtube-noticias-avatar`.

## Testing

- Sin tests nuevos dedicados para `generateDocumentalDoodleAssets` (mismo
  criterio que `generateVoxAssets`/`generateYoutubeNoticiasAvatarAssets`,
  que tampoco los tienen — la lógica nueva es orquestación de servicios ya
  testeados: `buildCaptionChunks` ya tiene tests, `generateVoice`/
  `generateImage`/`transcribeWithTimestamps` son llamadas a red sin lógica
  propia que testear unitariamente).
- Verificación manual de la composición con `npm run dev` usando un guion
  fixture corto (2 escenas) antes de armar un video real.

## Fuera de alcance (por ahora)

- Cualquier variante de estilo visual distinta a doodle/cartoon plano (ej.
  fotorrealista) — si se pidiera en el futuro, sería una opción `style`
  nueva, no se construye ahora (YAGNI).
- Música de fondo y efectos de sonido.
- Botón "SUBSCRIBE" u otro overlay de engagement.
- El `SKILL.md` de este formato (`.claude/skills/documental-doodle/`) se
  arma en el plan de implementación siguiente, con el mismo esqueleto que
  `youtube-noticias-avatar`/`vox` (no se repite esa estructura acá).
- Conectar el reproductor de YouTube para inspeccionar frames reales del
  video de referencia — no se logró durante esta investigación (buffering
  persistente); el estilo quedó confirmado por miniatura + descripción +
  respuestas directas del usuario, no por inspección visual frame a frame.
