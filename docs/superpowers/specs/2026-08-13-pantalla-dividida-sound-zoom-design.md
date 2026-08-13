# Sonido cinematográfico + zoom épico para "pantalla dividida"

## Contexto

El primer video de `pantalla-dividida` ya está renderizado y funcionando
(`docs/superpowers/specs/2026-08-13-pantalla-dividida-design.md`). El
usuario lo vio y pidió una mejora: que se sienta más "de película" —
efectos de sonido de suspenso y un zoom épico con sensación de speed
ramping en los cortes de imagen del Acto 1.

## Decisiones acordadas con el usuario

- **Origen del sonido**: generación automática vía IA (ElevenLabs
  `sound-generation`, mismo mecanismo ya usado por el campo `sfxPrompt` de
  los guiones `vox`), no archivos subidos a mano.
- **Tres capas de sonido**, generadas UNA sola vez por video (no una por
  escena/corte — se reutiliza el mismo asset en cada disparo, como en
  diseño de sonido real de cine):
  1. **Cama de tensión**: drone/pad de suspenso de fondo, continuo durante
     todo el Acto 1, con el volumen subiendo hacia el final.
  2. **Whoosh**: sonido de transición corto, en CADA corte de imagen
     (cada vez que cambia la ilustración dentro de una escena, ~cada 2.5s).
  3. **Sting**: golpe dramático corto, exactamente cuando arranca el
     Acto 2 (el cierre a pantalla completa).
- **Zoom épico sincronizado (Acto 1)**: cada corte de imagen entra con un
  "punch" de zoom — arranca en escala ampliada y cae rápido a tamaño
  normal con rebote leve — en el MISMO frame que su whoosh. Un solo golpe
  audiovisual por corte, no dos eventos independientes.
- **Zoom sutil (Acto 2)**: el video del presentador a pantalla completa
  escala lentamente y de forma continua durante todo el cierre (no es
  "épico", es apenas perceptible — evita que se sienta estático).
- **Mezcla de volumen**: la voz real del presentador manda siempre. Cama
  de tensión muy baja (sube de ~0.08 a ~0.22 a lo largo del Acto 1),
  whoosh moderado (~0.4), sting más fuerte que el whoosh pero por debajo
  de la voz (~0.5).

## Riesgo técnico a verificar en la implementación

`generateSoundEffect` (`src/services/elevenlabsService.ts:69`) ya envía
`duration_seconds` a la API de ElevenLabs, pero el proyecto solo lo ha
usado hasta ahora con clips cortos (`Math.min(durationInSeconds, 3)` en
`generateScene`). No se conoce el límite real de duración de la API para
un clip más largo. Por eso la cama de tensión **no depende de generar un
clip que dure lo mismo que el Acto 1 completo**: se genera un loop corto
(pedido en el prompt, ~6-8s) y Remotion lo repite (`<Audio loop>`) hasta
cubrir la duración real del Acto 1, con el volumen animado por separado.
Esto es válido sin importar cuál sea el límite real de la API. Verificar
igual con una llamada real antes de dar la función por terminada, por si
el clip corto también falla o suena distinto a lo esperado.

## Cambios de datos (`src/types/guion.ts`)

```ts
export interface PantallaDivididaGuion {
  // ...campos existentes sin cambios...
  /** Prompts para las 3 capas de sonido generadas una vez por video.
   * Todos opcionales: si se omite alguno, se usa un prompt por defecto
   * razonable de suspenso/whoosh/sting. */
  soundDesign?: {
    tensionBedPrompt?: string;
    whooshPrompt?: string;
    stingPrompt?: string;
  };
}

export interface RenderedPantallaDivididaGuion {
  // ...campos existentes sin cambios...
  sfx: {
    tensionBedPath: string;
    whooshPath: string;
    whooshDurationInSeconds: number;
    stingPath: string;
    stingDurationInSeconds: number;
  };
}
```

`sfx` no es opcional en `RenderedPantallaDivididaGuion`: siempre se genera
(con prompts por defecto si el guion no los especifica), así el
componente no necesita ramas condicionales para "video sin sonido de
ambiente".

## Pipeline (`src/services/generateAssets.ts`)

En `generatePantallaDivididaAssets`, después de resolver `renderedScenes`
y antes de escribir `public/data/<slug>.json`:

1. Prompts por defecto (usados si `guion.soundDesign?.xPrompt` no está):
   - tensión: `"low ominous cinematic tension drone, suspenseful ambient pad, subtle rising dread, seamless loop, no melody, no percussion"`
   - whoosh: `"quick cinematic whoosh transition sound effect, sharp and short, trailer style"`
   - sting: `"dramatic cinematic impact hit, deep bass boom with a sharp metallic edge, trailer sting"`
2. Por cada uno de los 3, mismo patrón de cacheo que el resto del pipeline
   (`public/assets/<slug>/sfx/tension-bed.mp3`, `whoosh.mp3`, `sting.mp3`
   — si el archivo ya existe, se reutiliza y no se vuelve a llamar a la
   API). La cama de tensión se pide con `durationSeconds: 7`; whoosh y
   sting sin `durationSeconds` (la API define una duración corta acorde
   al prompt).
