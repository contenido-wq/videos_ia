import { Audio, Img, staticFile, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { loadFont as loadDisplayFont } from "@remotion/google-fonts/PlayfairDisplay";
import { loadFont as loadScriptFont } from "@remotion/google-fonts/Caveat";
import type { RenderedScene } from "../types/guion";

const { fontFamily: displayFont } = loadDisplayFont("normal", { weights: ["900"] });
const { fontFamily: scriptFont } = loadScriptFont("normal", { weights: ["700"] });

const ENTRANCE_FRAMES = 8;
const CUT_TRANSITION_FRAMES = 6;
const SHARED_LAND_SFX = "assets/shared/photo-land.mp3";

// Tres niveles de tamaño (chico / grande / mediano) para que el titular no
// sea uniforme, como en las referencias de estilo Vox: entrada corta, palabra
// clave enorme, remate en script.
function splitThreeTier(text: string) {
  const words = text.replace(/[.]+$/, "").split(" ");
  if (words.length <= 3) {
    return { lead: "", main: words.join(" "), tag: "" };
  }
  const leadCount = Math.max(1, Math.round(words.length * 0.22));
  const tagCount = Math.max(1, Math.round(words.length * 0.28));
  const mainCount = Math.max(1, words.length - leadCount - tagCount);
  const lead = words.slice(0, leadCount).join(" ");
  const main = words.slice(leadCount, leadCount + mainCount).join(" ");
  const tag = words.slice(leadCount + mainCount).join(" ");
  const highlightWord = main.split(" ").reduce((longest, w) => (w.length > longest.length ? w : longest), "");
  return { lead, main, tag, highlightWord };
}

function hashAngle(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return (h * Math.PI) / 180;
}
function hashInt(seed: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 1000;
  return h % mod;
}

const PaperGrain: React.FC = () => (
  <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
    <filter id="paper-grain">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} stitchTiles="stitch" />
      <feColorMatrix type="saturate" values="0" />
    </filter>
    <rect width="100%" height="100%" filter="url(#paper-grain)" opacity={0.06} />
  </svg>
);

const DoodleArrow: React.FC<{ progress: number; left: string; top: string }> = ({ progress, left, top }) => (
  <svg viewBox="0 0 200 160" style={{ position: "absolute", left, top, width: 120, height: 96, overflow: "visible" }}>
    <path
      d="M10,10 C 60,20 40,90 130,120"
      fill="none"
      stroke="#1a1a1a"
      strokeWidth={4}
      strokeLinecap="round"
      strokeDasharray="10 9"
      strokeDashoffset={(1 - progress) * 260}
      opacity={progress}
    />
    <path d="M130,120 L112,104 M130,120 L120,138" fill="none" stroke="#1a1a1a" strokeWidth={4} strokeLinecap="round" opacity={progress} />
  </svg>
);

// Partículas flotantes ambientales (motas de luz), sutil acento de motion
// graphics sobre las escenas de mayor impacto.
const FloatingParticles: React.FC<{ frame: number; fps: number; color?: string; count?: number }> = ({ frame, fps, color = "#f4c430", count = 10 }) => (
  <div className="pointer-events-none absolute inset-0 overflow-hidden">
    {Array.from({ length: count }).map((_, i) => {
      const seed = `particle-${i}`;
      const xPct = hashInt(seed + "x", 100);
      const size = 3 + hashInt(seed + "s", 5);
      const speed = 0.15 + hashInt(seed + "v", 10) / 40;
      const phase = hashInt(seed + "p", 100) / 100;
      const t = frame / fps;
      const yPct = (1 - (((t * speed + phase) % 1) + 1) % 1) * 100;
      const drift = Math.sin(t * 0.6 + i) * 14;
      const opacity = 0.15 + 0.35 * Math.sin((t * speed + phase) * Math.PI * 2 * 0.5 + i) ** 2;
      return (
        <div
          key={seed}
          className="absolute rounded-full"
          style={{
            left: `calc(${xPct}% + ${drift}px)`,
            top: `${yPct}%`,
            width: size,
            height: size,
            background: color,
            opacity,
            filter: "blur(0.5px)",
            boxShadow: `0 0 ${size * 2}px ${color}`,
          }}
        />
      );
    })}
  </div>
);

