# Música de fondo con licencia real (reemplaza la cama de tensión)

## Contexto

El usuario escuchó la "cama de tensión" (`tensionBedPath`, generada con
ElevenLabs `sound-generation`, loop de 7s) y pidió reemplazarla por una
canción de fondo real. Requisito explícito: quería poder elegir la pista
antes de que se integrara al video, no que se generara/eligiera sola.

Se investigó la API de música de ElevenLabs (`POST /v1/music`, modelo
Music v2) como alternativa de generación, pero el usuario pidió
explícitamente **buscar una pista ya existente en una biblioteca libre de
regalías y usarla tal cual, no generar nada con IA** ("buscaras referencias
y que no la construyas desde cero" → "buscar pistas reales... y usar una
directo").

## Pista elegida

- **Título**: "Motivation - Motivation Music"
- **Autor**: PaulYudin
- **Fuente**: [Pixabay Music](https://pixabay.com/music/build-up-scenes-motivation-motivation-music-573993/)
- **Licencia**: Pixabay Content License — uso comercial permitido, sin
  atribución obligatoria.
- **Duración real**: 75.5s (más larga que el video, 29.9s — se usa desde
  el inicio de la pista, cortada por duración de Sequence en Remotion, sin
  necesidad de recortar el archivo físicamente).
- Ya descargada y guardada en `content/musica/motivation-paulyudin.mp3`
  (verificada con `ffprobe`: MP3 válido, 75.546s, 2,417,475 bytes).

## Decisiones acordadas con el usuario

- Reemplaza por completo la cama de tensión — no es una capa adicional.
- Se usa desde el segundo 0 de la pista.
- Mezcla: fade-in suave al arrancar, volumen bajo y constante durante todo
  el video (sin la rampa de intensidad que tenía la cama de tensión — una
  canción real ya tiene su propia dinámica, no hace falta simularla),
  fade-out antes de que el video corte — nunca un corte seco a mitad de
  la canción.
- El mecanismo de guion sigue el mismo patrón ya usado para
  `localImagePaths`: el usuario provee el archivo, el pipeline solo lo
  copia y lo cachea — no hay generación ni selección automática.

## Cambios de datos (`src/types/guion.ts`)

En `PantallaDivididaGuion`, se quita `tensionBedPrompt` de `soundDesign` y
se agrega `backgroundMusicPath`:

```ts
export interface PantallaDivididaGuion {
  // ...campos existentes sin cambios...
  /** Ruta a un archivo de música de fondo ya elegido y con licencia
   * verificada por el usuario, ej. "content/musica/motivation-paulyudin.mp3".
   * Se reproduce desde el segundo 0, cortado a la duración total del video. */
  backgroundMusicPath: string;
  soundDesign?: {
    whooshPrompt?: string;
    stingPrompt?: string;
  };
}
```

`backgroundMusicPath` es **requerido** (a diferencia de `soundDesign`, que
sigue siendo opcional con prompts por defecto para whoosh/sting) — este
tipo de video siempre lleva música de fondo, no hay un default automático
posible ya que no se genera con IA.

En `RenderedPantallaDivididaGuion.sfx`, se quita `tensionBedPath` y se
agrega `backgroundMusicPath`:

```ts
sfx: {
  backgroundMusicPath: string;
  whooshPath: string;
  whooshDurationInSeconds: number;
  stingPath: string;
  stingDurationInSeconds: number;
}
```

## Pipeline (`src/services/generateAssets.ts`)

En `generatePantallaDivididaAssets`, se quita el bloque que genera
`tensionBedPrompt`/`tensionBedAbsPath` vía `generateSoundEffect`. En su
lugar, mismo patrón de copia+cacheo que ya usa `prepareTrimmedVideo` para
el video crudo:

```ts
const musicAbsPath = path.join(PUBLIC_DIR, "assets", guion.slug, "music", "background.mp3");
if (fs.existsSync(musicAbsPath)) {
  console.log("música de fondo ya copiada, se reutiliza");
} else {
  console.log(`copiando música de fondo desde ${guion.backgroundMusicPath}...`);
  fs.mkdirSync(path.dirname(musicAbsPath), { recursive: true });
  fs.copyFileSync(guion.backgroundMusicPath, musicAbsPath);
}
```

No hace falta leer su duración (a diferencia de whoosh/sting): Remotion la
recorta sola al largo del `<Sequence>`.

## Composición (`src/components/PantallaDividida.tsx`)

Se reemplaza el bloque `<Sequence>`+`<Audio loop>` de la cama de tensión
(que usaba `interpolate` para la rampa 0.08→0.22) por:

```tsx
const MUSIC_VOLUME = 0.15;
const MUSIC_FADE_IN_FRAMES = 20;
const MUSIC_FADE_OUT_FRAMES = 45;

// dentro del componente, con totalFrames = duración total del video en frames:
<Sequence durationInFrames={totalFrames} layout="none">
  <Audio
    src={staticFile(guion.sfx.backgroundMusicPath)}
    volume={(f) =>
      Math.min(
        interpolate(f, [0, MUSIC_FADE_IN_FRAMES], [0, MUSIC_VOLUME], { extrapolateRight: "clamp" }),
        interpolate(f, [totalFrames - MUSIC_FADE_OUT_FRAMES, totalFrames], [MUSIC_VOLUME, 0], { extrapolateLeft: "clamp" }),
      )
    }
  />
</Sequence>
```

`totalFrames` no existe hoy como variable en el componente — se calcula
con `useVideoConfig().durationInFrames` (ya disponible vía `useVideoConfig()`,
que el componente ya usa para `fps`).

## Guion real (`content/guiones/pantalla-dividida.json`)

Se agrega `"backgroundMusicPath": "content/musica/motivation-paulyudin.mp3"`
y se quita `tensionBedPrompt` de `soundDesign` (si estuviera declarado —
hoy no lo está, así que no hay nada que tocar ahí).

## Fixture demo (`public/data/pantalla-dividida-demo.json`)

`sfx.tensionBedPath` se reemplaza por `sfx.backgroundMusicPath`, apuntando
a un archivo de prueba corto generado con `ffmpeg` (tono simple, mismo
patrón que ya usan `whoosh.mp3`/`sting.mp3` del fixture) — no hace falta
usar la pista real con licencia para el fixture sintético.

## Manejo de errores

- Si `guion.backgroundMusicPath` no existe en disco, `fs.copyFileSync`
  falla con un error de Node claro (`ENOENT`) — mismo comportamiento que
  ya tiene `rawVideoPath` hoy, no se agrega manejo especial.

## Testing

- No hay lógica nueva testeable de forma aislada (es copiar un archivo +
  un envelope de volumen declarativo en JSX) — se verifica renderizando
  el video real y el fixture, igual que las capas de sonido anteriores.

## Fuera de alcance

- Volver a habilitar el whoosh/zoom por corte de imagen (sigue pendiente
  de una conversación de diseño aparte, ver feedback anterior del usuario).
- Cualquier mecanismo de selección automática de música (el usuario pidió
  explícitamente elegir a mano).
