import fs from "fs";
import path from "path";
import { transcribeWithTimestamps, transcribeWithSpeakers } from "./elevenlabsService";
import { getVideoDurationInSeconds, extractAudioTrack } from "./ffmpegService";
import { detectRetakeCandidates, type RetakeCandidate } from "./retakeDetectionService";
import { reviewRetakeCandidates } from "./retakeReviewCli";
import type { TranscribedWord, DiarizedWord } from "./checklistSyncService";
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
  dropWordlessSegments,
  type CutRange,
} from "./videoTrimService";

const PUBLIC_DIR = path.join(process.cwd(), "public");
const TRIM_PADDING_SECONDS = 0.15;

function toPublicRelPath(absPath: string): string {
  return path.relative(PUBLIC_DIR, absPath).split(path.sep).join("/");
}

export interface PrepareTrimmedVideoParams {
  slug: string;
  rawVideoPath: string;
  removeOtherSpeakers?: boolean;
}

export interface TrimmedVideoResult {
  words: TranscribedWord[];
  videoPath: string;
  durationInSeconds: number;
}

export async function prepareTrimmedVideo({
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
    // Sin terminal interactiva (ej. corrida desde una herramienta que no expone
    // stdin) reviewRetakeCandidates se quedaría esperando input que nunca llega.
    // En ese caso paramos acá con instrucciones claras en vez de colgar el proceso:
    // los candidatos ya quedaron cacheados en retakeCandidatesPath para revisarlos
    // aparte (a mano o por otro medio) y escribir las aprobaciones directamente en
    // approvedRetakeRangesPath, formato CutRange[] ({ start, end }).
    if (!process.stdin.isTTY) {
      throw new Error(
        `Hay ${retakeCandidates.length} candidato(s) a retake/aside pendientes de revisión en ${retakeCandidatesPath}, ` +
          `pero no hay una terminal interactiva para revisarlos uno por uno. Revisalos y escribí las aprobaciones en ` +
          `${approvedRetakeRangesPath} (array de { start, end }), o volvé a correr este comando en una terminal interactiva.`,
      );
    }
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
  const keepSegmentsWithGaps = subtractRanges(keepSegmentsBeforePrecise, [...otherSpeakerRanges, ...approvedRetakeRanges]);
  // Descarta segmentos "conservados" sin ninguna palabra real (ver comentario en
  // dropWordlessSegments) — nunca pierde contenido porque solo saca tramos que ya
  // no tenían texto adentro.
  const keepSegments = dropWordlessSegments(keepSegmentsWithGaps, rawWords);
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

  const droppedWordlessSegments = keepSegmentsWithGaps.length - keepSegments.length;

  if (fs.existsSync(trimmedVideoAbsPath)) {
    console.log("video recortado ya existe, se reutiliza");
  } else {
    console.log(
      `recortando video (${keepSegments.length} segmento(s) a conservar de ${cutRanges.length + otherSpeakerRanges.length + approvedRetakeRanges.length} corte(s): ${cutRanges.length} de silencio/muletilla, ${otherSpeakerRanges.length} de otro-hablante, ${approvedRetakeRanges.length} de retake/aside${droppedWordlessSegments > 0 ? `, ${droppedWordlessSegments} tramo(s) sin palabras descartado(s)` : ""})...`,
    );
    await trimVideoToSegments(rawVideoAbsPath, trimmedVideoAbsPath, keepSegments);
  }

  const durationInSeconds = await getVideoDurationInSeconds(trimmedVideoAbsPath);
  console.log(`duración final: ${durationInSeconds.toFixed(1)}s (crudo: ${rawDurationInSeconds.toFixed(1)}s)`);

  return { words, videoPath: toPublicRelPath(trimmedVideoAbsPath), durationInSeconds };
}
