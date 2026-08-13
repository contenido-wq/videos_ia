import { CalculateMetadataFunction, Composition, staticFile } from "remotion";
import { PantallaDividida } from "./components/PantallaDividida";
import type { RenderedPantallaDivididaGuion } from "./types/guion";

const FPS = 30;
const WIDTH = 1080;
const HEIGHT = 1920;

type Props = { slug: string; guion: RenderedPantallaDivididaGuion | null };

async function loadGuion(slug: string): Promise<RenderedPantallaDivididaGuion> {
  const response = await fetch(staticFile(`data/${slug}.json`));
  return (await response.json()) as RenderedPantallaDivididaGuion;
}

const calculateMetadata: CalculateMetadataFunction<Props> = async ({ props }) => {
  const guion = await loadGuion(props.slug);
  const durationInFrames = Math.ceil(guion.durationInSeconds * FPS);

  return {
    props: { ...props, guion },
    durationInFrames: Math.max(durationInFrames, FPS),
  };
};

export const PantallaDivididaComposition: React.FC<{ id: string; slug: string }> = ({ id, slug }) => {
  return (
    <Composition
      id={id}
      component={PantallaDividida}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      durationInFrames={FPS * 10}
      defaultProps={{ slug, guion: null }}
      calculateMetadata={calculateMetadata}
    />
  );
};
