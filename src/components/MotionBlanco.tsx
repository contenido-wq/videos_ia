import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadSerif } from "@remotion/google-fonts/InstrumentSerif";
import type {
  CaptionChunk,
  RenderedMotionBlancoFront,
  RenderedMotionBlancoGuion,
  RenderedMotionBlancoScene,
} from "../types/guion";

const { fontFamily: inter } = loadInter("normal", { weights: ["600", "700", "800"], subsets: ["latin"] });
const { fontFamily: serif } = loadSerif("normal", { weights: ["400"], subsets: ["latin"] });

const INK = "#1C1B1A";
const ACCENT = "#E8662A";
const CARD_SHADOW = "0 18px 50px rgba(0,0,0,0.28), 0 2px 8px rgba(0,0,0,0.18)";

const SPEAKER_ORIGIN = "50% 28%";
// En la pantalla dividida se baja el video para que la cara quede en la mitad de abajo.
const SPLIT_VIDEO_SHIFT = "34%";
const HOLD_SECONDS = 0.35;
const WHOOSH_VOLUME = 0.22;
const POP_VOLUME = 0.08;
const MUSIC_FADE_SECONDS = 1.5;

// Parallax: cuánto recorre cada capa a lo largo de la escena (px). El frente va más rápido que el fondo.
const PARALLAX_BG = 36;
const PARALLAX_MID = 90;
const PARALLAX_FRONT = 150;
const PARALLAX_DUST = 240;
// Micromovimiento constante (px de amplitud) para que nada quede congelado mientras la escena "espera".
const MICRO_BG = 6;
const MICRO_MID = 10;
const MICRO_FRONT = 5;
// Zoom lento del presentador dentro de cada encuadre, para que el plano respire entre cortes.
const SPEAKER_BREATH = 0.025;

// Rebote al final: el resorte se pasa un poco del destino y vuelve.
const BOUNCE = { damping: 10, stiffness: 170, mass: 0.7 };
const BACK_OUT = Easing.bezier(0.34, 1.56, 0.64, 1);

type Ctx = { frame: number; fps: number };

const toFrame = (seconds: number, fps: number) => Math.round(seconds * fps);

function bounceIn({ frame, fps }: Ctx, atSeconds: number): number {
  return spring({ frame: frame - toFrame(atSeconds, fps), fps, config: BOUNCE });
}

/** Oscilación suave y continua; `seed` desfasa cada elemento para que no se muevan al unísono. */
function micro(frame: number, fps: number, amplitude: number, seed: number) {
  const t = frame / fps;
  return {
    x: Math.sin(t * 1.3 + seed * 1.7) * amplitude,
    y: Math.cos(t * 1.05 + seed * 2.3) * amplitude,
    rot: Math.sin(t * 0.9 + seed) * (amplitude / 6),
  };
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

/** Encuadre del presentador en un instante, con el zoom lento acumulado dentro de ese corte. */
function speakerFramingAt(jumpCuts: RenderedMotionBlancoGuion["jumpCuts"], seconds: number) {
  let current = { atSeconds: 0, scale: 1, offsetX: 0 };
  let next = Number.POSITIVE_INFINITY;
  for (let i = 0; i < jumpCuts.length; i++) {
    if (jumpCuts[i].atSeconds <= seconds) {
      current = jumpCuts[i];
      next = jumpCuts[i + 1]?.atSeconds ?? Number.POSITIVE_INFINITY;
    } else break;
  }
  const progress = Number.isFinite(next) ? (seconds - current.atSeconds) / (next - current.atSeconds) : 0;
  return { ...current, scale: current.scale * (1 + SPEAKER_BREATH * progress) };
}

// ---------------------------------------------------------------------------
// Capa del frente: textos
// ---------------------------------------------------------------------------

const FrontItem: React.FC<{ item: RenderedMotionBlancoFront }> = ({ item }) => {
  switch (item.kind) {
    case "pill":
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 18, background: "white", borderRadius: 999, padding: "20px 38px", boxShadow: CARD_SHADOW }}>
          <div style={{ width: 20, height: 20, borderRadius: 10, background: ACCENT }} />
          <p style={{ fontFamily: inter, fontWeight: 700, fontSize: 48, color: INK, margin: 0, letterSpacing: "-0.03em", whiteSpace: "nowrap" }}>{item.text}</p>
        </div>
      );
    case "title":
      return (
        <p style={{ fontFamily: serif, fontSize: 120, lineHeight: 0.95, color: "white", margin: 0, padding: "0 50px", textAlign: "center", textShadow: "0 6px 40px rgba(0,0,0,0.7)" }}>
          {item.text}
        </p>
      );
    case "quote":
      return (
        <div style={{ textAlign: "center", padding: "0 60px" }}>
          <p style={{ fontFamily: serif, fontSize: 180, lineHeight: 0.5, color: ACCENT, margin: "0 0 10px" }}>“</p>
          <p style={{ fontFamily: serif, fontSize: 96, lineHeight: 1.02, color: "white", margin: 0, textShadow: "0 6px 40px rgba(0,0,0,0.75)" }}>{item.text}</p>
        </div>
      );
    case "verse":
      return (
        <div style={{ background: "rgba(255,255,255,0.96)", borderRadius: 28, padding: "40px 48px", boxShadow: CARD_SHADOW, maxWidth: 900 }}>
          <p style={{ fontFamily: serif, fontSize: 84, lineHeight: 1.05, color: INK, margin: 0 }}>{item.text}</p>
        </div>
      );
    case "check":
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 22, background: "white", borderRadius: 26, padding: "22px 36px", boxShadow: CARD_SHADOW, minWidth: 640 }}>
          <svg width={52} height={52} viewBox="0 0 52 52">
            <rect x={2} y={2} width={48} height={48} rx={14} fill={ACCENT} />
            <path d="M14 27 L23 35 L39 17" fill="none" stroke="white" strokeWidth={5.5} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <p style={{ fontFamily: inter, fontWeight: 700, fontSize: 46, color: INK, margin: 0, letterSpacing: "-0.03em", whiteSpace: "nowrap" }}>{item.text}</p>
        </div>
      );
    case "key":
      return (
        <div
          style={{
            width: 190, height: 170, borderRadius: 34, background: "white", boxShadow: `0 12px 0 #d6d0c9, ${CARD_SHADOW}`,
            display: "flex", alignItems: "center", justifyContent: "center", fontFamily: inter, fontWeight: 800, fontSize: 70, color: INK,
          }}
        >
          {item.text}
        </div>
      );
  }
};

