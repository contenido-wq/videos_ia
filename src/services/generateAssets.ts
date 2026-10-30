import fs from "fs";
import path from "path";
import { parseFile } from "music-metadata";
import { generateSoundEffect, transcribeWithTimestamps } from "./elevenlabsService";
import { generateSpeech } from "./ai33Service";
import { generateImage, editImage, uploadImage } from "./kieAiService";
import { generatePollinationsImage } from "./pollinationsService";
import { findRealImageUrls, downloadImageFromUrl } from "./apifyService";
import { findWikimediaImageUrls } from "./wikimediaService";
import { findSimpleIconSvg, renderSimpleIconToPng } from "./simpleIconsService";
import { findLogoDevUrl } from "./logoDevService";
import { matchItemTimestamps, matchSceneTimestamps, type TranscribedWord } from "./checklistSyncService";
import { buildCaptionChunks } from "./captionChunkService";
import { prepareTrimmedVideo } from "./rawVideoCleaningService";
import { resolveCutawayTimings, computeJumpCuts } from "./cortesDocumentalTiming";
import { measureIntegratedLufs, normalizeVideoAudio } from "./ffmpegService";
import type {
  Guion,
  VoxGuion,
  SocialChecklistGuion,
  RenderedChecklistItem,
  RenderedSocialChecklistGuion,
  PantallaDivididaGuion,
  RenderedPantallaDivididaScene,
  RenderedPantallaDivididaGuion,
  YoutubeNoticiasAvatarGuion,
  RenderedYoutubeNoticiasAvatarScene,
  RenderedYoutubeNoticiasAvatarGuion,
  DocumentalDoodleGuion,
  RenderedDocumentalDoodleScene,
  RenderedDocumentalDoodleGuion,
  CortesDocumentalGuion,
  CortesDocumentalTransition,
  RenderedCortesDocumentalCutaway,
  RenderedCortesDocumentalTitle,
  RenderedCortesDocumentalGuion,
  GuionScene,
  RenderedGuion,
  RenderedScene,
  SceneImage,
} from "../types/guion";

const PUBLIC_DIR = path.join(process.cwd(), "public");

// Ningún corte visual dura más de esto: si la narración es más larga,
// se generan varias imágenes que se van cortando dentro de la misma escena.
const MAX_CUT_SECONDS = 2.5;

// Sufijo de estilo fijo para ilustraciones IA en escenas "split" de
// pantalla-dividida sin localImagePaths (ver PantallaDivididaScene.visual).
const PANTALLA_DIVIDIDA_AI_STYLE_SUFFIX =
  "flat vector illustration, clean modern minimalist style, bold rounded shapes, warm optimistic color palette of orange, cream and deep teal, soft gradient lighting, inspirational and uplifting mood, no text or letters in the image";

// Cadencia propia de youtube-noticias-avatar (no confundir con MAX_CUT_SECONDS,
// que usan vox/pantalla-dividida): una imagen de fondo nueva cada 4 segundos.
const NEWS_AVATAR_CUT_SECONDS = 4;

// Cadencia propia de documental-doodle (no confundir con MAX_CUT_SECONDS ni
// NEWS_AVATAR_CUT_SECONDS): una imagen doodle nueva cada 5 segundos.
const DOODLE_CUT_SECONDS = 5;

// Para el personaje: en vez de cortes secuenciales, generamos N poses que se
// van cross-fadeando en loop durante toda la escena (simula un micro-gesto).
const CHARACTER_POSE_VARIANTS = 2;

async function getAudioDurationInSeconds(filePath: string): Promise<number> {
  const metadata = await parseFile(filePath);
  return metadata.format.duration ?? 0;
}

function toPublicRelPath(absPath: string): string {
  return path.relative(PUBLIC_DIR, absPath).split(path.sep).join("/");
}

