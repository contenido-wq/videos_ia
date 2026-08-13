# Video Style Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 3 project-scoped Claude Code Skills (`vox`, `ranking`, `pantalla-dividida`) to this repo so anyone in the user's community who opens it in their own Claude Code can be guided end-to-end through producing each video style.

**Architecture:** Each skill is a single `SKILL.md` file with YAML frontmatter (`name`, `description`) under `.claude/skills/<name>/`, written as live instructions to Claude (not passive human documentation) — mirroring the style of the `superpowers` skills already used throughout this project.

**Tech Stack:** Markdown, YAML frontmatter. No code.

## Global Constraints

- Every technical claim in every SKILL.md (field names, commands, file paths) must be verifiable against real code or a real guion already in this repo — nothing invented. This spec's "Investigación de base" section is the source of truth; do not contradict it.
- `ranking` and `pantalla-dividida` share the same retake-review constraint: the interactive step (`retakeReviewCli.ts`) needs a real TTY. Both skills must instruct Claude to ask the person to run `npm run generate:assets` themselves in their own terminal for that step — never attempt it from a non-interactive tool call.
- Each skill documents only the API keys that style actually uses (see the exact table in the spec) — not a generic "you need everything" list.
- 1080x1920 (9:16), 30fps applies to all 3 styles — no need to restate per skill beyond mentioning it once in "Qué es este estilo."

---

## Task 1: `vox` skill

**Files:**
- Create: `.claude/skills/vox/SKILL.md`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: nothing consumed by later tasks — Task 4 only cross-checks structure, doesn't import content.

- [ ] **Step 1: Write the file**

Create `.claude/skills/vox/SKILL.md` with this exact content:

````markdown
---
name: vox
description: Crea videos narrados tipo documental (voz generada + imágenes de IA, fotos reales, o un personaje fijo) en dos estilos visuales — "neon" (oscuro, AIVI) o "collage" (scrapbook vintage). Usar cuando el usuario quiera un video narrado sin grabarse a cámara.
---

# Vox — videos narrados

## Qué es este estilo

Un video narrado por una voz generada con IA (no es el usuario hablando a
cámara), con una imagen distinta por cada línea del guion. Dos estilos
visuales posibles, elegidos por escena:

- **`neon`** (default): imágenes a pantalla completa (fotorrealistas
  generadas con IA, fotos reales, o un personaje fijo), degradado oscuro,
  subtítulo grande abajo. Estética AIVI.
- **`collage`**: fotos en blanco y negro estilo "recorte de diario",
  textura de papel kraft, tipografía cinética con una palabra resaltada
  tipo marcador, flechas dibujadas a mano. Varios layouts posibles
  (fotos lado a lado, cascada de banderas, VS entre dos fotos, badge con
  una estadística, logo con texto debajo).

30fps, 1080x1920 (9:16).

## Qué necesitás antes de empezar

- **`ELEVENLABS_API_KEY`** (siempre) — genera la voz narrada de cada
  escena. Conseguila en elevenlabs.io.
- **`KIE_AI_API_KEY`** — solo si alguna escena usa `imageSource: "ai"`
  (sin que encuentre una foto real en Wikimedia) o `imageSource:
  "character"` (sin `localImagePaths` propias). Conseguila en kie.ai.
- **`APIFY_API_TOKEN`** + **`APIFY_GOOGLE_IMAGES_TASK`** — solo si alguna
  escena usa `imageSource: "real"` con `apifyQuery` (no hace falta si le
  das directamente `realImageUrls`). Conseguilo en apify.com.

Ninguna de estas claves es compartida entre personas — cada quien pone las
suyas en su propio `.env` en la raíz del repo (mismas variables que ya
usa este proyecto, ver `CLAUDE.md`).

No hace falta grabar ningún video — este estilo no usa cámara, todo el
audio se genera.

## Flujo paso a paso (instrucciones para Claude)

Cuando alguien te pida un video de este estilo:

1. Preguntale el tema y pedile que te cuente la narración completa (o
   ayudalo a escribirla) — necesitás el texto exacto de cada línea antes
   de armar el guion, porque cada línea se convierte en una escena.
2. Preguntale qué estilo visual quiere: `neon` (default si no dice nada)
   o `collage`.
3. Armá el guion en `content/guiones/<slug>.json` con la estructura de
   abajo — una escena por línea narrada, decidiendo `imageSource` por
   escena según lo que se necesite ilustrar (foto real de algo/alguien
   identificable → `"real"` con `apifyQuery` o `realImageUrls`; ilustración
   genérica → `"ai"` con un prompt descriptivo en `visual`; el mismo
   personaje recurrente en varias escenas → `"character"`).
4. Corré `npm run generate:assets -- content/guiones/<slug>.json` — esto
   genera voz, imágenes, y efectos de sonido para cada escena. No requiere
   ninguna revisión interactiva (a diferencia de `ranking`/`pantalla-dividida`),
   así que podés correrlo vos directamente.
