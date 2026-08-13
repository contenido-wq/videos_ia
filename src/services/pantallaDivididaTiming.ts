import type { RenderedPantallaDivididaScene } from "../types/guion";

/** Frame absoluto de arranque de cada corte de imagen, juntando todas las
 * escenas "split" en orden (las escenas "closing" no aportan cortes). */
export function computeCutFrames(scenes: RenderedPantallaDivididaScene[], fps: number): number[] {
  const cutFrames: number[] = [];
  let sceneCursorSeconds = 0;

  for (const scene of scenes) {
    const sceneStartSeconds = sceneCursorSeconds;
    sceneCursorSeconds += scene.durationInSeconds;
    if (scene.act !== "split") continue;

    let cutCursorSeconds = 0;
    for (const image of scene.images) {
      const cutStartSeconds = sceneStartSeconds + cutCursorSeconds;
      cutFrames.push(Math.round(cutStartSeconds * fps));
      cutCursorSeconds += image.durationInSeconds;
    }
  }

  return cutFrames;
}

/** Frame absoluto donde arranca la primera escena "closing". Si no hay
 * ninguna, devuelve la duración total (en frames). */
export function computeActTwoStartFrame(scenes: RenderedPantallaDivididaScene[], fps: number): number {
  let cursorSeconds = 0;
  for (const scene of scenes) {
    if (scene.act === "closing") {
      return Math.round(cursorSeconds * fps);
    }
    cursorSeconds += scene.durationInSeconds;
  }
  return Math.round(cursorSeconds * fps);
}
