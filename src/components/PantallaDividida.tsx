import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/Poppins";
import { computeActTwoStartFrame } from "../services/pantallaDivididaTiming";
import type { RenderedPantallaDivididaGuion, RenderedPantallaDivididaScene } from "../types/guion";

const { fontFamily } = loadFont("normal", { weights: ["700", "800"] });

const ENTRANCE_FRAMES = 6;
const CUT_TRANSITION_FRAMES = 6;
// Zoom sutil y continuo sobre el presentador durante todo el cierre.
const CLOSING_ZOOM_MAX_SCALE = 1.06;
// Música de fondo: nunca arranca ni corta seco.
const MUSIC_VOLUME = 0.15;
const MUSIC_FADE_IN_FRAMES = 20;
const MUSIC_FADE_OUT_FRAMES = 45;

function findActiveScene(
  scenes: RenderedPantallaDivididaScene[],
  fps: number,
  frame: number,
): { scene: RenderedPantallaDivididaScene; sceneStartFrame: number } | null {
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

// Mismo algoritmo de ciclado por duración con crossfade que FullBleedVisual
// en components/Scene.tsx, adaptado a frame local de la escena activa (no
// hay TransitionSeries acá: el video de abajo es continuo).
const SceneIllustration: React.FC<{ scene: RenderedPantallaDivididaScene; localFrame: number; fps: number }> = ({
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

const Caption: React.FC<{ text: string; localFrame: number; fps: number; variant: "bar" | "overlay" }> = ({
  text,
  localFrame,
  fps,
  variant,
}) => {
  const entrance = spring({
    frame: localFrame - 2,
    fps,
    config: { damping: 12, stiffness: 260, mass: 0.5 },
    durationInFrames: ENTRANCE_FRAMES,
  });

  if (variant === "bar") {
    return (
      <div className="absolute inset-x-0 bottom-0 flex justify-center bg-black px-8 py-6" style={{ opacity: entrance }}>
        <p className="text-center text-white" style={{ fontFamily, fontWeight: 700, fontSize: 34, lineHeight: 1.2 }}>
          {text}
        </p>
      </div>
    );
  }

  return (
    <div className="absolute inset-x-0 flex justify-center px-10" style={{ top: "64%", opacity: entrance }}>
      <p
        className="text-center text-white"
        style={{ fontFamily, fontWeight: 800, fontSize: 64, lineHeight: 1.2, textShadow: "0 2px 18px rgba(0,0,0,0.65)" }}
      >
        {text}
      </p>
    </div>
  );
};

export const PantallaDividida: React.FC<{ slug: string; guion: RenderedPantallaDivididaGuion | null }> = ({ guion }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  if (!guion) return null;

  const active = findActiveScene(guion.scenes, fps, frame);
  const isSplit = active?.scene.act === "split";
  const localFrame = active ? frame - active.sceneStartFrame : 0;

  const closingProgress =
    active && !isSplit ? Math.min(localFrame / (active.scene.durationInSeconds * fps), 1) : 0;
  const videoScale = 1 + (CLOSING_ZOOM_MAX_SCALE - 1) * closingProgress;

  const actTwoStartFrame = computeActTwoStartFrame(guion.scenes, fps);
  const stingDurationInFrames = Math.round(guion.sfx.stingDurationInSeconds * fps);

  return (
    <AbsoluteFill className="bg-black">
      <div className="absolute inset-x-0 overflow-hidden" style={isSplit ? { bottom: 0, height: "50%" } : { inset: 0 }}>
        <OffthreadVideo
          src={staticFile(guion.videoPath)}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `scale(${videoScale})`,
          }}
        />
      </div>

      {active && isSplit && (
        <div className="absolute inset-x-0 top-0 overflow-hidden" style={{ height: "50%" }}>
          <SceneIllustration scene={active.scene} localFrame={localFrame} fps={fps} />
          <Caption text={active.scene.displayText} localFrame={localFrame} fps={fps} variant="bar" />
        </div>
      )}

      {active && !isSplit && (
        <Caption text={active.scene.displayText} localFrame={localFrame} fps={fps} variant="overlay" />
      )}

      <Sequence durationInFrames={durationInFrames} layout="none">
        <Audio
          src={staticFile(guion.sfx.backgroundMusicPath)}
          volume={(f) =>
            Math.min(
              interpolate(f, [0, MUSIC_FADE_IN_FRAMES], [0, MUSIC_VOLUME], { extrapolateRight: "clamp" }),
              interpolate(f, [durationInFrames - MUSIC_FADE_OUT_FRAMES, durationInFrames], [MUSIC_VOLUME, 0], {
                extrapolateLeft: "clamp",
              }),
            )
          }
        />
      </Sequence>

      <Sequence from={actTwoStartFrame} durationInFrames={stingDurationInFrames} layout="none">
        <Audio src={staticFile(guion.sfx.stingPath)} volume={0.5} />
      </Sequence>
    </AbsoluteFill>
  );
};
