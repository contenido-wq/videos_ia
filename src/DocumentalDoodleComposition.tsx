import { CalculateMetadataFunction, Composition, staticFile } from "remotion";
import { DocumentalDoodle } from "./components/DocumentalDoodle";
import type { RenderedDocumentalDoodleGuion } from "./types/guion";

const FPS = 30;
const WIDTH = 1920;
const HEIGHT = 1080;

type Props = { slug: string; guion: RenderedDocumentalDoodleGuion | null };

async function loadGuion(slug: string): Promise<RenderedDocumentalDoodleGuion> {
  const response = await fetch(staticFile(`data/${slug}.json`));
  return (await response.json()) as RenderedDocumentalDoodleGuion;
}

const calculateMetadata: CalculateMetadataFunction<Props> = async ({ props }) => {
  const guion = await loadGuion(props.slug);
  const durationInFrames = Math.ceil(guion.durationInSeconds * FPS);

  return {
    props: { ...props, guion },
    durationInFrames: Math.max(durationInFrames, FPS),
  };
};

export const DocumentalDoodleComposition: React.FC<{ id: string; slug: string }> = ({ id, slug }) => {
  return (
    <Composition
      id={id}
      component={DocumentalDoodle}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      durationInFrames={FPS * 10}
      defaultProps={{ slug, guion: null }}
      calculateMetadata={calculateMetadata}
    />
  );
};
