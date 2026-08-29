import { AbsoluteFill, Img, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import type { RenderedYoutubeNoticiasAvatarGuion, RenderedYoutubeNoticiasAvatarScene, CaptionChunk } from "../types/guion";

const CUT_TRANSITION_FRAMES = 6;

function findActiveScene(
  scenes: RenderedYoutubeNoticiasAvatarScene[],
  fps: number,
  frame: number,
): { scene: RenderedYoutubeNoticiasAvatarScene; sceneStartFrame: number } | null {
  let cursorSeconds = 0;
  for (const scene of scenes) {
    const sceneStartFrame = Math.round(cursorSeconds * fps);
    cursorSeconds += scene.durationInSeconds;
    const sceneEndFrame = Math.round(cursorSeconds * fps);
    if (frame >= sceneStartFrame && frame < sceneEndFrame) {
      return { scene, sceneStartFrame };
    }
  }
  return scenes.length > 0 ? { scene: scenes[scenes.length - 1], sceneStartFrame: 0 } : null;
}

function findActiveChunk(chunks: CaptionChunk[], currentSeconds: number): CaptionChunk | null {
  for (const chunk of chunks) {
    if (currentSeconds >= chunk.startSeconds && currentSeconds < chunk.endSeconds) {
      return chunk;
    }
  }
  return null;
}

// Mismo algoritmo de ciclado por duración con crossfade que SceneIllustration
// en components/PantallaDividida.tsx, adaptado a este layout (panel izquierdo
// en vez de mitad superior).
const BackgroundIllustration: React.FC<{ scene: RenderedYoutubeNoticiasAvatarScene; localFrame: number; fps: number }> = ({
  scene,
  localFrame,
  fps,
}) => {
  let cursorSeconds = 0;
  const cuts = scene.images.map((image) => {
    const startFrame = Math.round(cursorSeconds * fps);
    cursorSeconds += image.durationInSeconds;
    const endFrame = Math.round(cursorSeconds * fps);
    return { ...image, startFrame, endFrame };
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
            key={cut.path}
            src={staticFile(cut.path)}
            className="absolute inset-0 h-full w-full object-cover"
            style={{ opacity }}
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
      <p className="text-center uppercase" style={{ fontWeight: 800, fontSize: 56, lineHeight: 1.2 }}>
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

export const YoutubeNoticiasAvatar: React.FC<{ slug: string; guion: RenderedYoutubeNoticiasAvatarGuion | null }> = ({
  guion,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  if (!guion) return null;

  const active = findActiveScene(guion.scenes, fps, frame);
  const localFrame = active ? frame - active.sceneStartFrame : 0;
  const currentSeconds = frame / fps;
  const activeChunk = findActiveChunk(guion.captionChunks, currentSeconds);

  return (
    <AbsoluteFill className="bg-black">
      <div className="absolute inset-0 overflow-hidden" style={{ right: "38%" }}>
        {active && <BackgroundIllustration scene={active.scene} localFrame={localFrame} fps={fps} />}
        {activeChunk && <WordHighlightCaption chunk={activeChunk} currentSeconds={currentSeconds} />}
        {guion.subscribeButton && (
          <Img
            src={staticFile("assets/youtube-noticias-avatar/subscribe-button.png")}
            className="absolute left-8 top-8"
            style={{ width: 220 }}
          />
        )}
      </div>

      <div className="absolute inset-0 overflow-hidden" style={{ left: "62%" }}>
        <OffthreadVideo src={staticFile(guion.videoPath)} className="absolute inset-0 h-full w-full object-cover" />
      </div>
    </AbsoluteFill>
  );
};
