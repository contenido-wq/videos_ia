# Analizador de canal + referencia de personaje

## Contexto

Primer sub-proyecto de una idea más grande del usuario: dado el link de un
canal de YouTube, generar automáticamente todo lo que hoy se llena a mano
para producir contenido — referencia del personaje, metadatos, disclaimer,
miniatura, título y descripción SEO. Se decidió descomponer en
sub-proyectos independientes (cada uno con su propio ciclo diseño → plan →
implementación); este spec cubre solo el primero: **analizar un canal y
fijar la referencia visual/temática de su personaje**. El paquete SEO por
video, el diseño de miniatura y el disclaimer/metadata formal del canal
quedan para specs futuros.

Se validó el flujo completo con una prueba real (spike) sobre
`https://www.youtube.com/@TheCapitalExplained` (canal de terceros, usado
solo como prueba):

- La YouTube Data API v3 (`channels.list` con `forHandle`, luego
  `playlistItems.list` + `videos.list` sobre la playlist de uploads)
  resolvió el canal y trajo título/descripción/tags/thumbnails reales sin
  problema.
- Mirando 4 thumbnails se identificó un personaje recurrente consistente
  (joven, pelo castaño ondulado, expresión cansada/escéptica, ropa
  casual, estilo de ilustración 2D plano).
- `kieAiService.editImage(...)`, pasándole 3 URLs de thumbnails reales
  como referencia, generó una imagen de personaje de cuerpo completo en
  el mismo estilo — consistente y utilizable a la primera.

## Decisión de alcance (acordada con el usuario)

- Este sub-proyecto cubre **solo**: resolver el canal, listar sus videos
  recientes, extraer temas recurrentes + descripción del personaje (si
  existe), generar la imagen de referencia, y guardar todo a disco.
- El usuario confirmó que también va a correr esto sobre canales que **no
  son suyos**, a modo de moodboard/inspiración interna — nunca para
  publicar una imagen idéntica al personaje de otro canal. El output
  incluye siempre una nota advirtiendo esto (ver "Salvaguardas").
- El disclaimer que se extrae acá es un dato suelto que sale gratis de la
  misma llamada a Claude (no cuesta nada adicional pedirlo), aunque el
  diseño formal de metadatos/disclaimer del canal sea un sub-proyecto
  futuro separado.
- Fuente de datos: **YouTube Data API v3** (ya tiene key configurada en
  `.env` como `YOUTUBE_API_KEY`), no Apify ni scraping.
- Ventana de análisis: videos publicados en **los últimos 30 días**. Si no
  hay ninguno en ese rango, cae automáticamente a **los últimos 10 videos**
  del canal (para no dejar el análisis vacío en canales de cadencia más
  lenta) — el resultado indica cuál de los dos casos se usó
  (`usedFallback`).

## Salvaguardas (normas de YouTube / uso responsable)

1. **Copyright del personaje**: `personaje.md` siempre incluye esta nota,
   sin importar si el canal analizado es del usuario o no (el script no
   tiene forma de saberlo con certeza):

   > Esta imagen fue generada a partir de las miniaturas reales de este
   > canal. Si el canal no es tuyo, es solo referencia interna de
   > moodboard — no publiques esta imagen ni una copia visualmente
   > idéntica; usala para inspirarte en un personaje propio y distinto.

2. **Disclaimer de contenido sintético**: el prompt a Claude pide
   explícitamente el disclaimer con el criterio real de la política de
   YouTube ("Contenido alterado o sintético" — contenido realista
   generado/alterado con IA que pueda confundirse con material real).
   `analisis.json` guarda el texto sugerido junto con una nota fija:

   > Este texto complementa la descripción del video, pero NO reemplaza
   > activar el toggle "Contenido alterado o sintético" en YouTube Studio
   > al subir el video — ese paso es manual y obligatorio aparte.

3. **Solo API oficial**: se usa exclusivamente la YouTube Data API v3
   (nada de scraping del sitio), respetando cuota y sin almacenar más
   datos crudos de los necesarios para el análisis puntual.

