---
name: ranking
description: Crea videos de "ranking" o lista numerada — el usuario habla a cámara sobre una lista de herramientas/temas, y cada una aparece con su logo en el momento exacto en que la menciona. Internamente es el tipo "social-checklist". Usar cuando el usuario diga "video de ranking" o quiera mostrar una lista numerada con logos.
---

# Ranking — lista numerada con logos

## Qué es este estilo

Un video real (la persona grabada hablando a cámara) con un overlay de
lista numerada: un título fijo arriba tipo "sticker", y una fila por cada
item de la lista — cuando la persona menciona ese item en voz alta, su
logo entra animado a la casilla correspondiente y se queda ahí fijo. La
cantidad de filas se adapta a la cantidad de items (no está fijo en 5).

30fps, 1080x1920 (9:16). El audio es el real de la grabación, no se
genera voz.

## Qué necesitás antes de empezar

- **Un video crudo** grabado por la persona hablando a cámara,
  mencionando cada item de la lista en algún momento (no hace falta que
  sea en orden ni sin errores — el pipeline detecta y corta
  automáticamente silencios, muletillas, y hasta intentos fallidos/tomas
  repetidas).
- **`ELEVENLABS_API_KEY`** — transcribe el video con marcas de tiempo por
  palabra. Conseguila en elevenlabs.io.
- **`ANTHROPIC_API_KEY`** — detecta automáticamente qué tramos del video
  son intentos fallidos o interacciones con alguien fuera de cámara (ej.
  alguien dictándole el guion en vivo), para cortarlos. Conseguila en
  console.anthropic.com.
- Para los logos: no hace falta ninguna clave extra en la mayoría de los
  casos (usa una librería local de íconos primero); si no encuentra el
  logo ahí, cae en cascada a otras fuentes gratuitas antes de generar uno
  con IA como último recurso (esa última instancia sí usa `KIE_AI_API_KEY`).

## Flujo paso a paso (instrucciones para Claude)

Cuando alguien te pida un video de este estilo:

1. Preguntale cuál es la lista (los items, en el orden que quiera
   mostrarlos — el número 1 no tiene que ser el primero que menciona en
   el video, el pipeline lo ubica por lo que realmente dice).
2. Preguntale si en el video hay una segunda persona dictándole las
   líneas fuera de cámara (esto activa `removeOtherSpeakers: true`, que
   corta automáticamente esos tramos).
3. Pedile la ruta del video crudo (dónde lo tiene guardado) y copiálo a
   `content/raw/<slug>.<ext>` (los formatos `.mov`/`.mp4` funcionan
   igual).
4. Armá el guion en `content/guiones/<slug>.json` con la estructura de
   abajo.
5. **Importante — paso interactivo:** decile a la persona que corra ella
   misma, en su propia terminal (no una tool call tuya sin TTY):
   ```
   npm run generate:assets -- content/guiones/<slug>.json
   ```
   Este comando transcribe el video, y en algún punto va a pausar
   pidiéndole revisar cada candidato a retake/aside con `[s/n/a/r]` — eso
   solo funciona en una terminal interactiva real. Si vos intentás
   correrlo directamente, el proceso se cuelga esperando un input que
   nunca llega.
6. Una vez que la persona te confirme que terminó, agregá una línea en
   `src/Root.tsx` registrando la composición (ver sección de abajo).
7. Sugerile `npm run dev` para previsualizar, y
   `npx remotion render <CompositionId> out/<slug>.mp4` para renderizar.

## Estructura del guion

```ts
interface SocialChecklistGuion {
  type: "social-checklist";
  slug: string;
  topic: string;
  rawVideoPath: string;          // ej. "content/raw/mi-video.mov"
  listTitle: string;              // texto del título fijo arriba
  items: ChecklistItem[];
  removeOtherSpeakers?: boolean;  // default false
}

interface ChecklistItem {
  id: string;                     // "1" = arriba de todo en la lista visualmente
  label: string;                  // texto a buscar en lo que dice el video (no se muestra en pantalla)
  logoQuery: string;               // qué buscar para encontrar el logo/ícono
}
```

Ejemplo real, completo (`content/guiones/5-herramientas-ranking.json`):

```json
{
  "type": "social-checklist",
  "slug": "5-herramientas-ranking",
  "topic": "Ranking de 5 herramientas de IA",
  "rawVideoPath": "content/raw/5-herramientas-ranking.mov",
  "removeOtherSpeakers": true,
  "listTitle": "5 HERRAMIENTAS DE IA QUE USTED VA A NECESITAR PARA NO SER UN DINOSAURIO",
  "items": [
    { "id": "5", "label": "ChatGPT", "logoQuery": "ChatGPT logo" },
    { "id": "4", "label": "Gamma", "logoQuery": "Gamma app logo" },
    { "id": "3", "label": "Notebook LM", "logoQuery": "Google NotebookLM logo" },
    { "id": "2", "label": "Claude Code", "logoQuery": "Claude Anthropic AI logo" },
    { "id": "1", "label": "AiVi", "logoQuery": "AIVI logo" }
  ]
}
```

## Registrar la composición

En `src/Root.tsx`, agregar una línea dentro del `<>...</>`:

```tsx
<SocialChecklistComposition id="<UnNombreUnico>" slug="<slug-del-guion>" />
```

(`SocialChecklistComposition` ya está importado en ese archivo).
