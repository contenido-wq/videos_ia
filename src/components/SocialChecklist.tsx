import { AbsoluteFill, Img, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig, spring } from "remotion";
import { loadFont } from "@remotion/google-fonts/Poppins";
import type { RenderedSocialChecklistGuion } from "../types/guion";

const { fontFamily } = loadFont("normal", { weights: ["800", "900"] });

const ITEM_ENTRANCE_FRAMES = 18;

const ChecklistRow: React.FC<{
  index: number;
  total: number;
  startFrame: number;
  logoPath: string;
}> = ({ index, total, startFrame, logoPath }) => {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();

  const topArea = height * 0.24;
  const bottomArea = height * 0.92;
  const rowHeight = (bottomArea - topArea) / total;
  const rowTop = topArea + rowHeight * index;

  const localFrame = frame - startFrame;
  const hasArrived = localFrame >= 0;
  const entrance = spring({
    frame: Math.max(localFrame, 0),
    fps,
    config: { damping: 12, stiffness: 140, mass: 0.9 },
    durationInFrames: ITEM_ENTRANCE_FRAMES,
  });

  return (
    <div className="absolute left-[6%] flex items-center gap-4" style={{ top: rowTop, height: rowHeight }}>
      <div
        className="flex items-center justify-center rounded-full bg-[#e5342b] text-white"
        style={{
          width: rowHeight * 0.72,
          height: rowHeight * 0.72,
          fontFamily,
          fontWeight: 900,
          fontSize: rowHeight * 0.36,
        }}
      >
        {index + 1}
      </div>
      <div
        className="flex items-center justify-center overflow-hidden rounded-2xl bg-white"
        style={{ width: rowHeight * 0.72, height: rowHeight * 0.72 }}
      >
        {hasArrived && (
          <Img
            src={staticFile(logoPath)}
            style={{
              width: "72%",
              height: "72%",
              objectFit: "contain",
              opacity: entrance,
              transform: `translateY(${(1 - entrance) * -40}px) scale(${0.6 + entrance * 0.4})`,
            }}
          />
        )}
      </div>
    </div>
  );
};

export const SocialChecklist: React.FC<{ slug: string; guion: RenderedSocialChecklistGuion | null }> = ({
  guion,
}) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();

  if (!guion) return null;

  const titleEntrance = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 200, mass: 0.6 },
    durationInFrames: 14,
  });

  return (
    <AbsoluteFill className="bg-black">
      <OffthreadVideo src={staticFile(guion.videoPath)} className="absolute inset-0 h-full w-full object-cover" />

      <div
        className="absolute left-[6%] right-[6%] top-[4%] rounded-2xl bg-white px-6 py-4"
        style={{
          opacity: titleEntrance,
          transform: `translateY(${(1 - titleEntrance) * -20}px)`,
        }}
      >
        <p className="text-center uppercase text-black" style={{ fontFamily, fontWeight: 800, fontSize: 44, lineHeight: 1.15 }}>
          {guion.listTitle}
        </p>
      </div>

      {guion.items.map((item, i) => (
        <ChecklistRow
          key={item.id}
          index={i}
          total={guion.items.length}
          startFrame={Math.round(item.startSeconds * fps)}
          logoPath={item.logoPath}
        />
      ))}
    </AbsoluteFill>
  );
};