5. Agregá una línea en `src/Root.tsx` registrando la composición (ver
   sección de abajo).
6. Sugerile correr `npm run dev` (abre Remotion Studio) para previsualizar,
   y cuando esté conforme, renderizar con
   `npx remotion render <CompositionId> out/<slug>.mp4`.

## Estructura del guion

```ts
interface VoxGuion {
  type?: "vox";              // opcional, es el default si no ponés type
  slug: string;               // nombre de archivo/carpeta de assets
  topic: string;               // solo etiqueta, no se muestra en pantalla
  voiceId?: string;            // voz de ElevenLabs a usar
  characterImagePath?: string; // solo si alguna escena usa imageSource:"character" sin localImagePaths
  style?: "neon" | "collage";  // default "neon"
  scenes: GuionScene[];
}

interface GuionScene {
  id: string;
  text: string;                // narración de esta escena (se convierte en voz + subtítulo)
  visual: string;               // prompt de imagen (usado por imageSource "ai" y "character")
  imageSource: "ai" | "real" | "character";
  apifyQuery?: string;          // búsqueda de foto real (con imageSource:"real")
  realImageUrls?: string[];     // URLs ya verificadas, evita pagar la búsqueda
  wikipediaQuery?: string;      // solo con imageSource:"ai": intenta una foto real gratis antes de generar
  logo?: boolean;               // muestra la imagen en una tarjeta flotante en vez de a pantalla completa
  localImagePaths?: string[];   // imágenes ya preparadas a mano
  sfxPrompt?: string;           // efecto de sonido opcional para la escena
  // Solo aplican con style:"collage":
  layout?: "framed" | "full" | "layered" | "silhouette-collage" | "flags-cascade" | "vs-battle" | "stat-reveal" | "logo-cta";
  collageImageUrls?: string[];  // varias fotos juntas (no secuenciales)
  badgeLogoUrl?: string;
  statNumber?: string;
  statLabel?: string;
  ctaSubtext?: string;
}
```

Ejemplo real (estilo `neon`, `imageSource:"ai"` — tomado de
`content/guiones/mitos-claude-negocio.json`, guion completo en ese archivo):

```json
{
  "slug": "mitos-claude-negocio",
  "topic": "4 mitos que te impiden usar Claude en tu negocio",
  "voiceId": "htFfPSZGJwjBv1CL0aMD",
  "scenes": [
    {
      "id": "s01",
      "text": "Hay 4 excusas que escucho todos los días para no usar IA en tu negocio.",
      "visual": "Photorealistic photo of a real small business owner sitting behind a counter, arms crossed, skeptical expression looking directly at camera, natural lighting, documentary photography, realistic skin texture, no illustration, no cartoon",
      "imageSource": "ai"
    }
  ]
}
```

Ejemplo real (estilo `collage`, `layout:"silhouette-collage"` — tomado de
`content/guiones/mundial-2026-resumen.json`, guion completo en ese archivo,
cubre casi todos los `layout` disponibles):

```json
{
  "slug": "mundial-2026-resumen",
  "topic": "Resumen del Mundial 2026",
  "voiceId": "htFfPSZGJwjBv1CL0aMD",
  "style": "collage",
  "scenes": [
    {
      "id": "s01",
      "text": "El Mundial 2026 hizo historia.",
      "visual": "",
      "imageSource": "real",
      "layout": "silhouette-collage",
      "collageImageUrls": [
        "https://upload.wikimedia.org/wikipedia/commons/9/93/Kylian_Mbappe_-_France_v_Senegal_-_16_June_2026.jpg"
      ]
    }
  ]
}
```

## Registrar la composición

En `src/Root.tsx`, agregar una línea dentro del `<>...</>`:

```tsx
<DocumentalComposition id="<UnNombreUnico>" slug="<slug-del-guion>" />
```

(`DocumentalComposition` ya está importado en ese archivo — no hace falta
agregar el import de nuevo si ya hay otra línea `DocumentalComposition`
arriba).
````

- [ ] **Step 2: Verify the frontmatter and every technical claim**

Run these checks and confirm each one matches:

```bash
head -5 .claude/skills/vox/SKILL.md
grep -n "voiceId\|characterImagePath\|imageSource" src/types/guion.ts | head -10
grep -n "DocumentalComposition" src/Root.tsx
```