// Una foto con halftone + paneo multi-eje (no solo zoom) dentro de un
// contenedor de tamaño/posición arbitrario que le pasa el layout de arriba.
const HalftonePhoto: React.FC<{
  cuts: Array<{ path: string; startFrame: number; endFrame: number }>;
  frame: number;
  fps: number;
  objectPosition?: string;
}> = ({ cuts, frame, fps, objectPosition = "center" }) => (
  <div className="relative h-full w-full overflow-hidden">
    {cuts.map((cut, i) => {
      const localFrame = frame - cut.startFrame;
      const cutFrames = Math.max(cut.endFrame - cut.startFrame, 1);
      const cutEntrance = spring({ frame: localFrame, fps, config: { damping: 14, stiffness: 220 }, durationInFrames: CUT_TRANSITION_FRAMES });
      const angle = hashAngle(`${cut.path}-${i}`);
      const panDistance = 46;
      const panProgress = interpolate(localFrame, [0, cutFrames], [-1, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
      const panX = Math.cos(angle) * panDistance * panProgress;
      const panY = Math.sin(angle) * panDistance * panProgress;

      // Cuando no hay más fotos reales y se repite el mismo archivo para
      // llenar el corte, un pan distinto no alcanza: son los mismos pixeles,
      // así que el ojo no percibe corte, solo movimiento continuo. En vez de
      // repetir el plano abierto, saltamos a un encuadre de detalle (zoom +
      // otro punto de foco) para que cada repetición se lea como un plano
      // distinto: abierto -> detalle -> abierto.
      const isRepeat = i > 0 && cuts[i - 1].path === cut.path;
      const detailPositions = ["50% 6%", "28% 10%", "72% 8%", "50% 14%"];
      const detailPosition = detailPositions[hashInt(`${cut.path}-detail-${i}`, detailPositions.length)];
      const baseScale = isRepeat ? 1.85 : 1.22;
      const thisObjectPosition = isRepeat ? detailPosition : objectPosition;

      // El corte saliente debe apagarse en la MISMA ventana en que el
      // entrante se enciende (start..start+N), no antes (end-N..end): como
      // end === nextStart, usar ventanas distintas deja un hueco negro justo
      // en el punto de corte (ambos casi a 0 de opacidad a la vez).
      let opacity = 1;
      if (i > 0) opacity = Math.min(opacity, interpolate(frame, [cut.startFrame, cut.startFrame + CUT_TRANSITION_FRAMES], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
      if (i < cuts.length - 1) opacity = Math.min(opacity, interpolate(frame, [cut.endFrame, cut.endFrame + CUT_TRANSITION_FRAMES], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));

      return (
        <Img
          key={`${cut.path}-${i}`}
          src={staticFile(cut.path)}
          className="absolute inset-0 h-full w-full object-cover"
          style={{
            objectPosition: thisObjectPosition,
            filter: "grayscale(1) contrast(1.25)",
            transform: `scale(${baseScale + cutEntrance * 0.04}) translate(${panX}px, ${panY}px)`,
            opacity,
          }}
        />
      );
    })}
    <div
      className="pointer-events-none absolute inset-0"
      style={{ backgroundImage: "radial-gradient(circle, #000 1px, transparent 1.2px)", backgroundSize: "5px 5px", mixBlendMode: "multiply", opacity: 0.35 }}
    />
  </div>
);

// Varias fotos reales a la vez, tratadas como silueta/dúotono (no el retrato
// literal), en columnas que entran en cascada. Para el "collage de destacados".
const SilhouetteCollage: React.FC<{ paths: string[]; frame: number; fps: number; accent: string }> = ({ paths, frame, fps, accent }) => (
  <div className="absolute inset-0 flex">
    {paths.map((p, i) => {
      const localEntrance = spring({ frame: frame - i * 4, fps, config: { damping: 16, stiffness: 140 }, durationInFrames: 18 });
      const bob = Math.sin((frame / fps) * Math.PI * 2 * 0.3 + i) * 6;
      return (
        <div key={p} className="relative h-full flex-1 overflow-hidden" style={{ borderLeft: i > 0 ? "2px solid #00000022" : "none" }}>
          <Img
            src={staticFile(p)}
            className="absolute inset-0 h-full w-full object-cover"
            style={{
              objectPosition: "50% 20%",
              filter: "grayscale(1) brightness(0.9) contrast(1.4)",
              transform: `translateY(${(1 - localEntrance) * 60 + bob}px) scale(${1.08 + localEntrance * 0.05})`,
              opacity: localEntrance,
            }}
          />
          <div className="pointer-events-none absolute inset-0" style={{ background: accent, opacity: 0.1, mixBlendMode: "color" }} />
        </div>
      );
    })}
  </div>
);

// Muchas banderas/chips entrando en cascada rápida, en cuadrícula. Para
// "48 selecciones".
const FlagsCascade: React.FC<{ paths: string[]; frame: number; fps: number }> = ({ paths, frame, fps }) => {
  const cols = 6;
  return (
    <div className="absolute inset-0 flex flex-wrap content-center items-center justify-center gap-3 px-6">
      {paths.map((p, i) => {
        const pop = spring({ frame: frame - i * 2.2, fps, config: { damping: 12, stiffness: 260 }, durationInFrames: 14 });
        const bob = Math.sin((frame / fps) * Math.PI * 2 * 0.5 + i * 0.7) * 4;
        return (
          <div
            key={p + i}
            className="overflow-hidden rounded-md bg-white shadow-lg"
            style={{
              width: `${88 / (cols / 6)}px`,
              height: 60,
              transform: `scale(${pop}) translateY(${bob}px)`,
              opacity: pop,
            }}
          >
            <Img src={staticFile(p)} className="h-full w-full object-cover" />
          </div>
        );
      })}
    </div>
  );
};

// Dos fotos reales enfrentadas: la primera (veterano) entra desde la
// izquierda, la segunda (nueva generación) entra después desde la derecha.
const VsBattle: React.FC<{ paths: string[]; frame: number; fps: number; accent: string }> = ({ paths, frame, fps, accent }) => {
  const [leftPath, rightPath] = paths;
  const leftEntrance = spring({ frame, fps, config: { damping: 15, stiffness: 120 }, durationInFrames: 20 });
  const rightEntrance = spring({ frame: frame - 12, fps, config: { damping: 15, stiffness: 120 }, durationInFrames: 20 });
  const vsPop = spring({ frame: frame - 20, fps, config: { damping: 10, stiffness: 260 }, durationInFrames: 16 });

  return (
    <div className="absolute inset-0 overflow-hidden bg-black">
      <div
        className="absolute inset-y-0 left-0 w-1/2 overflow-hidden"
        style={{ transform: `translateX(${(1 - leftEntrance) * -100}%)` }}
      >
        <Img src={staticFile(leftPath)} className="absolute inset-0 h-full w-full object-cover" style={{ objectPosition: "60% 20%", filter: "grayscale(1) contrast(1.6) brightness(0.8)" }} />
        <div className="absolute inset-0" style={{ background: "linear-gradient(90deg, transparent 60%, rgba(0,0,0,0.65) 100%)" }} />
      </div>
      <div
        className="absolute inset-y-0 right-0 w-1/2 overflow-hidden"
        style={{ transform: `translateX(${(1 - rightEntrance) * 100}%)` }}
      >
        <Img src={staticFile(rightPath)} className="absolute inset-0 h-full w-full object-cover" style={{ objectPosition: "40% 20%", filter: "grayscale(1) contrast(1.6) brightness(0.8)" }} />
        <div className="absolute inset-0" style={{ background: "linear-gradient(-90deg, transparent 60%, rgba(0,0,0,0.65) 100%)" }} />
      </div>
      {/* Corrido hacia abajo (no al centro exacto): el titular ahora se
          centra en TODO el frame, y a 50% chocaba de lleno con este badge. */}
      <div
        className="absolute left-1/2 flex h-24 w-24 items-center justify-center rounded-full"
        style={{
          top: "83%",
          background: accent,
          transform: `translate(-50%, -50%) scale(${vsPop}) rotate(-6deg)`,
          boxShadow: "0 0 40px rgba(0,0,0,0.6)",
        }}
      >
        <span style={{ fontFamily: displayFont, fontWeight: 900, fontSize: 34, color: "#161616" }}>VS</span>
      </div>
    </div>
  );
};

export const CollageScene: React.FC<{ scene: RenderedScene; accent?: string }> = ({ scene, accent = "#f4c430" }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { lead, main, tag, highlightWord } = splitThreeTier(scene.text);

  const entrance = spring({ frame, fps, config: { damping: 14, stiffness: 200, mass: 0.6 }, durationInFrames: ENTRANCE_FRAMES + 6 });
  const arrowProgress = spring({ frame: frame - 6, fps, config: { damping: 16, stiffness: 90 }, durationInFrames: 20 });

  let cursorSeconds = 0;
  const cuts = scene.images.map((image) => {
    const startFrame = Math.round(cursorSeconds * fps);
    cursorSeconds += image.durationInSeconds;
    const endFrame = Math.round(cursorSeconds * fps);
    return { ...image, startFrame, endFrame };
  });

  const layout = scene.layout ?? "full";
  const tagBoxed = hashInt(scene.id, 2) === 0;
  const arrowLeft = hashInt(scene.id + "a", 2) === 0 ? "6%" : "72%";

  const darkLayouts = ["full", "silhouette-collage", "flags-cascade", "vs-battle", "stat-reveal", "logo-cta"];
  const isDarkBg = darkLayouts.includes(layout);

  const textShadow = isDarkBg ? "0 2px 14px rgba(0,0,0,0.55)" : "none";
  const mainWords = main.split(" ");
  const leadSpring = spring({ frame, fps, config: { damping: 14, stiffness: 210 }, durationInFrames: 12 });
  const tagSpring = spring({ frame: frame - 6 - mainWords.length * 2, fps, config: { damping: 14, stiffness: 210 }, durationInFrames: 12 });

  // Texto centrado lateral (text-center) Y verticalmente: la franja abarca
  // todo el alto del video con flex justify-center, así el bloque queda en
  // el centro exacto del frame sin importar cuántas líneas ocupe.
  // Kinetic type: cada palabra del titular entra con su propio delay
  // (stagger), en vez de que todo el bloque aparezca de una sola vez.
  const Headline = (
    <div
      className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-8 text-center"
      style={{ opacity: entrance }}
    >
      {lead && (
        <div
          style={{
            fontFamily: scriptFont,
            fontWeight: 700,
            fontSize: 32,
            color: isDarkBg ? "#f4f0e4" : "#3a3324",
            marginBottom: 2,
            textShadow,
            opacity: leadSpring,
            transform: `translateY(${(1 - leadSpring) * 14}px)`,
          }}
        >
          {lead}
        </div>
      )}
      <span style={{ fontFamily: displayFont, fontWeight: 900, fontSize: 60, lineHeight: 1.3, color: isDarkBg ? "#fff" : "#161616", textShadow }}>
        {mainWords.map((word, i) => {
          const wordSpring = spring({ frame: frame - 6 - i * 2, fps, config: { damping: 14, stiffness: 210 }, durationInFrames: 12 });
          const isHighlight = word === highlightWord && word.length > 0;
          const animStyle = { opacity: wordSpring, transform: `translateY(${(1 - wordSpring) * 18}px)` };
          const marginRight = i < mainWords.length - 1 ? "0.28em" : 0;
          // Ojo: el fondo resaltado usa "inset" en porcentaje, que depende de
          // que ESTE span (no uno extra envolviéndolo) sea su contenedor con
          // alto definido por el propio texto — anidar otro span animado
          // alrededor rompe ese cálculo y el rectángulo invade la línea de
          // abajo.
          if (isHighlight) {
            return (
              <span key={i} style={{ position: "relative", display: "inline-block", verticalAlign: "baseline", padding: "0 6px", marginRight, ...animStyle }}>
                {/* Alto fijo y chico en px: con lineHeight ajustado (1.3) hay
                    aire de sobra entre líneas, pero el rectángulo debe seguir
                    siendo más bajo que ese hueco o vuelve a invadir la línea
                    de abajo cuando el titular envuelve. */}
                <span style={{ position: "absolute", top: 14, bottom: 14, left: -4, right: -4, background: accent, transform: "rotate(-1.5deg)", zIndex: 0 }} />
                <span style={{ position: "relative", zIndex: 1, color: "#161616", textShadow: "none" }}>{word}</span>
              </span>
            );
          }
          return (
            <span key={i} style={{ display: "inline-block", marginRight, ...animStyle }}>
              {word}
            </span>
          );
        })}
      </span>
      {tag && (
        <div className="mt-1" style={{ opacity: tagSpring, transform: `translateY(${(1 - tagSpring) * 14}px)` }}>
          {tagBoxed ? (
            <span style={{ fontFamily: scriptFont, fontWeight: 700, fontSize: 38, background: "#161616", color: accent, padding: "2px 10px" }}>{tag}</span>
          ) : (
            <span style={{ fontFamily: scriptFont, fontWeight: 700, fontSize: 40, color: isDarkBg ? "#f4f0e4" : "#2a2a2a", textShadow }}>{tag}</span>
          )}
        </div>
      )}
    </div>
  );

  const Badge = scene.badgeImagePath && (
    <div
      className="absolute right-[6%] top-[6%] flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-white p-3 shadow-2xl"
      style={{ opacity: entrance, transform: `scale(${entrance}) rotate(${(1 - entrance) * 20}deg)` }}
    >
      <Img src={staticFile(scene.badgeImagePath)} className="h-full w-full object-contain" />
    </div>
  );

  const Audios = (
    <>
      <Audio src={staticFile(scene.audioPath)} />
      <Audio src={staticFile(SHARED_LAND_SFX)} volume={0.4} />
      {scene.sfxPath && <Audio src={staticFile(scene.sfxPath)} volume={0.5} />}
    </>
  );

  if (layout === "flags-cascade" && scene.collageImagePaths?.length) {
    // Sin titular: las banderas ya comunican "48 selecciones" por sí solas,
    // el texto encima solo estorbaba.
    return (
      <div className="absolute inset-0 overflow-hidden" style={{ background: "linear-gradient(160deg, #171310 0%, #241d12 100%)" }}>
        <FloatingParticles frame={frame} fps={fps} color={accent} count={14} />
        <FlagsCascade paths={scene.collageImagePaths} frame={frame} fps={fps} />
        <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.05) 30%, rgba(0,0,0,0.05) 70%, rgba(0,0,0,0.7) 100%)" }} />
        {Audios}
      </div>
    );
  }

  if (layout === "vs-battle" && scene.collageImagePaths && scene.collageImagePaths.length >= 2) {
    return (
      <div className="absolute inset-0 overflow-hidden">
        <VsBattle paths={scene.collageImagePaths} frame={frame} fps={fps} accent={accent} />
        {Headline}
        {Audios}
      </div>
    );
  }

  if (layout === "stat-reveal") {
    const numberPop = spring({ frame: frame - 16, fps, config: { damping: 11, stiffness: 200 }, durationInFrames: 18 });
    return (
      <div className="absolute inset-0 overflow-hidden bg-black">
        <HalftonePhoto cuts={cuts} frame={frame} fps={fps} objectPosition="65% 20%" />
        <div className="absolute inset-0" style={{ background: "linear-gradient(90deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.15) 45%, rgba(0,0,0,0.85) 100%), linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.05) 30%, rgba(0,0,0,0.05) 60%, rgba(0,0,0,0.7) 100%)" }} />
        {scene.statNumber && (
          <div
            className="absolute bottom-[16%] right-[6%] flex flex-col items-center justify-center rounded-full"
            style={{
              width: 168,
              height: 168,
              background: `radial-gradient(circle at 35% 30%, #fff7e0, ${accent})`,
              transform: `scale(${numberPop}) rotate(${(1 - numberPop) * -25}deg)`,
              boxShadow: "0 10px 40px rgba(0,0,0,0.5)",
            }}
          >
            <span style={{ fontFamily: displayFont, fontWeight: 900, fontSize: 58, color: "#161616", lineHeight: 1 }}>{scene.statNumber}</span>
            {scene.statLabel && <span style={{ fontFamily: scriptFont, fontWeight: 700, fontSize: 22, color: "#161616" }}>{scene.statLabel}</span>}
          </div>
        )}
        {Headline}
        {Audios}
      </div>
    );
  }

  if (layout === "logo-cta") {
    const logoPop = spring({ frame, fps, config: { damping: 11, stiffness: 170 }, durationInFrames: 22 });
    const ctaEntrance = spring({ frame: frame - 14, fps, config: { damping: 13, stiffness: 200 }, durationInFrames: 18 });
    return (
      <div className="absolute inset-0 overflow-hidden" style={{ background: "linear-gradient(160deg, #171310 0%, #241d12 100%)" }}>
        <FloatingParticles frame={frame} fps={fps} color={accent} count={16} />
        {/* Debajo del titular (ahora centrado en todo el frame), no encima:
            si no, el "SÍGUEME" queda arriba de la narración y se lee al
            revés. */}
        <div className="absolute inset-x-0 top-[58%] flex flex-col items-center gap-6">
          <div
            className="h-40 w-40 overflow-hidden rounded-3xl bg-white p-5 shadow-2xl"
            style={{ transform: `scale(${logoPop}) rotate(${(1 - logoPop) * -30}deg)`, opacity: logoPop }}
          >
            {cuts[0] && <Img src={staticFile(cuts[0].path)} className="h-full w-full object-contain" />}
          </div>
          {scene.ctaSubtext && (
            <span
              style={{
                fontFamily: displayFont,
                fontWeight: 900,
                fontSize: 64,
                letterSpacing: 4,
                color: "#fff",
                opacity: ctaEntrance,
                transform: `translateY(${(1 - ctaEntrance) * 20}px)`,
              }}
            >
              {scene.ctaSubtext}
            </span>
          )}
        </div>
        {Headline}
        {Audios}
      </div>
    );
  }

  if (layout === "silhouette-collage" && scene.collageImagePaths?.length) {
    return (
      <div className="absolute inset-0 overflow-hidden" style={{ background: "#171310" }}>
        <SilhouetteCollage paths={scene.collageImagePaths} frame={frame} fps={fps} accent={accent} />
        <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0.05) 32%, rgba(0,0,0,0.05) 62%, rgba(0,0,0,0.55) 100%)" }} />
        {Headline}
        {Audios}
      </div>
    );
  }

  if (layout === "full") {
    const isMapScene = scene.id.includes("map") || scene.text.toLowerCase().includes("estados unidos");
    // Brillo pulsante opcional (usado en el mapa para resaltar la zona sede).
    const glowPulse = 1 + Math.sin((frame / fps) * Math.PI * 2 * 0.5) * 0.15;
    return (
      <div className="absolute inset-0 overflow-hidden bg-black">
        <HalftonePhoto cuts={cuts} frame={frame} fps={fps} />
        {isMapScene ? (
          <div
            className="pointer-events-none absolute left-[30%] top-[42%] h-[26%] w-[46%] rounded-full"
            style={{
              background: `radial-gradient(circle, ${accent}aa 0%, transparent 70%)`,
              transform: `scale(${glowPulse})`,
              mixBlendMode: "screen",
              opacity: entrance,
            }}
          />
        ) : null}
        <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.05) 30%, rgba(0,0,0,0.05) 60%, rgba(0,0,0,0.75) 100%)" }} />
        {Badge}
        {Headline}
        {Audios}
      </div>
    );
  }

  if (layout === "layered") {
    return (
      <div className="absolute inset-0 overflow-hidden" style={{ background: "#efe6d3" }}>
        <PaperGrain />
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at center, transparent 55%, rgba(60,45,20,0.18) 100%)" }} />
        <div className="absolute left-[6%] top-[40%] h-[30%] w-[52%]" style={{ background: accent, transform: "rotate(4deg)", opacity: entrance }} />
        <div
          className="absolute left-[8%] top-[42%] h-[26%] w-[46%] overflow-hidden bg-white p-2 shadow-2xl"
          style={{ transform: `rotate(6deg) scale(${0.9 + entrance * 0.1})`, opacity: entrance, zIndex: 1 }}
        >
          <HalftonePhoto cuts={cuts} frame={frame} fps={fps} objectPosition="30% 30%" />
        </div>
        <div
          className="absolute left-[38%] top-[52%] h-[36%] w-[58%] overflow-hidden bg-white p-[10px] shadow-2xl"
          style={{ transform: `rotate(-4deg) scale(${0.9 + entrance * 0.1})`, opacity: entrance, zIndex: 2 }}
        >
          <HalftonePhoto cuts={cuts} frame={frame} fps={fps} objectPosition="70% 40%" />
        </div>
        <DoodleArrow progress={arrowProgress} left={arrowLeft} top="30%" />
        {Headline}
        {Audios}
      </div>
    );
  }

  // "framed": foto grande tipo recorte pegado (usar con moderación; el resto
  // de layouts prefiere pantalla completa para no perder contexto).
  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: "#efe6d3" }}>
      <PaperGrain />
      <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at center, transparent 55%, rgba(60,45,20,0.18) 100%)" }} />

      <div className="absolute left-[5%] top-[30%] h-[62%] w-[90%]" style={{ background: accent, transform: "rotate(2deg)", opacity: entrance }} />

      <div
        className="absolute left-[7%] top-[32%] h-[58%] w-[86%] overflow-hidden bg-white p-[10px] shadow-2xl"
        style={{ transform: `rotate(-2.2deg) scale(${0.92 + entrance * 0.08})`, opacity: entrance }}
      >
        <HalftonePhoto cuts={cuts} frame={frame} fps={fps} />
      </div>

      <DoodleArrow progress={arrowProgress} left={arrowLeft} top="26%" />
      {Headline}
      {Audios}
    </div>
  );
};
