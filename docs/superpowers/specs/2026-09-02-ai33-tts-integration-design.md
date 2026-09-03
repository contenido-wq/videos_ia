# Integración de ai33.pro como proveedor de voz (vox, documental-doodle)

## Contexto

El usuario compartió una API key de `ai33.pro` (marca "OpenSpeaker",
`https://ai33.pro`) y pidió reemplazar ElevenLabs como proveedor de voz
generada por IA. Se investigó la documentación real (`/app/api-document`,
requiere sesión — se leyó vía inspección del DOM) y se validó con una
llamada de prueba real usando la key del usuario (gastó ~149 créditos, el
usuario fue avisado).

Hallazgos confirmados empíricamente:

- `ai33.pro` es un **agregador**: expone una sola API (`https://api.ai33.pro/v3`)
  sobre múltiples motores de voz, seleccionados por prefijo del `voice_id`
  (`elevenlabs_`, `minimax_`, `edge_`, `fishaudio_`, `vbee_`, `kokoro_`,
  `clone_` para voces clonadas). Con `voice_id: "elevenlabs_21m00Tcm4TlvDq8ikWAM"`
  (la misma voz default que ya usa este proyecto) el proveedor real
  reportado en la respuesta es `"provider":"elevenlabs"` — o sea, se puede
  mantener exactamente la misma voz, solo cambia quién la sirve/factura.
- **Es asíncrono**, a diferencia del `generateVoice` actual (síncrono):
  `POST /v3/text-to-speech` (multipart, header `xi-api-key`, igual que
  ElevenLabs) devuelve `{success, task_id}` de inmediato. Hay que consultar
  `GET /v3/task/{task_id}` hasta que `status` sea `"done"` (se confirmó con
  una llamada real: tras el submit, el estado ya estaba `"done"` en la
  primera consulta de prueba, pero el pipeline no puede asumir eso).
- La respuesta del task, una vez `"done"`, trae `audio_url` (mp3, se
  descarga con un GET simple) y, si se pidió `with_transcript: true`,
  `json_url` — un JSON cuyo formato es **idéntico** al que ya devuelve
  `elevenlabsService.transcribeWithTimestamps`: un array con un objeto que
  tiene `words: [{text, start, end, type, speaker_id, logprob}]`, filtrando
  `type === "word"`. Verificado con una llamada real (ver "Contexto").
- No se encontró un endpoint de transcripción de audio arbitrario (solo
  `with_transcript` atado a audio generado por ellos mismos) — por eso el
  alcance de este cambio queda limitado a los tipos que generan voz con IA.

## Decisión de alcance (acordada con el usuario)

- **Reemplaza** a ElevenLabs para generar voz en `vox` y `documental-doodle`
  (los dos únicos tipos que generan narración con IA en vez de grabar a
  alguien).
- **No toca** `transcribeWithTimestamps`/`transcribeWithSpeakers`
  (transcripción de video/audio real grabado, usadas por
  `social-checklist`, `pantalla-dividida`, `youtube-noticias-avatar` vía
  `prepareTrimmedVideo`) ni `generateSoundEffect` (sfx de
  `pantalla-dividida`) — ai33.pro no cubre ese caso (transcribir audio que
  no generaron ellos), así que esas rutas siguen usando ElevenLabs tal
  cual.
- **Manejo del asincronismo**: polling simple (consultar `GET
  /v3/task/{task_id}` cada 2s hasta `"done"` o hasta un timeout) — no
  webhook, para no requerir exponer un endpoint público desde un proyecto
  que hoy corre todo local/CLI.
- **Voz default**: `elevenlabs_21m00Tcm4TlvDq8ikWAM` — mantiene la voz
  actual del proyecto, solo cambia el proveedor de la llamada.
- **Variable de entorno**: `AI33_API_KEY` en `.env` (ya gitignoreado, mismo
  patrón que `ELEVENLABS_API_KEY`/`KIE_AI_API_KEY`). Nunca se loguea ni se
  imprime el valor de la key en ningún punto del código o de la consola.

## Cambios de datos/servicios

### `src/services/env.ts`

Agregar un getter más, mismo patrón que los existentes:

```ts
get ai33ApiKey() {
  return required("AI33_API_KEY");
},
```

### `src/services/ai33Service.ts` (nuevo)

```ts
export interface GenerateSpeechOptions {
  voiceId?: string;
  speed?: number;
  outputPath: string;
  withTranscript?: boolean; // default false
}

export interface GenerateSpeechResult {
  audioPath: string;
  words: TranscribedWord[]; // [] si withTranscript es false
}

export async function generateSpeech(
  text: string,
  options: GenerateSpeechOptions,
): Promise<GenerateSpeechResult>
```

Internamente:

1. `POST https://api.ai33.pro/v3/text-to-speech` (multipart: `text`,
   `voice_id` = `options.voiceId ?? "elevenlabs_21m00Tcm4TlvDq8ikWAM"`,
   `speed` = `options.speed ?? 1`, `with_transcript` =
   `options.withTranscript ?? false`), header `xi-api-key: env.ai33ApiKey`.
   Falla explícito si `!res.ok`. Devuelve `task_id`.
