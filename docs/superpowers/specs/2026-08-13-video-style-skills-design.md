# Skills de Claude Code por estilo de video (vox, ranking, pantalla dividida)

## Contexto

El usuario quiere compartir su comunidad de AIVI (emprendedores hispanohablantes)
el repositorio `videos-ia` tal cual, con el link directo. Para que cualquiera
que lo abra en su propio Claude Code sepa qué hacer con cada uno de los 3
estilos de video ya establecidos en el proyecto (vox, "ranking"/`social-checklist`,
pantalla dividida), se agregan 3 Skills de Claude Code **project-scoped**
(viven dentro del repo en `.claude/skills/`, se activan solas al abrir el
repo — no requieren instalación aparte).

Esto retoma una nota de alcance futuro que ya existía en un spec anterior
del proyecto (`2026-08-06-video-types-social-checklist-design.md`, sección
"Fuera de alcance": *"Fase 2: empaquetar como Skill + panel web local para
la comunidad"*) — se resuelve la parte de "empaquetar como Skill" acá; el
panel web queda fuera de alcance todavía.

## Decisiones acordadas con el usuario

- **Distribución**: se comparte el repo completo (código, specs, historial)
  tal cual — no un paquete separado más liviano.
- **3 skills, una por estilo**: `vox`, `ranking`, `pantalla-dividida`. Cada
  una vive en su propia carpeta `.claude/skills/<nombre>/SKILL.md`.
- **A quién le hablan**: son instrucciones para que Claude Code guíe a la
  persona EN VIVO (como las skills de `superpowers` usadas en este proyecto
  hoy) — no documentación pasiva para leer. Cuando alguien las invoca,
  Claude explica el estilo, pregunta lo que falta, corre los comandos
  reales, y le devuelve el control a la persona en los puntos que
  requieren su propia terminal (ver más abajo).
- Cada skill documenta **solo las API keys que ese estilo específico usa**
  (verificado contra el código real, no asumido) — no una lista genérica
  de todas las keys del proyecto.

## Investigación de base (ya hecha, no repetir)

Se verificó contra el código real (no se asume nada):

**`vox`** (`type?: "vox"`, default si no se especifica `type`):
- Tipos: `VoxGuion` (`slug`, `topic`, `voiceId?`, `characterImagePath?`,
  `style?: "neon"|"collage"`, `scenes: GuionScene[]`) y `GuionScene` en
  `src/types/guion.ts`.
- Pipeline: `generateVoxAssets`/`generateScene` en `generateAssets.ts` —
  TTS por escena vía ElevenLabs, imágenes por `imageSource: "ai"|"real"|"character"`.
- Composición: `DocumentalComposition.tsx`, renderiza `Scene.tsx` ("neon")
  o `CollageScene.tsx` ("collage") según `guion.style`.
- API keys: `ELEVENLABS_API_KEY` siempre; `KIE_AI_API_KEY` si hay escenas
  `imageSource:"ai"` (sin match de Wikimedia) o `"character"` (sin
  `localImagePaths`); `APIFY_API_TOKEN`+`APIFY_GOOGLE_IMAGES_TASK` solo si
  alguna escena `imageSource:"real"` usa `apifyQuery` en vez de URLs ya
  provistas.
- Ejemplos reales de referencia: `content/guiones/mitos-claude-negocio.json`
  (neon, `imageSource:"ai"`), `content/guiones/claude-en-tu-negocio.json`
  (neon, mezcla `character`+`real`), `content/guiones/mundial-2026-resumen.json`
  (collage, cubre casi todos los `layout`).
- Registro: `<DocumentalComposition id="..." slug="..." />` en `Root.tsx`.

**`ranking`** (`type: "social-checklist"` internamente — el usuario lo
llama "ranking" o "video de ranking", ver memoria del proyecto):
- Tipos: `SocialChecklistGuion`/`ChecklistItem` en `src/types/guion.ts`.
- Pipeline: `generateSocialChecklistAssets` en `generateAssets.ts`, reusa
  `prepareTrimmedVideo` (transcripción + silencios + retakes/asides vía
  Claude, revisión humana interactiva) + `matchItemTimestamps`.
- Composición: `SocialChecklistComposition.tsx` / `components/SocialChecklist.tsx`.
- API keys: `ELEVENLABS_API_KEY` (transcripción), `ANTHROPIC_API_KEY`
  (detección de retakes/asides), más lo que haga falta para resolver
  logos (simple-icons no pide key; Google Images vía Apify, Wikimedia,
  Logo.dev, o kie.ai como último fallback).
- Ejemplo real: `content/guiones/5-herramientas-ranking.json`.
- Registro: `<SocialChecklistComposition id="..." slug="..." />` en `Root.tsx`.

**`pantalla-dividida`**:
- Tipos: `PantallaDivididaGuion`/`PantallaDivididaScene` en `src/types/guion.ts`.
- Pipeline: `generatePantallaDivididaAssets`, reusa `prepareTrimmedVideo` +
  `matchSceneTimestamps` (`checklistSyncService.ts`) + `pantallaDivididaTiming.ts`.
- Composición: `PantallaDivididaComposition.tsx` / `components/PantallaDividida.tsx`.
- API keys: `ELEVENLABS_API_KEY` + `ANTHROPIC_API_KEY` (mismo pipeline
  compartido que ranking) + `ELEVENLABS_API_KEY` de nuevo para
  whoosh/sting (`sound-generation`). La música de fondo NO se genera —
  el usuario elige una pista con licencia real (ver
  `2026-08-13-pantalla-dividida-background-music-design.md`) y la coloca
  en `content/musica/`.
- Ejemplo real: `content/guiones/pantalla-dividida.json` (el que armamos hoy).
- Registro: `<PantallaDivididaComposition id="..." slug="..." />` en `Root.tsx`.

**Compartido por `ranking` y `pantalla-dividida`**: el paso de revisión de
retakes/asides es **interactivo en terminal** (`retakeReviewCli.ts`, usa
`readline` sobre `process.stdin`). Si Claude lo corre desde una
herramienta sin TTY, el pipeline ahora falla explícito con instrucciones
(fix ya aplicado esta sesión) — las 2 skills que usan este pipeline deben
decirle a Claude que le pida a la persona correr `npm run generate:assets`
en SU propia terminal cuando haya candidatos pendientes de revisar, no
intentarlo desde una tool call sin TTY.

## Estructura de cada `SKILL.md`

Mismo esqueleto para los 3, contenido específico por estilo:

1. **Frontmatter** (`name`, `description`) — la `description` debe dejar
   claro para qué sirve, en términos que el usuario de la comunidad
   reconozca (ej. para `ranking`: mencionar "ranking", "lista numerada",
   no solo "social-checklist").
2. **Qué es este estilo** — 2-3 frases + qué se ve en pantalla.
3. **Qué necesitás antes de empezar** — API keys exactas de esa lista de
   arriba (con dónde conseguir cada una: elevenlabs.io, console.anthropic.com,
   kie.ai, apify.com), y qué insumos (video crudo grabado por la persona,
   tema/historia).
4. **Flujo paso a paso** — instrucciones PARA CLAUDE (no para el humano
   directamente): qué preguntar, qué archivos crear, qué comandos correr
   (`npm run generate:assets -- content/guiones/<slug>.json`, `npm run dev`,
   `npx remotion render <CompositionId> out/<slug>.mp4`), y en qué paso
   exacto pedirle a la persona que corra algo en su propia terminal.
5. **Estructura del guion** — la interfaz TypeScript exacta + un ejemplo
   JSON real tomado del repo (de los ya identificados arriba).
6. **Registrar la composición** — el snippet exacto a agregar en `Root.tsx`.

## Manejo de errores

- Si falta una API key requerida para el estilo, el pipeline ya falla con
  un error de Node claro (`env.ts` usa `required()`) — las skills no
  necesitan agregar manejo especial, solo advertir de antemano cuáles
  hacen falta para no descubrirlo a mitad de una corrida costosa.
- Ninguna de las 3 skills debe intentar correr `generate:assets` para
  `ranking`/`pantalla-dividida` de punta a punta sin avisar del paso
  interactivo — ver sección compartida arriba.

## Testing

- No hay lógica de código que testear (son archivos de instrucciones en
  Markdown) — la verificación es de exactitud: cada afirmación técnica en
  cada SKILL.md (nombres de campos, comandos, rutas) debe poder señalarse
  contra el código real o un guion real existente, no inventarse.

## Fuera de alcance

- El "panel web local para la comunidad" mencionado en el spec anterior
  sigue fuera de alcance.
- Empaquetar esto como un plugin/skill instalable por separado (el usuario
  eligió compartir el repo completo).
- Gestión centralizada de API keys (cada persona usa las suyas propias en
  su propio `.env`, igual que ya funciona hoy en este proyecto).
- Traducir o adaptar el guion `youtube` (existe en el tipo `GuionType`
  pero no tiene implementación — no se documenta porque no hay nada que
  documentar todavía).
