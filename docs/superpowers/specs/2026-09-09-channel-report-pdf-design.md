# Reporte de canal en PDF

## Contexto

Amplía y reemplaza el formato de salida de `analyze:channel`
(`docs/superpowers/specs/2026-09-08-channel-analyzer-design.md`). Durante
el uso real de esa herramienta, el usuario pidió mucho más de lo que
cubría el sub-proyecto "paquete SEO por video" originalmente planeado:
en vez de generar metadata por cada video nuevo, quiere que
`analyze:channel` entregue un **reporte único en PDF** sobre el canal
analizado, con todo lo necesario para entender y replicar su
posicionamiento — sin tener que abrir ni combinar varios archivos
sueltos a mano.

Se validó con una prueba real (spike) que `jspdf` (versión `4.2.1`, no
estaba en el proyecto) funciona correctamente en Node sin DOM: texto con
acentos, word-wrap (`splitTextToSize`) e imágenes embebidas
(`addImage` con base64) funcionaron a la primera, escribiendo el archivo
con `doc.output("arraybuffer")` + `fs.writeFileSync` (no con `.save()`,
que es solo de browser). `npm audit` confirma que `jspdf` no introduce
ninguna vulnerabilidad nueva (las 8 reportadas en el proyecto ya existían
antes, todas en herramientas de desarrollo — eslint/vitest — sin
relación con esta librería).

También se confirmó con llamadas reales a la YouTube Data API que los
campos nuevos que necesita este reporte están disponibles:

- `channels.list?part=snippet,contentDetails,brandingSettings,statistics`
  agrega, sobre lo que ya se pedía: `brandingSettings.image.bannerExternalUrl`
  (banner del canal — puede no existir), `snippet.description` (ya venía
  en la respuesta pero no se guardaba), y `statistics.subscriberCount` /
  `viewCount` / `videoCount`.
- `videos.list?part=snippet,statistics` agrega `statistics.viewCount` por
  video.

## Decisión de alcance (acordada con el usuario)

- El PDF **reemplaza por completo** los archivos sueltos que generaba la
  versión anterior (`analisis.json`, `personaje.md`, `personaje.png`,
  `personaje-prompt.txt`) — `analyze:channel` ahora deja un único
  `content/canales/<slug>/reporte.pdf`.
- "Títulos más virales" significa: **los mejores títulos que YA existen**
  entre los videos analizados (no títulos nuevos inventados), ordenados
  por vistas reales — no por lo que la IA "cree" que es viral. El ranking
  se hace en código (ordenar por `viewCount`), nunca pidiéndole a un LLM
  que ordene números. A Claude solo se le pide que explique, para cada
  uno de los títulos ya rankeados, por qué funciona / qué patrón sigue.
- Diseño visual del PDF: **funcional y legible**, sin trabajo de marca
  elaborado (es una herramienta interna, no un entregable de cliente) —
  secciones con títulos claros, texto con buen espaciado, imágenes en
  tamaño fijo razonable. Como el banner y la foto de perfil vienen de
  YouTube con proporciones conocidas y consistentes (banner ancho,
  perfil cuadrado) y la imagen del personaje siempre se genera con
  `aspectRatio: "3:2"` (ya fijo en `kieAiService.editImage`), se usan
  cajas de tamaño fijo por sección en vez de sumar una librería para
  detectar dimensiones reales de imagen — evita una dependencia nueva
  para un caso ya acotado.

## Contenido del PDF (en este orden)

1. **Portada** — nombre del canal, handle, banner (si existe) y foto de
   perfil.
2. **Qué hace el canal** — descripción real del canal (`snippet.description`)
   + los temas recurrentes ya detectados por Claude.
3. **Personaje** — la imagen generada (si `editImage` tuvo éxito) + la
   descripción escrita + el prompt completo usado, como bloque de texto
   plano (para poder copiarlo aunque la imagen haya fallado — reemplaza
   la función que cumplía `personaje-prompt.txt`).
4. **Títulos más virales** — tabla/lista: título real + vistas + por qué
   funciona (texto de Claude), para los 5 videos con más vistas de la
   muestra analizada.
5. **Disclaimer sugerido** — el texto + la nota de que no reemplaza el
   toggle "Contenido alterado o sintético" de YouTube Studio.
