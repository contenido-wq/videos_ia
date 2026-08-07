import { AbsoluteFill, Img, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { loadFont } from "@remotion/google-fonts/Poppins";
import type { RenderedChecklistItem, RenderedSocialChecklistGuion } from "../types/guion";

const { fontFamily } = loadFont("normal", { weights: ["800", "900"] });

const REVEAL_HOLD_FRAMES = 30;
const TRANSITION_FRAMES = 10;
const ZOOM_SCALE = 1.08;

function getRowGeometry(index: number, total: number, width: number, height: number) {
  const topArea = height * 0.24;
  const bottomArea = height * 0.92;
  const rowHeight = (bottomArea - topArea) / total;
  const rowTop = topArea + rowHeight * index;
  const size = rowHeight * 0.72;
  const boxLeft = width * 0.06 + size + 16;
  return { centerX: boxLeft + size / 2, centerY: rowTop + size / 2, size };
}

function computeZoomScale(frame: number, fps: number, items: RenderedChecklistItem[]): number {
  for (const item of items) {
    const startFrame = Math.round(item.startSeconds * fps);
    const holdEndFrame = startFrame + REVEAL_HOLD_FRAMES;
    const windowEndFrame = holdEndFrame + TRANSITION_FRAMES;
    if (frame < startFrame || frame > windowEndFrame) continue;

    if (frame <= holdEndFrame) {
      const zoomIn = spring({
        frame: frame - startFrame,
        fps,
        config: { damping: 14, stiffness: 180, mass: 0.7 },
        durationInFrames: 10,
      });
      return 1 + (ZOOM_SCALE - 1) * zoomIn;
    }

    const zoomOut = interpolate(frame, [holdEndFrame, windowEndFrame], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    return 1 + (ZOOM_SCALE - 1) * zoomOut;
  }
  return 1;
}

const RevealCard: React.FC<{ item: RenderedChecklistItem; rowIndex: number; total: number }> = ({
  item,
  rowIndex,
  total,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const startFrame = Math.round(item.startSeconds * fps);
  const localFrame = frame - startFrame;
  const windowFrames = REVEAL_HOLD_FRAMES + TRANSITION_FRAMES;

  if (localFrame < 0 || localFrame > windowFrames) return null;

  const entrance = spring({
    frame: localFrame,
    fps,
    config: { damping: 14, stiffness: 200, mass: 0.6 },
    durationInFrames: 10,
  });

  const isTransitioning = localFrame > REVEAL_HOLD_FRAMES;
  const transitionProgress = isTransitioning
    ? interpolate(localFrame, [REVEAL_HOLD_FRAMES, windowFrames], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 0;

  const bigCenterX = width * 0.7;
  const bigCenterY = height * 0.45;
  const bigSize = width * 0.36;
  const target = getRowGeometry(rowIndex, total, width, height);

  const currentSize = bigSize + (target.size - bigSize) * transitionProgress;
  const currentCenterX = bigCenterX + (target.centerX - bigCenterX) * transitionProgress;
  const currentCenterY = bigCenterY + (target.centerY - bigCenterY) * transitionProgress;
  const cardOpacity = entrance * (1 - transitionProgress);

  return (
    <>
      {!isTransitioning && (
        <div
          className="absolute text-center text-white"
          style={{
            left: bigCenterX - bigSize * 0.7,
            width: bigSize * 1.4,
            top: bigCenterY - bigSize / 2 - 60,
            fontFamily,
            fontWeight: 800,
            fontSize: 40,
            opacity: entrance,
            textShadow: "0 2px 12px rgba(0,0,0,0.6)",
          }}
        >
          {rowIndex + 1}. {item.label}
        </div>
      )}
      <div
        className="absolute flex items-center justify-center rounded-2xl bg-white"
        style={{
          left: currentCenterX - currentSize / 2,
          top: currentCenterY - currentSize / 2,
          width: currentSize,
          height: currentSize,
          opacity: cardOpacity,
          transform: `scale(${0.7 + entrance * 0.3})`,
        }}
      >
        <Img src={staticFile(item.logoPath)} style={{ width: "72%", height: "72%", objectFit: "contain" }} />
      </div>
    </>
  );
};

const ChecklistRow: React.FC<{
  rowIndex: number;
  total: number;
  landFrame: number;
  logoPath: string;
}> = ({ rowIndex, total, landFrame, logoPath }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const geometry = getRowGeometry(rowIndex, total, width, height);

  const localFrame = frame - landFrame;
  const hasArrived = localFrame >= 0;
  const entrance = spring({
    frame: Math.max(localFrame, 0),
    fps,
    config: { damping: 12, stiffness: 140, mass: 0.9 },
    durationInFrames: 18,
  });

  return (
    <div
      className="absolute flex items-center justify-center rounded-full bg-[#e5342b] text-white"
      style={{
        left: width * 0.06,
        top: geometry.centerY - geometry.size / 2,
        width: geometry.size,
        height: geometry.size,
        fontFamily,
        fontWeight: 900,
        fontSize: geometry.size * 0.5,
      }}
    >
      {rowIndex + 1}
      <div
        className="absolute flex items-center justify-center overflow-hidden rounded-2xl bg-white"
        style={{
          left: geometry.size + 16,
          top: 0,
          width: geometry.size,
          height: geometry.size,
        }}
      >
        {hasArrived && (
          <Img
            src={staticFile(logoPath)}
            style={{
              width: "72%",
              height: "72%",
              objectFit: "contain",
              opacity: entrance,
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

  const zoomScale = computeZoomScale(frame, fps, guion.items);

  return (
    <AbsoluteFill className="bg-black">
      <OffthreadVideo
        src={staticFile(guion.videoPath)}
        className="absolute inset-0 h-full w-full object-cover"
        style={{ transform: `scale(${zoomScale})` }}
      />

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

      {guion.items.map((item) => (
        <ChecklistRow
          key={item.id}
          rowIndex={Number(item.id) - 1}
          total={guion.items.length}
          landFrame={Math.round(item.startSeconds * fps) + REVEAL_HOLD_FRAMES + TRANSITION_FRAMES}
          logoPath={item.logoPath}
        />
      ))}

      {guion.items.map((item) => (
        <RevealCard key={`reveal-${item.id}`} item={item} rowIndex={Number(item.id) - 1} total={guion.items.length} />
      ))}
    </AbsoluteFill>
  );
};