// Wikimedia (y otras fuentes) devuelven 429 si se pide muchas imágenes
// seguidas sin pausa: reintenta con backoff antes de fallar la escena.
async function downloadImageFromUrlWithRetry(url: string, outputPath: string, attempts = 4): Promise<string> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await downloadImageFromUrl(url, outputPath);
    } catch (err) {
      if (i === attempts - 1) throw err;
      const waitMs = 800 * (i + 1);
      console.log(`  reintentando en ${waitMs}ms (${err instanceof Error ? err.message : err})...`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw new Error("unreachable");
}

async function generateScene(
  guion: VoxGuion,
  scene: GuionScene,
  characterImageUrl: string | null,
): Promise<RenderedScene> {
  const audioRelPath = path.join("assets", guion.slug, "audio", `${scene.id}.mp3`);
  const audioAbsPath = path.join(PUBLIC_DIR, audioRelPath);

  if (fs.existsSync(audioAbsPath)) {
    console.log(`[${scene.id}] voz ya existe, se reutiliza`);
  } else {
    console.log(`[${scene.id}] generando voz...`);
    await generateSpeech(scene.text, { outputPath: audioAbsPath, voiceId: guion.voiceId, withTranscript: false });
  }

  const durationInSeconds = await getAudioDurationInSeconds(audioAbsPath);
  const numCuts = Math.max(1, Math.ceil(durationInSeconds / MAX_CUT_SECONDS));
  const cutDuration = durationInSeconds / numCuts;
  const ext = scene.imageSource === "real" && !scene.logo ? "jpg" : "png";

  console.log(`[${scene.id}] ${durationInSeconds.toFixed(2)}s -> ${numCuts} corte(s) de ${cutDuration.toFixed(2)}s`);

  const images: SceneImage[] = [];
  let collageImagePaths: string[] | undefined;

  const isCollageLayout =
    scene.layout === "silhouette-collage" || scene.layout === "flags-cascade" || scene.layout === "vs-battle";

  if (isCollageLayout && scene.collageImageUrls?.length) {
    collageImagePaths = [];
    for (let i = 0; i < scene.collageImageUrls.length; i++) {
      const imageAbsPath = path.join(PUBLIC_DIR, "assets", guion.slug, "images", `${scene.id}-collage${i}.jpg`);
      if (fs.existsSync(imageAbsPath)) {
        console.log(`[${scene.id}] foto ${i} (collage) ya existe, se reutiliza`);
      } else {
        console.log(`[${scene.id}] descargando foto ${i} (collage)...`);
        await downloadImageFromUrlWithRetry(scene.collageImageUrls[i], imageAbsPath);
        await new Promise((r) => setTimeout(r, 400));
      }
      collageImagePaths.push(toPublicRelPath(imageAbsPath));
    }
    images.push({ path: collageImagePaths[0], durationInSeconds });
  } else if (scene.imageSource === "real") {
    let urls: string[];
    if (scene.realImageUrls?.length) {
      // URLs ya verificadas a mano: se descargan directo, sin pagar otra búsqueda de Apify.
      urls = Array.from({ length: numCuts }, (_, i) => scene.realImageUrls![i % scene.realImageUrls!.length]);
    } else if (scene.apifyQuery) {
      urls = await findRealImageUrls(scene.apifyQuery, numCuts);
    } else {
      throw new Error(`Escena ${scene.id} es "real" pero no tiene apifyQuery ni realImageUrls`);
    }
    // Si la misma URL se repite en varios cortes (no hay suficientes fotos
    // reales distintas), todos esos cortes deben apuntar al MISMO archivo:
    // así el componente puede detectar la repetición por ruta y saltar a un
    // encuadre de detalle en vez de solo re-panear el mismo plano.
    const urlToPath = new Map<string, string>();
    for (let i = 0; i < numCuts; i++) {
      const url = urls[i];
      let imageAbsPath = urlToPath.get(url);
      if (!imageAbsPath) {
        imageAbsPath = path.join(PUBLIC_DIR, "assets", guion.slug, "images", `${scene.id}-${i}.${ext}`);
        if (fs.existsSync(imageAbsPath)) {
          console.log(`[${scene.id}] corte ${i} (real) ya existe, se reutiliza`);
        } else {
          console.log(`[${scene.id}] descargando corte ${i} (real)...`);
          await downloadImageFromUrlWithRetry(url, imageAbsPath);
        }
        urlToPath.set(url, imageAbsPath);
      } else {
        console.log(`[${scene.id}] corte ${i} (real) es la misma URL que un corte anterior, reutiliza el mismo archivo`);
      }
      images.push({ path: toPublicRelPath(imageAbsPath), durationInSeconds: cutDuration });
    }
  } else if (scene.imageSource === "character" && scene.localImagePaths?.length) {
    for (let i = 0; i < numCuts; i++) {
      const sourcePath = scene.localImagePaths[i % scene.localImagePaths.length];
      const imageAbsPath = path.join(PUBLIC_DIR, "assets", guion.slug, "images", `${scene.id}-local${i}.${ext}`);
      if (fs.existsSync(imageAbsPath)) {
        console.log(`[${scene.id}] corte ${i} (toma local) ya existe, se reutiliza`);
      } else {
        console.log(`[${scene.id}] copiando corte ${i} (toma local): ${sourcePath}`);
        fs.mkdirSync(path.dirname(imageAbsPath), { recursive: true });
        fs.copyFileSync(sourcePath, imageAbsPath);
      }
      images.push({ path: toPublicRelPath(imageAbsPath), durationInSeconds: cutDuration });
    }
  } else if (scene.imageSource === "character") {
    if (!characterImageUrl) {
      throw new Error(`Escena ${scene.id} es "character" pero el guion no tiene characterImagePath`);
    }
    const poseDuration = durationInSeconds / CHARACTER_POSE_VARIANTS;
    for (let i = 0; i < CHARACTER_POSE_VARIANTS; i++) {
      const imageAbsPath = path.join(PUBLIC_DIR, "assets", guion.slug, "images", `${scene.id}-pose${i}.${ext}`);
      if (fs.existsSync(imageAbsPath)) {
        console.log(`[${scene.id}] pose ${i} (character) ya existe, se reutiliza`);
      } else {
        const prompt =
          i === 0
            ? scene.visual
            : `${scene.visual}, but showing a subtle micro-gesture change from a slight shift in hand position or weight, as if mid natural idle animation, keep the exact same character design, framing, lighting and background`;
        console.log(`[${scene.id}] generando pose ${i} (character)...`);
        await editImage(prompt, [characterImageUrl], imageAbsPath, { aspectRatio: "9:16" });
      }
      // Cada pose cubre su propia porción de la escena: corte único a mitad de camino, no dissolve en loop.
      images.push({ path: toPublicRelPath(imageAbsPath), durationInSeconds: poseDuration });
    }
  } else {
    // Si la escena es sobre algo real e identificable, primero intenta una foto
    // real y gratis en Wikimedia Commons antes de gastar créditos en kie.ai.
    let wikimediaUrls: string[] = [];
    if (scene.wikipediaQuery) {
      console.log(`[${scene.id}] buscando en Wikimedia Commons: "${scene.wikipediaQuery}"...`);
      wikimediaUrls = await findWikimediaImageUrls(scene.wikipediaQuery, numCuts);
      if (wikimediaUrls.length === 0) {
        console.log(`[${scene.id}] sin resultados en Wikimedia Commons, cae a kie.ai`);
      }
    }

    if (wikimediaUrls.length > 0) {
      const urlToPath = new Map<string, string>();
      for (let i = 0; i < numCuts; i++) {
        const url = wikimediaUrls[i];
        let imageAbsPath = urlToPath.get(url);
        if (!imageAbsPath) {
          imageAbsPath = path.join(PUBLIC_DIR, "assets", guion.slug, "images", `${scene.id}-${i}.${ext}`);
          if (fs.existsSync(imageAbsPath)) {
            console.log(`[${scene.id}] corte ${i} (wikimedia) ya existe, se reutiliza`);
          } else {
            console.log(`[${scene.id}] descargando corte ${i} (wikimedia)...`);
            await downloadImageFromUrlWithRetry(url, imageAbsPath);
          }
          urlToPath.set(url, imageAbsPath);
        } else {
          console.log(`[${scene.id}] corte ${i} (wikimedia) es la misma URL que un corte anterior, reutiliza el mismo archivo`);
        }
        images.push({ path: toPublicRelPath(imageAbsPath), durationInSeconds: cutDuration });
      }
    } else {
      for (let i = 0; i < numCuts; i++) {
        const imageAbsPath = path.join(PUBLIC_DIR, "assets", guion.slug, "images", `${scene.id}-${i}.${ext}`);
        if (fs.existsSync(imageAbsPath)) {
          console.log(`[${scene.id}] corte ${i} (ai) ya existe, se reutiliza`);
        } else {
          const prompt =
            numCuts > 1
              ? `${scene.visual}, alternate camera angle / closer framing, cut ${i + 1} of ${numCuts} in the same documentary sequence, same subject and art style`
              : scene.visual;
          console.log(`[${scene.id}] generando corte ${i} (ai)...`);
          await generateImage(prompt, imageAbsPath, { aspectRatio: "9:16" });
        }
        images.push({ path: toPublicRelPath(imageAbsPath), durationInSeconds: cutDuration });
      }
    }
  }

  let badgeImagePath: string | undefined;
  if (scene.badgeLogoUrl) {
    const badgeAbsPath = path.join(PUBLIC_DIR, "assets", guion.slug, "images", `${scene.id}-badge.png`);
    if (fs.existsSync(badgeAbsPath)) {
      console.log(`[${scene.id}] badge ya existe, se reutiliza`);
    } else {
      console.log(`[${scene.id}] descargando badge...`);
      await downloadImageFromUrlWithRetry(scene.badgeLogoUrl, badgeAbsPath);
    }
    badgeImagePath = toPublicRelPath(badgeAbsPath);
  }

  let sfxPath: string | undefined;
  if (scene.sfxPrompt) {
    const sfxAbsPath = path.join(PUBLIC_DIR, "assets", guion.slug, "sfx", `${scene.id}.mp3`);
    if (fs.existsSync(sfxAbsPath)) {
      console.log(`[${scene.id}] sfx ya existe, se reutiliza`);
    } else {
      console.log(`[${scene.id}] generando sfx...`);
      await generateSoundEffect(scene.sfxPrompt, sfxAbsPath, Math.min(durationInSeconds, 3));
    }
    sfxPath = toPublicRelPath(sfxAbsPath);
  }

  console.log(`[${scene.id}] listo`);

  return {
    ...scene,
    audioPath: toPublicRelPath(audioAbsPath),
    sfxPath,
    images,
    collageImagePaths,
    badgeImagePath,
    durationInSeconds,
  };
}

async function generateVoxAssets(guion: VoxGuion): Promise<void> {
  console.log(`Generando recursos para "${guion.topic}" (${guion.scenes.length} escenas)`);

  const needsCharacterUpload = guion.scenes.some(
    (s) => s.imageSource === "character" && !s.localImagePaths?.length,
  );

  let characterImageUrl: string | null = null;
  if (guion.characterImagePath && needsCharacterUpload) {
    console.log(`Subiendo imagen de personaje (${guion.characterImagePath})...`);
    characterImageUrl = await uploadImage(guion.characterImagePath);
    console.log(`Personaje subido: ${characterImageUrl}`);
  }

  const renderedScenes: RenderedScene[] = [];
  for (const scene of guion.scenes) {
    renderedScenes.push(await generateScene(guion, scene, characterImageUrl));
  }

  const rendered: RenderedGuion = {
    slug: guion.slug,
    topic: guion.topic,
    style: guion.style,
    scenes: renderedScenes,
  };

  const dataDir = path.join(PUBLIC_DIR, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const outputPath = path.join(dataDir, `${guion.slug}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(rendered, null, 2));

  const totalDuration = renderedScenes.reduce((acc, s) => acc + s.durationInSeconds, 0);
  const totalCuts = renderedScenes.reduce((acc, s) => acc + s.images.length, 0);
  console.log(`\nListo. Duración total: ${totalDuration.toFixed(1)}s en ${totalCuts} cortes visuales.`);
  console.log(`Datos guardados en ${outputPath}`);
}


async function generateSocialChecklistAssets(guion: SocialChecklistGuion): Promise<void> {
  console.log(`Generando recursos para "${guion.topic}" (social-checklist, ${guion.items.length} items)`);

  const { words, videoPath, durationInSeconds } = await prepareTrimmedVideo({
    slug: guion.slug,
    rawVideoPath: guion.rawVideoPath,
    removeOtherSpeakers: guion.removeOtherSpeakers,
  });

  const matches = matchItemTimestamps(words, guion.items, durationInSeconds);

  const renderedItems: RenderedChecklistItem[] = [];
  for (const { item, startSeconds, matched } of matches) {
    if (!matched) {
      console.log(
        `[${item.id}] no se encontró "${item.label}" en la transcripción, usando tiempo estimado (${startSeconds.toFixed(1)}s)`,
      );
    }

    const logoAbsPath = path.join(PUBLIC_DIR, "assets", guion.slug, "images", `item-${item.id}.png`);
    if (fs.existsSync(logoAbsPath)) {
      console.log(`[${item.id}] logo ya existe, se reutiliza`);
    } else {
      // simple-icons primero: biblioteca curada a mano (MIT, ~3400 marcas), sin
      // llamadas a ninguna API — gratis, instantánea, y cero riesgo de traer el
      // logo equivocado (a diferencia de una búsqueda de texto). Cubre muchas
      // marcas conocidas pero no todas (ej. Gamma, AiVi no están) — para esas
      // cae a la búsqueda real de abajo.
      const simpleIcon = findSimpleIconSvg(item.label);

      if (simpleIcon) {
        console.log(`[${item.id}] logo encontrado en simple-icons...`);
        fs.mkdirSync(path.dirname(logoAbsPath), { recursive: true });
        fs.writeFileSync(logoAbsPath, renderSimpleIconToPng(simpleIcon.svg, simpleIcon.hex));
      } else {
        // Google Images (vía Apify) después: Wikimedia Commons es un repositorio de
        // medios libres, no un catálogo de logos de SaaS — para productos como
        // Gamma o NotebookLM no tiene el logo real y su búsqueda de texto devuelve
        // cualquier archivo que coincida por palabra (bug real: "Gamma" devolvió el
        // logo de una fraternidad universitaria). findRealImageUrls ya está pensada
        // para esto ("úsalo para logos", ver apifyService.ts) y es lo que ya usa el
        // resto del pipeline para fotos reales.
        let logoUrl: string | null = null;
        try {
          [logoUrl] = await findRealImageUrls(item.logoQuery, 1);
        } catch {
          logoUrl = null;
        }

        if (logoUrl) {
          console.log(`[${item.id}] descargando logo (Google Images)...`);
          await downloadImageFromUrlWithRetry(logoUrl, logoAbsPath);
        } else {
          const wikimediaUrls = await findWikimediaImageUrls(item.logoQuery, 1);
          if (wikimediaUrls.length > 0) {
            console.log(`[${item.id}] sin resultados en Google Images, descargando logo de Wikimedia...`);
            await downloadImageFromUrlWithRetry(wikimediaUrls[0], logoAbsPath);
          } else {
            // Logo.dev al final, no como segunda opción: es gratis y hecho
            // específicamente para logos, pero su endpoint de imagen por nombre
            // NUNCA da error — si no encuentra la marca, devuelve una letra
            // genérica en vez de la nada (comprobado en vivo: un nombre
            // inventado dio 200 OK con una "J" sola, del mismo tamaño de
            // archivo que un logo real — no hay forma de distinguirlos sin la
            // Search API, que pide una key aparte que no tenemos). Por eso va
            // acá, como una alternativa más antes de generar con IA — no como
            // fuente temprana y confiable, para no arriesgar los casos que
            // Google Images ya resuelve bien.
            console.log(`[${item.id}] sin resultados en Wikimedia, probando Logo.dev...`);
            const logoDevUrl = await findLogoDevUrl(item.label);
            if (logoDevUrl) {
              await downloadImageFromUrlWithRetry(logoDevUrl, logoAbsPath);
            } else {
              console.log(`[${item.id}] sin resultados, generando logo con kie.ai...`);
              await generateImage(
                `${item.logoQuery}, flat icon logo, centered, plain white background, no text`,
                logoAbsPath,
                { aspectRatio: "1:1" },
              );
            }
          }
        }
      }
    }

    renderedItems.push({ ...item, startSeconds, matched, logoPath: toPublicRelPath(logoAbsPath) });
  }

  const rendered: RenderedSocialChecklistGuion = {
    type: "social-checklist",
    slug: guion.slug,
    topic: guion.topic,
    videoPath,
    durationInSeconds,
    listTitle: guion.listTitle,
    items: renderedItems,
  };

  const dataDir = path.join(PUBLIC_DIR, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, `${guion.slug}.json`), JSON.stringify(rendered, null, 2));

  const matchedCount = renderedItems.filter((i) => i.matched).length;
  console.log(
    `\nListo. Duración: ${durationInSeconds.toFixed(1)}s, ${renderedItems.length} items (${matchedCount} encontrados en transcripción).`,
  );
}

async function generatePantallaDivididaAssets(guion: PantallaDivididaGuion): Promise<void> {
  console.log(`Generando recursos para "${guion.topic}" (pantalla-dividida, ${guion.scenes.length} escena(s))`);

  const { words, videoPath, durationInSeconds } = await prepareTrimmedVideo({
    slug: guion.slug,
    rawVideoPath: guion.rawVideoPath,
    removeOtherSpeakers: guion.removeOtherSpeakers,
  });

  const matches = matchSceneTimestamps(words, guion.scenes, durationInSeconds);

  const missing: string[] = [];
  for (const { scene, durationInSeconds: sceneDuration } of matches) {
    if (scene.act !== "split") continue;
    if (scene.localImagePaths && scene.localImagePaths.length > 0) continue;
    if (scene.visual) continue;
    const numCuts = Math.max(1, Math.ceil(sceneDuration / MAX_CUT_SECONDS));
    missing.push(
      `  [${scene.id}] necesita ${numCuts} imagen(es) en "localImagePaths" o un prompt en "visual" (dura ${sceneDuration.toFixed(1)}s)`,
    );
  }
  if (missing.length > 0) {
    throw new Error(
      `Faltan imágenes para ${missing.length} escena(s) antes de generar el video:\n${missing.join("\n")}`,
    );
  }

  const renderedScenes: RenderedPantallaDivididaScene[] = [];
  for (const { scene, startSeconds, durationInSeconds: sceneDuration, matched } of matches) {
    if (!matched) {
      console.log(
        `[${scene.id}] no se encontró el texto en la transcripción, usando tiempo estimado (${startSeconds.toFixed(1)}s)`,
      );
    }

    const images: SceneImage[] = [];
    if (scene.act === "split") {
      const numCuts = Math.max(1, Math.ceil(sceneDuration / MAX_CUT_SECONDS));
      const cutDuration = sceneDuration / numCuts;

      if (scene.localImagePaths && scene.localImagePaths.length > 0) {
        const localImagePaths = scene.localImagePaths;
        for (let i = 0; i < numCuts; i++) {
          const sourcePath = localImagePaths[i % localImagePaths.length];
          const ext = path.extname(sourcePath) || ".png";
          const imageAbsPath = path.join(PUBLIC_DIR, "assets", guion.slug, "images", `${scene.id}-local${i}${ext}`);
          if (fs.existsSync(imageAbsPath)) {
            console.log(`[${scene.id}] corte ${i} ya existe, se reutiliza`);
          } else {
            console.log(`[${scene.id}] copiando corte ${i}: ${sourcePath}`);
            fs.mkdirSync(path.dirname(imageAbsPath), { recursive: true });
            fs.copyFileSync(sourcePath, imageAbsPath);
          }
          images.push({ path: toPublicRelPath(imageAbsPath), durationInSeconds: cutDuration });
        }
      } else if (scene.visual) {
        for (let i = 0; i < numCuts; i++) {
          const imageAbsPath = path.join(PUBLIC_DIR, "assets", guion.slug, "images", `${scene.id}-ai${i}.png`);
          if (fs.existsSync(imageAbsPath)) {
            console.log(`[${scene.id}] corte ${i} (ai) ya existe, se reutiliza`);
          } else {
            const subject =
              numCuts > 1
                ? `${scene.visual}, alternate camera angle / closer framing, cut ${i + 1} of ${numCuts} in the same illustrated sequence, same subject and art style`
                : scene.visual;
            const prompt = `${subject}, ${PANTALLA_DIVIDIDA_AI_STYLE_SUFFIX}`;
            console.log(`[${scene.id}] generando corte ${i} (ai)...`);
            try {
              await generateImage(prompt, imageAbsPath, { aspectRatio: "16:9" });
            } catch (err) {
              console.log(
                `[${scene.id}] kie.ai falló (${(err as Error).message}), usando fallback gratuito (pollinations.ai)...`,
              );
              await generatePollinationsImage(prompt, imageAbsPath, { width: 1024, height: 576 });
            }
          }
          images.push({ path: toPublicRelPath(imageAbsPath), durationInSeconds: cutDuration });
        }
      }
    }

    renderedScenes.push({
      id: scene.id,
      text: scene.text,
      act: scene.act,
      startSeconds,
      durationInSeconds: sceneDuration,
      matched,
      images,
      displayText: scene.displayText ?? scene.text,
      highlightWord: scene.highlightWord,
    });
  }

  const sfxDir = path.join(PUBLIC_DIR, "assets", guion.slug, "sfx");
  fs.mkdirSync(sfxDir, { recursive: true });

  const whooshPrompt =
    guion.soundDesign?.whooshPrompt ?? "quick cinematic whoosh transition sound effect, sharp and short, trailer style";
  const stingPrompt =
    guion.soundDesign?.stingPrompt ??
    "dramatic cinematic impact hit, deep bass boom with a sharp metallic edge, trailer sting";

  const musicAbsPath = path.join(sfxDir, "background-music.mp3");
  if (!guion.backgroundMusicPath) {
    console.log("sin música de fondo (no se especificó backgroundMusicPath)");
  } else if (fs.existsSync(musicAbsPath)) {
    console.log("música de fondo ya copiada, se reutiliza");
  } else {
    console.log(`copiando música de fondo desde ${guion.backgroundMusicPath}...`);
    fs.copyFileSync(guion.backgroundMusicPath, musicAbsPath);
  }

  const whooshAbsPath = path.join(sfxDir, "whoosh.mp3");
  if (fs.existsSync(whooshAbsPath)) {
    console.log("whoosh ya existe, se reutiliza");
  } else {
    console.log("generando whoosh...");
    await generateSoundEffect(whooshPrompt, whooshAbsPath);
  }

  const stingAbsPath = path.join(sfxDir, "sting.mp3");
  if (fs.existsSync(stingAbsPath)) {
    console.log("sting ya existe, se reutiliza");
  } else {
    console.log("generando sting...");
    await generateSoundEffect(stingPrompt, stingAbsPath);
  }

  const whooshDurationInSeconds = await getAudioDurationInSeconds(whooshAbsPath);
  const stingDurationInSeconds = await getAudioDurationInSeconds(stingAbsPath);

  const rendered: RenderedPantallaDivididaGuion = {
    type: "pantalla-dividida",
    slug: guion.slug,
    topic: guion.topic,
    videoPath,
    durationInSeconds,
    scenes: renderedScenes,
    sfx: {
      backgroundMusicPath: guion.backgroundMusicPath ? toPublicRelPath(musicAbsPath) : undefined,
      whooshPath: toPublicRelPath(whooshAbsPath),
      whooshDurationInSeconds,
      stingPath: toPublicRelPath(stingAbsPath),
      stingDurationInSeconds,
    },
  };

  const dataDir = path.join(PUBLIC_DIR, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, `${guion.slug}.json`), JSON.stringify(rendered, null, 2));

  const matchedCount = renderedScenes.filter((s) => s.matched).length;
  console.log(
    `\nListo. Duración: ${durationInSeconds.toFixed(1)}s, ${renderedScenes.length} escena(s) (${matchedCount} encontrada(s) en transcripción).`,
  );
}

async function generateYoutubeNoticiasAvatarAssets(guion: YoutubeNoticiasAvatarGuion): Promise<void> {
  console.log(`Generando recursos para "${guion.topic}" (youtube-noticias-avatar, ${guion.scenes.length} escena(s))`);

  const { words, videoPath, durationInSeconds } = await prepareTrimmedVideo({
    slug: guion.slug,
    rawVideoPath: guion.rawVideoPath,
    removeOtherSpeakers: guion.removeOtherSpeakers,
  });

  const matches = matchSceneTimestamps(words, guion.scenes, durationInSeconds);

  const missing: string[] = [];
  for (const { scene, durationInSeconds: sceneDuration } of matches) {
    if (scene.localImagePaths && scene.localImagePaths.length > 0) continue;
    const numCuts = Math.max(1, Math.ceil(sceneDuration / NEWS_AVATAR_CUT_SECONDS));
    missing.push(`  [${scene.id}] necesita ${numCuts} imagen(es) en "localImagePaths" (dura ${sceneDuration.toFixed(1)}s)`);
  }
  if (missing.length > 0) {
    throw new Error(
      `Faltan imágenes locales para ${missing.length} escena(s) antes de generar el video:\n${missing.join("\n")}`,
    );
  }

  if (guion.subscribeButton) {
    const subscribeButtonAbsPath = path.join(PUBLIC_DIR, "assets", "youtube-noticias-avatar", "subscribe-button.png");
    if (!fs.existsSync(subscribeButtonAbsPath)) {
      throw new Error(
        `subscribeButton está en true pero falta el asset compartido en ${subscribeButtonAbsPath}. Colocalo ahí una vez (se reusa en todos los videos de este tipo).`,
      );
    }
  }

  const renderedScenes: RenderedYoutubeNoticiasAvatarScene[] = [];
  for (const { scene, startSeconds, durationInSeconds: sceneDuration, matched } of matches) {
    if (!matched) {
      console.log(
        `[${scene.id}] no se encontró el texto en la transcripción, usando tiempo estimado (${startSeconds.toFixed(1)}s)`,
      );
    }

    const numCuts = Math.max(1, Math.ceil(sceneDuration / NEWS_AVATAR_CUT_SECONDS));
    const cutDuration = sceneDuration / numCuts;
    const images: SceneImage[] = [];
    for (let i = 0; i < numCuts; i++) {
      const sourcePath = scene.localImagePaths[i % scene.localImagePaths.length];
      const ext = path.extname(sourcePath) || ".png";
      const imageAbsPath = path.join(PUBLIC_DIR, "assets", guion.slug, "images", `${scene.id}-local${i}${ext}`);
      if (fs.existsSync(imageAbsPath)) {
        console.log(`[${scene.id}] corte ${i} ya existe, se reutiliza`);
      } else {
        console.log(`[${scene.id}] copiando corte ${i}: ${sourcePath}`);
        fs.mkdirSync(path.dirname(imageAbsPath), { recursive: true });
        fs.copyFileSync(sourcePath, imageAbsPath);
      }
      images.push({ path: toPublicRelPath(imageAbsPath), durationInSeconds: cutDuration });
    }

    renderedScenes.push({
      id: scene.id,
      text: scene.text,
      startSeconds,
      durationInSeconds: sceneDuration,
      matched,
      images,
    });
  }

  const captionChunks = buildCaptionChunks(words, 4, 0.6);

  const rendered: RenderedYoutubeNoticiasAvatarGuion = {
    type: "youtube-noticias-avatar",
    slug: guion.slug,
    topic: guion.topic,
    videoPath,
    durationInSeconds,
    subscribeButton: guion.subscribeButton ?? false,
    scenes: renderedScenes,
    captionChunks,
  };

  const dataDir = path.join(PUBLIC_DIR, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, `${guion.slug}.json`), JSON.stringify(rendered, null, 2));

  const matchedCount = renderedScenes.filter((s) => s.matched).length;
  console.log(
    `\nListo. Duración: ${durationInSeconds.toFixed(1)}s, ${renderedScenes.length} escena(s) (${matchedCount} encontrada(s) en transcripción), ${captionChunks.length} bloque(s) de subtítulo.`,
  );
}

async function generateDocumentalDoodleAssets(guion: DocumentalDoodleGuion): Promise<void> {
  console.log(`Generando recursos para "${guion.topic}" (documental-doodle, ${guion.scenes.length} escena(s))`);

  const missingText = guion.scenes.filter((s) => s.text.trim().length === 0);
  if (missingText.length > 0) {
    throw new Error(
      `${missingText.length} escena(s) sin texto para narrar: ${missingText.map((s) => s.id).join(", ")}`,
    );
  }

  const renderedScenes: RenderedDocumentalDoodleScene[] = [];
  const allWords: TranscribedWord[] = [];
  let cursorSeconds = 0;

  for (const scene of guion.scenes) {
    const audioAbsPath = path.join(PUBLIC_DIR, "assets", guion.slug, "audio", `${scene.id}.mp3`);

    let words: TranscribedWord[] = [];
    if (fs.existsSync(audioAbsPath)) {
      // No re-genera la voz (ya está en disco), pero SÍ necesita las palabras
      // con timestamp para los subtítulos — como esta corrida no tiene el
      // transcript en memoria (se perdió si el proceso se cortó antes de
      // escribir el JSON final), lo saca transcribiendo el audio ya
      // descargado con ElevenLabs en vez de volver a pagar la generación de
      // voz completa en ai33.
      console.log(`[${scene.id}] voz ya existe, transcribiendo el audio ya generado...`);
      words = await transcribeWithTimestamps(audioAbsPath);
    } else {
      console.log(`[${scene.id}] generando voz + transcript...`);
      const result = await generateSpeech(scene.text, { outputPath: audioAbsPath, voiceId: guion.voiceId, withTranscript: true });
      words = result.words;
    }

    const durationInSeconds = await getAudioDurationInSeconds(audioAbsPath);

    for (const word of words) {
      allWords.push({ text: word.text, start: word.start + cursorSeconds, end: word.end + cursorSeconds });
    }

    const numCuts = Math.max(1, Math.ceil(durationInSeconds / DOODLE_CUT_SECONDS));
    const cutDuration = durationInSeconds / numCuts;
    const images: SceneImage[] = [];
    for (let i = 0; i < numCuts; i++) {
      const imageAbsPath = path.join(PUBLIC_DIR, "assets", guion.slug, "images", `${scene.id}-${i}.png`);
      if (fs.existsSync(imageAbsPath)) {
        console.log(`[${scene.id}] corte ${i} ya existe, se reutiliza`);
      } else {
        const prompt =
          numCuts > 1
            ? `${scene.visual}, alternate camera angle / closer framing, cut ${i + 1} of ${numCuts} in the same documentary sequence, same subject and art style`
            : scene.visual;
        console.log(`[${scene.id}] generando corte ${i} (doodle)...`);
        await generateImage(prompt, imageAbsPath, { aspectRatio: "16:9" });
      }
      images.push({ path: toPublicRelPath(imageAbsPath), durationInSeconds: cutDuration });
    }

    renderedScenes.push({
      id: scene.id,
      text: scene.text,
      audioPath: toPublicRelPath(audioAbsPath),
      startSeconds: cursorSeconds,
      durationInSeconds,
      images,
    });

    cursorSeconds += durationInSeconds;
  }

  const captionChunks = buildCaptionChunks(allWords, 4, 0.6);

  const rendered: RenderedDocumentalDoodleGuion = {
    type: "documental-doodle",
    slug: guion.slug,
    topic: guion.topic,
    durationInSeconds: cursorSeconds,
    scenes: renderedScenes,
    captionChunks,
  };

  const dataDir = path.join(PUBLIC_DIR, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, `${guion.slug}.json`), JSON.stringify(rendered, null, 2));

  const totalCuts = renderedScenes.reduce((acc, s) => acc + s.images.length, 0);
  console.log(
    `\nListo. Duración total: ${cursorSeconds.toFixed(1)}s en ${renderedScenes.length} escena(s), ${totalCuts} corte(s) visuales, ${captionChunks.length} bloque(s) de subtítulo.`,
  );
}

// Sufijo de estilo fijo para imágenes IA de cortes-documental (visual sin localImagePath).
const CORTES_DOCUMENTAL_AI_STYLE_SUFFIX =
  "vertical 9:16 documentary archive photograph, photorealistic, natural film grain, warm cinematic tones, shallow depth of field, authentic candid moment, no text or letters in the image";

// Prefijo para cortes con `basedOn`: la imagen del corte referenciado fija el personaje.
const CORTES_DOCUMENTAL_CHARACTER_PREFIX =
  "Use the reference image as the character reference: keep the EXACT same person (same face, same age, same hair, same clothing) in a new scene. New scene: ";

const CORTES_DOCUMENTAL_TITLE_SECONDS = 2.5;
// Cola después de la última palabra: el corte de cierre sigue sobre ella y se funde a negro.
const CORTES_DOCUMENTAL_OUTRO_SECONDS = 2.5;
// La voz se lleva a este nivel (el video de referencia está en -10.9 LUFS) y la música queda debajo.
const CORTES_DOCUMENTAL_VOICE_LUFS = -13;
const CORTES_DOCUMENTAL_MUSIC_BELOW_VOICE_DB = 14;
const CORTES_DOCUMENTAL_TRANSITIONS: CortesDocumentalTransition[] = ["flash", "slide", "zoom"];

async function generateCortesDocumentalAssets(guion: CortesDocumentalGuion): Promise<void> {
  const titles = guion.titles ?? [];
  console.log(
    `Generando recursos para "${guion.topic}" (cortes-documental, ${guion.cutaways.length} corte(s), ${titles.length} título(s))`,
  );

  const missingImage = guion.cutaways.filter((c) => !c.localImagePath && !c.visual);
  if (missingImage.length > 0) {
    throw new Error(
      `Faltan imágenes para ${missingImage.length} corte(s): ${missingImage
        .map((c) => `[${c.id}] necesita "localImagePath" o un prompt en "visual"`)
        .join("; ")}`,
    );
  }
  guion.cutaways.forEach((c, i) => {
    if (c.basedOn && !guion.cutaways.slice(0, i).some((other) => other.id === c.basedOn)) {
      throw new Error(`[${c.id}] "basedOn" apunta a "${c.basedOn}", que no existe o no aparece antes en la lista.`);
    }
  });
  if (guion.cutaways.filter((c) => c.closing).length > 1) {
    throw new Error('Solo un corte puede tener "closing": true.');
  }

  const trimmed = await prepareTrimmedVideo({
    slug: guion.slug,
    rawVideoPath: guion.rawVideoPath,
    removeOtherSpeakers: guion.removeOtherSpeakers,
  });
  const { words, durationInSeconds } = trimmed;

  // Voz a nivel de referencia: el crudo del celular suele quedar ~19 dB por debajo.
  const trimmedAbsPath = path.join(PUBLIC_DIR, trimmed.videoPath);
  const normalizedAbsPath = path.join(path.dirname(trimmedAbsPath), `voice-normalized${path.extname(trimmedAbsPath)}`);
  if (fs.existsSync(normalizedAbsPath)) {
    console.log("voz ya normalizada, se reutiliza");
  } else {
    console.log(`normalizando voz a ${CORTES_DOCUMENTAL_VOICE_LUFS} LUFS...`);
    await normalizeVideoAudio(trimmedAbsPath, normalizedAbsPath, CORTES_DOCUMENTAL_VOICE_LUFS);
  }
  const videoPath = toPublicRelPath(normalizedAbsPath);

  const cutawayMatches = matchSceneTimestamps(words, guion.cutaways, durationInSeconds);
  const titleMatches = matchSceneTimestamps(words, titles, durationInSeconds);

  const unmatched = [...cutawayMatches, ...titleMatches].filter((m) => !m.matched);
  if (unmatched.length > 0) {
    throw new Error(
      `No se encontró en la transcripción el texto de ${unmatched.length} elemento(s):\n${unmatched
        .map((m) => `  [${m.scene.id}] "${m.scene.text}"`)
        .join("\n")}\nCopia la frase EXACTA de public/assets/${guion.slug}/transcript.json.`,
    );
  }

  const hasClosing = guion.cutaways.some((c) => c.closing);
  const outroSeconds = hasClosing ? CORTES_DOCUMENTAL_OUTRO_SECONDS : 0;

  const { resolved, dropped } = resolveCutawayTimings(
    cutawayMatches.map((m) => ({
      id: m.scene.id,
      startSeconds: m.startSeconds,
      durationSeconds: m.scene.durationSeconds,
      closing: m.scene.closing,
    })),
    durationInSeconds,
    outroSeconds,
  );
  for (const d of dropped) {
    console.log(`[${d.id}] corte descartado: ${d.reason}`);
  }

  const imagesDir = path.join(PUBLIC_DIR, "assets", guion.slug, "images");
  const imageAbsPaths = new Map<string, string>();

  // Devuelve la ruta absoluta de la imagen del corte, generándola (o copiándola) si falta.
  // Con `basedOn` genera primero la imagen base y la usa como referencia del personaje.
  const ensureCutawayImage = async (cutawayId: string): Promise<string> => {
    const known = imageAbsPaths.get(cutawayId);
    if (known) return known;
    const cutaway = guion.cutaways.find((c) => c.id === cutawayId)!;

    let imageAbsPath: string;
    if (cutaway.localImagePath) {
      const ext = path.extname(cutaway.localImagePath) || ".png";
      imageAbsPath = path.join(imagesDir, `${cutaway.id}-local${ext}`);
      if (fs.existsSync(imageAbsPath)) {
        console.log(`[${cutaway.id}] imagen ya existe, se reutiliza`);
      } else {
        console.log(`[${cutaway.id}] copiando imagen: ${cutaway.localImagePath}`);
        fs.mkdirSync(imagesDir, { recursive: true });
        fs.copyFileSync(cutaway.localImagePath, imageAbsPath);
      }
    } else {
      imageAbsPath = path.join(imagesDir, `${cutaway.id}-ai.png`);
      if (fs.existsSync(imageAbsPath)) {
        console.log(`[${cutaway.id}] imagen (ai) ya existe, se reutiliza`);
      } else {
        const styled = `${cutaway.visual}, ${CORTES_DOCUMENTAL_AI_STYLE_SUFFIX}`;
        let done = false;
        if (cutaway.basedOn) {
          try {
            const baseAbsPath = await ensureCutawayImage(cutaway.basedOn);
            console.log(`[${cutaway.id}] generando imagen (ai) con personaje de referencia ${cutaway.basedOn}...`);
            const referenceUrl = await uploadImage(baseAbsPath);
            await editImage(`${CORTES_DOCUMENTAL_CHARACTER_PREFIX}${styled}`, [referenceUrl], imageAbsPath, { aspectRatio: "9:16" });
            done = true;
          } catch (err) {
            console.log(`[${cutaway.id}] con referencia falló (${(err as Error).message}), se genera sin referencia...`);
          }
        }
        if (!done) {
          console.log(`[${cutaway.id}] generando imagen (ai)...`);
          try {
            await generateImage(styled, imageAbsPath, { aspectRatio: "9:16" });
          } catch (err) {
            console.log(
              `[${cutaway.id}] kie.ai falló (${(err as Error).message}), usando fallback gratuito (pollinations.ai)...`,
            );
            await generatePollinationsImage(styled, imageAbsPath, { width: 576, height: 1024 });
          }
        }
      }
    }

    imageAbsPaths.set(cutawayId, imageAbsPath);
    return imageAbsPath;
  };

  const cutaways: RenderedCortesDocumentalCutaway[] = [];
  for (const [index, timing] of resolved.entries()) {
    const imageAbsPath = await ensureCutawayImage(timing.id);
    cutaways.push({
      id: timing.id,
      startSeconds: timing.startSeconds,
      durationInSeconds: timing.durationSeconds,
      imagePath: toPublicRelPath(imageAbsPath),
      transition: CORTES_DOCUMENTAL_TRANSITIONS[index % CORTES_DOCUMENTAL_TRANSITIONS.length],
      closing: guion.cutaways.find((c) => c.id === timing.id)?.closing,
    });
  }

  const renderedTitles: RenderedCortesDocumentalTitle[] = titleMatches.map((m) => {
    const wanted = m.scene.durationSeconds ?? CORTES_DOCUMENTAL_TITLE_SECONDS;
    return {
      id: m.scene.id,
      startSeconds: m.startSeconds,
      durationInSeconds: Math.max(0, Math.min(wanted, durationInSeconds - m.startSeconds)),
      kicker: m.scene.kicker,
      headline: m.scene.headline,
    };
  });

  const sfxDir = path.join(PUBLIC_DIR, "assets", guion.slug, "sfx");
  fs.mkdirSync(sfxDir, { recursive: true });

  const whooshAbsPath = path.join(sfxDir, "whoosh.mp3");
  if (fs.existsSync(whooshAbsPath)) {
    console.log("whoosh ya existe, se reutiliza");
  } else {
    console.log("generando whoosh...");
    await generateSoundEffect(
      guion.soundDesign?.whooshPrompt ?? "short fast cinematic whoosh transition, airy swoosh with a soft impact at the end, no music",
      whooshAbsPath,
    );
  }
  const hitAbsPath = path.join(sfxDir, "hit.mp3");
  if (fs.existsSync(hitAbsPath)) {
    console.log("hit ya existe, se reutiliza");
  } else {
    console.log("generando hit...");
    await generateSoundEffect(
      guion.soundDesign?.hitPrompt ?? "deep cinematic impact hit with sub bass boom and a short reverb tail, trailer style",
      hitAbsPath,
    );
  }

  let music: RenderedCortesDocumentalGuion["music"];
  if (guion.backgroundMusicPath) {
    const musicAbsPath = path.join(sfxDir, "background-music.mp3");
    if (!fs.existsSync(musicAbsPath)) {
      console.log(`copiando música de fondo desde ${guion.backgroundMusicPath}...`);
      fs.copyFileSync(guion.backgroundMusicPath, musicAbsPath);
    }
    const musicLufs = await measureIntegratedLufs(musicAbsPath);
    const targetLufs = CORTES_DOCUMENTAL_VOICE_LUFS - CORTES_DOCUMENTAL_MUSIC_BELOW_VOICE_DB;
    const volume = Math.min(1, Math.pow(10, (targetLufs - musicLufs) / 20));
    console.log(`música: ${musicLufs.toFixed(1)} LUFS, volumen ${volume.toFixed(2)} para quedar a ${targetLufs} LUFS`);
    music = { path: toPublicRelPath(musicAbsPath), volume };
  } else {
    console.log("sin música de fondo (no se especificó backgroundMusicPath)");
  }

  const captionChunks = buildCaptionChunks(words, 3, 0.4);
  const jumpCuts = computeJumpCuts(
    captionChunks.map((chunk) => chunk.startSeconds),
    cutaways.filter((c) => !c.closing).map((c) => ({ startSeconds: c.startSeconds, durationSeconds: c.durationInSeconds })),
    durationInSeconds,
  );

  const rendered: RenderedCortesDocumentalGuion = {
    type: "cortes-documental",
    slug: guion.slug,
    topic: guion.topic,
    videoPath,
    durationInSeconds,
    cutaways,
    titles: renderedTitles,
    captionChunks,
    outroSeconds,
    jumpCuts,
    sfx: {
      whooshPath: toPublicRelPath(whooshAbsPath),
      whooshDurationInSeconds: await getAudioDurationInSeconds(whooshAbsPath),
      hitPath: toPublicRelPath(hitAbsPath),
      hitDurationInSeconds: await getAudioDurationInSeconds(hitAbsPath),
    },
    music,
  };

  const dataDir = path.join(PUBLIC_DIR, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, `${guion.slug}.json`), JSON.stringify(rendered, null, 2));

  console.log(
    `\nListo. Duración: ${durationInSeconds.toFixed(1)}s (+${outroSeconds}s de cierre), ${cutaways.length} corte(s) (${dropped.length} descartado(s)), ${renderedTitles.length} título(s), ${jumpCuts.length} jump cut(s).`,
  );
}

async function main() {
  const guionPath = process.argv[2];
  if (!guionPath) {
    console.error("Uso: tsx src/services/generateAssets.ts content/guiones/<slug>.json");
    process.exit(1);
  }

  const guion = JSON.parse(fs.readFileSync(guionPath, "utf-8")) as Guion;

  if (guion.type === "social-checklist") {
    await generateSocialChecklistAssets(guion);
    return;
  }

  if (guion.type === "pantalla-dividida") {
    await generatePantallaDivididaAssets(guion);
    return;
  }

  if (guion.type === "youtube-noticias-avatar") {
    await generateYoutubeNoticiasAvatarAssets(guion);
    return;
  }

  if (guion.type === "documental-doodle") {
    await generateDocumentalDoodleAssets(guion);
    return;
  }

  if (guion.type === "cortes-documental") {
    await generateCortesDocumentalAssets(guion);
    return;
  }

  await generateVoxAssets(guion);
}

main().catch((err) => {
  console.error("FALLÓ:", err);
  process.exit(1);
});