2. Poll `GET https://api.ai33.pro/v3/task/{task_id}` (mismo header) cada
   2 segundos (constante `POLL_INTERVAL_MS = 2000`) hasta un timeout total
   de 120 segundos (constante `POLL_TIMEOUT_MS = 120000`):
   - `status === "done"` → sigue.
   - `status === "failed"` → falla explícito con el `error` que devuelva la
     API.
   - timeout alcanzado → falla explícito indicando el `task_id` y cuánto
     esperó.
3. Descarga `audio_url` (GET simple, sin auth — es una URL de CDN firmada)
   y la escribe en `options.outputPath` (`fs.mkdirSync` recursivo +
   `fs.writeFileSync`, mismo patrón que `elevenlabsService.generateVoice`).
4. Si `options.withTranscript`: descarga `json_url`, toma el primer
   elemento del array, filtra `words` por `type === "word"`, mapea a
   `{text, start, end}` (mismo shape que `TranscribedWord`). Si
   `withTranscript` es `true` pero la respuesta no trae `json_url`, falla
   explícito.
5. Devuelve `{ audioPath: options.outputPath, words }`.

## Cambios en `src/services/generateAssets.ts`

### `generateScene` (usada por `vox`)

Cambia únicamente la línea que genera la voz:

```ts
// antes
await generateVoice(scene.text, { outputPath: audioAbsPath, voiceId: guion.voiceId });
// después
await ai33Service.generateSpeech(scene.text, { outputPath: audioAbsPath, voiceId: guion.voiceId, withTranscript: false });
```

Nada más cambia en `generateScene` — `getAudioDurationInSeconds` sobre el
archivo ya descargado sigue funcionando igual, y toda la lógica de
`numCuts`/imágenes es independiente del proveedor de voz.

### `generateDocumentalDoodleAssets`

Reemplaza el par actual (`generateVoice` + `transcribeWithTimestamps`, dos
llamadas separadas) por una sola:

```ts
const { words } = await ai33Service.generateSpeech(scene.text, {
  outputPath: audioAbsPath,
  voiceId: guion.voiceId,
  withTranscript: true,
});
for (const word of words) {
  allWords.push({ text: word.text, start: word.start + cursorSeconds, end: word.end + cursorSeconds });
}
```

`getAudioDurationInSeconds(audioAbsPath)` sigue llamándose igual después,
sobre el mismo archivo ya descargado por `ai33Service.generateSpeech`.

## Limpieza

- `elevenlabsService.generateVoice` queda sin ningún llamador tras este
  cambio (los dos únicos call sites eran `generateScene` y
  `generateDocumentalDoodleAssets`) — se borra junto con su interfaz
  `GenerateVoiceOptions` y la constante `DEFAULT_VOICE_ID` de ese archivo
  (pasa a vivir, con el prefijo `elevenlabs_`, como default dentro de
  `ai33Service.ts`).
- `elevenlabsService.listVoices`, `transcribeWithTimestamps`,
  `transcribeWithSpeakers`, `generateSoundEffect` **no se tocan** (siguen
  con otros llamadores activos).

## Seguridad

- La API key va únicamente en `.env` (ya gitignoreado) bajo
  `AI33_API_KEY` — nunca se hardcodea, nunca se loguea, nunca se imprime
  en `console.log` ni en mensajes de error (los errores incluyen el status
  HTTP y el cuerpo de la respuesta de ai33, que no contiene la key).
- Las URLs `audio_url`/`json_url` que devuelve el task son URLs firmadas de
  CDN (`cdn.ai33.pro`, con query params de firma) — se tratan como
  cualquier otra descarga del pipeline, no requieren el header `xi-api-key`
  para el GET.

## Manejo de errores

- `res.ok` falso en el submit → error explícito con status + body (mismo
  criterio que `elevenlabsService.ts`).
- `status: "failed"` en el polling → error explícito con el `error` de la
  API.
- Timeout de polling (120s sin `"done"`) → error explícito con el
  `task_id` (permite a la persona consultarlo manualmente después si
  quiere).
- `withTranscript: true` sin `json_url` en la respuesta → error explícito
  (no debería pasar, pero evita un `undefined` silencioso).

## Testing

- Sin tests nuevos dedicados para `generateSpeech` en sí (llamadas de red
  puras, mismo criterio que `elevenlabsService.ts`, que tampoco tiene
  tests unitarios de sus llamadas HTTP).
- Verificación manual: correr `npm run generate:assets` sobre el guion
  fixture de `vox` o `documental-doodle` ya existentes (o uno nuevo chico)
  y confirmar que el audio se genera y (para `documental-doodle`) que los
  `captionChunks` resultantes tienen timestamps coherentes.

## Fuera de alcance (por ahora)

- Reemplazar ElevenLabs en los tipos que transcriben audio/video real
  (`social-checklist`, `pantalla-dividida`, `youtube-noticias-avatar`) —
  ai33.pro no expone (que se haya encontrado) un endpoint de transcripción
  de audio arbitrario.
- Reemplazar `generateSoundEffect` (sfx de `pantalla-dividida`).
- Explorar motores más baratos que `elevenlabs_*` (minimax/edge/fishaudio)
  — el usuario decidió mantener la voz actual por ahora.
- Webhooks (`receive_url`) — se usa polling simple.
- Voice cloning, diccionarios de pronunciación, y el resto de endpoints de
  ai33.pro no relacionados con generar voz + transcript.
