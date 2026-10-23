import {
  AbsoluteFill,
  Audio,
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

const { fontFamily: inter } = loadInter("normal", { weights: ["500", "600", "700"], subsets: ["latin"] });
const { fontFamily: serif } = loadSerif("normal", { weights: ["400"], subsets: ["latin"] });

// Paleta de la referencia: papel casi blanco, tinta casi negra y un único acento naranja.
const PAPER = "#FAF9F7";
const INK = "#1C1B1A";
const MUTED = "#8C8782";
const ACCENT = "#E8662A";
// Sombras apenas perceptibles, como las tarjetas de la referencia.
const SOFT_SHADOW = "0 1px 2px rgba(28,27,26,0.06), 0 12px 32px rgba(28,27,26,0.08)";
const OBJECT_SHADOW = "drop-shadow(0 18px 22px rgba(28,27,26,0.18))";

const SPEAKER_ORIGIN = "50% 28%";
// En la pantalla dividida se baja el video para que la cara quede en la mitad de abajo.
const SPLIT_VIDEO_SHIFT = "34%";
const HOLD_SECONDS = 0.35;
const MUSIC_FADE_SECONDS = 1.5;

// Si los rótulos juntos pasan de este largo no caben en una línea y se apilan.
const LABELS_ROW_MAX_CHARS = 24;
// Composición: el gráfico vive entre ~13% y ~60% de la altura y el subtítulo va justo debajo.
const CARD = { width: 720, height: 900, top: 250 };
const CAPTION_ON_PAPER_TOP = "64%";

// Parallax discreto: el papel no se mueve, la foto apenas sube y los objetos del frente un poco más.
const PARALLAX_CARD = 10;
const PARALLAX_FRONT = 24;
// Empuje lento de cámara sobre la foto dentro de la tarjeta, como los zooms de la referencia.
const CARD_PUSH_IN = 0.05;
// Micromovimiento casi imperceptible: solo evita que la escena quede congelada.
const MICRO_PX = 1.5;
// Zoom lento del presentador dentro de cada encuadre, para que el plano respire entre cortes.
const SPEAKER_BREATH = 0.02;

// Resorte con un rebote corto al final (se pasa ~4% y vuelve).
const SETTLE = { damping: 15, stiffness: 150, mass: 0.8 };

type Ctx = { frame: number; fps: number };

const toFrame = (seconds: number, fps: number) => Math.round(seconds * fps);

function settleIn({ frame, fps }: Ctx, atSeconds: number): number {
  return spring({ frame: frame - toFrame(atSeconds, fps), fps, config: SETTLE });
}

/** Oscilación lenta y mínima; `seed` desfasa cada elemento para que no se muevan al unísono. */
function micro(frame: number, fps: number, seed: number) {
  const t = frame / fps;
  return { x: Math.sin(t * 0.7 + seed * 1.7) * MICRO_PX, y: Math.cos(t * 0.55 + seed * 2.3) * MICRO_PX };
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
// Piezas de texto (siempre sobre el papel, nunca encima de una foto)
// ---------------------------------------------------------------------------

/** Rótulo arriba de la tarjeta, en serif y tinta oscura; las citas llevan comillas naranjas. */
const Label: React.FC<{ item: RenderedMotionBlancoFront; separator: boolean }> = ({ item, separator }) => (
  <p style={{ fontFamily: serif, fontSize: item.kind === "quote" ? 64 : 72, lineHeight: 1, color: INK, margin: 0, whiteSpace: "nowrap" }}>
    {separator ? <span style={{ color: ACCENT, margin: "0 18px" }}>·</span> : null}
    {item.kind === "quote" ? <span style={{ color: ACCENT }}>“</span> : null}
    {item.text}
    {item.kind === "quote" ? <span style={{ color: ACCENT }}>”</span> : null}
  </p>
);

const CheckRow: React.FC<{ text: string; size?: number }> = ({ text, size = 38 }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 18, padding: "12px 0" }}>
    <svg width={size} height={size} viewBox="0 0 52 52">
      <rect x={2} y={2} width={48} height={48} rx={14} fill={ACCENT} />
      <path d="M14 27 L23 35 L39 17" fill="none" stroke="white" strokeWidth={5.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
    <p style={{ fontFamily: inter, fontWeight: 600, fontSize: size, color: INK, margin: 0, letterSpacing: "-0.03em", whiteSpace: "nowrap" }}>{text}</p>
  </div>
);

const Keycap: React.FC<{ text: string }> = ({ text }) => (
  <div
    style={{
      width: 150, height: 130, borderRadius: 28, background: "white", boxShadow: `0 8px 0 #e4dfd9, ${SOFT_SHADOW}`,
      display: "flex", alignItems: "center", justifyContent: "center", fontFamily: inter, fontWeight: 700, fontSize: 54, color: INK,
    }}
  >
    {text}
  </div>
);

/** Elemento que entra con un asentado corto y un leve desplazamiento hacia arriba. */
const Settle: React.FC<{ ctx: Ctx; at: number; seed: number; children: React.ReactNode; style?: React.CSSProperties }> = ({
  ctx,
  at,
  seed,
  children,
  style,
}) => {
  const s = settleIn(ctx, at);
  const m = micro(ctx.frame, ctx.fps, seed);
  return (
    <div style={{ opacity: interpolate(s, [0, 0.6], [0, 1], { extrapolateRight: "clamp" }), transform: `translate(${m.x}px, ${(1 - s) * 28 + m.y}px) scale(${0.96 + s * 0.04})`, ...style }}>
      {children}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Escena: papel (fondo) → foto en tarjeta (medio) → objetos y textos (frente)
// ---------------------------------------------------------------------------

// Objetos recortados: se apoyan sobre las esquinas inferiores de la tarjeta, nunca al centro.
const OBJECT_BOX = 380;
const OBJECT_SLOTS: Record<number, { left: number; top: number; rot: number }[]> = {
  1: [{ left: CARD.width / 2 + 110, top: CARD.top + CARD.height - 330, rot: 4 }],
  2: [
    { left: 40, top: CARD.top + CARD.height - 330, rot: -5 },
    { left: 1080 - 40 - OBJECT_BOX, top: CARD.top + CARD.height - 300, rot: 5 },
  ],
};

const Scene: React.FC<{ scene: RenderedMotionBlancoScene; index: number; ctx: Ctx }> = ({ scene, index, ctx }) => {
  const { frame, fps } = ctx;
  const local = frame - toFrame(scene.startSeconds, fps);
  const total = Math.max(1, toFrame(scene.durationInSeconds, fps));
  const progress = interpolate(local, [0, total], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const isSplit = scene.layout === "split";

  const checks = scene.front.filter((f) => f.kind === "check");
  const verses = scene.front.filter((f) => f.kind === "verse");
  // Con versículo, la etiqueta corta va dentro de su tarjeta como referencia y no arriba.
  const labels = scene.front.filter((f) => f.kind === "title" || f.kind === "quote" || (f.kind === "pill" && verses.length === 0));
  const keys = scene.front.filter((f) => f.kind === "key");

  const labelsInRow = labels.reduce((n, l) => n + l.text.length, 0) <= LABELS_ROW_MAX_CHARS;
  const cardIn = settleIn(ctx, scene.startSeconds);
  const cardMicro = micro(frame, fps, index);

  if (isSplit) {
    // Pantalla dividida: foto a la izquierda y lista a la derecha, todo en la mitad de arriba.
    return (
      <AbsoluteFill style={{ height: "50%", backgroundColor: PAPER, overflow: "hidden" }}>
        <div
          style={{
            position: "absolute", left: 60, top: 170, width: 450, height: 620, borderRadius: 22, overflow: "hidden", boxShadow: SOFT_SHADOW,
            opacity: interpolate(cardIn, [0, 0.6], [0, 1], { extrapolateRight: "clamp" }),
            transform: `translate(${cardMicro.x}px, ${(1 - cardIn) * 28 - progress * PARALLAX_CARD + cardMicro.y}px) scale(${0.96 + cardIn * 0.04})`,
          }}
        >
          <Img src={staticFile(scene.bgPath)} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "50% 35%", transform: `scale(${1 + CARD_PUSH_IN * progress})` }} />
        </div>
        <div style={{ position: "absolute", left: 550, top: 300, transform: `translateY(${-progress * PARALLAX_FRONT}px)` }}>
          {checks.map((c, i) => (
            <Settle key={c.text} ctx={ctx} at={c.atSeconds} seed={index * 5 + i}>
              <CheckRow text={c.text} size={40} />
            </Settle>
          ))}
        </div>
      </AbsoluteFill>
    );
  }

  const objectSlots = OBJECT_SLOTS[Math.min(scene.mid.length, 2)] ?? [];
  const cardLeft = (1080 - CARD.width) / 2;
  const overlayTop = CARD.top + CARD.height - 150;

  return (
    <AbsoluteFill style={{ backgroundColor: PAPER }}>
      {/* Rótulos arriba de la tarjeta */}
      <div
        style={{
          position: "absolute", left: 60, right: 60, top: 70, height: CARD.top - 100,
          display: "flex", flexDirection: labelsInRow ? "row" : "column", alignItems: labelsInRow ? "flex-end" : "center", justifyContent: labelsInRow ? "center" : "flex-end", gap: 10,
          transform: `translateY(${-progress * PARALLAX_FRONT * 0.5}px)`,
        }}
      >
        {labels.map((l, i) => (
          <Settle key={l.text} ctx={ctx} at={l.atSeconds} seed={index * 5 + i}>
            <Label item={l} separator={labelsInRow && i > 0} />
          </Settle>
        ))}
      </div>

      {/* Foto en tarjeta */}
      <div
        style={{
          position: "absolute", left: cardLeft, top: CARD.top, width: CARD.width, height: CARD.height,
          borderRadius: 24, overflow: "hidden", boxShadow: SOFT_SHADOW,
          opacity: interpolate(cardIn, [0, 0.6], [0, 1], { extrapolateRight: "clamp" }),
          transform: `translate(${cardMicro.x}px, ${(1 - cardIn) * 30 - progress * PARALLAX_CARD + cardMicro.y}px) scale(${0.96 + cardIn * 0.04})`,
        }}
      >
        <Img
          src={staticFile(scene.bgPath)}
          style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "50% 35%", transform: `scale(${1 + CARD_PUSH_IN * progress})` }}
        />
      </div>

      {/* Objetos recortados apoyados en la tarjeta */}
      {scene.mid.map((m, i) => {
        const slot = objectSlots[i];
        if (!slot) return null;
        return (
          <Settle
            key={m.imagePath}
            ctx={ctx}
            at={m.atSeconds}
            seed={index * 3 + i + 1}
            style={{ position: "absolute", left: slot.left, top: slot.top - progress * PARALLAX_FRONT, width: OBJECT_BOX, height: OBJECT_BOX }}
          >
            <Img
              src={staticFile(m.imagePath)}
              style={{ width: "100%", height: "100%", objectFit: "contain", filter: OBJECT_SHADOW, transform: `rotate(${slot.rot}deg)` }}
            />
          </Settle>
        );
      })}

      {/* Tarjetas de texto que se superponen al borde inferior de la foto */}
      {(checks.length > 0 || verses.length > 0 || keys.length > 0) && (
        <div
          style={{
            position: "absolute", left: 0, right: 0, top: overlayTop, display: "flex", flexDirection: "column", alignItems: "center",
            transform: `translateY(${-progress * PARALLAX_FRONT}px)`,
          }}
        >
          {checks.length > 0 && (
            <Settle ctx={ctx} at={checks[0].atSeconds} seed={index * 7}>
              <div style={{ background: "white", borderRadius: 24, padding: "14px 36px", boxShadow: SOFT_SHADOW, minWidth: 600 }}>
                {checks.map((c, i) => (
                  <Settle key={c.text} ctx={ctx} at={c.atSeconds} seed={index * 7 + i + 1}>
                    <CheckRow text={c.text} />
                  </Settle>
                ))}
              </div>
            </Settle>
          )}
          {verses.map((v, i) => (
            <Settle key={v.text} ctx={ctx} at={v.atSeconds} seed={index * 7 + i}>
              <div style={{ background: "white", borderRadius: 24, padding: "30px 40px", boxShadow: SOFT_SHADOW, maxWidth: 800 }}>
                <p style={{ fontFamily: inter, fontWeight: 600, fontSize: 26, color: MUTED, margin: "0 0 10px", letterSpacing: "0.02em" }}>
                  {scene.front.find((f) => f.kind === "pill")?.text ?? ""}
                </p>
                <p style={{ fontFamily: serif, fontSize: 64, lineHeight: 1.05, color: INK, margin: 0 }}>{v.text}</p>
              </div>
            </Settle>
          ))}
          {keys.length > 0 && (
            <div style={{ display: "flex", gap: 36 }}>
              {keys.map((k, i) => (
                <Settle key={k.text} ctx={ctx} at={k.atSeconds} seed={index * 7 + i}>
                  <Keycap text={k.text} />
                </Settle>
              ))}
            </div>
          )}
        </div>
      )}
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
  const mark = settleIn(ctx, 0);
  const kickerIn = settleIn(ctx, 0.15 + words.length * 0.1);
  return (
    <div style={{ position: "absolute", left: 70, right: 70, top: "56%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
        <div style={{ transform: `scale(${mark})` }}>
          <ShieldMark size={96} />
        </div>
        <p style={{ fontFamily: serif, fontSize: 100, lineHeight: 0.95, color: "white", margin: 0, whiteSpace: "nowrap", textShadow: "0 4px 30px rgba(0,0,0,0.55)" }}>
          {words.map((w, i) => {
            const s = settleIn(ctx, 0.1 + i * 0.1);
            return (
              <span key={i} style={{ display: "inline-block", opacity: interpolate(s, [0, 0.6], [0, 1], { extrapolateRight: "clamp" }), transform: `translateY(${(1 - s) * 30}px)`, marginRight: 24 }}>
                {w}
              </span>
            );
          })}
        </p>
      </div>
      <p
        style={{
          fontFamily: inter, fontWeight: 600, fontSize: 40, color: "white", margin: "16px 0 0 118px",
          opacity: interpolate(kickerIn, [0, 0.6], [0, 1], { extrapolateRight: "clamp" }), textShadow: "0 2px 16px rgba(0,0,0,0.6)",
        }}
      >
        {kicker}
      </p>
    </div>
  );
};

/** Subtítulo de 1–3 palabras: blanco sobre el presentador, negro y más chico sobre el papel. */
const Subtitle: React.FC<{ chunk: CaptionChunk; top: string; onPaper: boolean }> = ({ chunk, top, onPaper }) => (
  <div className="absolute inset-x-0 flex justify-center px-16" style={{ top }}>
    <p
      className="text-center"
      style={{
        fontFamily: inter,
        fontWeight: 700,
        fontSize: onPaper ? 46 : 56,
        lineHeight: 1.1,
        letterSpacing: "-0.04em",
        color: onPaper ? INK : "white",
        textShadow: onPaper ? undefined : "0 2px 14px rgba(0,0,0,0.6), 0 0 3px rgba(0,0,0,0.4)",
        margin: 0,
      }}
    >
      {chunk.words.map((w) => w.text).join(" ")}
    </p>
  </div>
);

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
  const onPaper = active !== null && !isSplit;
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
    <AbsoluteFill style={{ backgroundColor: PAPER }}>
      <AbsoluteFill style={{ overflow: "hidden", opacity: onPaper ? 0 : 1 }}>
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
        chunk && <Subtitle chunk={chunk} onPaper={onPaper} top={isSplit ? "86%" : onPaper ? CAPTION_ON_PAPER_TOP : "60%"} />
      )}

      {guion.music && (
        <Sequence durationInFrames={durationInFrames} layout="none">
          <Audio src={staticFile(guion.music.path)} volume={musicVolume} loop />
        </Sequence>
      )}
    </AbsoluteFill>
  );
};
