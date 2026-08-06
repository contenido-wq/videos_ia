# Tipos de video por proyecto + tipo "redes sociales" (social-checklist)

## Contexto

El proyecto genera hoy un solo tipo de video: un "documental" narrado (TTS +
personaje/fotos IA, o el estilo "collage" con fotos reales que se usó en
`mundial-2026-resumen.json`). El usuario quiere formalizar que existen varios
**tipos de edición** por proyecto:

- **`vox`**: lo que ya existe (`DocumentalComposition`, estilos `neon`/`collage`).
  El usuario confirmó que "vox" es específicamente el estilo usado en el video
  del Mundial (`style: "collage"`, fotos reales de Wikimedia, mapas, stat-reveal).
- **`social-checklist`** (lo que el usuario llama "redes sociales"): un video de
  la persona hablando a cámara (grabación real, audio real — sin TTS) con un
  overlay tipo checklist: título fijo arriba, filas numeradas, y el logo de cada
  herramienta/tema entrando animado a su casilla en el momento exacto en que se
  menciona. Referencia visual: captura de un reel existente del usuario
  ("5 HERRAMIENTAS DE IA QUE USTED VA A NECESITAR PARA NO SER UN DINOSAURIO",
  con círculos numerados 1-5 y casillas blancas a la izquierda, persona hablando
  a la derecha).
- **`youtube`**: fuera de alcance de este spec, se diseña en una sesión aparte.

El usuario planea agregar más tipos de contenido en el futuro (más allá de
estos 3) — la arquitectura de tipos debe quedar abierta a eso sin fricción,
ver "Cómo agregar un tipo nuevo" más abajo.

Este spec cubre **type architecture + `vox` formalizado + `social-checklist`
completo**. `youtube` queda pendiente.

### Relación con otro spec

Existe un spec previo (`2026-07-25-video-scenes-silence-removal-design.md`,
plan escrito pero **nunca implementado** — ninguno de sus archivos existe en
el repo) que también transcribe un video crudo del usuario con ElevenLabs
Scribe y timestamps por palabra, para otro propósito (cortar silencios +
b-roll que tapa la cámara). Ambos specs necesitan "transcribir un video con
timestamps por palabra" — si ese otro feature se construye después, debe
reusar la función de transcripción que este spec crea en
`elevenlabsService.ts`, no duplicarla.

## Decisiones acordadas con el usuario

- Nuevo campo `type` en el guion: `"vox" | "social-checklist" | "youtube"`.
  Si no está presente, se asume `"vox"` (compatibilidad hacia atrás — ningún
  guion existente necesita cambios).
- `vox` no cambia de comportamiento, solo se nombra formalmente.
- `social-checklist`:
  - El video base es una grabación real de la persona hablando a cámara
    (ej. `content/raw/video-1-jhei.mov`), **con su audio real** — no hay voz
    sintética ni ElevenLabs TTS en este tipo.
  - Overlay: título fijo tipo "sticker" (fondo blanco, texto negro mayúscula)
    visible todo el video; filas numeradas (círculo rojo con el número +
    casilla blanca) a la izquierda, cantidad de filas = cantidad de items
    (variable, no fijo en 5).
  - Sincronización: se transcribe el video con **ElevenLabs Speech-to-Text
    (Scribe)**, timestamps por palabra. Por cada item se busca la primera
    mención de su `label` en la transcripción; ese timestamp es el momento en
    que su logo aparece.
  - Si un item no se encuentra en la transcripción (mala pronunciación,
    sinónimo, etc.), **no se cae el render**: se le asigna un tiempo estimado
    repartido proporcionalmente entre los items sin match, y se loguea una
    advertencia en consola para que el usuario lo revise.
  - Si el match de un item da un timestamp **anterior** al del item previo
    (falso positivo, orden ilógico), se descarta ese match y se usa tiempo
    estimado para ese item — nunca se muestran los logos fuera de orden.
  - Animación: el logo entra flotando y se acomoda ("settle") dentro de su
    casilla blanca; una vez posicionado, **se queda fijo ahí el resto del
    video** (no se reemplaza por check ni desaparece).
  - Fuente de los logos: se reutiliza el pipeline ya construido — primero
    `wikimediaService.findWikimediaImageUrls`, si no hay resultado raster cae
    a `kieAiService.generateImage` (logo/ícono, fondo transparente).
  - No se muestra el texto del `label` en pantalla, solo el logo dentro de la
    casilla (igual que la referencia visual).

