import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/Inter";
import { speakerScaleAt } from "../services/cortesDocumentalTiming";
import type {
  CaptionChunk,
  RenderedCortesDocumentalCutaway,
  RenderedCortesDocumentalGuion,
  RenderedCortesDocumentalTitle,
} from "../types/guion";

const { fontFamily } = loadFont("normal", { weights: ["800", "900"] });

// Salida de un corte normal: casi seca (la entrada lleva el efecto).
const EXIT_FADE_FRAMES = 4;
// Zoom lento tipo Ken Burns dentro de cada corte; alterna dirección por corte.
const ZOOM_SCALE_DELTA = 0.08;
// Los jump cuts del presentador pivotan cerca de la cara, no del centro.
const SPEAKER_ORIGIN = "50% 28%";
const ENTRY_FRAMES = 10;
const CLOSING_FADE_SECONDS = 1.4;
const MUSIC_FADE_IN_SECONDS = 1.2;
const MUSIC_FADE_OUT_SECONDS = 2.5;

// Los SFX generados vienen tan fuertes como la voz (~-12 LUFS): se bajan para que no la tapen ni saturen al sumarse.
const WHOOSH_VOLUME = 0.35;
const WHOOSH_EXIT_VOLUME = 0.2;
const HIT_VOLUME = 0.3;

// Una pausa corta entre dos bloques no deja la pantalla sin subtítulo: el bloque se sostiene
// hasta que arranca el siguiente, con un máximo de HOLD_SECONDS.
const HOLD_SECONDS = 0.35;

function findActive<T extends { startSeconds: number; durationInSeconds: number }>(items: T[], seconds: number): T | null {
  return items.find((item) => seconds >= item.startSeconds && seconds < item.startSeconds + item.durationInSeconds) ?? null;
}

function findActiveChunk(chunks: CaptionChunk[], seconds: number): CaptionChunk | null {
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const next = chunks[i + 1];
    const holdUntil = chunk.endSeconds + Math.min(HOLD_SECONDS, next ? next.startSeconds - chunk.endSeconds : HOLD_SECONDS);
    if (seconds >= chunk.startSeconds && seconds < holdUntil) return chunk;
  }
  return null;
}

