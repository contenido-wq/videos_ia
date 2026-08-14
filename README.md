# videos-ia — AIVI

Proyecto [Remotion](https://www.remotion.dev) para generar videos con IA en 3
estilos: narración documental (**vox**), lista numerada con logos
(**ranking**) y narrativa a dos pantallas (**pantalla dividida**).

Si abrís este repo en [Claude Code](https://claude.com/claude-code), las 3
skills en `.claude/skills/` se activan solas — solo pedile en español el
video que querés y Claude te va a guiar paso a paso. El resto de este README
es para setear el proyecto la primera vez.

## Instalar

```console
npm install
```

## Configurar tu `.env`

El archivo `.env` no viene en el repo (está en `.gitignore` a propósito —
cada quien usa sus propias claves, no se comparten). Creá uno en la raíz con
las variables que necesites según el estilo de video que vayas a hacer:

| Variable | Para qué sirve | La necesitás si... |
|---|---|---|
| `ELEVENLABS_API_KEY` | Transcripción de audio y generación de voz | Siempre — la usan los 3 estilos |
| `ANTHROPIC_API_KEY` | Detecta y corta automáticamente tomas fallidas/muletillas | `ranking` y `pantalla dividida` (video grabado por vos) |
| `KIE_AI_API_KEY` | Genera imágenes con IA como último recurso | `vox` con imágenes de IA/personaje, o `ranking` si no encuentra el logo en ninguna otra fuente |
| `APIFY_API_TOKEN` + `APIFY_GOOGLE_IMAGES_TASK` | Busca fotos/logos reales | `vox` con fotos reales, o `ranking` en la cascada de búsqueda de logos |

Conseguí las claves en [elevenlabs.io](https://elevenlabs.io),
[console.anthropic.com](https://console.anthropic.com), [kie.ai](https://kie.ai)
y [apify.com](https://apify.com) respectivamente.

## Los 3 estilos de video

- **`vox`** — narrado por una voz generada con IA, sin grabarte a cámara.
  Estilos visuales `neon` (fotorrealista, oscuro) o `collage` (recorte de
  diario, vintage).
- **`ranking`** — te grabás hablando de una lista de herramientas/temas, y el
  logo de cada una entra animado justo cuando lo mencionás.
- **`pantalla dividida`** — te grabás contando una historia; arriba una
  ilustración en silueta que va cambiando con la narración, abajo vos
  hablando, y cierra a pantalla completa con la reflexión/CTA final.

El detalle completo de cada uno (qué necesitás antes de empezar, el flujo
paso a paso, la estructura del guion) está en
`.claude/skills/<estilo>/SKILL.md`.

## Comandos

**Generar los assets de un guion** (transcribe, genera voz/imágenes/efectos
según el tipo — para `ranking` y `pantalla dividida` este comando pausa
pidiendo revisar candidatos a retake, así que corrélo vos en tu propia
terminal):

```console
npm run generate:assets -- content/guiones/<slug>.json
```

**Previsualizar** (abre Remotion Studio):

```console
npm run dev
```

**Renderizar un video:**

```console
npx remotion render <CompositionId> out/<slug>.mp4
```

**Correr los tests:**

```console
npm test
```

## Docs de Remotion

Este proyecto está construido sobre Remotion — para entender cómo funciona
por debajo, la [página de fundamentos](https://www.remotion.dev/docs/the-fundamentals)
es un buen punto de partida. Ayuda y soporte de Remotion en su
[Discord](https://discord.gg/6VzzNDwUwV).
