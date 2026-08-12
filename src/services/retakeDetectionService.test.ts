import { describe, it, expect } from "vitest";
import { resolveRetakeCandidates } from "./retakeDetectionService";
import type { TranscribedWord } from "./checklistSyncService";

function w(text: string, start: number, end: number): TranscribedWord {
  return { text, start, end };
}

describe("resolveRetakeCandidates", () => {
  const words = [
    w("La", 0.0, 0.2),
    w("herramienta.", 0.2, 0.6),
    w("Bueno,", 0.7, 0.9),
    w("la", 0.9, 1.0),
    w("herramienta", 1.0, 1.3),
    w("es", 1.3, 1.5),
    w("Gamma.", 1.5, 1.8),
  ];

  it("resuelve un rango de índices a start/end reales y arma el quote", () => {
    const result = resolveRetakeCandidates(
      [{ startIndex: 0, endIndex: 1, type: "retake", reason: "intento fallido" }],
      words,
    );
    expect(result).toEqual([
      { start: 0.0, end: 0.6, quote: "La herramienta.", type: "retake", reason: "intento fallido" },
    ]);
  });

  it("resuelve varios candidatos en el mismo batch", () => {
    const result = resolveRetakeCandidates(
      [
        { startIndex: 0, endIndex: 1, type: "retake", reason: "r1" },
        { startIndex: 2, endIndex: 2, type: "aside", reason: "r2" },
      ],
      words,
    );
    expect(result).toHaveLength(2);
    expect(result[1]).toEqual({ start: 0.7, end: 0.9, quote: "Bueno,", type: "aside", reason: "r2" });
  });

  it("descarta un candidato con endIndex fuera de rango en vez de fallar todo el batch", () => {
    const result = resolveRetakeCandidates(
      [
        { startIndex: 0, endIndex: 1, type: "retake", reason: "válido" },
        { startIndex: 5, endIndex: 99, type: "retake", reason: "índice inválido" },
      ],
      words,
    );
    expect(result).toEqual([
      { start: 0.0, end: 0.6, quote: "La herramienta.", type: "retake", reason: "válido" },
    ]);
  });

  it("descarta un candidato con endIndex menor que startIndex", () => {
    const result = resolveRetakeCandidates(
      [{ startIndex: 3, endIndex: 1, type: "retake", reason: "invertido" }],
      words,
    );
    expect(result).toEqual([]);
  });

  it("devuelve [] si no hay candidatos", () => {
    expect(resolveRetakeCandidates([], words)).toEqual([]);
  });
});
