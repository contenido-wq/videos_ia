import fs from "fs";
import path from "path";
import { parseFile } from "music-metadata";
import { generateVoice, generateSoundEffect, transcribeWithTimestamps, transcribeWithSpeakers } from "./elevenlabsService";
import { generateImage, editImage, uploadImage } from "./kieAiService";
import { findRealImageUrls, downloadImageFromUrl } from "./apifyService";
import { findWikimediaImageUrls } from "./wikimediaService";
import { findSimpleIconSvg, renderSimpleIconToPng } from "./simpleIconsService";
import { findLogoDevUrl } from "./logoDevService";
import { getVideoDurationInSeconds, extractAudioTrack } from "./ffmpegService";
import { matchItemTimestamps, matchSceneTimestamps, type TranscribedWord, type DiarizedWord } from "./checklistSyncService";
import { detectRetakeCandidates, type RetakeCandidate } from "./retakeDetectionService";
import { reviewRetakeCandidates } from "./retakeReviewCli";
import {
  detectSilenceRanges,
  detectFillerRanges,
  mergeCutRanges,
  computeKeepSegments,
  trimVideoToSegments,
  remapWords,
  findPrimarySpeakerId,
  detectOtherSpeakerRanges,
  detectRepeatedPhrases,
  subtractRanges,
  type CutRange,
} from "./videoTrimService";
import type {
  Guion,
  VoxGuion,
  SocialChecklistGuion,
  RenderedChecklistItem,
  RenderedSocialChecklistGuion,
  PantallaDivididaGuion,
  RenderedPantallaDivididaScene,
  RenderedPantallaDivididaGuion,
  GuionScene,
  RenderedGuion,
  RenderedScene,
  SceneImage,
} from "../types/guion";

const PUBLIC_DIR = path.join(process.cwd(), "public");

// Ningún corte visual dura más de esto: si la narración es más larga,
// se generan varias imágenes que se van cortando dentro de la misma escena.
const MAX_CUT_SECONDS = 2.5;

// Para el personaje: en vez de cortes secuenciales, generamos N poses que se
// van cross-fadeando en loop durante toda la escena (simula un micro-gesto).
const CHARACTER_POSE_VARIANTS = 2;

// Aire que se deja a cada lado de un silencio/titubeo cortado en social-checklist,
// para no comerse el inicio/fin de la palabra siguiente/anterior.
const TRIM_PADDING_SECONDS = 0.15;

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

interface PrepareTrimmedVideoParams {
  slug: string;
  rawVideoPath: string;
  removeOtherSpeakers?: boolean;
}

interface TrimmedVideoResult {
  words: TranscribedWord[];
  videoPath: string;
  durationInSeconds: number;
}

