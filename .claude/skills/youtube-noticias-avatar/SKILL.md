---
name: youtube-noticias-avatar
description: Crea videos de noticias para YouTube en formato horizontal (16:9) — el experto habla a cámara en una franja vertical a la derecha, mientras a la izquierda una ilustración de fondo va cambiando cada 4 segundos junto con lo que se narra, con subtítulos grandes palabra por palabra resaltados en amarillo. Usar cuando el usuario quiera un video de noticias/informativo horizontal con este layout de "experto + fondo ilustrado".
---

# Youtube noticias avatar — noticiero horizontal con experto

## Qué es este estilo

Un video horizontal (16:9) de noticias contadas por un experto real hablando
a cámara: a la derecha, en una franja vertical angosta, el experto; a la
izquierda, a pantalla completa, una ilustración de fondo que cambia cada 4
segundos y siempre corresponde a lo que se está diciendo en ese momento.
Abajo a la izquierda, subtítulos grandes en mayúsculas que resaltan en
amarillo la palabra exacta que se está diciendo (el resto en blanco).
Opcionalmente, un botón "SUBSCRIBE" falso arriba a la izquierda como gancho
de engagement.

30fps, 1920x1080 (16:9) — primer formato horizontal del proyecto (los demás
son 1080x1920). El audio es el real de la grabación, no se genera voz.

## Qué necesitás antes de empezar

- **Un video crudo** grabado por el experto hablando a cámara, contando la
  noticia de principio a fin (con errores/repeticiones — se cortan
  automáticamente).
- **`ELEVENLABS_API_KEY`** — transcribe el video con timestamps por palabra.
  Conseguila en elevenlabs.io.
- **`ANTHROPIC_API_KEY`** — detecta y corta automáticamente intentos
  fallidos y tramos fuera de guion. Conseguila en console.anthropic.com.
- **Las ilustraciones de fondo**: por ahora se preparan a mano (por ejemplo
  generándolas en ChatGPT/Midjourney con los prompts que arme Claude a
  partir de la transcripción real) y se guardan en
  `content/personajes/<slug>/` — no se generan automáticamente todavía.
  Avisale esto a la persona antes de pedirle el video (más adelante se va a
  conectar a una API de generación de imágenes, pero eso todavía no está
  construido).
- **Si querés el botón "SUBSCRIBE"**: la imagen tiene que existir una sola
  vez en `public/assets/youtube-noticias-avatar/subscribe-button.png` (se
  reusa en todos los videos de este tipo) — si no existe y pedís
  `subscribeButton: true`, el pipeline falla explícito pidiéndola.

## Flujo paso a paso (instrucciones para Claude)

Cuando alguien te pida un video de este estilo:

1. Preguntale la noticia/tema y pedile el video crudo ya grabado — copiálo a
   `content/raw/<slug>.<ext>`.
2. Preguntale explícitamente (no asumas) si las ilustraciones las va a
   generar él mismo y dártelas en una carpeta, o si más adelante querría
   conectarlas a una API de generación — hoy solo está construido el flujo
   manual (carpeta con imágenes numeradas).
3. Preguntale si quiere el botón "SUBSCRIBE" en este video
   (`subscribeButton: true|false`) — no va fijo, se pregunta cada vez.
4. Armá un guion BORRADOR con `scenes: []` solo para disparar la
   transcripción — no se pueden escribir las escenas sin la transcripción
   real primero.
5. **Paso interactivo:** decile a la persona que corra ella misma, en su
   propia terminal:
   ```
   npm run generate:assets -- content/guiones/<slug>.json
   ```
   Va a pausar pidiendo revisar candidatos a retake/aside — no lo intentes
   desde una tool call sin TTY.
6. Con la transcripción real ya generada
   (`public/assets/<slug>/transcript.json`), leela y armá las escenas
   reales: dividí la narración en bloques naturales (por idea/tema), y para
   cada bloque escribí `text` como copia EXACTA de las palabras dichas ahí
   (matching literal, normalizado — no parafrasees).
7. Para cada escena, calculá cuántas imágenes hacen falta (duración real de
   la escena ÷ 4 segundos, redondeado hacia arriba) y armale a la persona la
   lista de prompts para generar esa cantidad de ilustraciones, en el mismo
   orden — pedile que las guarde en `content/personajes/<slug>/` y te pase
   las rutas.
8. Con las imágenes ya listas, corré
   `npm run generate:assets -- content/guiones/<slug>.json` de nuevo (esta
   vez sin candidatos pendientes).
9. Agregá una línea en `src/Root.tsx` registrando la composición.
10. Sugerile `npm run dev` para previsualizar, y
    `npx remotion render <CompositionId> out/<slug>.mp4` para renderizar.

## Estructura del guion

```ts
interface YoutubeNoticiasAvatarGuion {
  type: "youtube-noticias-avatar";
  slug: string;
  topic: string;
  rawVideoPath: string;
  removeOtherSpeakers?: boolean;
  scenes: YoutubeNoticiasAvatarScene[];
  subscribeButton?: boolean;   // default false, se pregunta cada vez
}

interface YoutubeNoticiasAvatarScene {
  id: string;
  text: string;                // debe existir literalmente en la transcripción real
  localImagePaths: string[];   // imágenes ya preparadas, en orden; se ciclan cada 4s
}
```

Ejemplo (fixture de prueba usada para verificar la composición — no un video
real todavía; cuando armes el primero de este tipo, reemplazá este ejemplo
por ese guion real, igual que en las otras skills):

```json
{
  "type": "youtube-noticias-avatar",
  "slug": "youtube-noticias-avatar-demo",
  "topic": "Demo de youtube-noticias-avatar (fixture de prueba, sin audio real)",
  "rawVideoPath": "content/raw/youtube-noticias-avatar-demo.mp4",
  "subscribeButton": true,
  "scenes": [
    {
      "id": "s1",
      "text": "Terremoto sacude la costa",
      "localImagePaths": [
        "content/personajes/youtube-noticias-avatar-demo/s1-a.png",
        "content/personajes/youtube-noticias-avatar-demo/s1-b.png"
      ]
    },
    {
      "id": "s2",
      "text": "Autoridades piden calma",
      "localImagePaths": ["content/personajes/youtube-noticias-avatar-demo/s2-a.png"]
    }
  ]
}
```

## Registrar la composición

En `src/Root.tsx`, agregar una línea dentro del `<>...</>`:

```tsx
<YoutubeNoticiasAvatarComposition id="<UnNombreUnico>" slug="<slug-del-guion>" />
```

(`YoutubeNoticiasAvatarComposition` ya está importado en ese archivo si ya
hay otra línea de este tipo).