const Cutaway: React.FC<{ cutaway: RenderedCortesDocumentalCutaway; index: number; frame: number; fps: number }> = ({
  cutaway,
  index,
  frame,
  fps,
}) => {
  const startFrame = Math.round(cutaway.startSeconds * fps);
  const endFrame = Math.round((cutaway.startSeconds + cutaway.durationInSeconds) * fps);
  const local = frame - startFrame;
  const ease = Easing.out(Easing.cubic);

  const zoomIn = index % 2 === 0;
  const kenBurns = interpolate(local, [0, endFrame - startFrame], zoomIn ? [1, 1 + ZOOM_SCALE_DELTA] : [1 + ZOOM_SCALE_DELTA, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  let opacity = cutaway.closing
    ? 1
    : interpolate(frame, [endFrame - EXIT_FADE_FRAMES, endFrame], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  let entryScale = 1;
  let translateX = 0;
  let blur = 0;

  if (cutaway.transition === "flash") {
    entryScale = interpolate(local, [0, ENTRY_FRAMES], [1.14, 1], { extrapolateRight: "clamp", easing: ease });
  } else if (cutaway.transition === "slide") {
    translateX = interpolate(local, [0, 9], [100, 0], { extrapolateRight: "clamp", easing: ease });
  } else {
    entryScale = interpolate(local, [0, ENTRY_FRAMES], [1.4, 1], { extrapolateRight: "clamp", easing: ease });
    blur = interpolate(local, [0, ENTRY_FRAMES], [18, 0], { extrapolateRight: "clamp", easing: ease });
    opacity = Math.min(opacity, interpolate(local, [0, 3], [0, 1], { extrapolateRight: "clamp" }));
  }

  // Overlays que "empujan" la entrada: destello blanco + barrido de luz cálida (flash),
  // y borde de sombra que acompaña al deslizamiento (slide).
  const flashOpacity = cutaway.transition === "flash" ? interpolate(local, [0, 7], [0.85, 0], { extrapolateRight: "clamp" }) : 0;
  const leakX = interpolate(local, [0, 12], [-110, 110], { extrapolateRight: "clamp" });
  const leakOpacity = cutaway.transition === "flash" ? interpolate(local, [0, 12], [0.9, 0], { extrapolateRight: "clamp" }) : 0;
  const edgeOpacity = cutaway.transition === "slide" ? interpolate(local, [0, 9], [0.7, 0], { extrapolateRight: "clamp" }) : 0;

  return (
    <AbsoluteFill style={{ opacity, overflow: "hidden" }}>
      <Img
        src={staticFile(cutaway.imagePath)}
        className="absolute inset-0 h-full w-full object-cover"
        style={{
          transform: `translateX(${translateX}%) scale(${kenBurns * entryScale})`,
          filter: blur > 0.1 ? `blur(${blur}px)` : undefined,
        }}
      />
      {edgeOpacity > 0 && (
        <div
          className="absolute inset-y-0"
          style={{
            left: `${translateX}%`,
            width: 140,
            transform: "translateX(-100%)",
            background: "linear-gradient(to left, rgba(0,0,0,0.75), rgba(0,0,0,0))",
            opacity: edgeOpacity,
          }}
        />
      )}
      {leakOpacity > 0 && (
        <div
          className="absolute inset-0"
          style={{
            transform: `translateX(${leakX}%)`,
            opacity: leakOpacity,
            mixBlendMode: "screen",
            background: "linear-gradient(105deg, rgba(255,120,30,0) 20%, rgba(255,160,60,0.8) 50%, rgba(255,235,200,0) 80%)",
          }}
        />
      )}
      {flashOpacity > 0 && <AbsoluteFill style={{ backgroundColor: "white", opacity: flashOpacity }} />}
    </AbsoluteFill>
  );
};

// Subtítulos: 1–3 palabras, blancas, letra apretada y sombra suave, a media altura.
const Subtitle: React.FC<{ chunk: CaptionChunk }> = ({ chunk }) => (
  <div className="absolute inset-x-0 flex justify-center px-10" style={{ top: "58%" }}>
    <p
      className="text-center text-white"
      style={{
        fontFamily,
        fontWeight: 800,
        fontSize: 72,
        lineHeight: 1.1,
        letterSpacing: "-0.05em",
        textShadow: "0 2px 16px rgba(0,0,0,0.7), 0 0 4px rgba(0,0,0,0.5)",
      }}
    >
      {chunk.words.map((w) => w.text).join(" ")}
    </p>
  </div>
);

const TitleCard: React.FC<{ title: RenderedCortesDocumentalTitle; frame: number; fps: number }> = ({ title, frame, fps }) => {
  const startFrame = Math.round(title.startSeconds * fps);
  const entrance = spring({ frame: frame - startFrame, fps, config: { damping: 14, stiffness: 220, mass: 0.6 } });

  return (
    <div
      className="absolute inset-x-0 flex flex-col items-center justify-center px-8"
      style={{ top: "52%", opacity: entrance, transform: `translateY(${(1 - entrance) * 24}px)` }}
    >
      {title.kicker && (
        <p
          className="text-white"
          style={{ fontFamily, fontWeight: 800, fontSize: 44, letterSpacing: "-0.04em", textShadow: "0 2px 16px rgba(0,0,0,0.7)" }}
        >
          {title.kicker}
        </p>
      )}
      <p
        className="text-center text-white"
        style={{
          fontFamily,
          fontWeight: 900,
          fontSize: 150,
          lineHeight: 0.95,
          letterSpacing: "-0.06em",
          textShadow: "0 4px 28px rgba(0,0,0,0.75)",
        }}
      >
        {title.headline}
      </p>
    </div>
  );
};

export const CortesDocumental: React.FC<{ slug: string; guion: RenderedCortesDocumentalGuion | null }> = ({ guion }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  if (!guion) return null;

  const seconds = frame / fps;
  const videoFrames = Math.ceil(guion.durationInSeconds * fps);
  const activeTitle = findActive(guion.titles, seconds);
  const activeChunk = findActiveChunk(guion.captionChunks, seconds);
  const speakerScale = speakerScaleAt(guion.jumpCuts, seconds);

  // Los fades de entrada y salida ocurren dentro de la ventana del corte, así que basta con
  // montar los cortes cuya ventana incluye el momento actual.
  const visibleCutaways = guion.cutaways
    .map((cutaway, index) => ({ cutaway, index }))
    .filter(({ cutaway }) => seconds >= cutaway.startSeconds && seconds < cutaway.startSeconds + cutaway.durationInSeconds);

  const closingFadeFrames = Math.round(CLOSING_FADE_SECONDS * fps);
  const blackOpacity = guion.outroSeconds > 0
    ? interpolate(frame, [durationInFrames - closingFadeFrames, durationInFrames], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 0;

  const musicVolume = (f: number) => {
    const base = guion.music?.volume ?? 0;
    return Math.min(
      interpolate(f, [0, Math.round(MUSIC_FADE_IN_SECONDS * fps)], [0, base], { extrapolateRight: "clamp" }),
      interpolate(f, [durationInFrames - Math.round(MUSIC_FADE_OUT_SECONDS * fps), durationInFrames], [base, 0], {
        extrapolateLeft: "clamp",
      }),
    );
  };

  return (
    <AbsoluteFill className="bg-black">
      <Sequence durationInFrames={videoFrames} layout="none">
        <AbsoluteFill style={{ overflow: "hidden" }}>
          <OffthreadVideo
            src={staticFile(guion.videoPath)}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              transform: `scale(${speakerScale})`,
              transformOrigin: SPEAKER_ORIGIN,
            }}
          />
        </AbsoluteFill>
      </Sequence>

      {visibleCutaways.map(({ cutaway, index }) => (
        <Cutaway key={cutaway.id} cutaway={cutaway} index={index} frame={frame} fps={fps} />
      ))}

      {activeTitle ? (
        <TitleCard title={activeTitle} frame={frame} fps={fps} />
      ) : (
        activeChunk && <Subtitle chunk={activeChunk} />
      )}

      {blackOpacity > 0 && <AbsoluteFill style={{ backgroundColor: "black", opacity: blackOpacity }} />}

      {guion.music && (
        <Sequence durationInFrames={durationInFrames} layout="none">
          <Audio src={staticFile(guion.music.path)} volume={musicVolume} loop />
        </Sequence>
      )}

      {guion.cutaways.map((cutaway) => {
        const from = Math.round(cutaway.startSeconds * fps);
        const entryPath = cutaway.closing ? guion.sfx.hitPath : guion.sfx.whooshPath;
        const entryVolume = cutaway.closing ? HIT_VOLUME : WHOOSH_VOLUME;
        const entryFrames = Math.round((cutaway.closing ? guion.sfx.hitDurationInSeconds : guion.sfx.whooshDurationInSeconds) * fps);
        return (
          <Sequence key={`sfx-${cutaway.id}`} from={from} durationInFrames={entryFrames} layout="none">
            <Audio src={staticFile(entryPath)} volume={() => entryVolume} />
          </Sequence>
        );
      })}

      {guion.cutaways
        .filter((cutaway) => !cutaway.closing)
        .map((cutaway) => (
          <Sequence
            key={`sfx-exit-${cutaway.id}`}
            from={Math.round((cutaway.startSeconds + cutaway.durationInSeconds) * fps)}
            durationInFrames={Math.round(guion.sfx.whooshDurationInSeconds * fps)}
            layout="none"
          >
            <Audio src={staticFile(guion.sfx.whooshPath)} volume={() => WHOOSH_EXIT_VOLUME} />
          </Sequence>
        ))}

      {guion.titles.map((title) => (
        <Sequence
          key={`hit-${title.id}`}
          from={Math.round(title.startSeconds * fps)}
          durationInFrames={Math.round(guion.sfx.hitDurationInSeconds * fps)}
          layout="none"
        >
          <Audio src={staticFile(guion.sfx.hitPath)} volume={() => HIT_VOLUME} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
