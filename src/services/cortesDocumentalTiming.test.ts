import { describe, it, expect } from "vitest";
import { resolveCutawayTimings, computeJumpCuts, speakerScaleAt, JUMP_CUT_SCALES } from "./cortesDocumentalTiming";

describe("resolveCutawayTimings", () => {
  it("usa 2.5 s por defecto y respeta la duración pedida dentro de 1.5–3 s", () => {
    const { resolved } = resolveCutawayTimings(
      [
        { id: "a", startSeconds: 5 },
        { id: "b", startSeconds: 15, durationSeconds: 2 },
      ],
      60,
    );
    expect(resolved).toEqual([
      { id: "a", startSeconds: 5, durationSeconds: 2.5 },
      { id: "b", startSeconds: 15, durationSeconds: 2 },
    ]);
  });

  it("limita la duración a 1.5–3 s", () => {
    const { resolved } = resolveCutawayTimings(
      [
        { id: "a", startSeconds: 5, durationSeconds: 0.5 },
        { id: "b", startSeconds: 15, durationSeconds: 10 },
      ],
      60,
    );
    expect(resolved.map((r) => r.durationSeconds)).toEqual([1.5, 3]);
  });

  it("mueve un corte pedido en el primer segundo al segundo 1", () => {
    const { resolved } = resolveCutawayTimings([{ id: "a", startSeconds: 0.2 }], 60);
    expect(resolved).toEqual([{ id: "a", startSeconds: 1, durationSeconds: 2.5 }]);
  });

  it("recorta un corte que llegaría al último segundo y lo descarta si queda menor a 1.5 s", () => {
    const { resolved, dropped } = resolveCutawayTimings(
      [
        { id: "a", startSeconds: 56, durationSeconds: 3 },
        { id: "b", startSeconds: 58.5 },
      ],
      60,
    );
    expect(resolved).toEqual([{ id: "a", startSeconds: 56, durationSeconds: 3 }]);
    expect(dropped.map((d) => d.id)).toEqual(["b"]);
  });

  it("desplaza un corte que se solapa con el anterior, dejando 0.4 s de presentador", () => {
    const { resolved } = resolveCutawayTimings(
      [
        { id: "a", startSeconds: 10, durationSeconds: 2.5 },
        { id: "b", startSeconds: 11 },
      ],
      60,
    );
    expect(resolved[1].id).toBe("b");
    expect(resolved[1].startSeconds).toBeCloseTo(12.9);
    expect(resolved[1].durationSeconds).toBe(2.5);
  });

  it("descarta el corte desplazado si ya no cabe antes del final", () => {
    const { resolved, dropped } = resolveCutawayTimings(
      [
        { id: "a", startSeconds: 55, durationSeconds: 3 },
        { id: "b", startSeconds: 56 },
      ],
      60,
    );
    expect(resolved.map((r) => r.id)).toEqual(["a"]);
    expect(dropped).toEqual([{ id: "b", reason: expect.stringContaining("no cabe") }]);
  });

  it("ordena por inicio aunque lleguen desordenados", () => {
    const { resolved } = resolveCutawayTimings(
      [
        { id: "late", startSeconds: 30 },
        { id: "early", startSeconds: 5 },
      ],
      60,
    );
    expect(resolved.map((r) => r.id)).toEqual(["early", "late"]);
  });

  it("descarta todo en un video demasiado corto", () => {
    const { resolved, dropped } = resolveCutawayTimings([{ id: "a", startSeconds: 1 }], 3);
    expect(resolved).toEqual([]);
    expect(dropped).toHaveLength(1);
  });
});

describe("resolveCutawayTimings — corte de cierre", () => {
  it("corre hasta el final del video más la cola, sin tope de 3 s ni borde final", () => {
    const { resolved } = resolveCutawayTimings(
      [
        { id: "a", startSeconds: 10 },
        { id: "end", startSeconds: 57, closing: true },
      ],
      60,
      2,
    );
    expect(resolved).toEqual([
      { id: "a", startSeconds: 10, durationSeconds: 2.5 },
      { id: "end", startSeconds: 57, durationSeconds: 5 },
    ]);
  });

  it("se resuelve después de los demás aunque llegue primero en la lista", () => {
    const { resolved } = resolveCutawayTimings(
      [
        { id: "end", startSeconds: 50, closing: true },
        { id: "a", startSeconds: 48, durationSeconds: 2.5 },
      ],
      60,
      2,
    );
    expect(resolved.map((r) => r.id)).toEqual(["a", "end"]);
    expect(resolved[1].startSeconds).toBeCloseTo(50.9);
  });
});

describe("computeJumpCuts", () => {
  it("respeta el intervalo mínimo entre candidatos y alterna las escalas", () => {
    const cuts = computeJumpCuts([2, 3, 5.5, 6, 9], [], 60);
    expect(cuts.map((c) => c.atSeconds)).toEqual([2, 5.5, 9]);
    expect(cuts.map((c) => c.scale)).toEqual(JUMP_CUT_SCALES.slice(0, 3));
  });

  it("ignora candidatos dentro de un corte a imagen y agrega un salto al terminar cada corte", () => {
    const cuts = computeJumpCuts([6, 12], [{ startSeconds: 5.5, durationSeconds: 2.5 }], 60);
    expect(cuts.map((c) => c.atSeconds)).toEqual([8, 12]);
  });

  it("no corta en el primer ni el último segundo", () => {
    const cuts = computeJumpCuts([0.5, 59.5], [], 60);
    expect(cuts).toEqual([]);
  });

  it("speakerScaleAt devuelve la escala del último salto ya ocurrido", () => {
    const cuts = [
      { atSeconds: 2, scale: 1.16 },
      { atSeconds: 6, scale: 1 },
    ];
    expect(speakerScaleAt(cuts, 1)).toBe(1);
    expect(speakerScaleAt(cuts, 2)).toBe(1.16);
    expect(speakerScaleAt(cuts, 5.9)).toBe(1.16);
    expect(speakerScaleAt(cuts, 7)).toBe(1);
  });
});
