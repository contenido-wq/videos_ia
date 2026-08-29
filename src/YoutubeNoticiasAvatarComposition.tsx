import { CalculateMetadataFunction, Composition, staticFile } from "remotion";
import { YoutubeNoticiasAvatar } from "./components/YoutubeNoticiasAvatar";
import type { RenderedYoutubeNoticiasAvatarGuion } from "./types/guion";

const FPS = 30;
const WIDTH = 1920;
const HEIGHT = 1080;

type Props = { slug: string; guion: RenderedYoutubeNoticiasAvatarGuion | null };

async function loadGuion(slug: string): Promise<RenderedYoutubeNoticiasAvatarGuion> {
  const response = await fetch(staticFile(`data/${slug}.json`));
  return (await response.json()) as RenderedYoutubeNoticiasAvatarGuion;
}

const calculateMetadata: CalculateMetadataFunction<Props> = async ({ props }) => {
  const guion = await loadGuion(props.slug);
  const durationInFrames = Math.ceil(guion.durationInSeconds * FPS);

  return {
    props: { ...props, guion },
    durationInFrames: Math.max(durationInFrames, FPS),
  };
};

export const YoutubeNoticiasAvatarComposition: React.FC<{ id: string; slug: string }> = ({ id, slug }) => {
  return (
    <Composition
      id={id}
      component={YoutubeNoticiasAvatar}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      durationInFrames={FPS * 10}
      defaultProps={{ slug, guion: null }}
      calculateMetadata={calculateMetadata}
    />
  );
};
