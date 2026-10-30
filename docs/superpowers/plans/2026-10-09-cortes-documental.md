# cortes-documental Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Nuevo tipo de video `cortes-documental` (presentador a pantalla completa + cortes a imágenes de archivo + subtítulos palabra por palabra + títulos grandes) y su skill.

**Architecture:** Mismo patrón que `pantalla-dividida`: guion JSON → `generate:assets` (reusa `prepareTrimmedVideo`, `matchSceneTimestamps`, `buildCaptionChunks`) → `public/data/<slug>.json` → composición Remotion. La única lógica nueva con riesgo (tiempos de cortes) es una función pura con tests.

**Tech Stack:** TypeScript, Remotion 4, vitest, kie.ai/pollinations, ElevenLabs (transcripción).

**Spec:** `docs/superpowers/specs/2026-10-09-cortes-documental-design.md`

## Global Constraints
- 1080x1920, 30 fps, audio real de la grabación; UI/textos en español neutro.
- Cutaway de 1.5 a 3 s (default 2.5), sin cutaway en el primer ni en el último segundo.
- Subtítulos de máx. 3 palabras (`buildCaptionChunks(words, 3, 0.4)`).
- Imágenes IA en 9:16. Sin música ni SFX en v1.
- `Root.tsx`, `generateAssets.ts`, `guion.ts` tienen cambios previos sin commit del usuario: solo ediciones aditivas; no commitear.

## Review Focus
- Dos cutaways cuya frase cae a < 0.4 s uno del otro → el segundo se desplaza o se descarta, nunca se solapan.
- Frase del cutaway no encontrada en la transcripción → error claro, no tiempo inventado.
- Cutaway pedido en el primer/último segundo → se mueve o se descarta.
- Cutaway sin `localImagePath` ni `visual` → error listando cuáles faltan.
- Título activo mientras hay cutaway → el título se pinta encima, el subtítulo se oculta.

## Tasks
1. **Timing (TDD)** — `src/services/cortesDocumentalTiming.ts` + `.test.ts`:
   `resolveCutawayTimings(requests: {id; startSeconds; durationSeconds?}[], totalDurationSeconds): { resolved: {id; startSeconds; durationSeconds}[]; dropped: {id; reason}[] }`.
   Tests: clamp 1.5–3, default 2.5, borde inicial/final, solape con separación mínima 0.4 s, descarte cuando no cabe, orden por inicio.
2. **Tipos** — `src/types/guion.ts`: `CortesDocumentalGuion`, `RenderedCortesDocumentalGuion`, ampliar `GuionType` y `Guion`.
3. **Assets** — `generateAssets.ts`: `generateCortesDocumentalAssets` + rama en `main()`.
4. **Render** — `components/CortesDocumental.tsx`, `CortesDocumentalComposition.tsx`, registro en `Root.tsx`.
5. **Skills** — `.claude/skills/cortes-documental/SKILL.md`; instalar `vox-motion-graphics` tal cual.
6. **Verificación** — `npm test`, `npm run lint`, y corrida real con IMG_2951.mov hasta donde permita la terminal no interactiva.
