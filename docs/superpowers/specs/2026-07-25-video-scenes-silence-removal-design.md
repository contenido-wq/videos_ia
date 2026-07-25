# Video propio: corte de silencios + escenas de b-roll sincronizadas

## Contexto

El proyecto ya tiene un pipeline para generar "documentales" desde un guion escrito
a mano (`content/guiones/*.json`) con narración generada por ElevenLabs TTS y
collages de imágenes (`src/components/CollageScene.tsx`, `src/services/generateAssets.ts`,
`src/DocumentalComposition.tsx`).

Este spec cubre un caso distinto: el usuario sube **su propio video hablando a cámara**
(no un guion escrito) y quiere:

1. Que se le quiten los silencios (pausas donde no está hablando).
2. Que, mientras habla, se le vayan poniendo escenas visuales (collages de imágenes
   reales de Wikipedia/Wikimedia Commons) que ilustren lo que va diciendo, tapando
   la cámara a pantalla completa — igual al estilo visual que ya usan los
   documentales existentes.

Video de prueba para esta primera corrida: `content/raw/video-1-jhei.mov`
(iPhone 16 Pro Max, 3840×2160 grabado en vertical con matriz de rotación -90°
→ se ve nativo en 9:16, 24fps, 72s, audio AAC estéreo 48kHz).

## Decisiones ya acordadas con el usuario

- **B-roll a pantalla completa** (no picture-in-picture): mientras suena la voz del
  usuario, el collage tapa toda la pantalla; la cámara no se ve en esos tramos.