3. `whooshDurationInSeconds`/`stingDurationInSeconds` se leen del archivo
   ya generado con la función `getAudioDurationInSeconds` que ya existe
   en este mismo archivo (usada hoy para las voces de `vox`).
4. Se agregan al objeto `rendered` como el campo `sfx` descrito arriba.

## Nuevo módulo puro: `src/services/pantallaDivididaTiming.ts`

Lógica de timing testeable sin dependencias de Remotion, para no mezclar
cálculo de frames con JSX:

```ts
export function computeCutFrames(scenes: RenderedPantallaDivididaScene[], fps: number): number[]
```
Recorre las escenas en orden; por cada escena `"split"`, recorre su
array `images` (igual algoritmo de cursor acumulado que ya usa
`SceneIllustration`) y agrega el frame absoluto de arranque de cada
corte (escenas `"closing"` no aportan cortes). Devuelve la lista completa
en orden — un whoosh por cada valor de esta lista.

```ts
export function computeActTwoStartFrame(scenes: RenderedPantallaDivididaScene[], fps: number): number
```
Frame absoluto donde arranca la primera escena `"closing"` (si no hay
ninguna, devuelve la duración total). Se usa para: (a) hasta dónde suena
la cama de tensión, (b) en qué frame dispara el sting.

Ambas se testean con `vitest` con guiones de prueba pequeños (2-3
escenas), sin necesidad de renderizar nada.

## Composición (`src/components/PantallaDividida.tsx`)

- **Zoom épico por corte** (`SceneIllustration`): se agrega un `spring`
  por corte (`frame: localFrame - cut.startFrame`, config con rebote
  leve — damping bajo, stiffness alto — `durationInFrames: 18`) que
  interpola `scale` de `1.18` a `1.0`. Se aplica junto a la opacidad ya
  existente en el `style` del `<Img>` (`transform: scale(...)`), sin
  tocar la lógica de crossfade actual.
- **Zoom sutil en el cierre**: dentro del bloque `!isSplit` que envuelve
  el `<OffthreadVideo>`, se calcula `progress = localFrame /
  (scene.durationInSeconds * fps)` y se aplica `transform: scale(1 +
  0.06 * progress)` — solo cuando la escena activa es `"closing"`.
- **Whoosh**: por cada frame en `computeCutFrames(guion.scenes, fps)`, un
  `<Sequence from={f} durationInFrames={Math.round(guion.sfx.whooshDurationInSeconds * fps)}><Audio src={staticFile(guion.sfx.whooshPath)} volume={0.4} /></Sequence>`.
- **Cama de tensión**: `<Sequence from={0} durationInFrames={actTwoStartFrame}><Audio src={staticFile(guion.sfx.tensionBedPath)} loop volume={(f) => interpolate(f, [0, actTwoStartFrame], [0.08, 0.22], { extrapolateRight: "clamp" })} /></Sequence>`.
- **Sting**: `<Sequence from={actTwoStartFrame} durationInFrames={Math.round(guion.sfx.stingDurationInSeconds * fps)}><Audio src={staticFile(guion.sfx.stingPath)} volume={0.5} /></Sequence>`.

Estos 4 bloques de audio/zoom se agregan dentro del `<AbsoluteFill>` ya
existente, sin reestructurar el layout actual (video, ilustración,
captions siguen igual).

## Manejo de errores

- Si `generateSoundEffect` falla para cualquiera de las 3 capas, el
  pipeline falla explícito (mismo comportamiento que cualquier otra
  llamada a servicio externo en este archivo hoy — no hay fallback
  silencioso a "video sin sonido").
- Si `computeActTwoStartFrame` no encuentra ninguna escena `"closing"`
  (guion mal formado), devuelve la duración total — la cama de tensión
  cubre todo el video y no hay sting (no rompe el render).

## Testing

- `computeCutFrames` y `computeActTwoStartFrame`: casos con varias
  escenas `"split"` de distinto número de cortes, con y sin escena
  `"closing"`, escena `"closing"` en cualquier posición (no
  necesariamente la última).
- El resto (generación de audio, mezcla en Remotion) se verifica
  visual/auditivamente renderizando el video real, igual que se hizo
  para el spec anterior — no hay forma práctica de testear
  automáticamente cómo suena una mezcla de audio.

## Fuera de alcance

- Regenerar el primer video ya existente con este sonido (se hace en una
  sesión aparte, después de que el código esté listo — mismo patrón que
  el spec anterior).
- Reusar este mecanismo de sonido cinematográfico en los tipos `vox` o
  `social-checklist` (queda específico de `pantalla-dividida` por ahora).
- Sonido reactivo al contenido semántico de cada escena (ej. un sonido
  distinto según el tema de la ilustración) — las 3 capas son genéricas,
  no una por escena.
