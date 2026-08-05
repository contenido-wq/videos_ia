import { Audio, Img, staticFile, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { loadFont } from "@remotion/google-fonts/Poppins";
import type { RenderedScene } from "../types/guion";

const { fontFamily } = loadFont("normal", { weights: ["700", "800"] });

// Entradas rápidas: imagen y subtítulo aparecen en ~0.2s.
const ENTRANCE_FRAMES = 6;
// Corte interno rápido entre imágenes de una misma escena (~0.2s).
const CUT_TRANSITION_FRAMES = 6;

interface Motion {
  floatY: number;
  breathe: number;
  swayDeg: number;
}

// Flotación + respiración + balanceo continuos, para que personaje y logos
// se sientan vivos en vez de una foto fija.
function useMotion(frame: number, fps: number, { floatAmp = 14, breatheAmp = 0.018, swayAmp = 1.6 } = {}): Motion {
  const t = frame / fps;
  const floatY = Math.sin(t * Math.PI * 2 * 0.35) * floatAmp;
  const breathe = 1 + Math.sin(t * Math.PI * 2 * 0.5) * breatheAmp;
  const swayDeg = Math.sin(t * Math.PI * 2 * 0.22) * swayAmp;
  return { floatY, breathe, swayDeg };
}

const LogoCard: React.FC<{ scene: RenderedScene }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  let cursorSeconds = 0;
  const cuts = scene.images.map((image) => {
    const startFrame = Math.round(cursorSeconds * fps);
    cursorSeconds += image.durationInSeconds;
    const endFrame = Math.round(cursorSeconds * fps);
    return { ...image, startFrame, endFrame };
  });

  const entrance = spring({ frame, fps, config: { damping: 13, stiffness: 200, mass: 0.7 }, durationInFrames: ENTRANCE_FRAMES + 4 });
  const { floatY, breathe, swayDeg } = useMotion(frame, fps, { floatAmp: 10, breatheAmp: 0.03, swayAmp: 2.2 });
  const glowPulse = 1 + Math.sin((frame / fps) * Math.PI * 2 * 0.6) * 0.12;

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black">
      <div
        className="absolute h-[46%] w-[70%] rounded-full"
        style={{
          background: "radial-gradient(circle, rgba(255,138,61,0.55) 0%, rgba(255,138,61,0) 70%)",
          transform: `scale(${glowPulse})`,
          filter: "blur(4px)",
        }}
      />

      {cuts.map((cut, i) => {
        const localFrame = frame - cut.startFrame;
        const cutEntrance = spring({
          frame: localFrame,
          fps,
          config: { damping: 13, stiffness: 200, mass: 0.6 },
          durationInFrames: CUT_TRANSITION_FRAMES + 4,
        });

        let opacity = 1;
        if (i > 0) {
          opacity = Math.min(
            opacity,
            interpolate(frame, [cut.startFrame, cut.startFrame + CUT_TRANSITION_FRAMES], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          );
        }
        if (i < cuts.length - 1) {
          opacity = Math.min(
            opacity,
            interpolate(frame, [cut.endFrame - CUT_TRANSITION_FRAMES, cut.endFrame], [1, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          );
        }

        return (
          <div
            key={cut.path}
            className="absolute flex items-center justify-center rounded-[36px] bg-[#f7f4ee] shadow-2xl"
            style={{
              width: "62%",
              padding: "48px",
              opacity: opacity * entrance,
              transform: `translateY(${floatY}px) scale(${(0.85 + entrance * 0.15) * breathe * cutEntrance}) rotate(${swayDeg}deg)`,
              boxShadow: "0 30px 60px rgba(0,0,0,0.5), 0 0 40px rgba(255,138,61,0.25)",
            }}
          >
            <Img src={staticFile(cut.path)} className="w-full object-contain" />
          </div>
        );
      })}
    </div>
  );
};

// Cada imagen de la escena (sea IA, foto real o toma de personaje) se sostiene
// durante su propia duración y solo cambia con un corte breve en el límite
// exacto: dos imágenes generadas o elegidas por separado casi nunca quedan
// alineadas píxel a píxel, así que mezclarlas por mucho tiempo se ve como un
// "fantasma" doble en vez de movimiento.
const FullBleedVisual: React.FC<{ scene: RenderedScene }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const isCharacter = scene.imageSource === "character";

  let cursorSeconds = 0;
  const cuts = scene.images.map((image) => {
    const startFrame = Math.round(cursorSeconds * fps);
    cursorSeconds += image.durationInSeconds;
    const endFrame = Math.round(cursorSeconds * fps);
    return { ...image, startFrame, endFrame };
  });

  const { floatY, breathe, swayDeg } = useMotion(
    frame,
    fps,
    isCharacter ? undefined : { floatAmp: 6, breatheAmp: 0.01, swayAmp: 0.6 },
  );

  return (
    <>
      {cuts.map((cut, i) => {
        const localFrame = frame - cut.startFrame;
        const cutSpring = spring({
          frame: localFrame,
          fps,
          config: { damping: 14, stiffness: 220, mass: 0.6 },
          durationInFrames: CUT_TRANSITION_FRAMES,
        });
        const cutFrames = Math.max(cut.endFrame - cut.startFrame, 1);
        const kenburns = 1 + (localFrame / cutFrames) * 0.06;
        const scale = (0.94 + cutSpring * 0.06) * kenburns * breathe;

        let opacity = 1;
        if (i > 0) {
          opacity = Math.min(
            opacity,
            interpolate(frame, [cut.startFrame, cut.startFrame + CUT_TRANSITION_FRAMES], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          );
        }
        if (i < cuts.length - 1) {
          opacity = Math.min(
            opacity,
            interpolate(frame, [cut.endFrame - CUT_TRANSITION_FRAMES, cut.endFrame], [1, 0], {
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
            style={{
              transform: `translateY(${floatY}px) scale(${scale}) rotate(${swayDeg}deg)`,
              opacity,
            }}
          />
        );
      })}
    </>
  );
};

export const Scene: React.FC<{ scene: RenderedScene }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const isLogo = scene.imageSource === "real" && scene.logo;

  const captionEntrance = spring({
    frame: frame - 2,
    fps,
    config: { damping: 12, stiffness: 260, mass: 0.5 },
    durationInFrames: ENTRANCE_FRAMES,
  });

  return (
    <div className="absolute inset-0 overflow-hidden bg-black">
      {isLogo ? <LogoCard scene={scene} /> : <FullBleedVisual scene={scene} />}

      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-black/40" />

      <div
        className="absolute inset-x-0 bottom-[9%] flex justify-center px-10"
        style={{
          opacity: captionEntrance,
          transform: `translateY(${(1 - captionEntrance) * 24}px) scale(${0.9 + captionEntrance * 0.1})`,
        }}
      >
        <p
          className="text-center text-white"
          style={{
            fontFamily,
            fontWeight: 800,
            fontSize: 54,
            lineHeight: 1.15,
            textShadow: "0 2px 18px rgba(0,0,0,0.65)",
          }}
        >
          {scene.text}
        </p>
      </div>

      <Audio src={staticFile(scene.audioPath)} />
      {scene.sfxPath && <Audio src={staticFile(scene.sfxPath)} volume={0.5} />}
    </div>
  );
};
