import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { editImage, generateImage, uploadImage } from "./kieAiService";
import type { MotionBlancoPlan } from "../types/guion";

const execFileAsync = promisify(execFile);
const PUBLIC_DIR = path.join(process.cwd(), "public");
const CONCURRENCY = 5;

// Mismo look en todas las fotos para que parezcan fotogramas de una sola película.
const BG_STYLE =
  "Cinematic film still, photorealistic, shot on 35mm film, shallow depth of field, warm golden-hour color grading, " +
  "dramatic natural lighting, soft film grain, realistic textures. Vertical 9:16 composition with the main subject " +
  "in the upper-middle of the frame. No text, no letters, no watermark.";
const CUTOUT_STYLE =
  "Single isolated object, centered, fully visible with margin around it, photorealistic studio product photo, " +
  "warm soft key light, on a pure flat white background (#FFFFFF), no shadow, no floor, no text, no watermark.";

export function bgRelPath(slug: string, sceneId: string): string {
  return `assets/${slug}/images/${sceneId}.png`;
}

export function cutoutRelPath(slug: string, cutoutId: string): string {
  return `assets/${slug}/images/cutouts/${cutoutId}.png`;
}

type Job = { label: string; run: () => Promise<void> };

async function runPool(jobs: Job[]): Promise<void> {
  const failures: string[] = [];
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      try {
        await job.run();
        console.log(`  ✓ ${job.label}`);
      } catch (err) {
        failures.push(`${job.label}: ${(err as Error).message}`);
        console.log(`  ✗ ${job.label}: ${(err as Error).message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (failures.length > 0) {
    throw new Error(`${failures.length} imagen(es) fallaron; vuelve a correr para reintentar solo esas.`);
  }
}

/**
 * Con personajes de referencia la imagen se genera editando a partir de ellos (nano-banana-edit),
 * así David, Goliat, etc. mantienen la misma cara, edad y ropa en todo el video.
 */
function makeGenerator(plan: MotionBlancoPlan) {
  const uploads = new Map<string, Promise<string>>();
  const uploadOnce = (relPath: string) => {
    if (!uploads.has(relPath)) uploads.set(relPath, uploadImage(path.join(PUBLIC_DIR, relPath)));
    return uploads.get(relPath)!;
  };
  return async (prompt: string, refs: string[] | undefined, outputPath: string, aspectRatio: "9:16" | "1:1") => {
    if (!refs || refs.length === 0) {
      await generateImage(prompt, outputPath, { aspectRatio });
      return;
    }
    const characters = refs.map((key) => {
      const character = plan.characters?.[key];
      if (!character) throw new Error(`El personaje "${key}" no está definido en characters del plan`);
      return character;
    });
    const urls = await Promise.all(characters.map((c) => uploadOnce(c.image)));
    const cast = characters.map((c, i) => `Reference image ${i + 1}: ${c.description}.`).join(" ");
    await editImage(
      `${prompt}. ${cast} Keep each character exactly as in their reference image: same face, same age, same hair, same build and same clothing. ` +
        `Create a completely new scene and composition; do not copy the reference background or pose.`,
      urls,
      outputPath,
      { aspectRatio },
    );
  };
}

/** Genera (solo las que falten) las fotos de fondo y los objetos recortados de cada escena. */
export async function generateMotionBlancoImages(slug: string, plan: MotionBlancoPlan): Promise<void> {
  const jobs: Job[] = [];
  const generate = makeGenerator(plan);

  for (const scene of plan.scenes) {
    const bgAbs = path.join(PUBLIC_DIR, bgRelPath(slug, scene.id));
    if (!fs.existsSync(bgAbs)) {
      jobs.push({ label: `fondo ${scene.id}`, run: () => generate(`${scene.bg}. ${BG_STYLE}`, scene.refs, bgAbs, "9:16") });
    }
    for (const mid of scene.mid ?? []) {
      const cutAbs = path.join(PUBLIC_DIR, cutoutRelPath(slug, mid.id));
      if (fs.existsSync(cutAbs)) continue;
      const rawAbs = cutAbs.replace(/\.png$/, "-raw.png");
      jobs.push({
        label: `recorte ${mid.id}`,
        run: async () => {
          if (!fs.existsSync(rawAbs)) await generate(`${mid.prompt}. ${CUTOUT_STYLE}`, mid.refs, rawAbs, "1:1");
          await execFileAsync("python3", [path.join(process.cwd(), "scripts", "cutout_white_bg.py"), rawAbs, cutAbs]);
        },
      });
    }
  }

  if (jobs.length === 0) {
    console.log("todas las imágenes ya existen, se reutilizan");
    return;
  }
  console.log(`generando ${jobs.length} imagen(es) con kie.ai...`);
  await runPool(jobs);
}