/** Agrupa teclas consecutivas en una misma fila; todo lo demás va apilado. */
function groupFrontRows(items: RenderedMotionBlancoFront[]): RenderedMotionBlancoFront[][] {
  const rows: RenderedMotionBlancoFront[][] = [];
  for (const item of items) {
    const last = rows[rows.length - 1];
    if (item.kind === "key" && last && last[0].kind === "key") last.push(item);
    else rows.push([item]);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Escena en capas
// ---------------------------------------------------------------------------

// Partículas de luz del frente: posiciones fijas por índice (render determinista).
const DUST = Array.from({ length: 16 }, (_, i) => ({
  x: (i * 137) % 100,
  y: (i * 61 + 13) % 100,
  size: 6 + ((i * 7) % 14),
  speed: 0.6 + ((i * 13) % 10) / 10,
  blur: 1 + (i % 4),
}));

// Dónde va cada objeto recortado según cuántos haya en la escena (x/y en %, ancho en px).
const MID_SLOTS: Record<number, { x: number; y: number; w: number; rot: number }[]> = {
  1: [{ x: 50, y: 50, w: 640, rot: -3 }],
  2: [
    { x: 30, y: 46, w: 500, rot: -7 },
    { x: 70, y: 58, w: 500, rot: 6 },
  ],
};

const Scene: React.FC<{ scene: RenderedMotionBlancoScene; index: number; ctx: Ctx }> = ({ scene, index, ctx }) => {
  const { frame, fps } = ctx;
  const startFrame = toFrame(scene.startSeconds, fps);
  const totalFrames = Math.max(1, toFrame(scene.durationInSeconds, fps));
  const local = frame - startFrame;
  const progress = interpolate(local, [0, totalFrames], [-0.5, 0.5], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  // Cada escena panea hacia el lado contrario de la anterior.
  const dir = index % 2 === 0 ? 1 : -1;
  const isSplit = scene.layout === "split";

  const bgIn = interpolate(local, [0, 14], [0, 1], { extrapolateRight: "clamp", easing: BACK_OUT });
  const bgMicro = micro(frame, fps, MICRO_BG, index);
  const bgScale = interpolate(bgIn, [0, 1], [1.34, 1.14]) + Math.abs(progress) * 0.02;
  const bgBlur = interpolate(local, [0, 8], [10, 0], { extrapolateRight: "clamp" });

  const midSlots = MID_SLOTS[Math.min(scene.mid.length, 2)] ?? [];
  const rows = groupFrontRows(scene.front);

  return (
    <AbsoluteFill style={{ height: isSplit ? "50%" : "100%", overflow: "hidden", backgroundColor: "#0e0b09" }}>
      {/* Fondo */}
      <Img
        src={staticFile(scene.bgPath)}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `translate(${dir * progress * PARALLAX_BG + bgMicro.x}px, ${bgMicro.y}px) scale(${bgScale})`,
          filter: bgBlur > 0.1 ? `blur(${bgBlur}px)` : undefined,
        }}
      />
      {/* Sombra superior e inferior para que textos y subtítulos se lean sobre cualquier foto */}
      <AbsoluteFill
        style={{
          background: "linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 32%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.6) 100%)",
        }}
      />

      {/* Medio: objetos recortados */}
      {scene.mid.map((m, i) => {
        const slot = midSlots[i];
        if (!slot) return null;
        const s = bounceIn(ctx, m.atSeconds);
        const mm = micro(frame, fps, MICRO_MID, index * 3 + i);
        return (
          <Img
            key={m.imagePath}
            src={staticFile(m.imagePath)}
            style={{
              position: "absolute",
              left: `${slot.x}%`,
              top: `${slot.y}%`,
              width: slot.w,
              opacity: Math.min(1, s * 1.5),
              transform:
                `translate(-50%, -50%) translate(${dir * progress * PARALLAX_MID + mm.x}px, ${(1 - s) * 260 + mm.y}px) ` +
                `rotate(${slot.rot + (1 - s) * -14 + mm.rot}deg) scale(${0.55 + s * 0.45})`,
              filter: "drop-shadow(0 30px 40px rgba(0,0,0,0.55))",
            }}
          />
        );
      })}

      {/* Frente: textos apilados, entran uno tras otro con rebote */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: isSplit ? "14%" : scene.mid.length > 0 ? "9%" : "12%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 26,
          transform: `translateX(${dir * progress * PARALLAX_FRONT}px)`,
        }}
      >
        {rows.map((row, r) => (
          <div key={r} style={{ display: "flex", gap: 40 }}>
            {row.map((item, k) => {
              const s = bounceIn(ctx, item.atSeconds);
              const fm = micro(frame, fps, MICRO_FRONT, index * 5 + r * 2 + k);
              return (
                <div
                  key={item.text}
                  style={{
                    opacity: Math.min(1, s * 1.6),
                    transform: `translate(${fm.x}px, ${(1 - s) * 70 + fm.y}px) scale(${0.6 + s * 0.4}) rotate(${fm.rot}deg)`,
                  }}
                >
                  <FrontItem item={item} />
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Polvo de luz: la capa más cercana, la que más rápido se mueve */}
      {DUST.map((d, i) => {
        const t = frame / fps;
        const x = (d.x + dir * progress * (PARALLAX_DUST / 10.8) * d.speed + 100) % 100;
        const y = (d.y - t * 2.2 * d.speed + 200) % 100;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${x}%`,
              top: `${y}%`,
              width: d.size,
              height: d.size,
              borderRadius: d.size,
              background: "rgba(255,214,160,0.75)",
              filter: `blur(${d.blur}px)`,
              opacity: 0.35 + 0.25 * Math.sin(t * 2 + i),
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// Título de apertura y subtítulos
// ---------------------------------------------------------------------------

/** Escudo de marca junto al título de apertura. */
const ShieldMark: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 100 100">
    <path d="M50 6 L88 20 V48 C88 72 70 88 50 95 C30 88 12 72 12 48 V20 Z" fill={ACCENT} />
    <path d="M50 22 V80 M30 44 H70" stroke="white" strokeWidth={7} strokeLinecap="round" />
  </svg>
);

const TitleCard: React.FC<{ kicker: string; headline: string; ctx: Ctx }> = ({ kicker, headline, ctx }) => {
  const words = headline.split(" ");
  const mark = bounceIn(ctx, 0);
  const kickerIn = bounceIn(ctx, 0.15 + words.length * 0.1);
  const m = micro(ctx.frame, ctx.fps, 4, 0);
  return (
    <div style={{ position: "absolute", left: 70, right: 70, top: "56%", transform: `translate(${m.x}px, ${m.y}px)` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
        <div style={{ transform: `scale(${mark}) rotate(${(1 - mark) * -40}deg)` }}>
          <ShieldMark size={100} />
        </div>
        <p style={{ fontFamily: serif, fontSize: 100, lineHeight: 0.95, color: "white", margin: 0, whiteSpace: "nowrap", textShadow: "0 4px 30px rgba(0,0,0,0.55)" }}>
          {words.map((w, i) => {
            const s = bounceIn(ctx, 0.1 + i * 0.1);
            return (
              <span key={i} style={{ display: "inline-block", opacity: Math.min(1, s * 1.5), transform: `translateY(${(1 - s) * 50}px)`, marginRight: 24 }}>
                {w}
              </span>
            );
          })}
        </p>
      </div>
      <p
        style={{
          fontFamily: inter, fontWeight: 600, fontSize: 40, color: "white", margin: "16px 0 0 124px",
          opacity: Math.min(1, kickerIn * 1.5), transform: `translateY(${(1 - kickerIn) * 30}px)`, textShadow: "0 2px 16px rgba(0,0,0,0.6)",
        }}
      >
        {kicker}
      </p>
    </div>
  );
};

const Subtitle: React.FC<{ chunk: CaptionChunk; top: string; ctx: Ctx }> = ({ chunk, top, ctx }) => {
  const s = bounceIn(ctx, chunk.startSeconds);
  return (
    <div className="absolute inset-x-0 flex justify-center px-16" style={{ top }}>
      <p
        className="text-center"
        style={{
          fontFamily: inter,
          fontWeight: 700,
          fontSize: 60,
          lineHeight: 1.1,
          letterSpacing: "-0.04em",
          color: "white",
          textShadow: "0 2px 14px rgba(0,0,0,0.65), 0 0 3px rgba(0,0,0,0.45)",
          margin: 0,
          transform: `scale(${0.85 + s * 0.15})`,
        }}
      >
        {chunk.words.map((w) => w.text).join(" ")}
      </p>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Composición
// ---------------------------------------------------------------------------

export const MotionBlanco: React.FC<{ slug: string; guion: RenderedMotionBlancoGuion | null }> = ({ guion }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  if (!guion) return null;

  const ctx = { frame, fps };
  const seconds = frame / fps;
  const activeIndex = guion.scenes.findIndex((s) => seconds >= s.startSeconds && seconds < s.startSeconds + s.durationInSeconds);
  const active = activeIndex >= 0 ? guion.scenes[activeIndex] : null;
  const isSplit = active?.layout === "split";
  const showTitle = seconds < guion.title.durationInSeconds;
  const chunk = findActiveChunk(guion.captionChunks, seconds);
  const framing = speakerFramingAt(guion.jumpCuts, seconds);

  const musicVolume = (f: number) => {
    const base = guion.music?.volume ?? 0;
    const fade = Math.round(MUSIC_FADE_SECONDS * fps);
    return Math.min(
      interpolate(f, [0, fade], [0, base], { extrapolateRight: "clamp" }),
      interpolate(f, [durationInFrames - fade, durationInFrames], [base, 0], { extrapolateLeft: "clamp" }),
    );
  };

  return (
    <AbsoluteFill className="bg-black">
      <AbsoluteFill style={{ overflow: "hidden", opacity: active && !isSplit ? 0 : 1 }}>
        <OffthreadVideo
          src={staticFile(guion.videoPath)}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: isSplit ? `translateY(${SPLIT_VIDEO_SHIFT})` : `translateX(${framing.offsetX}%) scale(${framing.scale})`,
            transformOrigin: SPEAKER_ORIGIN,
            filter: "contrast(1.06) saturate(1.08) brightness(0.98)",
          }}
        />
        {/* Viñeta cálida suave para acercarse al look cinematográfico de la referencia. */}
        <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 35%, rgba(0,0,0,0) 45%, rgba(20,10,0,0.45) 100%)" }} />
      </AbsoluteFill>

      {active && <Scene key={active.id} scene={active} index={activeIndex} ctx={ctx} />}

      {showTitle ? (
        <TitleCard kicker={guion.title.kicker} headline={guion.title.headline} ctx={ctx} />
      ) : (
        chunk && <Subtitle chunk={chunk} ctx={ctx} top={isSplit ? "86%" : active ? "72%" : "60%"} />
      )}

      {guion.music && (
        <Sequence durationInFrames={durationInFrames} layout="none">
          <Audio src={staticFile(guion.music.path)} volume={musicVolume} loop />
        </Sequence>
      )}
      {guion.scenes.map((s) => (
        <Sequence key={`whoosh-${s.id}`} from={toFrame(s.startSeconds, fps)} durationInFrames={toFrame(guion.sfx.whooshDurationInSeconds, fps)} layout="none">
          <Audio src={staticFile(guion.sfx.whooshPath)} volume={() => WHOOSH_VOLUME} />
        </Sequence>
      ))}
      {guion.scenes.flatMap((s) =>
        [...s.mid, ...s.front].map((item, i) => (
          <Sequence key={`pop-${s.id}-${i}`} from={toFrame(item.atSeconds, fps)} durationInFrames={toFrame(guion.sfx.popDurationInSeconds, fps)} layout="none">
            <Audio src={staticFile(guion.sfx.popPath)} volume={() => POP_VOLUME} />
          </Sequence>
        )),
      )}
    </AbsoluteFill>
  );
};
