import { AbsoluteFill, Audio, Img, Sequence, staticFile, useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { loadFont } from "@remotion/google-fonts/Poppins";
import type { RenderedDocumentalDoodleGuion, RenderedDocumentalDoodleScene, CaptionChunk } from "../types/guion";

const { fontFamily } = loadFont("normal", { weights: ["800"] });

const CUT_TRANSITION_FRAMES = 6;
// Zoom sutil tipo Ken Burns, uno por ESCENA completa (no por corte) — mismo
// criterio que components/YoutubeNoticiasAvatar.tsx: si reiniciara el zoom
// en cada corte se vería como un salto en vez de un movimiento continuo.
// Alterna dirección (in/out) por escena para que no se sienta repetitivo.
const ZOOM_SCALE_DELTA = 0.04;

function findActiveScene(
  scenes: RenderedDocumentalDoodleScene[],
  fps: number,
  frame: number,
): { scene: RenderedDocumentalDoodleScene; sceneStartFrame: number; sceneIndex: number } | null {
  let cursorSeconds = 0;
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const sceneStartFrame = Math.round(cursorSeconds * fps);
    cursorSeconds += scene.durationInSeconds;
    const sceneEndFrame = Math.round(cursorSeconds * fps);
    if (frame >= sceneStartFrame && frame < sceneEndFrame) {
      return { scene, sceneStartFrame, sceneIndex: i };
    }
  }
  return scenes.length > 0 ? { scene: scenes[scenes.length - 1], sceneStartFrame: 0, sceneIndex: scenes.length - 1 } : null;
}

function findActiveChunk(chunks: CaptionChunk[], currentSeconds: number): CaptionChunk | null {
  for (const chunk of chunks) {
    if (currentSeconds >= chunk.startSeconds && currentSeconds < chunk.endSeconds) {
      return chunk;
    }
  }
  return null;
}

// Mismo algoritmo de ciclado con crossfade + Ken Burns que BackgroundIllustration
// en components/YoutubeNoticiasAvatar.tsx, adaptado a pantalla completa (no hay
// panel de avatar que le quite espacio a la imagen).
const SceneIllustration: React.FC<{
  scene: RenderedDocumentalDoodleScene;
  localFrame: number;
  fps: number;
  sceneIndex: number;
}> = ({ scene, localFrame, fps, sceneIndex }) => {
  let cursorSeconds = 0;
  const cuts = scene.images.map((image) => {
    const startFrame = Math.round(cursorSeconds * fps);
    cursorSeconds += image.durationInSeconds;
    const endFrame = Math.round(cursorSeconds * fps);
    return { ...image, startFrame, endFrame };
  });

  const sceneDurationFrames = Math.round(scene.durationInSeconds * fps);
  const zoomIn = sceneIndex % 2 === 0;
  const scale = interpolate(localFrame, [0, sceneDurationFrames], zoomIn ? [1, 1 + ZOOM_SCALE_DELTA] : [1 + ZOOM_SCALE_DELTA, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <>
      {cuts.map((cut, i) => {
        let opacity = 1;
        if (i > 0) {
          opacity = Math.min(
            opacity,
            interpolate(localFrame, [cut.startFrame, cut.startFrame + CUT_TRANSITION_FRAMES], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          );
        }
        if (i < cuts.length - 1) {
          opacity = Math.min(
            opacity,
            interpolate(localFrame, [cut.endFrame - CUT_TRANSITION_FRAMES, cut.endFrame], [1, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          );
        }

        return (
          <Img
            key={`${cut.path}-${i}`}
            src={staticFile(cut.path)}
            className="absolute inset-0 h-full w-full object-cover"
            style={{ opacity, transform: `scale(${scale})` }}
          />
        );
      })}
    </>
  );
};

const WordHighlightCaption: React.FC<{ chunk: CaptionChunk; currentSeconds: number }> = ({ chunk, currentSeconds }) => {
  let activeIndex = -1;
  chunk.words.forEach((word, i) => {
    if (word.start <= currentSeconds) activeIndex = i;
  });

  return (
    <div className="absolute inset-x-0 bottom-16 flex justify-center px-10">
      <p className="text-center uppercase" style={{ fontFamily, fontWeight: 800, fontSize: 56, lineHeight: 1.2 }}>
        {chunk.words.map((word, i) => (
          <span
            key={`${word.text}-${word.start}`}
            style={{
              color: i === activeIndex ? "#FFD400" : "#FFFFFF",
              WebkitTextStroke: "3px black",
              paintOrder: "stroke fill",
              marginRight: 14,
            }}
          >
            {word.text}
          </span>
        ))}
      </p>
    </div>
  );
};

export const DocumentalDoodle: React.FC<{ slug: string; guion: RenderedDocumentalDoodleGuion | null }> = ({ guion }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  if (!guion) return null;

  const active = findActiveScene(guion.scenes, fps, frame);
  const localFrame = active ? frame - active.sceneStartFrame : 0;
  const currentSeconds = frame / fps;
  const activeChunk = findActiveChunk(guion.captionChunks, currentSeconds);

  return (
    <AbsoluteFill className="bg-black">
      {active && (
        <>
          <SceneIllustration scene={active.scene} localFrame={localFrame} fps={fps} sceneIndex={active.sceneIndex} />
          {/* Sequence remapea el frame local a 0 en sceneStartFrame, así el Audio
              arranca desde el principio de SU propio archivo en vez de saltar a
              mitad del clip cuando la escena empieza en un frame > 0 del video. */}
          <Sequence
            key={active.scene.id}
            from={active.sceneStartFrame}
            durationInFrames={Math.round(active.scene.durationInSeconds * fps)}
          >
            <Audio src={staticFile(active.scene.audioPath)} />
          </Sequence>
        </>
      )}
      {activeChunk && <WordHighlightCaption chunk={activeChunk} currentSeconds={currentSeconds} />}
    </AbsoluteFill>
  );
};
