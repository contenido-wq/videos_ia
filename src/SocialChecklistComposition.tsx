import { CalculateMetadataFunction, Composition, staticFile } from "remotion";
import { SocialChecklist } from "./components/SocialChecklist";
import type { RenderedSocialChecklistGuion } from "./types/guion";

const FPS = 30;
const WIDTH = 1080;
const HEIGHT = 1920;

type Props = { slug: string; guion: RenderedSocialChecklistGuion | null };

async function loadGuion(slug: string): Promise<RenderedSocialChecklistGuion> {
  const response = await fetch(staticFile(`data/${slug}.json`));
  return (await response.json()) as RenderedSocialChecklistGuion;
}

const calculateMetadata: CalculateMetadataFunction<Props> = async ({ props }) => {
  const guion = await loadGuion(props.slug);
  const durationInFrames = Math.ceil(guion.durationInSeconds * FPS);

  return {
    props: { ...props, guion },
    durationInFrames: Math.max(durationInFrames, FPS),
  };
};

export const SocialChecklistComposition: React.FC<{ id: string; slug: string }> = ({ id, slug }) => {
  return (
    <Composition
      id={id}
      component={SocialChecklist}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      durationInFrames={FPS * 10}
      defaultProps={{ slug, guion: null }}
      calculateMetadata={calculateMetadata}
    />
  );
};
