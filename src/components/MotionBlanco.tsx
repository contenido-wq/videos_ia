import {
  AbsoluteFill,
  Audio,
  Easing,
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
import { loadFont as loadHand } from "@remotion/google-fonts/Caveat";
import type { CaptionChunk, RenderedMotionBlancoGraphic, RenderedMotionBlancoGuion } from "../types/guion";

const { fontFamily: inter } = loadInter("normal", { weights: ["500", "600", "700", "800"] });
const { fontFamily: serif } = loadSerif("normal", { weights: ["400"] });
const { fontFamily: hand } = loadHand("normal", { weights: ["600", "700"] });

// Paleta: blanco hueso del fondo, tinta casi negra y el naranja de marca como único acento.
const PAPER = "#F6F4F1";
const INK = "#1C1B1A";
const MUTED = "#8C8782";
const ACCENT = "#E8662A";
const CARD_SHADOW = "0 24px 60px rgba(28,27,26,0.10), 0 2px 8px rgba(28,27,26,0.06)";

const SPEAKER_ORIGIN = "50% 28%";
// En la pantalla dividida se baja el video para que la cara quede en la mitad de abajo.
const SPLIT_VIDEO_SHIFT = "34%";
const HOLD_SECONDS = 0.35;
const WHOOSH_VOLUME = 0.22;
const POP_VOLUME = 0.12;
const MUSIC_FADE_SECONDS = 1.5;

type Ctx = { frame: number; fps: number };

const toFrame = (seconds: number, fps: number) => Math.round(seconds * fps);

function pop({ frame, fps }: Ctx, atSeconds: number): number {
  return spring({ frame: frame - toFrame(atSeconds, fps), fps, config: { damping: 15, stiffness: 210, mass: 0.6 } });
}

/** Escala del presentador en un instante: la del último jump cut ya ocurrido (1 antes del primero). */
function speakerScaleAt(jumpCuts: { atSeconds: number; scale: number }[], seconds: number): number {
  let scale = 1;
  for (const cut of jumpCuts) {
    if (cut.atSeconds <= seconds) scale = cut.scale;
    else break;
  }
  return scale;
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

// ---------------------------------------------------------------------------
// Piezas reutilizables
// ---------------------------------------------------------------------------

const Card: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div
    style={{
      background: "white",
      borderRadius: 30,
      boxShadow: CARD_SHADOW,
      border: "1px solid rgba(28,27,26,0.06)",
      ...style,
    }}
  >
    {children}
  </div>
);

/** Nota escrita a mano con flecha que se dibuja sola, como las anotaciones de la referencia. */
const HandNote: React.FC<{
  ctx: Ctx;
  text: string;
  atSeconds: number;
  x: number;
  y: number;
  arrow?: "down-right" | "down-left" | "up-right" | "down";
  color?: string;
  size?: number;
}> = ({ ctx, text, atSeconds, x, y, arrow = "down-right", color = INK, size = 64 }) => {
  const local = ctx.frame - toFrame(atSeconds, ctx.fps);
  const textIn = interpolate(local, [0, 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const draw = interpolate(local, [6, 20], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const paths: Record<string, string> = {
    "down-right": "M10 10 C 30 70, 80 95, 140 80 M118 62 L142 80 L116 96",
    "down-left": "M140 10 C 120 70, 70 95, 10 80 M32 62 L8 80 L34 96",
    "up-right": "M10 90 C 40 30, 90 10, 140 20 M114 6 L142 20 L118 40",
    down: "M60 0 C 40 40, 80 70, 60 110 M42 92 L60 112 L78 90",
  };
  return (
    <div style={{ position: "absolute", left: x, top: y, opacity: textIn }}>
      <p style={{ fontFamily: hand, fontWeight: 700, fontSize: size, color, margin: 0, whiteSpace: "nowrap", transform: "rotate(-4deg)" }}>
        {text}
      </p>
      <svg width={150} height={120} viewBox="0 0 150 120" style={{ marginLeft: 30 }}>
        <path
          d={paths[arrow]}
          fill="none"
          stroke={color}
          strokeWidth={6}
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={draw}
        />
      </svg>
    </div>
  );
};

/** Escudo de marca: hace las veces del logo de la referencia y amarra todo al tema "armadura". */
const ShieldMark: React.FC<{ size: number; color?: string }> = ({ size, color = ACCENT }) => (
  <svg width={size} height={size} viewBox="0 0 100 100">
    <path d="M50 6 L88 20 V48 C88 72 70 88 50 95 C30 88 12 72 12 48 V20 Z" fill={color} />
    <path d="M50 22 V80 M30 44 H70" stroke="white" strokeWidth={7} strokeLinecap="round" />
  </svg>
);

const ArmorIcon: React.FC<{ size: number; draw: number }> = ({ size, draw }) => {
  const stroke = { fill: "none", stroke: INK, strokeWidth: 5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, pathLength: 1, strokeDasharray: 1, strokeDashoffset: 1 - draw };
  return (
    <svg width={size} height={size * 1.15} viewBox="0 0 200 230">
      {/* casco */}
      <path d="M60 70 C60 25 140 25 140 70 V92 H118 V70 H82 V92 H60 Z" {...stroke} />
      <path d="M100 22 V8" {...stroke} stroke={ACCENT} strokeWidth={9} />
      {/* peto */}
      <path d="M40 112 C70 100 130 100 160 112 L150 200 C120 218 80 218 50 200 Z" {...stroke} />
      <path d="M100 108 V210 M62 140 C85 150 115 150 138 140 M60 172 C85 182 115 182 140 172" {...stroke} />
    </svg>
  );
};

const WEAPON_PATHS: Record<string, string> = {
  honda: "M30 40 C70 90 70 90 100 120 C130 90 130 90 170 40 M100 120 C80 140 80 165 100 172 C120 165 120 140 100 120",
  resortera: "M100 190 V115 M100 115 L58 40 M100 115 L142 40 M58 40 C80 70 120 70 142 40",
  lanza: "M40 175 L150 50 M150 50 L176 22 L168 60 Z M140 62 L162 82",
  flecha: "M30 170 L165 40 M165 40 L128 46 M165 40 L159 77 M42 158 L24 150 M42 158 L50 176 M58 142 L40 134 M58 142 L66 160",
  escudo: "M100 22 L168 46 V100 C168 145 136 172 100 186 C64 172 32 145 32 100 V46 Z M100 50 V158 M62 96 H138",
};

const WeaponIcon: React.FC<{ name: string; size: number; draw: number; color?: string }> = ({ name, size, draw, color = INK }) => (
  <svg width={size} height={size} viewBox="0 0 200 200">
    <path
      d={WEAPON_PATHS[name] ?? WEAPON_PATHS.escudo}
      fill="none"
      stroke={color}
      strokeWidth={9}
      strokeLinecap="round"
      strokeLinejoin="round"
      pathLength={1}
      strokeDasharray={1}
      strokeDashoffset={1 - draw}
    />
  </svg>
);

const Figure: React.FC<{ height: number; color: string }> = ({ height, color }) => (
  <svg width={height * 0.5} height={height} viewBox="0 0 100 200">
    <circle cx={50} cy={26} r={20} fill={color} />
    <path d="M18 70 C18 52 82 52 82 70 L76 130 H62 L58 196 H42 L38 130 H24 Z" fill={color} />
  </svg>
);

// ---------------------------------------------------------------------------
// Gráficos (uno por "kind")
// ---------------------------------------------------------------------------

type GraphicProps = { g: RenderedMotionBlancoGraphic; ctx: Ctx };

const Versus: React.FC<GraphicProps> = ({ g, ctx }) => {
  const [david, goliat] = g.reveals;
  const d = david ? pop(ctx, david.atSeconds) : 1;
  const go = goliat ? pop(ctx, goliat.atSeconds) : 1;
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", top: -260 }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 120 }}>
        <div style={{ textAlign: "center", opacity: d, transform: `translateY(${(1 - d) * 40}px)` }}>
          <Figure height={230} color={ACCENT} />
          <p style={{ fontFamily: inter, fontWeight: 700, fontSize: 48, color: INK, margin: "18px 0 0" }}>{david?.text}</p>
        </div>
        <div style={{ textAlign: "center", opacity: go, transform: `scale(${0.85 + go * 0.15})`, transformOrigin: "bottom center" }}>
          <Figure height={560} color={INK} />
          <p style={{ fontFamily: inter, fontWeight: 700, fontSize: 48, color: INK, margin: "18px 0 0" }}>{goliat?.text}</p>
        </div>
      </div>
      {g.note && g.noteAtSeconds !== undefined && (
        <HandNote ctx={ctx} text={g.note} atSeconds={g.noteAtSeconds} x={640} y={330} arrow="down-left" color={ACCENT} />
      )}
    </AbsoluteFill>
  );
};

const Armadura: React.FC<GraphicProps & { crossed?: boolean }> = ({ g, ctx, crossed }) => {
  const local = ctx.frame - toFrame(g.startSeconds, ctx.fps);
  const draw = interpolate(local, [2, 28], [0, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const cross = interpolate(local, [24, 36], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", top: -260 }}>
      <Card style={{ padding: "56px 80px 48px", textAlign: "center", position: "relative" }}>
        <ArmorIcon size={300} draw={draw} />
        {crossed && (
          <svg width={320} height={320} viewBox="0 0 100 100" style={{ position: "absolute", left: "50%", top: 60, marginLeft: -160 }}>
            <path d="M10 10 L90 90 M90 10 L10 90" stroke={ACCENT} strokeWidth={7} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={cross} fill="none" />
          </svg>
        )}
        <p style={{ fontFamily: inter, fontWeight: 700, fontSize: 46, color: INK, margin: "28px 0 0", letterSpacing: "-0.02em" }}>{g.title}</p>
      </Card>
      {g.note && g.noteAtSeconds !== undefined && (
        <HandNote ctx={ctx} text={g.note} atSeconds={g.noteAtSeconds} x={crossed ? 150 : 470} y={crossed ? 1250 : 270} arrow={crossed ? "up-right" : "down-left"} color={ACCENT} size={crossed ? 58 : 64} />
      )}
    </AbsoluteFill>
  );
};

/** Texto que aparece tecleado, con resaltado de marcador al decir cada frase clave. */
const Versiculo: React.FC<GraphicProps> = ({ g, ctx }) => {
  const body = g.body ?? "";
  const local = ctx.frame - toFrame(g.startSeconds, ctx.fps);
  const typed = Math.floor(interpolate(local, [6, 6 + body.length * 0.9], [0, body.length], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  // Parte el texto en tramos normales y resaltables, respetando el orden de los reveals.
  const segments: { text: string; mark?: number }[] = [];
  let rest = body;
  g.reveals.forEach((r) => {
    const i = rest.indexOf(r.text);
    if (i < 0) return;
    segments.push({ text: rest.slice(0, i) }, { text: r.text, mark: r.atSeconds });
    rest = rest.slice(i + r.text.length);
  });
  segments.push({ text: rest });

  let shown = 0;
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", top: -240, padding: "0 70px" }}>
      <Card style={{ padding: "54px 60px", width: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 28 }}>
          <ShieldMark size={46} />
          <p style={{ fontFamily: inter, fontWeight: 800, fontSize: 38, color: INK, margin: 0 }}>{g.title}</p>
        </div>
        <p style={{ fontFamily: serif, fontSize: 70, lineHeight: 1.18, color: INK, margin: 0 }}>
          {segments.map((s, i) => {
            const visible = s.text.slice(0, Math.max(0, typed - shown));
            shown += s.text.length;
            if (s.mark === undefined) return <span key={i}>{visible}</span>;
            const sweep = interpolate(ctx.frame - toFrame(s.mark, ctx.fps), [0, 10], [0, 100], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
            return (
              <span
                key={i}
                style={{
                  backgroundImage: `linear-gradient(transparent 58%, ${ACCENT}55 58%)`,
                  backgroundSize: `${sweep}% 100%`,
                  backgroundRepeat: "no-repeat",
                }}
              >
                {visible}
              </span>
            );
          })}
          {typed < body.length && <span style={{ color: ACCENT }}>|</span>}
        </p>
      </Card>
    </AbsoluteFill>
  );
};

const Cita: React.FC<GraphicProps> = ({ g, ctx }) => {
  const s = pop(ctx, g.startSeconds);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", top: -240, padding: "0 90px" }}>
      <div style={{ opacity: s, transform: `translateY(${(1 - s) * 30}px)` }}>
        <p style={{ fontFamily: serif, fontSize: 220, lineHeight: 0.6, color: ACCENT, margin: 0 }}>“</p>
        <p style={{ fontFamily: serif, fontSize: 104, lineHeight: 1.05, color: INK, margin: "10px 0 0", letterSpacing: "-0.01em" }}>{g.body}</p>
        <p style={{ fontFamily: inter, fontWeight: 600, fontSize: 40, color: MUTED, margin: "34px 0 0" }}>— {g.title}</p>
      </div>
      {g.note && g.noteAtSeconds !== undefined && (
        <HandNote ctx={ctx} text={g.note} atSeconds={g.noteAtSeconds + 0.6} x={160} y={1230} arrow="up-right" color={ACCENT} size={58} />
      )}
    </AbsoluteFill>
  );
};

// Posiciones fijas alrededor del perfil central, como las tarjetas dispersas de la referencia.
const SCATTER = [
  { x: 70, y: 250, r: -6 },
  { x: 470, y: 210, r: 5 },
  { x: 40, y: 760, r: 4 },
  { x: 640, y: 720, r: -5 },
  { x: 330, y: 930, r: 2 },
];

const Tarjetas: React.FC<GraphicProps> = ({ g, ctx }) => {
  const center = pop(ctx, g.startSeconds);
  const t = ctx.frame / ctx.fps;
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: 300, top: 400, opacity: center, transform: `scale(${0.9 + center * 0.1})` }}>
        <Card style={{ width: 480, padding: 36 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
            <div style={{ width: 96, height: 96, borderRadius: 48, background: "linear-gradient(135deg,#d9d4ce,#a8a29c)" }} />
            <div>
              <p style={{ fontFamily: inter, fontWeight: 700, fontSize: 36, color: INK, margin: 0 }}>@el_de_afuera</p>
              <p style={{ fontFamily: inter, fontWeight: 500, fontSize: 26, color: MUTED, margin: "6px 0 0" }}>1.2M seguidores</p>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginTop: 28 }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} style={{ aspectRatio: "9 / 12", borderRadius: 10, background: i % 2 ? "#e9e5e0" : "#d8d2cb" }} />
            ))}
          </div>
        </Card>
      </div>
      {g.reveals.map((r, i) => {
        const pos = SCATTER[i % SCATTER.length];
        const s = pop(ctx, r.atSeconds);
        const float = Math.sin(t * 1.4 + i) * 6;
        return (
          <div
            key={r.text}
            style={{
              position: "absolute",
              left: pos.x,
              top: pos.y + float,
              opacity: s,
              transform: `rotate(${pos.r}deg) scale(${0.7 + s * 0.3})`,
            }}
          >
            <Card style={{ padding: "22px 30px", borderRadius: 22, display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ width: 18, height: 18, borderRadius: 9, background: ACCENT }} />
              <p style={{ fontFamily: inter, fontWeight: 700, fontSize: 36, color: INK, margin: 0, whiteSpace: "nowrap" }}>{r.text}</p>
            </Card>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

const Copiar: React.FC<GraphicProps> = ({ g, ctx }) => {
  const [copy, paste] = g.reveals;
  const c = copy ? pop(ctx, copy.atSeconds) : 1;
  const p = paste ? pop(ctx, paste.atSeconds) : 0;
  const doc = (opacity: number, dx: number, accent: boolean) => (
    <Card style={{ width: 300, height: 380, padding: 34, opacity, transform: `translateX(${dx}px)`, position: "absolute" }}>
      {[0.9, 0.7, 0.8, 0.5, 0.75].map((w, i) => (
        <div key={i} style={{ height: 18, width: `${w * 100}%`, borderRadius: 9, background: i === 0 && accent ? ACCENT : "#e4dfda", marginBottom: 26 }} />
      ))}
    </Card>
  );
  const key = (label: string, s: number) => (
    <div style={{ textAlign: "center", opacity: s, transform: `translateY(${(1 - s) * 30}px)` }}>
      <div
        style={{
          width: 170, height: 150, borderRadius: 30, background: "white", boxShadow: "0 10px 0 #dcd6cf, 0 24px 40px rgba(0,0,0,0.08)",
          display: "flex", alignItems: "center", justifyContent: "center", fontFamily: inter, fontWeight: 700, fontSize: 64, color: INK,
        }}
      >
        ⌘{label === "Copiar" ? "C" : "V"}
      </div>
      <p style={{ fontFamily: inter, fontWeight: 600, fontSize: 36, color: MUTED, margin: "26px 0 0" }}>{label}</p>
    </div>
  );
  return (
    <AbsoluteFill style={{ alignItems: "center" }}>
      <div style={{ position: "relative", width: 640, height: 400, marginTop: 220 }}>
        <div style={{ position: "absolute", left: 10 }}>{doc(1, 0, true)}</div>
        <div style={{ position: "absolute", left: 10 }}>{doc(p, p * 310, true)}</div>
      </div>
      <div style={{ display: "flex", gap: 90, marginTop: 70 }}>
        {copy && key(copy.text, c)}
        {paste && key(paste.text, p)}
      </div>
      {g.note && g.noteAtSeconds !== undefined && (
        <HandNote ctx={ctx} text={g.note} atSeconds={g.noteAtSeconds} x={600} y={90} arrow="down-left" color={ACCENT} size={60} />
      )}
    </AbsoluteFill>
  );
};

const Checklist: React.FC<GraphicProps & { width?: number }> = ({ g, ctx, width = 860 }) => {
  const s = pop(ctx, g.startSeconds);
  return (
    <Card style={{ width, padding: "48px 54px", opacity: s, transform: `translateY(${(1 - s) * 30}px)` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 30 }}>
        <ShieldMark size={50} />
        <p style={{ fontFamily: inter, fontWeight: 800, fontSize: 42, color: INK, margin: 0, letterSpacing: "-0.02em" }}>{g.title}</p>
      </div>
      {g.reveals.map((r) => {
        const on = pop(ctx, r.atSeconds);
        const tick = interpolate(ctx.frame - toFrame(r.atSeconds, ctx.fps), [4, 12], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        return (
          <div key={r.text} style={{ display: "flex", alignItems: "center", gap: 24, padding: "16px 0", opacity: 0.25 + on * 0.75 }}>
            <svg width={52} height={52} viewBox="0 0 52 52">
              <rect x={3} y={3} width={46} height={46} rx={13} fill={on > 0.5 ? ACCENT : "none"} stroke={on > 0.5 ? ACCENT : "#d6d0c9"} strokeWidth={4} />
              <path d="M14 27 L23 35 L39 17" fill="none" stroke="white" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={tick} />
            </svg>
            <p style={{ fontFamily: inter, fontWeight: 600, fontSize: 46, color: INK, margin: 0, letterSpacing: "-0.02em" }}>{r.text}</p>
          </div>
        );
      })}
    </Card>
  );
};

const Preguntas: React.FC<GraphicProps> = ({ g, ctx }) => (
  <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", top: -240 }}>
    <Checklist g={g} ctx={ctx} />
    {g.note && g.noteAtSeconds !== undefined && (
      <HandNote ctx={ctx} text={g.note} atSeconds={g.noteAtSeconds} x={330} y={1290} arrow="up-right" color={ACCENT} size={62} />
    )}
  </AbsoluteFill>
);

/** Mitad de arriba en blanco con la lista; la mitad de abajo deja ver al presentador. */
const ListaSplit: React.FC<GraphicProps> = ({ g, ctx }) => (
  <AbsoluteFill>
    <div style={{ position: "absolute", inset: 0, bottom: "50%", background: PAPER, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Checklist g={g} ctx={ctx} width={820} />
    </div>
  </AbsoluteFill>
);

const Armas: React.FC<GraphicProps> = ({ g, ctx }) => {
  const seconds = ctx.frame / ctx.fps;
  const currentIndex = Math.max(0, g.reveals.filter((r) => r.atSeconds <= seconds).length - 1);
  const current = g.reveals[currentIndex];
  const local = ctx.frame - toFrame(current.atSeconds, ctx.fps);
  const draw = interpolate(local, [0, 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const s = pop(ctx, current.atSeconds);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", top: -240 }}>
      <div style={{ transform: `scale(${0.85 + s * 0.15})`, textAlign: "center" }}>
        <WeaponIcon name={current.text} size={420} draw={draw} />
        <p style={{ fontFamily: hand, fontWeight: 700, fontSize: 96, color: ACCENT, margin: "10px 0 0" }}>tu {current.text}</p>
      </div>
      <div style={{ display: "flex", gap: 34, marginTop: 50 }}>
        {g.reveals.map((r, i) => (
          <div
            key={r.text}
            style={{
              width: 110, height: 110, borderRadius: 26, background: "white", boxShadow: CARD_SHADOW,
              display: "flex", alignItems: "center", justifyContent: "center",
              opacity: i <= currentIndex && r.atSeconds <= seconds ? 1 : 0.3,
              outline: i === currentIndex ? `4px solid ${ACCENT}` : "none",
            }}
          >
            <WeaponIcon name={r.text} size={76} draw={1} color={i === currentIndex ? ACCENT : INK} />
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

const Cta: React.FC<GraphicProps> = ({ g, ctx }) => {
  const s = pop(ctx, g.startSeconds);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", top: -240 }}>
      <div style={{ opacity: s, transform: `rotate(${-3 + s * 3}deg) translateY(${(1 - s) * 40}px)` }}>
        <div
          style={{
            width: 520, height: 680, borderRadius: "18px 34px 34px 18px", background: "#2a2523",
            boxShadow: "inset 22px 0 0 #1c1817, 0 30px 70px rgba(0,0,0,0.25)",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 30,
          }}
        >
          <ShieldMark size={120} />
          <p style={{ fontFamily: serif, fontSize: 92, color: "#F6EFE6", margin: 0 }}>{g.title}</p>
          <p style={{ fontFamily: inter, fontWeight: 600, fontSize: 34, color: "#bfb6ad", margin: 0, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            {g.body}
          </p>
        </div>
      </div>
      {g.note && g.noteAtSeconds !== undefined && (
        <HandNote ctx={ctx} text={g.note} atSeconds={g.noteAtSeconds} x={600} y={430} arrow="down-left" color={ACCENT} size={64} />
      )}
    </AbsoluteFill>
  );
};

const Graphic: React.FC<GraphicProps> = ({ g, ctx }) => {
  const isSplit = g.kind === "lista-split";
  // Corte seco como en la referencia, con un leve asentado de escala al entrar.
  const local = ctx.frame - toFrame(g.startSeconds, ctx.fps);
  const settle = interpolate(local, [0, 8], [1.04, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const content = (() => {
    switch (g.kind) {
      case "versus": return <Versus g={g} ctx={ctx} />;
      case "armadura": return <Armadura g={g} ctx={ctx} />;
      case "equivocada": return <Armadura g={g} ctx={ctx} crossed />;
      case "versiculo": return <Versiculo g={g} ctx={ctx} />;
      case "cita": return <Cita g={g} ctx={ctx} />;
      case "tarjetas": return <Tarjetas g={g} ctx={ctx} />;
      case "copiar": return <Copiar g={g} ctx={ctx} />;
      case "preguntas": return <Preguntas g={g} ctx={ctx} />;
      case "lista-split": return <ListaSplit g={g} ctx={ctx} />;
      case "armas": return <Armas g={g} ctx={ctx} />;
      case "cta": return <Cta g={g} ctx={ctx} />;
    }
  })();
  return (
    <AbsoluteFill style={{ background: isSplit ? undefined : `radial-gradient(ellipse at 50% 35%, #FBFAF8 0%, ${PAPER} 60%, #EFECE8 100%)` }}>
      <AbsoluteFill style={{ transform: `scale(${settle})` }}>{content}</AbsoluteFill>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// Título de apertura y subtítulos
// ---------------------------------------------------------------------------

const TitleCard: React.FC<{ kicker: string; headline: string; ctx: Ctx }> = ({ kicker, headline, ctx }) => {
  const typed = Math.floor(interpolate(ctx.frame, [4, 4 + headline.length * 1.3], [0, headline.length], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const mark = pop(ctx, 0);
  const kickerIn = interpolate(ctx.frame, [headline.length * 1.3, headline.length * 1.3 + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", left: 70, right: 70, top: "56%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
        <div style={{ transform: `scale(${mark}) rotate(${(1 - mark) * -40}deg)` }}>
          <ShieldMark size={100} />
        </div>
        <p style={{ fontFamily: serif, fontSize: 100, lineHeight: 0.95, color: "white", margin: 0, whiteSpace: "nowrap", textShadow: "0 4px 30px rgba(0,0,0,0.55)" }}>
          {headline.slice(0, typed)}
        </p>
      </div>
      <p style={{ fontFamily: inter, fontWeight: 600, fontSize: 40, color: "white", margin: "16px 0 0 124px", opacity: kickerIn, textShadow: "0 2px 16px rgba(0,0,0,0.6)" }}>
        {kicker}
      </p>
    </div>
  );
};

const Subtitle: React.FC<{ chunk: CaptionChunk; onPaper: boolean; top: string }> = ({ chunk, onPaper, top }) => (
  <div className="absolute inset-x-0 flex justify-center px-16" style={{ top }}>
    <p
      className="text-center"
      style={{
        fontFamily: inter,
        fontWeight: 700,
        fontSize: onPaper ? 52 : 60,
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
  const active = guion.graphics.find((g) => seconds >= g.startSeconds && seconds < g.startSeconds + g.durationInSeconds) ?? null;
  const isSplit = active?.kind === "lista-split";
  const onPaper = active !== null && !isSplit;
  const showTitle = seconds < guion.title.durationInSeconds;
  const chunk = findActiveChunk(guion.captionChunks, seconds);
  const speakerScale = isSplit ? 1 : speakerScaleAt(guion.jumpCuts, seconds);

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
            transform: isSplit ? `translateY(${SPLIT_VIDEO_SHIFT})` : `scale(${speakerScale})`,
            transformOrigin: SPEAKER_ORIGIN,
            filter: "contrast(1.06) saturate(1.08) brightness(0.98)",
          }}
        />
        {/* Viñeta cálida suave para acercarse al look cinematográfico de la referencia. */}
        <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 35%, rgba(0,0,0,0) 45%, rgba(20,10,0,0.45) 100%)" }} />
        <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(255,140,60,0.06), rgba(0,0,0,0) 40%, rgba(255,120,40,0.05))", mixBlendMode: "soft-light" }} />
      </AbsoluteFill>

      {active && <Graphic g={active} ctx={ctx} />}

      {showTitle ? (
        <TitleCard kicker={guion.title.kicker} headline={guion.title.headline} ctx={ctx} />
      ) : (
        chunk && <Subtitle chunk={chunk} onPaper={onPaper} top={isSplit ? "86%" : onPaper ? "70%" : "60%"} />
      )}

      {guion.music && (
        <Sequence durationInFrames={durationInFrames} layout="none">
          <Audio src={staticFile(guion.music.path)} volume={musicVolume} loop />
        </Sequence>
      )}
      {guion.graphics.map((g) => (
        <Sequence key={`whoosh-${g.id}`} from={toFrame(g.startSeconds, fps)} durationInFrames={toFrame(guion.sfx.whooshDurationInSeconds, fps)} layout="none">
          <Audio src={staticFile(guion.sfx.whooshPath)} volume={() => WHOOSH_VOLUME} />
        </Sequence>
      ))}
      {guion.graphics.flatMap((g) =>
        g.reveals.map((r) => (
          <Sequence key={`pop-${g.id}-${r.text}`} from={toFrame(r.atSeconds, fps)} durationInFrames={toFrame(guion.sfx.popDurationInSeconds, fps)} layout="none">
            <Audio src={staticFile(guion.sfx.popPath)} volume={() => POP_VOLUME} />
          </Sequence>
        )),
      )}
    </AbsoluteFill>
  );
};
