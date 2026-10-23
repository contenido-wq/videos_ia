---
name: motion-blanco
description: Edita un video crudo de la persona hablando a cámara en el estilo "Motion blanco" — cortes secos entre el presentador (jump cuts cada ≤3 s) y escenas de 2.5–3 s sobre papel casi blanco con fotos cinematográficas reales como tarjetas compactas, objetos fotorrealistas recortados apoyados en sus esquinas y rótulos en serif arriba, con parallax discreto, rebote corto, entradas escalonadas, personajes consistentes y subtítulos de 1–3 palabras. Usar cuando el usuario pida "motion blanco", "estilo tarjetas sobre blanco", "como el reel de @gannon.meyer" o "como La armadura de otro".
---

# Motion blanco

## Qué es este estilo

Un video vertical (1080x1920, 30fps) hecho a partir de UN video real de la
persona hablando a cámara. Alterna con cortes secos entre:

- **El presentador**: tono cálido, viñeta suave, un encuadre nuevo (abierto /
  medio / cerrado con leve corrimiento) al menos cada 3 s y un zoom lento
  dentro de cada corte. Subtítulos blancos de 1–3 palabras a la altura del
  pecho. Al inicio, el título del video en serif sobre la imagen con el
  escudo naranja de marca.
- **Escenas sobre papel** (#FAF9F7), de 2.5 a 3 s cada una, en 3 capas:
  - *Fondo*: el papel, quieto.
  - *Medio*: una foto cinematográfica real (generada con IA) como tarjeta
    compacta de 720x900, entre ~13% y ~60% de la altura, sombra apenas
    perceptible y un zoom lento adentro.
  - *Frente*: objetos fotorrealistas recortados apoyados en las esquinas
    inferiores de la tarjeta, rótulos en serif oscuro ARRIBA de la tarjeta, y
    tarjetitas blancas (checklist, versículo, teclas) en su borde inferior.
  - Subtítulo negro y pequeño justo debajo de la tarjeta.
- **Pantalla dividida** opcional: foto + checklist arriba, presentador abajo.

Solo la voz + música de fondo 18 dB por debajo. Voz normalizada a -14 LUFS.

Referencia original: instagram.com/p/DeNVzrvsDyv (@gannon.meyer). Primer
video hecho así: slug `reel-2951`, composición `ArmaduraDeOtro`
("La armadura de otro").

## Reglas que NO se negocian

Salieron de varias rondas de corrección con Jhei; no las relajes sin que él
lo pida:

1. **Imágenes reales, nunca dibujos** (nada de siluetas vectoriales, íconos
   de línea ni notas a mano con flechas).
2. **Papel blanco con la foto como tarjeta compacta**, NO fotos a pantalla
   completa.
3. **Ningún texto encima de una foto ni de la cara de nadie.**
4. **Movimiento sutil**: rebote corto (~4%), entradas escalonadas, parallax
   discreto (tarjeta 10 px, frente 24 px), micromovimiento de 1.5 px. Sin
   partículas ni flotaciones.
5. **Sin efectos de sonido** (whoosh/pop le suenan ficticios).
6. **Ninguna escena dura más de 3 s** — el build falla si alguna se pasa.
7. **Personajes consistentes**: misma cara, edad, pelo y ropa en todo el
   video (ej. David ≈ 17 años en todas las escenas).
8. **Nunca repetir una imagen** ni dejar que una escena copie la pose/fondo
   de la referencia de un personaje.

## Qué necesitas antes de empezar

- El **video crudo** de la persona hablando a cámara.
- En `.env`: `ELEVENLABS_API_KEY` (transcripción), `ANTHROPIC_API_KEY`
  (detección de retakes) y `KIE_AI_API_KEY` (imágenes con nano-banana;
  ~4 créditos por imagen, un video de ~2 min usa ~40 imágenes).
- Música en `content/musica/` (hoy el build usa `motivation-paulyudin.mp3`).

## Flujo paso a paso (instrucciones para Claude)

1. **Limpiar y transcribir**: `npm run clean:video -- <video> <slug>`. Si
   corre sin terminal interactiva se detiene en los candidatos a retake:
   léelos en `public/assets/<slug>/retake-candidates.json`, revísalos contra
   `transcript.json` palabra por palabra y escribe los cortes aprobados en
   `approved-retake-ranges.json` (`[{ "start", "end" }]`). Recorta los
   retakes con precisión de palabra para que la frase limpia quede completa.
2. **Leer la transcripción ya recortada** (con los tiempos remapeados) y
   decidir qué frases se ilustran. Un buen reparto: ~2/3 del video en
   escenas, y el presentador en las frases de opinión/reflexión y en el
   cierre.
3. **Escribir el plan** en `content/motion-blanco/<slug>.json` (formato
   abajo). Cada escena se ancla a frases del guion, no a segundos.
4. **Validar el ritmo sin gastar créditos**:
   `SKIP_IMAGES=1 npx tsx src/services/buildMotionBlanco.ts <video> <slug>`.
   Si alguna escena pasa de 3 s, pártela o ponle `toPhrase`, y repite.
5. **Personajes**: si hay personajes recurrentes, genera primero UNA
   referencia de cuerpo entero por personaje sobre fondo neutro (con
   `editImage` a partir de la mejor toma, o `generateImage`), guárdala en
   `public/assets/<slug>/images/characters/` y regístrala en `characters`.
6. **Generar** (solo crea las imágenes que falten):
   `npx tsx src/services/buildMotionBlanco.ts <video> <slug>`.
7. **Revisar las imágenes en una hoja de contacto** antes de renderizar:
   fondos, recortes (sin blanco atrapado ni sombras) y TODAS las escenas con
   personajes juntas. Para rehacer una imagen, bórrala, ajusta su prompt y
   vuelve a correr el paso 6. Errores ya vistos: objetos modernos en escenas
   bíblicas (un tanque), texto en inglés en pantallas, edades distintas del
   mismo personaje, escenas que copian la foto de referencia.
8. **Registrar la composición** en `src/Root.tsx`:
   `<MotionBlancoComposition id="<Id>" slug="<slug>" />`.
9. **Revisar fotogramas** con `npx remotion still <Id> <png> --frame=<n>` al
   final de cada escena (ya asentada) y armar una hoja de contacto; ajustar
   textos que no quepan.
10. **Renderizar**:
    `npx remotion render <Id> /Users/jheitrujillo/videos-ia/out/<nombre>.mp4 --codec=h264 --crf=18`
    y medir el audio (`ffmpeg -i … -af ebur128=peak=true -f null -`):
    debe dar ~-14 LUFS.
11. Entregar con ruta absoluta y ofrecer caption/portada.

## Formato del plan

```json
{
  "title": { "kicker": "David vs. Goliat", "headline": "La armadura de otro", "toPhrase": "armadura de otro" },
  "characters": {
    "david": {
      "image": "assets/<slug>/images/characters/david.png",
      "description": "David, a 17-year-old Israelite shepherd, lean build, wavy shoulder-length brown hair, no beard, light beige wool tunic with a rope belt"
    }
  },
  "scenes": [
    {
      "id": "g08-casco-malla",
      "fromPhrase": "un casco de bronce",
      "toPhrase": "una cota de malla",
      "layout": "full",
      "bg": "dark interior of an ancient royal tent, warm side light",
      "refs": [],
      "mid": [
        { "id": "casco-bronce", "kind": "cutout", "prompt": "an ancient bronze helmet", "atPhrase": "casco" }
      ],
      "front": [{ "kind": "pill", "text": "Casco de bronce", "atPhrase": "casco" }]
    }
  ]
}
```

- `fromPhrase` / `toPhrase` / `atPhrase`: palabras exactas de la
  transcripción (se ignoran mayúsculas, tildes y puntuación). Sin `toPhrase`
  la escena dura hasta que empieza la siguiente.
- `layout`: `"full"` (tarjeta) o `"split"` (foto + checklist arriba,
  presentador abajo).
- `bg`: prompt en inglés de la foto; el build le agrega el estilo
  cinematográfico común (35 mm, golden hour, grano suave, sin texto).
- `refs`: personajes de `characters` que salen en la escena (se generan con
  nano-banana-edit a partir de su referencia).
- `mid`: hasta 2 objetos recortados (se generan sobre fondo blanco y
  `scripts/cutout_white_bg.py` quita el fondo). También aceptan `refs`.
- `front` — `kind`:
  - `title` y `pill`: rótulo en serif arriba de la tarjeta. Varios cortos van
    en una línea separados por "·"; si juntos pasan de 24 caracteres se
    apilan.
  - `quote`: rótulo con comillas naranjas.
  - `verse`: tarjeta blanca de texto en el borde inferior; el `pill` de la
    misma escena se usa como su referencia (ej. "1 Samuel 17:38").
  - `check`: filas de checklist en una tarjeta blanca.
  - `key`: teclas (ej. "⌘C", "⌘V") en fila.
- Lo que no tiene `atPhrase` entra escalonado desde el inicio de la escena.

## Archivos

- `src/components/MotionBlanco.tsx` — render (capas, tiempos de animación,
  tipografía, paleta).
- `src/MotionBlancoComposition.tsx` — composición 1080x1920 @30fps.
- `src/services/buildMotionBlanco.ts` — limpieza, proxy, normalización de
  audio, resolución de frases, validación de ≤3 s, jump cuts, datos.
- `src/services/motionBlancoImages.ts` — generación de fotos, recortes y
  personajes con referencia.
- `scripts/cutout_white_bg.py` — quita el fondo blanco de los objetos.
- Salidas: `public/data/<slug>.json`, imágenes en
  `public/assets/<slug>/images/`.
