export const MIN_CUTAWAY_SECONDS = 1.5;
export const MAX_CUTAWAY_SECONDS = 3;
export const DEFAULT_CUTAWAY_SECONDS = 2.5;
/** Sin cortes en el primer ni en el último segundo del video. */
export const EDGE_SECONDS = 1;
/** Presentador visible entre dos cortes seguidos. */
export const MIN_GAP_SECONDS = 0.4;

export interface CutawayRequest {
  id: string;
  startSeconds: number;
  durationSeconds?: number;
  /** Corte final: dura hasta el final del video (incluida la cola `outroSeconds`), sin tope de 3 s ni borde final. */
  closing?: boolean;
}

export interface ResolvedCutaway {
  id: string;
  startSeconds: number;
  durationSeconds: number;
}

export interface DroppedCutaway {
  id: string;
  reason: string;
}

/** Ajusta los cortes pedidos a las reglas del estilo: duración 1.5–3 s, sin bordes,
 * sin solapes (se desplaza el segundo; si ya no cabe, se descarta). */
export function resolveCutawayTimings(
  requests: CutawayRequest[],
  totalDurationSeconds: number,
  outroSeconds = 0,
): { resolved: ResolvedCutaway[]; dropped: DroppedCutaway[] } {
  const resolved: ResolvedCutaway[] = [];
  const dropped: DroppedCutaway[] = [];
  const latestEnd = totalDurationSeconds - EDGE_SECONDS;

  // El corte de cierre siempre se resuelve al final, después de todos los demás.
  const ordered = [...requests].sort(
    (a, b) => Number(a.closing ?? false) - Number(b.closing ?? false) || a.startSeconds - b.startSeconds,
  );

  for (const request of ordered) {
    const previous = resolved[resolved.length - 1];
    const earliestStart = previous ? previous.startSeconds + previous.durationSeconds + MIN_GAP_SECONDS : EDGE_SECONDS;
    const startSeconds = Math.max(request.startSeconds, EDGE_SECONDS, earliestStart);

    if (request.closing) {
      const closingDuration = totalDurationSeconds + outroSeconds - startSeconds;
      if (closingDuration < MIN_CUTAWAY_SECONDS) {
        dropped.push({ id: request.id, reason: `no cabe un corte de cierre de al menos ${MIN_CUTAWAY_SECONDS}s desde ${startSeconds.toFixed(1)}s` });
      } else {
        resolved.push({ id: request.id, startSeconds, durationSeconds: closingDuration });
      }
      continue;
    }

    const wanted = Math.min(
      Math.max(request.durationSeconds ?? DEFAULT_CUTAWAY_SECONDS, MIN_CUTAWAY_SECONDS),
      MAX_CUTAWAY_SECONDS,
    );
    const durationSeconds = Math.min(wanted, latestEnd - startSeconds);

    if (durationSeconds < MIN_CUTAWAY_SECONDS) {
      dropped.push({
        id: request.id,
        reason: `no cabe un corte de al menos ${MIN_CUTAWAY_SECONDS}s desde ${startSeconds.toFixed(1)}s`,
      });
      continue;
    }

    resolved.push({ id: request.id, startSeconds, durationSeconds });
  }

  return { resolved, dropped };
}

export interface JumpCut {
  atSeconds: number;
  scale: number;
}

/** Escalas (zoom sobre el presentador) que se alternan en cada jump cut. */
export const JUMP_CUT_SCALES = [1.16, 1, 1.3, 1];
export const JUMP_CUT_MIN_INTERVAL_SECONDS = 3;
const JUMP_CUT_CUTAWAY_MARGIN_SECONDS = 0.3;

/** Puntos donde el presentador "salta" de encuadre. Candidatos = inicios de bloque de subtítulo
 * (pausas naturales), separados al menos JUMP_CUT_MIN_INTERVAL_SECONDS, fuera de los cortes a imagen.
 * Además, cada vez que termina un corte a imagen el presentador vuelve con un encuadre distinto. */
export function computeJumpCuts(
  candidateSeconds: number[],
  cutaways: { startSeconds: number; durationSeconds: number }[],
  totalDurationSeconds: number,
): JumpCut[] {
  const insideCutaway = (t: number) =>
    cutaways.some(
      (c) =>
        t > c.startSeconds - JUMP_CUT_CUTAWAY_MARGIN_SECONDS &&
        t < c.startSeconds + c.durationSeconds + JUMP_CUT_CUTAWAY_MARGIN_SECONDS,
    );

  const events: { at: number; forced: boolean }[] = [
    ...candidateSeconds
      .filter((t) => t >= EDGE_SECONDS && t <= totalDurationSeconds - EDGE_SECONDS && !insideCutaway(t))
      .map((at) => ({ at, forced: false })),
    ...cutaways
      .map((c) => c.startSeconds + c.durationSeconds)
      .filter((t) => t < totalDurationSeconds - EDGE_SECONDS)
      .map((at) => ({ at, forced: true })),
  ].sort((a, b) => a.at - b.at);

  const cuts: JumpCut[] = [];
  let lastAt = -Infinity;
  for (const event of events) {
    if (!event.forced && event.at - lastAt < JUMP_CUT_MIN_INTERVAL_SECONDS) continue;
    cuts.push({ atSeconds: event.at, scale: JUMP_CUT_SCALES[cuts.length % JUMP_CUT_SCALES.length] });
    lastAt = event.at;
  }
  return cuts;
}

/** Escala del presentador en un instante: la del último jump cut ya ocurrido (1 antes del primero). */
export function speakerScaleAt(jumpCuts: JumpCut[], seconds: number): number {
  let scale = 1;
  for (const cut of jumpCuts) {
    if (cut.atSeconds <= seconds) scale = cut.scale;
    else break;
  }
  return scale;
}