## Cambios de datos (`src/types/guion.ts`)

Se convierte `Guion` en unión discriminada por `type`:

```ts
export type GuionType = "vox" | "social-checklist" | "youtube";

// Lo que hoy es `Guion` se renombra a VoxGuion y gana `type?: "vox"`.
export interface VoxGuion {
  type?: "vox";
  slug: string;
  topic: string;
  voiceId?: string;
  characterImagePath?: string;
  style?: VisualStyle; // "neon" | "collage"
  scenes: GuionScene[];
}

export interface ChecklistItem {
  id: string;
  label: string; // texto a buscar en la transcripción (no se muestra en pantalla)
  logoQuery: string; // query para Wikimedia/kie.ai
}

export interface SocialChecklistGuion {
  type: "social-checklist";
  slug: string;
  topic: string;
  rawVideoPath: string; // ej. "content/raw/video-1-jhei.mov"
  listTitle: string;
  items: ChecklistItem[];
}

export type Guion = VoxGuion | SocialChecklistGuion;

// Tras generar assets:
export interface RenderedChecklistItem extends ChecklistItem {
  startSeconds: number;
  matched: boolean; // false = tiempo estimado, no encontrado en transcripción
  logoPath: string;
}

export interface RenderedSocialChecklistGuion {
  type: "social-checklist";
  slug: string;
  topic: string;
  videoPath: string; // relativo a public/, servible con staticFile()
  durationInSeconds: number;
  listTitle: string;
  items: RenderedChecklistItem[];
}
```

`RenderedGuion` (el tipo "vox" ya existente) no cambia.

## Pipeline

### 1. `src/services/elevenlabsService.ts` — nueva función de transcripción

```ts
export async function transcribeWithTimestamps(filePath: string): Promise<{
  words: { text: string; start: number; end: number }[];
}>
```

- `POST /v1/speech-to-text` (modelo Scribe), multipart con el archivo de
  video/audio. Verificar en la implementación la forma exacta de la respuesta
  (campo `words` con `start`/`end` en segundos) con una llamada real antes de
  integrarla al pipeline completo — igual que se hizo al construir
  `wikimediaService`.

### 2. `src/services/checklistSyncService.ts` — nuevo, lógica pura (testeable)

```ts
export function matchItemTimestamps(
  words: { text: string; start: number; end: number }[],
  items: ChecklistItem[],
  totalDurationSeconds: number,
): { item: ChecklistItem; startSeconds: number; matched: boolean }[]
```

- Normaliza (minúsculas, sin acentos/puntuación) y busca, por cada item, la
  primera ventana de palabras consecutivas del mismo largo que las palabras
  del `label` (ej. `label: "Claude Anthropic"` → ventanas de 2 palabras
  consecutivas) cuyo texto unido coincida con el `label` normalizado.
- Aplica las reglas de fallback y de orden ascendente descritas arriba.
- Sin dependencias de red — se puede testear con `vitest` (el proyecto no
  tiene tests aún; instalar `vitest` como en el spec previo no implementado,
  agregar `"test": "vitest run"` a `package.json`).

### 3. `src/services/generateAssets.ts` — nueva rama por tipo