- **Fuente de imágenes: Wikipedia/Wikimedia Commons**, no Apify (el usuario ya
  reportó que los resultados de Apify no le sirven; hay un comentario en `.env`
  confirmando que ese scraper "devuelve resultados genéricos sin relación con la
  query").
- **Hay un paso de revisión humana**: antes de salir a buscar imágenes, se le
  muestra al usuario el guion transcrito y segmentado en escenas con las palabras
  clave propuestas por escena, para que las apruebe o ajuste.
- Formato de salida: 1080×1920 @ 30fps (igual que el resto del proyecto).
- Alcance: un video a la vez. Sin mezcla de música ni PIP en esta primera versión.

## Pipeline

Nuevo script orquestador `src/services/generateUserVideoAssets.ts` (mismo patrón
que `generateAssets.ts`), invocado como `tsx src/services/generateUserVideoAssets.ts <slug>`,
dividido en dos corridas porque hay un punto de revisión humana en el medio:

```
tsx src/services/generateUserVideoAssets.ts video-1-jhei --hasta-borrador
   (usuario revisa/edita el borrador)
tsx src/services/generateUserVideoAssets.ts video-1-jhei --desde-borrador
```

### Paso 1 — Cortar silencios (`src/services/silenceRemovalService.ts`)

- Usa `ffmpeg` (ya instalado localmente, sin dependencia nueva) vía
  `silencedetect` para encontrar tramos por debajo de **-35dB** de más de
  **500ms**.
- Construye la lista de tramos "con voz" (el complemento de los silencios
  detectados), agregando **~120ms de aire** antes y después de cada tramo para
  no comerse inicios/finales de palabra.
- Corta y concatena esos tramos con el filtro `concat` de ffmpeg (un solo paso,
  sin reencodear dos veces) en un video continuo, sin huecos, ya rotado/escalado
  a 1080×1920.
- Salida: `public/assets/<slug>/video/trimmed.mp4`.
- Umbral y duración mínima son constantes ajustables al inicio del archivo, no
  hace falta flag por ahora — si el resultado corta mal, se ajusta el número y
  se vuelve a correr (es rápido, es un solo video).

### Paso 2 — Transcribir (`src/services/elevenlabsService.ts`, nueva función)

- Se transcribe **el video ya recortado** (no el original), usando ElevenLabs
  Speech-to-Text (Scribe) — mismo `ELEVENLABS_API_KEY` que ya usan para TTS.
  Transcribir el video recortado evita tener que remapear timestamps a través
  de los cortes: el tiempo que devuelve el STT ya calza con la línea de tiempo
  final.
- Se pide el modo con timestamps por palabra (`timestamps_granularity: "word"`
  o el parámetro equivalente de la API de Scribe).

### Paso 3 — Segmentar en escenas (`src/services/sceneSegmentationService.ts`)

- Agrupa las palabras transcritas en escenas de **~3 a 6 segundos**, cortando
  en las pausas más largas dentro de ese rango (nunca a mitad de una palabra/frase).
- Si una frase natural es más larga que 6s, se corta igual en la pausa más
  cercana disponible (relleno de aire entre palabras), priorizando no partir
  a media palabra.
- Por cada escena, extrae 2-4 **palabras clave** con un filtro simple de
  stopwords en español (sin NLP/IA): sustantivos y nombres propios con
  mayúscula inicial tienen prioridad; si no hay suficientes, se usan las
  palabras más largas restantes.

### Paso 4 — Borrador para revisión

- Se escribe `content/guiones/<slug>-borrador.json` con esta forma (nuevo tipo,
  `src/types/userVideoGuion.ts`):

```ts
interface UserVideoScene {
  id: string;              // "s01", "s02"...
  startSeconds: number;    // en la línea de tiempo del video ya recortado
  endSeconds: number;
  text: string;            // texto transcrito de la escena, para contexto humano
  keywords: string[];      // editable por el usuario antes del paso 5
  layout?: CollageLayout;  // default: "silhouette-collage"
}

interface UserVideoGuion {
  slug: string;
  sourceVideoPath: string; // "video/trimmed.mp4", relativo a public/assets/<slug>/
  scenes: UserVideoScene[];
}
```

- El usuario edita este JSON a mano (texto/keywords/layout) y me avisa cuando
  está listo, o me pide que yo ajuste puntos específicos.
- Este es el punto de corte entre `--hasta-borrador` y `--desde-borrador`.

### Paso 5 — Buscar imágenes en Wikimedia (`src/services/wikimediaService.ts`)

- Nuevo servicio, mismo rol que `apifyService.ts` pero contra la API pública
  de Wikimedia Commons (sin API key): búsqueda por texto
  (`action=query&list=search&srsearch=<keywords>&srnamespace=6`) y resolución
  de la URL final de archivo vía `Special:FilePath` — el mismo patrón de URL
  que ya aparece a mano en `content/guiones/mundial-2026-resumen.json`.
- Devuelve 2-4 URLs de imagen por escena según el `layout` (p. ej.
  `silhouette-collage` usa varias, `full` usa una).
- Escribe el JSON final `content/guiones/<slug>.json` (mismo archivo, ahora
  con `collageImageUrls` poblado) y descarga las imágenes a
  `public/assets/<slug>/images/`, igual que hace `generateAssets.ts` hoy.

### Paso 6 — Composición Remotion (`src/UserVideoComposition.tsx`)

- Nuevo componente (no reutiliza `DocumentalComposition.tsx` porque ahí el
  audio es por-escena vía TTS; acá es **un solo audio continuo** — el del
  video recortado — con escenas visuales superpuestas encima).
- Estructura:
  - `<Audio src={staticFile("assets/<slug>/video/trimmed.mp4")} />` (o
    `<OffthreadVideo>` con el video oculto/mudo si en algún momento se quiere
    mostrar la cámara; en esta versión el audio es lo único que se usa del
    video fuente) sonando de corrido durante toda la duración de la
    composición.
  - Un `<Sequence from={} durationInFrames={}>` por escena (convertido de
    `startSeconds`/`endSeconds` a frames a 30fps), cada uno renderizando
    `<CollageScene>` tal cual existe hoy, sin cambios.
  - `durationInFrames` de la composición = duración total del video recortado,
    calculado con un `calculateMetadataFunction` que lee el guion final (mismo
    patrón que ya usa `DocumentalComposition.tsx` con `loadGuion`/`calculateMetadata`).
- Se registra en `src/Root.tsx` junto a las demás composiciones:
  `<UserVideoComposition id="VideoJhei" slug="video-1-jhei" />`.

## Convención de archivos

```
content/raw/<slug>.mov              # video crudo que el usuario copia (gitignored)
content/guiones/<slug>-borrador.json # borrador para revisión humana
content/guiones/<slug>.json          # guion final, mismo formato que usa CollageScene
public/assets/<slug>/video/trimmed.mp4
public/assets/<slug>/images/...
```

- Se agrega `content/raw/` a `.gitignore`: son videos personales pesados
  (cientos de MB), no assets finales del proyecto — no tiene sentido
  versionarlos, igual que `out/` (salida renderizada) ya está ignorado.

## Fuera de alcance (por ahora)

- Picture-in-picture / mostrar la cámara del usuario en algún momento.
- Mezcla de música de fondo o SFX.
- Selección automática de imágenes sin revisión humana del guion.
- Procesar más de un video por corrida.
- Ajuste fino de umbral de silencio vía flags de CLI (se ajusta a mano en el
  código si hace falta, dado que es un solo video a la vez).