async function prepareTrimmedVideo({
  slug,
  rawVideoPath,
  removeOtherSpeakers,
}: PrepareTrimmedVideoParams): Promise<TrimmedVideoResult> {
  const rawExt = path.extname(rawVideoPath) || ".mov";
  const rawVideoAbsPath = path.join(PUBLIC_DIR, "assets", slug, "video", `source${rawExt}`);

  if (fs.existsSync(rawVideoAbsPath)) {
    console.log("video crudo ya copiado, se reutiliza");
  } else {
    console.log(`copiando video crudo desde ${rawVideoPath}...`);
    fs.mkdirSync(path.dirname(rawVideoAbsPath), { recursive: true });
    fs.copyFileSync(rawVideoPath, rawVideoAbsPath);
  }

  const rawDurationInSeconds = await getVideoDurationInSeconds(rawVideoAbsPath);

  const transcriptPath = path.join(PUBLIC_DIR, "assets", slug, "transcript.json");
  let rawWords: TranscribedWord[];
  if (fs.existsSync(transcriptPath)) {
    console.log("transcripción ya existe, se reutiliza");
    rawWords = JSON.parse(fs.readFileSync(transcriptPath, "utf-8")) as TranscribedWord[];
  } else {
    const audioTmpPath = path.join(PUBLIC_DIR, "assets", slug, "audio-for-transcription.mp3");
    console.log("extrayendo audio para transcribir...");
    await extractAudioTrack(rawVideoAbsPath, audioTmpPath);
    if (removeOtherSpeakers) {
      console.log("transcribiendo con ElevenLabs Scribe (con diarización)...");
      rawWords = await transcribeWithSpeakers(audioTmpPath);
    } else {
      console.log("transcribiendo con ElevenLabs Scribe...");
      rawWords = await transcribeWithTimestamps(audioTmpPath);
    }
    fs.writeFileSync(transcriptPath, JSON.stringify(rawWords, null, 2));
    fs.rmSync(audioTmpPath);
  }

  const trimmedVideoAbsPath = path.join(PUBLIC_DIR, "assets", slug, "video", `trimmed${rawExt}`);

  console.log("detectando silencios y titubeos...");
  const silenceRanges = await detectSilenceRanges(rawVideoAbsPath, rawDurationInSeconds);
  const fillerRanges = detectFillerRanges(rawWords);
  let otherSpeakerRanges: CutRange[] = [];
  if (removeOtherSpeakers) {
    const diarizedWords = rawWords as DiarizedWord[];
    const primarySpeakerId = findPrimarySpeakerId(diarizedWords);
    otherSpeakerRanges = detectOtherSpeakerRanges(diarizedWords, primarySpeakerId);
    console.log(`  hablante principal: ${primarySpeakerId}, ${otherSpeakerRanges.length} tramo(s) de otra voz`);
  }
  console.log(`  ${silenceRanges.length} silencio(s), ${fillerRanges.length} titubeo(s)/muletilla(s)`);

  // Los rangos APROBADOS se persisten en su propio archivo, separado de
  // trimmedVideoAbsPath: ese gate solo controla si hace falta volver a correr
  // ffmpeg, pero words/matches/duración se recalculan en CADA corrida (incluso
  // si el video ya está recortado — ej. para regenerar solo un logo). Si
  // approvedRetakeRanges dependiera de que el video NO exista, cualquier
  // corrida posterior a la primera calculaba words sin restar los retakes,
  // aunque el video real sí los tuviera cortados — desincronizaba el timing de
  // las tarjetas y generaba falsos positivos en detectRepeatedPhrases (bug
  // real: encontrado al re-correr el pipeline solo para arreglar logos).
  const approvedRetakeRangesPath = path.join(PUBLIC_DIR, "assets", slug, "approved-retake-ranges.json");
  let approvedRetakeRanges: CutRange[];
  if (fs.existsSync(approvedRetakeRangesPath)) {
    console.log("rangos de retake ya aprobados, se reutilizan");
    approvedRetakeRanges = JSON.parse(fs.readFileSync(approvedRetakeRangesPath, "utf-8")) as CutRange[];
  } else {
    const retakeCandidatesPath = path.join(PUBLIC_DIR, "assets", slug, "retake-candidates.json");
    let retakeCandidates: RetakeCandidate[];
    if (fs.existsSync(retakeCandidatesPath)) {
      console.log("candidatos a retake ya existen, se reutilizan");
      retakeCandidates = JSON.parse(fs.readFileSync(retakeCandidatesPath, "utf-8")) as RetakeCandidate[];
    } else {
      console.log("detectando retakes y asides fuera de guion con Claude...");
      retakeCandidates = await detectRetakeCandidates(rawWords);
      fs.mkdirSync(path.dirname(retakeCandidatesPath), { recursive: true });
      fs.writeFileSync(retakeCandidatesPath, JSON.stringify(retakeCandidates, null, 2));
    }
    console.log(`  ${retakeCandidates.length} candidato(s) a retake/aside`);
    approvedRetakeRanges = await reviewRetakeCandidates(retakeCandidates);
    console.log(`  ${approvedRetakeRanges.length} aprobado(s) para cortar`);
    fs.mkdirSync(path.dirname(approvedRetakeRangesPath), { recursive: true });
    fs.writeFileSync(approvedRetakeRangesPath, JSON.stringify(approvedRetakeRanges, null, 2));
  }

  // Los cortes de retake/aside y de otro-hablante NO entran al merge+padding general:
  // computeKeepSegments encoge cada corte por TRIM_PADDING_SECONDS de cada lado (pensado
  // para silencios, donde ese aire de más es inofensivo), y ese mismo aire deja pasar un
  // fragmento de contenido MALO en el borde — una palabra de Lina leyendo el guion antes
  // de que el hablante principal la diga, o la cola de un tartamudeo. Sumarlos ya
  // "ensanchados" para cancelar ese encogimiento tampoco sirve: en tramos con cortes muy
  // pegados entre sí, el ensanchado se fusiona con el corte vecino y se traga tomas
  // buenas cortas enteras (bug real: así se perdió la única mención de "Notebook LM").
  // Se calculan los tramos a conservar solo con silencio/muletillas (con su padding de
  // siempre, ahí sí inofensivo) y recién ahí se restan retakes y otro-hablante de forma
  // exacta, sin padding ni fusión con nada más.
  const cutRanges = mergeCutRanges([...silenceRanges, ...fillerRanges]);
  const keepSegmentsBeforePrecise = computeKeepSegments(rawDurationInSeconds, cutRanges, TRIM_PADDING_SECONDS);
  const keepSegments = subtractRanges(keepSegmentsBeforePrecise, [...otherSpeakerRanges, ...approvedRetakeRanges]);
  // remapWords usa los mismos keepSegments que trimVideoToSegments (no cutRanges
  // crudos) para que el timestamp de cada palabra calce exactamente con el video
  // ya recortado, padding incluido.
  const words = remapWords(rawWords, keepSegments);

  // Señal automática de "brincos" mal cortados: un retake que se cortó a medias
  // deja las palabras iniciales de la frase duplicadas cuando arranca el segundo
  // intento limpio justo después. No corta nada solo, es una alerta para revisar
  // el video a mano en ese punto.
  const repeatedPhrases = detectRepeatedPhrases(words);
  if (repeatedPhrases.length > 0) {
    console.log(`\n⚠️  ${repeatedPhrases.length} frase(s) posiblemente duplicada(s) en el video final (revisar):`);
    for (const r of repeatedPhrases) {
      console.log(`  ${r.start.toFixed(1)}s-${r.end.toFixed(1)}s: "${r.phrase}"`);
    }
    console.log("");
  }

  if (fs.existsSync(trimmedVideoAbsPath)) {
    console.log("video recortado ya existe, se reutiliza");
  } else {
    console.log(
      `recortando video (${keepSegments.length} segmento(s) a conservar de ${cutRanges.length + otherSpeakerRanges.length + approvedRetakeRanges.length} corte(s): ${cutRanges.length} de silencio/muletilla, ${otherSpeakerRanges.length} de otro-hablante, ${approvedRetakeRanges.length} de retake/aside)...`,
    );
    await trimVideoToSegments(rawVideoAbsPath, trimmedVideoAbsPath, keepSegments);
  }

  const durationInSeconds = await getVideoDurationInSeconds(trimmedVideoAbsPath);
  console.log(`duración final: ${durationInSeconds.toFixed(1)}s (crudo: ${rawDurationInSeconds.toFixed(1)}s)`);

  return { words, videoPath: toPublicRelPath(trimmedVideoAbsPath), durationInSeconds };
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
    const numCuts = Math.max(1, Math.ceil(sceneDuration / MAX_CUT_SECONDS));
    missing.push(`  [${scene.id}] necesita ${numCuts} imagen(es) en "localImagePaths" (dura ${sceneDuration.toFixed(1)}s)`);
  }
  if (missing.length > 0) {
    throw new Error(
      `Faltan imágenes locales para ${missing.length} escena(s) antes de generar el video:\n${missing.join("\n")}`,
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
      const localImagePaths = scene.localImagePaths as string[];
      const numCuts = Math.max(1, Math.ceil(sceneDuration / MAX_CUT_SECONDS));
      const cutDuration = sceneDuration / numCuts;
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
    }

    renderedScenes.push({
      id: scene.id,
      text: scene.text,
      act: scene.act,
      startSeconds,
      durationInSeconds: sceneDuration,
      matched,
      images,
    });
  }

  const rendered: RenderedPantallaDivididaGuion = {
    type: "pantalla-dividida",
    slug: guion.slug,
    topic: guion.topic,
    videoPath,
    durationInSeconds,
    scenes: renderedScenes,
  };

  const dataDir = path.join(PUBLIC_DIR, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, `${guion.slug}.json`), JSON.stringify(rendered, null, 2));

  const matchedCount = renderedScenes.filter((s) => s.matched).length;
  console.log(
    `\nListo. Duración: ${durationInSeconds.toFixed(1)}s, ${renderedScenes.length} escena(s) (${matchedCount} encontrada(s) en transcripción).`,
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

  await generateVoxAssets(guion);
}

main().catch((err) => {
  console.error("FALLÓ:", err);
  process.exit(1);
});
