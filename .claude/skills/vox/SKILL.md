---
name: vox
description: Crea videos narrados tipo documental (voz generada + imágenes de IA, fotos reales, o un personaje fijo) en dos estilos visuales — "neon" (oscuro, AIVI) o "collage" (scrapbook vintage). Usar cuando el usuario quiera un video narrado sin grabarse a cámara.
---

# Vox — videos narrados

## Qué es este estilo

Un video narrado por una voz generada con IA (no es el usuario hablando a
cámara), con una imagen distinta por cada línea del guion. Dos estilos
visuales posibles, elegidos por escena:

- **`neon`** (default): imágenes a pantalla completa (fotorrealistas
  generadas con IA, fotos reales, o un personaje fijo), degradado oscuro,
  subtítulo grande abajo. Estética AIVI.
- **`collage`**: fotos en blanco y negro estilo "recorte de diario",
  textura de papel kraft, tipografía cinética con una palabra resaltada
  tipo marcador, flechas dibujadas a mano. Varios layouts posibles
  (fotos lado a lado, cascada de banderas, VS entre dos fotos, badge con
  una estadística, logo con texto debajo).

30fps, 1080x1920 (9:16).

## Qué necesitás antes de empezar

- **`ELEVENLABS_API_KEY`** (siempre) — genera la voz narrada de cada
  escena. Conseguila en elevenlabs.io.
- **`KIE_AI_API_KEY`** — solo si alguna escena usa `imageSource: "ai"`
  (sin que encuentre una foto real en Wikimedia) o `imageSource:
  "character"` (sin `localImagePaths` propias). Conseguila en kie.ai.
- **`APIFY_API_TOKEN`** + **`APIFY_GOOGLE_IMAGES_TASK`** — solo si alguna
  escena usa `imageSource: "real"` con `apifyQuery` (no hace falta si le
  das directamente `realImageUrls`). Conseguilo en apify.com.

Ninguna de estas claves es compartida entre personas — cada quien pone las
suyas en su propio `.env` en la raíz del repo (mismas variables que ya
usa este proyecto, ver `CLAUDE.md`).

No hace falta grabar ningún video — este estilo no usa cámara, todo el
audio se genera.

## Flujo paso a paso (instrucciones para Claude)

Cuando alguien te pida un video de este estilo:

1. Preguntale el tema y pedile que te cuente la narración completa (o
   ayudalo a escribirla) — necesitás el texto exacto de cada línea antes
   de armar el guion, porque cada línea se convierte en una escena.
2. Preguntale qué estilo visual quiere: `neon` (default si no dice nada)
   o `collage`.
3. Armá el guion en `content/guiones/<slug>.json` con la estructura de
   abajo — una escena por línea narrada, decidiendo `imageSource` por
   escena según lo que se necesite ilustrar (foto real de algo/alguien
   identificable → `"real"` con `apifyQuery` o `realImageUrls`; ilustración
   genérica → `"ai"` con un prompt descriptivo en `visual`; el mismo
   personaje recurrente en varias escenas → `"character"`).
4. Corré `npm run generate:assets -- content/guiones/<slug>.json` — esto
   genera voz, imágenes, y efectos de sonido para cada escena. No requiere
   ninguna revisión interactiva (a diferencia de `ranking`/`pantalla-dividida`),
   así que podés correrlo vos directamente.
5. Agregá una línea en `src/Root.tsx` registrando la composición (ver
   sección de abajo).
6. Sugerile correr `npm run dev` (abre Remotion Studio) para previsualizar,
   y cuando esté conforme, renderizar con
   `npx remotion render <CompositionId> out/<slug>.mp4`.

## Estructura del guion

```ts
interface VoxGuion {
  type?: "vox";              // opcional, es el default si no ponés type
  slug: string;               // nombre de archivo/carpeta de assets
  topic: string;               // solo etiqueta, no se muestra en pantalla
  voiceId?: string;            // voz de ElevenLabs a usar
  characterImagePath?: string; // solo si alguna escena usa imageSource:"character" sin localImagePaths
  style?: "neon" | "collage";  // default "neon"
  scenes: GuionScene[];
}

interface GuionScene {
  id: string;
  text: string;                // narración de esta escena (se convierte en voz + subtítulo)
  visual: string;               // prompt de imagen (usado por imageSource "ai" y "character")
  imageSource: "ai" | "real" | "character";
  apifyQuery?: string;          // búsqueda de foto real (con imageSource:"real")
  realImageUrls?: string[];     // URLs ya verificadas, evita pagar la búsqueda
  wikipediaQuery?: string;      // solo con imageSource:"ai": intenta una foto real gratis antes de generar
  logo?: boolean;               // muestra la imagen en una tarjeta flotante en vez de a pantalla completa
  localImagePaths?: string[];   // imágenes ya preparadas a mano
  sfxPrompt?: string;           // efecto de sonido opcional para la escena
  // Solo aplican con style:"collage":
  layout?: "framed" | "full" | "layered" | "silhouette-collage" | "flags-cascade" | "vs-battle" | "stat-reveal" | "logo-cta";
  collageImageUrls?: string[];  // varias fotos juntas (no secuenciales)
  badgeLogoUrl?: string;
  statNumber?: string;
  statLabel?: string;
  ctaSubtext?: string;
}
```

Ejemplo real (estilo `neon`, `imageSource:"ai"` — tomado de
`content/guiones/mitos-claude-negocio.json`, guion completo en ese archivo):

```json
{
  "slug": "mitos-claude-negocio",
  "topic": "4 mitos que te impiden usar Claude en tu negocio",
  "voiceId": "htFfPSZGJwjBv1CL0aMD",
  "scenes": [
    {
      "id": "s01",
      "text": "Hay 4 excusas que escucho todos los días para no usar IA en tu negocio.",
      "visual": "Photorealistic photo of a real small business owner sitting behind a counter, arms crossed, skeptical expression looking directly at camera, natural lighting, documentary photography, realistic skin texture, no illustration, no cartoon",
      "imageSource": "ai"
    }
  ]
}
```

Ejemplo real (estilo `collage`, `layout:"silhouette-collage"` — tomado de
`content/guiones/mundial-2026-resumen.json`, guion completo en ese archivo,
cubre casi todos los `layout` disponibles):

```json
{
  "slug": "mundial-2026-resumen",
  "topic": "Resumen del Mundial 2026",
  "voiceId": "htFfPSZGJwjBv1CL0aMD",
  "style": "collage",
  "scenes": [
    {
      "id": "s01",
      "text": "El Mundial 2026 hizo historia.",
      "visual": "",
      "imageSource": "real",
      "layout": "silhouette-collage",
      "collageImageUrls": [
        "https://upload.wikimedia.org/wikipedia/commons/9/93/Kylian_Mbappe_-_France_v_Senegal_-_16_June_2026.jpg"
      ]
    }
  ]
}
```

## Registrar la composición

En `src/Root.tsx`, agregar una línea dentro del `<>...</>`:

```tsx
<DocumentalComposition id="<UnNombreUnico>" slug="<slug-del-guion>" />
```

(`DocumentalComposition` ya está importado en ese archivo — no hace falta
agregar el import de nuevo si ya hay otra línea `DocumentalComposition`
arriba).
