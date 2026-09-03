---
name: documental-doodle
description: Crea videos documentales narrados para YouTube en formato horizontal (16:9) — sin cámara ni avatar, con voz generada por IA y una ilustración estilo doodle/cartoon (contorno negro grueso, colores planos) que cambia cada 5 segundos siguiendo la narración, con subtítulos grandes palabra por palabra resaltados en amarillo. Usar cuando el usuario quiera un video narrado tipo documental horizontal sin grabarse, con este estilo de ilustración doodle.
---

# Documental doodle — documental horizontal narrado, sin cámara

## Qué es este estilo

Un video horizontal (16:9) narrado por una voz generada con IA — nadie habla
a cámara, no hay avatar ni panel dividido. La imagen ocupa el 100% de la
pantalla en todo momento: una ilustración estilo doodle/cartoon plano
(contorno negro grueso, colores planos, sin fotorrealismo) que cambia cada 5
segundos dentro de cada escena, con un zoom Ken Burns sutil y continuo.
Abajo, centrados, subtítulos grandes en mayúsculas que resaltan en amarillo
la palabra exacta que se está diciendo (el resto en blanco, contorno negro).

30fps, 1920x1080 (16:9) — mismo formato horizontal que
`youtube-noticias-avatar`. Sin música de fondo, sin botón "SUBSCRIBE".

## Qué necesitás antes de empezar

- **`ELEVENLABS_API_KEY`** — genera la voz narrada de cada escena y la
  transcribe con timestamps por palabra (para los subtítulos). Conseguila en
  elevenlabs.io.
- **`KIE_AI_API_KEY`** — genera las ilustraciones doodle de cada escena.
  Conseguila en kie.ai.
- **No hace falta grabar nada** — a diferencia de `youtube-noticias-avatar`,
  este tipo no usa cámara ni recorta silencios/retakes; todo el pipeline
  corre sin intervención manual (podés correrlo vos mismo con una tool call,
  no necesitás que la persona lo corra en su propia terminal).

## Flujo paso a paso (instrucciones para Claude)

Cuando alguien te pida un video de este estilo:

1. Preguntale el tema del documental.
2. Redactá el guion en escenas: dividí la narración en bloques naturales por
   idea/tema. Para cada escena escribí:
   - `text`: lo que se narra (se convierte a voz tal cual, sin parafrasear
     después).
   - `visual`: descripción de la escena para generar la imagen, **incluyendo
     siempre y explícitamente el estilo doodle** en el prompt (ej. "flat 2D
     doodle illustration, thick black outline, minimal flat color palette,
     hand-drawn vector style, plain background, no text or watermarks") —
     el pipeline no agrega ningún estilo automáticamente.
3. Guardá el guion en `content/guiones/<slug>.json` con
   `type: "documental-doodle"`.
4. Corré vos mismo (podés hacerlo con una tool call, no requiere terminal
   interactiva):
   ```
   npm run generate:assets -- content/guiones/<slug>.json
   ```
   Esto genera la voz, transcribe cada escena, y genera las imágenes doodle
   (cuántas por escena = duración real de esa escena ÷ 5s, redondeado hacia
   arriba) — todo automático.
5. Agregá una línea en `src/Root.tsx` registrando la composición.
6. Sugerile `npm run dev` para previsualizar, y
   `npx remotion render <CompositionId> out/<slug>.mp4` para renderizar.

## Estructura del guion

```ts
interface DocumentalDoodleGuion {
  type: "documental-doodle";
  slug: string;
  topic: string;
  voiceId?: string;             // opcional, usa un default si se omite
  scenes: DocumentalDoodleScene[];
}

interface DocumentalDoodleScene {
  id: string;
  text: string;    // lo que se narra en esta escena
  visual: string;   // prompt de imagen; escribí el estilo doodle acá siempre
}
```

Ejemplo (fixture de prueba usada para verificar la composición — no un video
real todavía; cuando armes el primero de este tipo, reemplazá este ejemplo
por ese guion real, igual que en las otras skills):

```json
{
  "type": "documental-doodle",
  "slug": "documental-doodle-demo",
  "topic": "Demo de documental-doodle (fixture de prueba, sin audio real)",
  "scenes": [
    {
      "id": "s1",
      "text": "La oscuridad forjó a la humanidad",
      "visual": "early humans huddled around a fire at night, flat 2D doodle illustration, thick black outline, minimal flat color palette, hand-drawn vector style, plain background, no text or watermarks"
    },
    {
      "id": "s2",
      "text": "Hoy encendés la luz sin pensarlo",
      "visual": "a hand flipping a modern light switch, flat 2D doodle illustration, thick black outline, minimal flat color palette, hand-drawn vector style, plain background, no text or watermarks"
    }
  ]
}
```

## Registrar la composición

En `src/Root.tsx`, agregar una línea dentro del `<>...</>`:

```tsx
<DocumentalDoodleComposition id="<UnNombreUnico>" slug="<slug-del-guion>" />
```

(`DocumentalDoodleComposition` ya está importado en ese archivo si ya hay
otra línea de este tipo).
