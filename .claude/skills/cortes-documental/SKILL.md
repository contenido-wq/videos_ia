---
name: cortes-documental
description: Edita un video crudo de una persona hablando a cámara (vertical 9:16) con estilo documental — la persona a pantalla completa, con cortes cada ~2-3 segundos a fotos de archivo que ilustran lo que dice, subtítulos grandes palabra por palabra a media altura y títulos grandes en las frases clave. Usar cuando el usuario pase un video crudo y quiera este estilo de "cortes a imágenes de archivo", o cuando mencione el video de referencia "Cont 3 Pas Juangui".
---

# Cortes documental — presentador + imágenes de archivo

## Qué es este estilo

Un video a partir de UN video real de la persona hablando a cámara:

- La persona va a **pantalla completa** todo el tiempo.
- Cada ~2-3 segundos hay un **corte a una imagen de archivo** (foto
  documental 9:16 a pantalla completa, con zoom lento) que ilustra la
  palabra o idea que se dice en ese momento; el audio sigue siendo el de
  la persona. Entre cortes la persona vuelve a verse.
- **Subtítulos** palabra por palabra (1-3 palabras a la vez), blancos,
  tipografía pesada con letra apretada, a media altura. Se ven sobre la
  persona y sobre las imágenes.
- **Títulos grandes** ocasionales en las frases clave: una línea pequeña
  ("El que vive") y una línea enorme ("del aplauso"). Mientras hay título
  se oculta el subtítulo.

- **Jump cuts del presentador:** cada ~3 s (en pausas naturales) y al volver de
  cada imagen, el encuadre salta de golpe (zoom 1.0 / 1.16 / 1.3).
- **Transiciones con overlay** al entrar cada imagen, rotando: destello blanco +
  barrido de luz cálida, deslizamiento lateral con sombra, y zoom con desenfoque.
- **Cierre:** el último corte (`closing`) entra en la última frase, sigue sobre una
  cola de 2.5 s y se funde a negro mientras la música se apaga.
- **Audio:** la voz se normaliza a -13 LUFS (los videos de celular salen ~-30),
  música de fondo continua ~14 dB por debajo de la voz con fade in/out, un whoosh
  en cada corte y un hit en los títulos y el cierre.

1080x1920, 30fps.
Referencia visual: `/Users/jheitrujillo/Downloads/Cont 3 Pas Juangui.mp4`.

## Qué necesitas antes de empezar

- **Música de fondo con licencia real** (no generada con IA) y aprobada por la
  persona, en `content/musica/`. Pregunta cuál usar; la de `pantalla-dividida`
  es `content/musica/motivation-paulyudin.mp3`. Se pone en `backgroundMusicPath`.
- **Un video crudo** de la persona hablando a cámara, contando todo de
  principio a fin (los errores y repeticiones se cortan automáticamente).
- **`ELEVENLABS_API_KEY`** (transcripción) y **`ANTHROPIC_API_KEY`**
  (detección de retakes) en `.env`. Si se usan imágenes con IA, también
  la clave de kie.ai (con fallback gratuito a pollinations.ai).
- **Decidir de dónde salen las imágenes** — pregúntalo SIEMPRE antes de
  arrancar, no lo asumas:
  - **IA:** cada corte lleva un prompt en `visual` y se genera solo.
  - **Carpeta del usuario:** las pone la persona en
    `content/personajes/<slug>/` (9:16) y cada corte apunta con `localImagePath`.
  Se pueden mezclar por corte.

## Flujo paso a paso (instrucciones para Claude)

1. Pregunta el tema/mensaje, pide el video crudo y cópialo a
   `content/raw/<slug>.<ext>`. Pregunta si las imágenes son con IA o de carpeta.
2. Crea un guion BORRADOR `content/guiones/<slug>.json` con
   `"cutaways": []` solo para disparar la transcripción.
3. **Paso interactivo:** pídele a la persona que corra ella misma, en su
   terminal (por eso no se puede desde una tool call, necesita TTY):
   ```
   npm run generate:assets -- content/guiones/<slug>.json
   ```
   Va a pausar para revisar candidatos a retake/aside.
4. Con `public/assets/<slug>/transcript.json` ya generado, léelo y elige
   los cortes: una imagen por cada sustantivo/idea visual fuerte, con un
   ritmo de ~1 corte cada 4-6 segundos de habla (el sistema los ajusta a
   1.5-3 s, evita solapes y deja libres el primer y último segundo). Para
   cada uno, `text` es una copia EXACTA de las palabras dichas ahí
   (el matching es literal, normalizado: no parafrasees). No repitas
   imágenes ni prompts. Elige 1-3 frases clave para `titles`.