## Cambios de datos/servicios

### `src/services/env.ts`

Nuevo getter, mismo patrón que los existentes:

```ts
get youtubeApiKey() {
  return required("YOUTUBE_API_KEY");
},
```

### `.env.example` / README

Agregar `YOUTUBE_API_KEY` a la tabla de variables ("la necesitás si vas a
usar `analyze:channel`").

### `src/services/youtubeService.ts` (nuevo)

```ts
export interface ChannelInfo {
  channelId: string;
  title: string;
  handle?: string;
  uploadsPlaylistId: string;
}

export interface ChannelVideo {
  videoId: string;
  title: string;
  description: string;
  tags: string[];
  publishedAt: string; // ISO 8601
  thumbnailUrl: string; // "high" si existe, si no "default"
}

export interface ChannelVideosResult {
  videos: ChannelVideo[];
  usedFallback: boolean; // true = no había videos en los últimos 30 días, se usaron los últimos 10
}

export function parseChannelInput(input: string): { forHandle?: string; id?: string; forUsername?: string }
export async function resolveChannel(input: string): Promise<ChannelInfo>
export async function listRecentVideos(channel: ChannelInfo): Promise<ChannelVideosResult>
```

- `parseChannelInput` (función pura, testeable sin red) interpreta:
  - `@handle` o URL `.../@handle` → `{ forHandle: "handle" }`
  - URL `.../channel/UCxxxx` o un string que ya matchea `/^UC[\w-]{22}$/` →
    `{ id: "UCxxxx" }`
  - URL legacy `.../user/Nombre` → `{ forUsername: "Nombre" }`
  - URL legacy `.../c/NombrePersonalizado` → se intenta igual como
    `forUsername`; si `resolveChannel` no encuentra nada así, cae a
    `search.list?type=channel&q=NombrePersonalizado` y toma el primer
    resultado (cuesta 100 unidades de cuota vs. 1 — solo se usa en este
    caso legacy raro).
- `resolveChannel` llama `channels.list` con `part=snippet,contentDetails`
  y el parámetro que corresponda; error explícito si `items` viene vacío
  ("no se encontró el canal '<input>'").
- `listRecentVideos`:
  1. `playlistItems.list?playlistId=<uploads>&part=snippet,contentDetails&maxResults=50`
     (una sola página alcanza para el caso de uso — canales con más de 50
     uploads en 30 días son un caso extremo fuera de alcance por ahora).
  2. Filtra por `publishedAt >= now - 30 días`; si el resultado queda
     vacío, en cambio toma los primeros 10 de la lista (ya viene
     ordenada del más nuevo al más viejo) y marca `usedFallback: true`.
  3. Con los `videoId` resultantes, `videos.list?part=snippet&id=<ids
     separados por coma>` (un solo call, ≤50 ids) para traer
     `description`, `tags` y el thumbnail en resolución "high".

### `src/services/channelAnalysisService.ts` (nuevo)

```ts
export interface ChannelCharacter {
  present: boolean;
  description: string | null; // null si present es false
}

export interface ChannelAnalysisResult {
  topics: string[];
  character: ChannelCharacter;
  disclaimer: string;
}

export async function analyzeChannel(videos: ChannelVideo[]): Promise<ChannelAnalysisResult>
```

Mismo patrón que `retakeDetectionService.ts` (tool use con
`input_schema` estricto, modelo `claude-opus-5`, `output_config: {
effort: "medium" }`). El mensaje a Claude incluye:

- Un bloque de texto con título + descripción (primeras ~300 caracteres) +
  tags de cada video de la muestra.
- Hasta 5 bloques de imagen (`type: "image", source: { type: "url", url:
  thumbnailUrl }`) de los thumbnails más recientes — confirmado con una
  llamada real que la Messages API acepta `source.type: "url"`
  directamente, sin descargar/subir nada primero.

El `input_schema` de la tool pide: `topics` (array de strings, temas/
ángulos recurrentes), `character.present` (boolean — hay o no un
personaje visual consistente en las miniaturas), `character.description`
(string, requerido solo si `present` es true: apariencia, vestuario,
estilo de ilustración, en inglés o español según el idioma del canal), y
`disclaimer` (string, en el idioma del canal, con el criterio de YouTube
descrito arriba).

### `src/services/analyzeChannel.ts` (nuevo — script CLI)

`npm run analyze:channel -- <url-o-@handle>`

1. Lee `process.argv[2]`; falla con mensaje de uso si falta.
2. `resolveChannel` → `listRecentVideos`.
3. `analyzeChannel(videos)`.
4. Slug del canal: `channel.title` normalizado a kebab-case (mismo
   criterio que los slugs de `content/guiones/*.json`).
5. Si `character.present`: junta las URLs de thumbnail de hasta 3 videos
   de la muestra y llama `kieAiService.editImage(prompt, thumbnailUrls,
   "content/canales/<slug>/personaje.png", { aspectRatio: "3:2" })`, con
   un prompt que combina `character.description` + instrucción de
   mantener el mismo estilo de ilustración, pose neutral de cuerpo
   completo, fondo plano, sin texto ni otros personajes (mismo prompt
   validado en el spike). Si esta llamada falla, se loguea el error y se
   sigue — no aborta el resto del guardado (mejor esfuerzo).
6. Escribe `content/canales/<slug>/personaje.md`: la descripción del
   personaje (o "Este canal no muestra un personaje visual consistente en
   la muestra analizada." si `present` es false) + la nota de copyright
   de la sección "Salvaguardas".
7. Escribe `content/canales/<slug>/analisis.json`:

```json
{
  "channel": { "channelId": "...", "title": "...", "handle": "..." },
  "videosAnalyzed": [{ "videoId": "...", "title": "...", "publishedAt": "..." }],
  "usedFallback": false,
  "topics": ["..."],
  "disclaimer": "...",
  "disclaimerNote": "Complementa, no reemplaza, el toggle de YouTube Studio."
}
```

8. Imprime un resumen por consola (temas encontrados, si se generó imagen
   de personaje o no, rutas de los archivos guardados).

## Manejo de errores

- Canal no encontrado (ni por handle ni por id ni por username/búsqueda) →
  error explícito con el input original.
- Canal sin ningún video (ni en 30 días ni en total) → error explícito,
  no tiene sentido analizar un canal vacío.
- `character.present: false` → no se intenta generar imagen; se guarda
  igual el resto del análisis (temas, disclaimer).
- Falla `editImage` (kie.ai) → se loguea y se continúa (ver paso 5); el
  usuario se queda con el texto para reintentar la imagen a mano si
  quiere.
- Falla la llamada a Claude → error explícito, aborta (sin temas ni
  disclaimer no hay nada útil que guardar).

## Testing

- Unit tests (`vitest`) para `parseChannelInput` (todas las formas de
  input: `@handle`, URL con `@`, `/channel/UC...`, `/user/...`, `/c/...`,
  id crudo) y para la lógica de selección de videos (30 días vs. fallback
  a 10), extraída como función pura que recibe la lista ya parseada +
  una fecha de referencia inyectada (mismo patrón que
  `pantallaDivididaTiming.ts`/`.test.ts`: lógica pura separada de las
  llamadas de red para poder testearla sin mocks de `fetch`).
- Sin tests para las llamadas HTTP en sí (mismo criterio que el resto de
  los servicios del proyecto) — se valida manualmente corriendo
  `npm run analyze:channel -- <url>` contra un canal real, como ya se
  hizo en el spike.

## Fuera de alcance (sub-proyectos futuros)

- Paquete SEO por video (título, descripción con keywords, tags) generado
  del guion.
- Diseño de miniatura por video.
- Metadatos/disclaimer formal del canal como flujo propio (más allá del
  dato suelto que ya guarda este spec).
