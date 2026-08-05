import fs from "fs";
import path from "path";
import { parseFile } from "music-metadata";
import { generateVoice, generateSoundEffect } from "./elevenlabsService";
import { generateImage, editImage, uploadImage } from "./kieAiService";
import { findRealImageUrls, downloadImageFromUrl } from "./apifyService";
import type { Guion, RenderedGuion, RenderedScene, SceneImage } from "../types/guion";

const PUBLIC_DIR = path.join(process.cwd(), "public");

// Ningún corte visual dura más de esto: si la narración es más larga,
// se generan varias imágenes que se van cortando dentro de la misma escena.
const MAX_CUT_SECONDS = 2.5;

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
  guion: Guion,
  scene: Guion["scenes"][number],
  characterImageUrl: string | null,
): Promise<RenderedScene> {
  const audioRelPath = path.join("assets", guion.slug, "audio", `${scene.id}.mp3`);
  const audioAbsPath = path.join(PUBLIC_DIR, audioRelPath);

  if (fs.existsSync(audioAbsPath)) {
    console.log(`[${scene.id}] voz ya existe, se reutiliza`);
  } else {
    console.log(`[${scene.id}] generando voz...`);
    await generateVoice(scene.text, { outputPath: audioAbsPath, voiceId: guion.voiceId });
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

async function main() {
  const guionPath = process.argv[2];
  if (!guionPath) {
    console.error("Uso: tsx src/services/generateAssets.ts content/guiones/<slug>.json");
    process.exit(1);
  }

  const guion = JSON.parse(fs.readFileSync(guionPath, "utf-8")) as Guion;
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

main().catch((err) => {
  console.error("FALLÓ:", err);
  process.exit(1);
});
