---
name: pantalla-dividida
description: Crea videos narrativos de "pantalla dividida" — la mitad de arriba muestra una ilustración estilo sombras chinas que va cambiando con la narración, la mitad de abajo es la persona hablando a cámara, y el video cierra con la persona sola a pantalla completa diciendo la reflexión/CTA final. Usar cuando el usuario quiera contar una historia o dar un mensaje motivacional con este formato de dos mitades.
---

# Pantalla dividida — narrativa en dos actos

## Qué es este estilo

Un video en 2 actos, siempre a partir de UN video real de la persona
hablando a cámara:

- **Acto 1** (la mayoría del video): pantalla dividida — arriba una
  ilustración en silueta negra sobre fondo dorado/sepia ("sombras
  chinas") que ilustra lo que se está narrando en ese momento, con el
  texto de esa escena en una barra negra justo debajo de la ilustración;
  abajo, la persona hablando a cámara.
- **Acto 2** (el cierre): la persona sola, a pantalla completa, con el
  texto clave (ej. una palabra entre comillas) superpuesto sin fondo,
  centrado debajo del mentón.

30fps, 1080x1920 (9:16). El audio es el real de la grabación.

## Qué necesitás antes de empezar

- **Un video crudo** grabado por la persona hablando a cámara, contando
  la historia/mensaje completo de principio a fin (con los errores y
  repeticiones que hagan falta — se cortan automáticamente).
- **`ELEVENLABS_API_KEY`** — transcribe el video, y genera los efectos de
  sonido cortos (whoosh, sting). Conseguila en elevenlabs.io.
- **`ANTHROPIC_API_KEY`** — detecta y corta automáticamente intentos
  fallidos y tramos fuera de guion. Conseguila en console.anthropic.com.
- **Las ilustraciones de la mitad superior**: se preparan a mano (por
  ejemplo generándolas en ChatGPT con los prompts que arme Claude a
  partir de la transcripción real) y se guardan en
  `content/personajes/<slug>/` — no se generan automáticamente. Avisale
  esto a la persona antes de pedirle el video.
- **Una canción de fondo con licencia real** (no se genera con IA) — hay
  que elegir una pista libre de regalías (ej. en Pixabay Music) que la
  persona apruebe antes de usarla, y guardarla en `content/musica/`.

## Flujo paso a paso (instrucciones para Claude)

Cuando alguien te pida un video de este estilo:

1. Preguntale el tema/mensaje que quiere contar y pedile el video crudo
   ya grabado — copiálo a `content/raw/<slug>.<ext>`.
2. Armá un guion BORRADOR con `scenes: []` (sin escenas todavía) solo
   para disparar la transcripción — no se pueden escribir las escenas
   sin la transcripción real primero.
3. **Paso interactivo:** decile a la persona que corra ella misma, en su
   propia terminal:
   ```
   npm run generate:assets -- content/guiones/<slug>.json
   ```
   Va a pausar pidiendo revisar candidatos a retake/aside — mismo motivo
   que en `ranking`, no lo intentes desde una tool call sin TTY.
4. Con la transcripción real ya generada (`public/assets/<slug>/transcript.json`
   después de esa corrida), leela y armá las escenas reales: dividí la
   narración en bloques naturales (por oración/idea), y para cada bloque
   escribí `text` como una copia EXACTA de las palabras reales dichas ahí
   (el matching contra la transcripción es literal, normalizado — no
   podés parafrasear). Marcá la última escena (o las últimas) con
   `act: "closing"`.
5. Para cada escena `act: "split"`, calculá cuántas imágenes hacen falta
   (duración real de la escena ÷ 2.5 segundos, redondeado hacia arriba) y
   armale a la persona la lista de prompts para pegar en ChatGPT — una
   consistencia visual fija tipo "black paper-cut silhouette illustration
   (sombras chinas style), backlit against a warm golden amber textured
   background" agregada al final de cada prompt.
6. Cuando la persona confirme que las imágenes ya están en
   `content/personajes/<slug>/`, buscá o generá con ella una canción de
   fondo con licencia libre y guardala en `content/musica/`.
7. Corré `npm run generate:assets -- content/guiones/<slug>.json` de
   nuevo (esta vez sin candidatos pendientes, corre completo sin
   necesitar terminal interactiva).
8. Agregá una línea en `src/Root.tsx` registrando la composición.
9. Sugerile `npm run dev` para previsualizar, y
   `npx remotion render <CompositionId> out/<slug>.mp4` para renderizar.

## Estructura del guion

```ts
interface PantallaDivididaGuion {
  type: "pantalla-dividida";
  slug: string;
  topic: string;
  rawVideoPath: string;
  removeOtherSpeakers?: boolean;
  scenes: PantallaDivididaScene[];
  backgroundMusicPath: string;   // ej. "content/musica/nombre-pista.mp3"
  soundDesign?: {
    whooshPrompt?: string;        // prompt custom del whoosh, opcional
    stingPrompt?: string;         // prompt custom del sting, opcional
  };
}

interface PantallaDivididaScene {
  id: string;
  text: string;                  // debe existir literalmente en la transcripción real
  act: "split" | "closing";
  localImagePaths?: string[];    // solo para act:"split" — imágenes ya generadas a mano, en orden
  displayText?: string;          // texto a mostrar en pantalla si es distinto de `text` (ej. solo la palabra clave en el cierre)
}
```

Ejemplo real, completo (`content/guiones/pantalla-dividida.json`):

```json
{
  "type": "pantalla-dividida",
  "slug": "pantalla-dividida",
  "topic": "El mito de la perfección en redes sociales",
  "rawVideoPath": "content/raw/pantalla-dividida.mp4",
  "removeOtherSpeakers": true,
  "backgroundMusicPath": "content/musica/motivation-paulyudin.mp3",
  "scenes": [
    {
      "id": "s1",
      "text": "¿Pensaste que eres malo o que las redes sociales no te quieren? Estás equivocado.",
      "act": "split",
      "localImagePaths": ["content/personajes/pantalla-dividida/s1-a.png", "content/personajes/pantalla-dividida/s1-b.png"]
    },
    {
      "id": "s8",
      "text": "Comenta la palabra \"CREADOR\" si estás dispuesto a cambiar todo lo que has venido haciendo.",
      "act": "closing",
      "displayText": "\"CREADOR\""
    }
  ]
}
```

## Registrar la composición

En `src/Root.tsx`, agregar una línea dentro del `<>...</>`:

```tsx
<PantallaDivididaComposition id="<UnNombreUnico>" slug="<slug-del-guion>" />
```

(`PantallaDivididaComposition` ya está importado en ese archivo).
