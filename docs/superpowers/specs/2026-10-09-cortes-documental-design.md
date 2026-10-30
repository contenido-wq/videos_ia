# Estilo "cortes-documental" — diseño

## Objetivo
Un tipo de video nuevo para editar UN video crudo de la persona hablando a cámara
(vertical 9:16) con el estilo del video de referencia `Cont 3 Pas Juangui.mp4`:
el presentador a pantalla completa, con cortes a imágenes de archivo estilo
documental que ilustran lo que dice, subtítulos palabra por palabra y títulos
grandes en las frases clave. Salida 1080x1920, 30 fps, audio real de la grabación.

Primera prueba: `/Users/jheitrujillo/Downloads/IMG_2951.mov` (2 min 03 s, vertical).

## Qué se observó en la referencia (36.6 s)
- Presentador a pantalla completa; un corte a imagen cada ~2 s, alternando con él.
- Imágenes: fotos de archivo a pantalla completa 9:16 (jugador, calles de Medellín,
  estadio), ancladas a la palabra que se dice ("estadios", "mi nombre").
- Subtítulos: 1–3 palabras a la vez, blancos, tipografía pesada con letra apretada
  y sombra suave, a media altura, siempre visibles (sobre el presentador y sobre
  las imágenes).
- Título grande ocasional: línea pequeña ("El que vive") + línea enorme ("del aplauso").

## Decisiones
1. **Se reutiliza el pipeline compartido** (`prepareTrimmedVideo`: silencios, retakes,
   transcripción con tiempos por palabra) y `matchSceneTimestamps`. Solo cambia lo visual.
2. **Un tipo nuevo `cortes-documental`**, no una variante de `pantalla-dividida`: el
   layout es distinto (pantalla completa + cortes, sin barra de texto ni acto de cierre).
3. **Imágenes: dos fuentes, por cutaway.** `localImagePath` (la persona las pone en
   `content/personajes/<slug>/`) o `visual` (prompt para IA vía kie.ai con fallback a
   pollinations, mismo mecanismo que `pantalla-dividida`, aspecto 9:16). La skill
   pregunta SIEMPRE cuál se usa antes de arrancar. Sufijo de estilo fijo para IA:
   fotografía de archivo documental, grano de película, tonos cálidos.
4. **Audio (ampliado tras la primera revisión):** voz normalizada a -13 LUFS, música de fondo
   con licencia (`backgroundMusicPath`) ~14 dB debajo, whoosh por corte y hit en títulos/cierre.
5. **Subtítulos** con `buildCaptionChunks` (máx. 3 palabras, pausa > 0.4 s corta bloque),
   independientes de los cutaways.
6. Dimensiones fijas del estilo: cutaway de 1.5 a 3 s, zoom lento (1.0 → 1.08),
   crossfade de 6 frames, sin cutaway en el primer segundo ni en el último.

## Guion
```ts
interface CortesDocumentalGuion {
  type: "cortes-documental";
  slug: string;
  topic: string;
  rawVideoPath: string;            // ej. "content/raw/<slug>.mov"
  removeOtherSpeakers?: boolean;
  cutaways: {
    id: string;
    text: string;                  // frase literal de la transcripción donde arranca el corte
    localImagePath?: string;
    visual?: string;               // prompt IA si no hay localImagePath
    durationSeconds?: number;      // opcional, 1.5–3 (default 2.5)
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
Cada cutaway/título falla con un error claro si no tiene imagen o no se encuentra
el texto (mismo patrón que `pantalla-dividida`: lista lo que falta antes de renderizar).

## Archivos
- `src/types/guion.ts` — tipos `CortesDocumentalGuion` y `Rendered…`, ampliar `GuionType` y `Guion`.
- `src/services/cortesDocumentalTiming.ts` (+ `.test.ts`, vitest) — función pura: recorta cutaways
  a 1.5–3 s, evita solapes y bordes (primer/último segundo). Es la única lógica con riesgo.
- `src/services/generateAssets.ts` — `generateCortesDocumentalAssets` y rama en `main()`.
- `src/components/CortesDocumental.tsx` y `src/CortesDocumentalComposition.tsx`.
- `src/Root.tsx` — registrar la composición de la prueba.
- `.claude/skills/cortes-documental/SKILL.md` — flujo para Claude (mismo esquema que `pantalla-dividida`:
  pedir video, guion borrador sin cutaways, el usuario corre `generate:assets` en su terminal por los
  retakes, Claude lee la transcripción real y arma los cutaways/títulos, segunda corrida, render).

## Fuera de alcance
Música, efectos de sonido, etalonaje de color del presentador, resaltado de palabra activa en
los subtítulos, y cualquier cambio a `pantalla-dividida` o a la skill `vox-motion-graphics`
(que se instala aparte, tal cual, en `.claude/skills/vox-motion-graphics/`).

## Verificación
- Tests de `cortesDocumentalTiming` en verde (`npm test`), `npm run lint` sin errores.
- Render real de IMG_2951.mov y revisión de fotogramas contra la referencia
  (subtítulos legibles sobre fondo claro y oscuro, cortes ≤ 3 s, sin imágenes repetidas).

## Ampliación tras la primera revisión (2026-10-09)
- `basedOn` en un corte: imagen de referencia (nano-banana-edit) para que un personaje se vea igual en todos los cortes.
- `closing`: corte final que dura hasta el final + cola de 2.5 s, con fundido a negro.
- Jump cuts del presentador (`computeJumpCuts`, `speakerScaleAt`) y 3 transiciones con overlay (flash/slide/zoom).
- El pipeline compartido fallaba con `.mov` de iPhone que traen una pista de audio espacial (`apac`):
  se fijó `-map 0:a:0` en `ffmpegService.ts` y `videoTrimService.ts`.
