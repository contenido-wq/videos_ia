import { CalculateMetadataFunction, Composition, staticFile } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { slide } from "@remotion/transitions/slide";
import { Scene } from "./components/Scene";
import { CollageScene } from "./components/CollageScene";
import type { RenderedGuion } from "./types/guion";

const FPS = 30;
const WIDTH = 1080;
const HEIGHT = 1920;

// Corte rápido y dinámico entre escenas (~0.27s), como pide el estilo documental de redes.
const TRANSITION_FRAMES = 8;

type Props = { slug: string; guion: RenderedGuion | null };

async function loadGuion(slug: string): Promise<RenderedGuion> {
  const response = await fetch(staticFile(`data/${slug}.json`));
  return (await response.json()) as RenderedGuion;
}

const calculateMetadata: CalculateMetadataFunction<Props> = async ({ props }) => {
  const guion = await loadGuion(props.slug);
  const totalSeconds = guion.scenes.reduce((acc, s) => acc + s.durationInSeconds, 0);
  const transitionsOverlapFrames = TRANSITION_FRAMES * Math.max(guion.scenes.length - 1, 0);
  const durationInFrames = Math.ceil(totalSeconds * FPS) - transitionsOverlapFrames;

  return {
    props: { ...props, guion },
    durationInFrames: Math.max(durationInFrames, FPS),
  };
};

export const DocumentalVideo: React.FC<Props> = ({ guion }) => {
  if (!guion) return null;

  const elements = guion.scenes.flatMap((scene, i) => {
    const sequence = (
      <TransitionSeries.Sequence
        key={scene.id}
        durationInFrames={Math.round(scene.durationInSeconds * FPS)}
      >
        {guion.style === "collage" ? <CollageScene scene={scene} /> : <Scene scene={scene} />}
      </TransitionSeries.Sequence>
    );

    if (i === guion.scenes.length - 1) {
      return [sequence];
    }

    const transition = (
      <TransitionSeries.Transition
        key={`${scene.id}-transition`}
        presentation={slide({ direction: "from-right" })}
        timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
      />
    );

    return [sequence, transition];
  });

  return <TransitionSeries>{elements}</TransitionSeries>;
};

export const DocumentalComposition: React.FC<{ id: string; slug: string }> = ({ id, slug }) => {
  return (
    <Composition
      id={id}
      component={DocumentalVideo}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      durationInFrames={FPS * 10}
      defaultProps={{ slug, guion: null }}
      calculateMetadata={calculateMetadata}
    />
  );
};