6. **Metadatos del canal** — suscriptores, vistas totales, cantidad de
   videos, fecha de creación, país (si está disponible).

## Cambios de datos/servicios

### `src/services/youtubeService.ts`

`ChannelInfo` gana campos nuevos:

```ts
export interface ChannelInfo {
  channelId: string;
  title: string;
  handle?: string;
  uploadsPlaylistId: string;
  description: string;
  profileImageUrl: string;
  bannerUrl: string | null;
  subscriberCount: number;
  viewCount: number;
  videoCount: number;
  publishedAt: string;
  country?: string;
}
```

`ChannelVideo` gana un campo:

```ts
export interface ChannelVideo {
  // ...los campos existentes...
  viewCount: number;
}
```

`fetchChannelInfo` pasa a pedir
`part=snippet,contentDetails,brandingSettings,statistics` y mapea:

```ts
description: item.snippet.description,
profileImageUrl: item.snippet.thumbnails.high?.url ?? item.snippet.thumbnails.default.url,
bannerUrl: item.brandingSettings?.image?.bannerExternalUrl ?? null,
subscriberCount: Number(item.statistics.subscriberCount),
viewCount: Number(item.statistics.viewCount),
videoCount: Number(item.statistics.videoCount),
publishedAt: item.snippet.publishedAt,
country: item.snippet.country,
```

(El tipo de la respuesta de `channels.list` se extiende con
`brandingSettings?: { image?: { bannerExternalUrl?: string } }` y
`statistics: { subscriberCount: string; viewCount: string; videoCount: string }`,
y `snippet.country?: string`.)

`fetchVideoDetails` pasa a pedir `part=snippet,statistics` y agrega
`viewCount: Number(item.statistics.viewCount)` al resultado mapeado.

Nueva función pura, exportada y testeable sin red:

```ts
export function selectTopVideosByViews(videos: ChannelVideo[], count: number): ChannelVideo[] {
  return [...videos].sort((a, b) => b.viewCount - a.viewCount).slice(0, count);
}
```

### `src/services/channelAnalysisService.ts`

`ChannelAnalysisResult` gana un campo:

```ts
export interface ViralTitleInsight {
  title: string;
  viewCount: number;
  reason: string;
}

export interface ChannelAnalysisResult {
  topics: string[];
  character: ChannelCharacter;
  disclaimer: string;
  viralTitles: ViralTitleInsight[];
}
```

`analyzeChannel(videos)` ahora:

1. Calcula `const topByViews = selectTopVideosByViews(videos, 5)` (de
   `youtubeService.ts`) — código, no la IA.
2. Incluye esos 5 títulos (ya con sus vistas reales) en el prompt, con
   una instrucción explícita: "para cada uno de estos títulos, usando el
   texto EXACTO tal como aparece acá abajo, explicá en 1-2 oraciones por
   qué funciona / qué patrón de título sigue". El `input_schema` de la
   tool agrega:

```ts
viralTitleReasons: {
  type: "array",
  items: {
    type: "object",
    properties: {
      title: { type: "string" },
      reason: { type: "string" },
    },
    required: ["title", "reason"],
    additionalProperties: false,
  },
},
```

3. Al procesar la respuesta, matchea cada entrada de
   `viralTitleReasons` contra `topByViews` por **coincidencia exacta de
   `title`** (no por índice — más robusto si el modelo reordena). Si un
   título de `topByViews` no tiene match en la respuesta (el modelo lo
   parafraseó o lo omitió), esa entrada se incluye igual en el resultado
   final con `reason: ""` — nunca se descarta el video ni se rompe el
   análisis por un mismatch de texto. Función pura y testeable:

```ts
export function matchViralTitleReasons(
  topByViews: ChannelVideo[],
  rawReasons: { title: string; reason: string }[],
): ViralTitleInsight[] {
  return topByViews.map((video) => ({
    title: video.title,
    viewCount: video.viewCount,
    reason: rawReasons.find((r) => r.title === video.title)?.reason ?? "",
  }));
}
```

### `src/services/channelReportPdfService.ts` (nuevo)