5. **Personajes consistentes (obligatorio con IA):** si un mismo personaje aparece en
   varios cortes, escribe SIEMPRE el mismo descriptor completo en cada `visual`
   (edad exacta, pelo, ropa; ej. "David, a lean 17-year-old shepherd boy with short
   dark curly hair, olive skin and a rough brown wool tunic") y marca los cortes
   siguientes con `"basedOn": "<id del primer corte con ese personaje>"`: se genera
   con esa imagen de referencia y mantiene la misma cara. Sin esto salen versiones
   distintas (niño, joven, adulto). El corte base debe ir antes en la lista.
   Termina con un corte `"closing": true` en la última frase (imagen de cierre épica).
5b. Si las imágenes son con IA, escribe cada `visual` anclado en lo que se
   dice (persona/lugar/objeto concreto, sin texto en la imagen). Si son
   de carpeta, dale a la persona la lista de imágenes que necesita, con
   el nombre de archivo exacto de cada una y que sean verticales 9:16, y espera
   a que confirme que están en `content/personajes/<slug>/`.
6. Corre `npm run generate:assets -- content/guiones/<slug>.json` otra vez
   (ya sin candidatos pendientes, corre completo). Si falla por un `text`
   que no se encuentra, copia la frase exacta del transcript.
7. Registra la composición en `src/Root.tsx`:
   ```tsx
   <CortesDocumentalComposition id="<UnNombreUnico>" slug="<slug>" />
   ```
8. Previsualiza con `npm run dev` y renderiza con
   `npx remotion render <UnNombreUnico> out/<slug>.mp4`.
   **Reporta siempre la ruta absoluta completa del MP4.**
9. Al terminar el video, entrega el paquete estándar de metadatos de
   YouTube (título x3, descripción + disclaimer, tags, subtítulos,
   tarjetas y checklist).

## Estructura del guion

```ts
interface CortesDocumentalGuion {
  type: "cortes-documental";
  slug: string;
  topic: string;
  rawVideoPath: string;            // ej. "content/raw/<slug>.mov"
  removeOtherSpeakers?: boolean;
  backgroundMusicPath?: string;    // ej. "content/musica/motivation-paulyudin.mp3"
  soundDesign?: { whooshPrompt?: string; hitPrompt?: string };
  cutaways: {
    id: string;
    text: string;                  // frase literal de la transcripción donde arranca el corte
    localImagePath?: string;       // imagen 9:16 ya preparada
    visual?: string;               // prompt IA si no hay localImagePath
    durationSeconds?: number;      // 1.5-3, default 2.5
    basedOn?: string;              // id de un corte anterior: su imagen fija el personaje
    closing?: boolean;             // último corte: hasta el final + cola, fundido a negro (solo uno)
  }[];
  titles?: {
    id: string;
    text: string;                  // frase literal donde aparece
    kicker?: string;               // línea pequeña
    headline: string;              // línea enorme
    durationSeconds?: number;      // default 2.5
  }[];
}
```

Ejemplo:

```json
{
  "type": "cortes-documental",
  "slug": "el-aplauso",
  "topic": "Vivir del aplauso",
  "rawVideoPath": "content/raw/el-aplauso.mov",
  "cutaways": [
    { "id": "c1", "text": "en los estadios", "visual": "football stadium packed with fans in green and white, 1990s" },
    { "id": "c2", "text": "mi nombre", "localImagePath": "content/personajes/el-aplauso/c2.png" }
  ],
  "titles": [
    { "id": "t1", "text": "del aplauso", "kicker": "El que vive", "headline": "del aplauso" }
  ]
}
```

## Reglas del estilo (no cambiar sin pedirlo)

- Cortes de 1.5-3 s, nunca en el primer ni último segundo, nunca solapados
  (el `closing` es la única excepción: dura hasta el final).
- Subtítulos de máx. 3 palabras.
- Voz a -13 LUFS, música ~14 dB debajo, SFX bajos (los generados vienen tan
  fuertes como la voz y saturan si se suben). Revisa que el pico final sea < 0 dBFS.
- Imágenes siempre 9:16.
- Los cortes se descartan o se desplazan automáticamente si no caben;
  la consola avisa cuáles.
