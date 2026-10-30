import { CalculateMetadataFunction, Composition, staticFile } from "remotion";
import { CortesDocumental } from "./components/CortesDocumental";
import type { RenderedCortesDocumentalGuion } from "./types/guion";

const FPS = 30;
const WIDTH = 1080;
const HEIGHT = 1920;

type Props = { slug: string; guion: RenderedCortesDocumentalGuion | null };

async function loadGuion(slug: string): Promise<RenderedCortesDocumentalGuion> {
  const response = await fetch(staticFile(`data/${slug}.json`));
  return (await response.json()) as RenderedCortesDocumentalGuion;
}

const calculateMetadata: CalculateMetadataFunction<Props> = async ({ props }) => {
  const guion = await loadGuion(props.slug);
  const durationInFrames = Math.ceil((guion.durationInSeconds + (guion.outroSeconds ?? 0)) * FPS);

  return {
    props: { ...props, guion },
    durationInFrames: Math.max(durationInFrames, FPS),
  };
};

export const CortesDocumentalComposition: React.FC<{ id: string; slug: string }> = ({ id, slug }) => {
  return (
    <Composition
      id={id}
      component={CortesDocumental}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      durationInFrames={FPS * 10}
      defaultProps={{ slug, guion: null }}
      calculateMetadata={calculateMetadata}
    />
  );
};