```ts
export interface ChannelReportData {
  channel: ChannelInfo;
  analysis: ChannelAnalysisResult;
  characterImageBuffer: Buffer | null; // null si editImage falló
  characterImagePrompt: string | null; // null si character.present es false
}

export async function buildChannelReportPdf(data: ChannelReportData): Promise<Buffer>
```

Arma el documento con `jspdf` siguiendo las 6 secciones de "Contenido
del PDF" de arriba, en ese orden, usando `doc.addPage()` entre secciones
grandes. Descarga banner/foto de perfil con un helper interno
`fetchImageAsBase64(url): Promise<{ data: string; format: "JPEG" | "PNG" }>`
(formato inferido de la extensión de la URL; default `"JPEG"` si no se
reconoce, que es el formato real de los thumbnails/banners de YouTube).
Si la descarga de banner o foto de perfil falla (red, 404), esa imagen
puntual se omite del PDF (se loguea un `console.error`, no se aborta el
reporte completo) — mismo criterio de "mejor esfuerzo" que ya usa
`analyzeChannel.ts` para la imagen del personaje.

Texto largo (descripción del canal, prompt del personaje, razones de
títulos virales) se corta con `doc.splitTextToSize(text, maxWidth)`
antes de imprimirlo, para que haga word-wrap dentro del ancho de la
página.

Devuelve el PDF como `Buffer` (no escribe a disco) — mantiene el
servicio con una sola responsabilidad (construir el documento) y facilita
probar/reusar sin acoplarlo a rutas de archivo.

### `src/services/analyzeChannel.ts` (reescrito)

Cambia el final del script (todo lo anterior a "Analizando temas y
personaje con Claude..." se mantiene igual):

1. Ya no escribe `personaje.md` ni `analisis.json` directamente.
2. Si `analysis.character.present && analysis.character.description`:
   genera la imagen con `editImage` hacia un archivo temporal
   (`path.join(os.tmpdir(), \`personaje-${Date.now()}.png\`)`, no dentro
   de `content/canales/`), la lee con `fs.readFileSync` a un `Buffer`, y
   borra el archivo temporal con `fs.unlinkSync` — igual que antes, si
   `editImage` falla se loguea el error y se sigue, pero ahora
   `characterImageBuffer` queda `null` en vez de faltar un archivo.
3. Llama `buildChannelReportPdf({...})` con todo lo recolectado, y
   escribe el resultado en `content/canales/<slug>/reporte.pdf`.
4. El resumen final por consola pasa a listar solo `reporte.pdf`.

## Dependencia nueva

`jspdf@^4.2.1` en `dependencies` de `package.json` (no
`devDependencies` — se usa en tiempo de ejecución del script, igual que
`dotenv`).

## Manejo de errores

- Falla la descarga del banner o la foto de perfil → se omite esa imagen
  puntual del PDF, el resto del reporte se genera igual.
- Falla `editImage` (imagen del personaje) → mismo criterio que ya
  existía: se loguea, `characterImageBuffer` queda `null`, el PDF igual
  incluye la descripción y el prompt en texto.
- Un título de `topByViews` sin `reason` devuelta por Claude → se
  incluye en el PDF con el título y las vistas, sin la explicación (en
  vez de fallar todo el análisis).
- Cualquier otra falla (YouTube API, Anthropic) → error explícito, aborta
  (mismo criterio que el spec anterior).

## Testing

- Unit tests (`vitest`) para `selectTopVideosByViews` (orden correcto,
  corte a `count`, empate estable) y `matchViralTitleReasons` (match
  exacto, título sin reason devuelta, reasons con títulos que no
  matchean ningún video de `topByViews`).
- Sin tests para `channelReportPdfService.ts` en sí (llamadas de red +
  generación binaria — mismo criterio que el resto de los servicios de
  este proyecto). Se valida manualmente abriendo el PDF generado contra
  un canal real.

## Fuera de alcance (sin cambios respecto al spec anterior)

- Paquete SEO (título/descripción/tags) para videos nuevos propios del
  usuario, generado a partir de un guion — esto ya no es parte de este
  reporte; si el usuario lo quiere más adelante, es un sub-proyecto
  aparte con su propio spec.
- Diseño visual de marca para el PDF (colores, tipografía custom) — el
  usuario puede pedirlo como iteración futura si el resultado funcional
  no le alcanza.