- `main()` lee el guion y, según `guion.type`, llama a
  `generateVoxAssets` (lo que hoy es el cuerpo de `main`, renombrado sin
  cambios de comportamiento) o a la nueva `generateSocialChecklistAssets`:
  1. Copia `rawVideoPath` a `public/assets/<slug>/video/source.<ext>` (si no
     existe ya, igual que el resto del pipeline evita recomputar).
  2. Lee duración del video con `ffprobe` (`ffprobe -v quiet -print_format
     json -show_format <path>`, ya está instalado localmente — confirmado
     `/opt/homebrew/bin/ffprobe`) vía `child_process.execFile`.
  3. Transcribe (paso 1), cacheando el resultado en
     `public/assets/<slug>/transcript.json` para no re-transcribir en
     corridas repetidas.
  4. Corre `matchItemTimestamps` (paso 2).
  5. Por cada item, resuelve el logo (Wikimedia → kie.ai fallback), cacheado
     en `public/assets/<slug>/images/item-<id>.png` igual que las demás
     imágenes del proyecto.
  6. Escribe `public/data/<slug>.json` con forma `RenderedSocialChecklistGuion`.

### 4. Composición Remotion nueva

- `src/SocialChecklistComposition.tsx` (paralelo a `DocumentalComposition.tsx`):
  `calculateMetadata` lee `public/data/<slug>.json`, `durationInFrames` sale
  de `durationInSeconds` del video (no de audio por escena).
- `src/components/SocialChecklist.tsx`:
  - `<OffthreadVideo src={staticFile(videoPath)} />` a pantalla completa
    (con su audio real).
  - Título fijo (sticker blanco) renderizado durante todo el video.
  - Una fila por item, alto de fila = alto disponible / cantidad de items
    (layout se adapta a N items, no fijo en 5).
  - Por cada item: mientras `frame < startFrame` no se muestra nada en su
    casilla; al llegar `startFrame`, `spring()` anima el logo desde una
    posición flotante hasta encajar en la casilla, y se queda ahí fijo
    (mismo patrón de animación que ya usa `LogoCard` en `Scene.tsx` para
    entrada, sin salida).
- Registro en `src/Root.tsx`: `<SocialChecklistComposition id="..."
  slug="..." />`, mismo patrón manual que las composiciones existentes.

## Convención de archivos

```
content/raw/<slug>.mov                    # ya gitignored
content/guiones/<slug>.json               # type: "social-checklist"
public/assets/<slug>/video/source.<ext>   # copia del crudo
public/assets/<slug>/transcript.json      # cache de transcripción
public/assets/<slug>/images/item-<id>.png
public/data/<slug>.json                   # RenderedSocialChecklistGuion
```

## Cómo agregar un tipo nuevo

`type` es una unión discriminada, no un enum cerrado — sumar un tipo nuevo
(ej. `youtube`, o cualquier otro que salga más adelante) no debe requerir
tocar el código de los tipos existentes, solo agregar piezas nuevas:

1. Nueva interfaz de guion (ej. `YoutubeGuion`) + sumarla a `type Guion =
   VoxGuion | SocialChecklistGuion | YoutubeGuion`. TypeScript avisa en
   cualquier `switch`/`if` sobre `guion.type` que no esté cubierto (chequeo
   de exhaustividad), así que no se puede olvidar un caso por error.
2. Nueva función `generate<Tipo>Assets` en `generateAssets.ts`, llamada desde
   `main()` en la rama de ese `type` — no toca las ramas de los tipos que ya
   existen.
3. Nueva composición Remotion (`src/<Tipo>Composition.tsx` +
   `src/components/<Tipo>.tsx`) y su línea de registro en `Root.tsx` — no
   toca las composiciones existentes.

Los servicios compartidos (`wikimediaService`, `elevenlabsService`,
`kieAiService`) ya están escritos como funciones genéricas por query/texto,
no atadas a un tipo de guion en particular, así que cualquier tipo nuevo los
puede reusar directamente.

## Fuera de alcance (por ahora)

- Tipo `youtube` (diseño aparte).
- Fase 2: empaquetar como Skill + panel web local para la comunidad (diseño
  aparte, incluye gestión de API keys por proveedor).
- Migrar guiones `vox` existentes para declarar `type: "vox"` explícito (es
  opcional, no rompe nada dejarlo implícito).
- Mostrar el texto del `label` en pantalla, mezcla de música, más de un video
  crudo por guion, edición manual de timestamps desde UI.