Expected: frontmatter has `name: vox` and a one-line `description`; the
field names in the skill's `VoxGuion`/`GuionScene` blocks all appear in
`src/types/guion.ts`; `DocumentalComposition` is already imported/used in
`Root.tsx` (confirms the "no hace falta agregar el import" claim is true).

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/vox/SKILL.md
git commit -m "docs: add vox video style Claude Code skill"
```

---

## Task 2: `ranking` skill

**Files:**
- Create: `.claude/skills/ranking/SKILL.md`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the file**

Create `.claude/skills/ranking/SKILL.md` with this exact content:

````markdown
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
  con IA como último recurso (esa última instancia si usa `KIE_AI_API_KEY`).

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
````

- [ ] **Step 2: Verify the frontmatter and every technical claim**

```bash
head -5 .claude/skills/ranking/SKILL.md
grep -n "removeOtherSpeakers\|listTitle\|logoQuery" src/types/guion.ts | head -10
grep -n "SocialChecklistComposition" src/Root.tsx
grep -n "readline\|process.stdin" src/services/retakeReviewCli.ts
```

Expected: frontmatter has `name: ranking`; the field names appear in
`src/types/guion.ts`; `SocialChecklistComposition` already imported in
`Root.tsx`; `retakeReviewCli.ts` confirms the interactive-terminal claim
(uses `readline`/`process.stdin`).

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/ranking/SKILL.md
git commit -m "docs: add ranking video style Claude Code skill"
```

---

## Task 3: `pantalla-dividida` skill

**Files:**
- Create: `.claude/skills/pantalla-dividida/SKILL.md`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the file**

Create `.claude/skills/pantalla-dividida/SKILL.md` with this exact content:

````markdown
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
````

- [ ] **Step 2: Verify the frontmatter and every technical claim**

```bash
head -5 .claude/skills/pantalla-dividida/SKILL.md
grep -n "backgroundMusicPath\|displayText\|act:" src/types/guion.ts | head -10
grep -n "PantallaDivididaComposition" src/Root.tsx
grep -n "MAX_CUT_SECONDS" src/services/generateAssets.ts
```

Expected: frontmatter has `name: pantalla-dividida`; field names appear
in `src/types/guion.ts`; `PantallaDivididaComposition` already imported
in `Root.tsx`; `MAX_CUT_SECONDS = 2.5` confirms the "2.5 segundos" claim
in Step 5 of the workflow.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/pantalla-dividida/SKILL.md
git commit -m "docs: add pantalla-dividida video style Claude Code skill"
```

---

## Task 4: Cross-check consistency across the 3 skills

**Files:**
- Modify (only if inconsistencies found): any of the 3 `SKILL.md` files above.

**Interfaces:**
- Consumes: all 3 files from Tasks 1-3.
- Produces: nothing (final task).

- [ ] **Step 1: Confirm all 3 have the same section skeleton**

```bash
grep -n "^## " .claude/skills/vox/SKILL.md
grep -n "^## " .claude/skills/ranking/SKILL.md
grep -n "^## " .claude/skills/pantalla-dividida/SKILL.md
```

Expected: all three list the same 5 section headers in the same order:
`Qué es este estilo`, `Qué necesitás antes de empezar`, `Flujo paso a
paso (instrucciones para Claude)`, `Estructura del guion`, `Registrar la
composición`. If any differs, fix that file's headers to match.

- [ ] **Step 2: Confirm the shared retake-review instruction is consistent**

```bash
grep -n "su propia terminal\|TTY\|readline" .claude/skills/ranking/SKILL.md .claude/skills/pantalla-dividida/SKILL.md
```

Expected: both files contain an explicit instruction to have the person
run `generate:assets` themselves for the interactive review step, in
near-identical wording (both were written from the same Global Constraint
above). `vox/SKILL.md` should have NO such instruction (it doesn't use
this pipeline) — confirm with:

```bash
grep -n "su propia terminal\|TTY" .claude/skills/vox/SKILL.md
```

Expected: no output.

- [ ] **Step 3: Confirm no skill lists an API key it doesn't use**

```bash
grep -n "API_KEY\|API_TOKEN" .claude/skills/vox/SKILL.md
grep -n "API_KEY\|API_TOKEN" .claude/skills/ranking/SKILL.md
grep -n "API_KEY\|API_TOKEN" .claude/skills/pantalla-dividida/SKILL.md
```

Expected: `vox` mentions `ELEVENLABS_API_KEY`, `KIE_AI_API_KEY`,
`APIFY_API_TOKEN`, `APIFY_GOOGLE_IMAGES_TASK` (and no `ANTHROPIC_API_KEY`
— vox's pipeline never calls retake detection). `ranking` and
`pantalla-dividida` both mention `ELEVENLABS_API_KEY` and
`ANTHROPIC_API_KEY`. `pantalla-dividida` additionally does NOT list
`KIE_AI_API_KEY` as required (illustrations are manual, not generated) —
if it does, remove that line, it contradicts the spec's decision that
images are prepared by hand.

- [ ] **Step 4: Final commit (only if Steps 1-3 required fixes)**

If any file was changed in Steps 1-3:

```bash
git add .claude/skills/
git commit -m "docs: fix consistency issues across video style skills"
```

If nothing needed fixing, skip this step — there's nothing to commit.

## Final check

- [ ] Run `git log --oneline -6` and confirm 3 or 4 commits exist for this plan (3 skills + optional consistency-fix commit).
- [ ] Read the finished `.claude/skills/pantalla-dividida/SKILL.md` once more end-to-end as if you were a community member with zero context — confirm it alone is enough to get from "I have a raw video" to "I have a rendered video" without needing to ask the project owner anything not already answered in the file.
