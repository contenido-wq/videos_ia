import { describe, it, expect } from "vitest";
import { matchItemTimestamps, matchSceneTimestamps, type TranscribedWord } from "./checklistSyncService";
import type { ChecklistItem, PantallaDivididaScene } from "../types/guion";

function w(text: string, start: number, end: number): TranscribedWord {
  return { text, start, end };
}

describe("matchItemTimestamps", () => {
  it("encuentra un item de una sola palabra y devuelve su timestamp real", () => {
    const words = [w("Hola", 0, 0.3), w("ManyChat", 0.3, 0.9), w("es", 0.9, 1.0)];
    const items: ChecklistItem[] = [{ id: "1", label: "ManyChat", logoQuery: "ManyChat logo" }];

    const result = matchItemTimestamps(words, items, 10);

    expect(result).toEqual([{ item: items[0], startSeconds: 0.3, matched: true }]);
  });

  it("encuentra un item de varias palabras consecutivas", () => {
    const words = [w("usa", 0, 0.2), w("Claude", 0.2, 0.5), w("Code", 0.5, 0.8), w("ya", 0.8, 0.9)];
    const items: ChecklistItem[] = [{ id: "1", label: "Claude Code", logoQuery: "Claude logo" }];

    const result = matchItemTimestamps(words, items, 10);

    expect(result[0]).toEqual({ item: items[0], startSeconds: 0.2, matched: true });
  });

  it("ignora mayúsculas/acentos al comparar", () => {
    const words = [w("cloud", 0, 0.4)];
    const items: ChecklistItem[] = [{ id: "1", label: "CLOUD", logoQuery: "q" }];

    const result = matchItemTimestamps(words, items, 10);

    expect(result[0].matched).toBe(true);
    expect(result[0].startSeconds).toBe(0);
  });

  it("si no encuentra un item, le asigna tiempo estimado y matched=false, sin fallar", () => {
    const words = [w("hola", 0, 0.3), w("mundo", 0.3, 0.6)];
    const items: ChecklistItem[] = [{ id: "1", label: "Claude", logoQuery: "q" }];

    const result = matchItemTimestamps(words, items, 20);

    expect(result[0].matched).toBe(false);
    expect(result[0].startSeconds).toBeGreaterThan(0);
    expect(result[0].startSeconds).toBeLessThanOrEqual(20);
  });

  it("reparte varios items sin match en orden entre 0 y la duración total", () => {
    const words: TranscribedWord[] = [];
    const items: ChecklistItem[] = [
      { id: "1", label: "Uno", logoQuery: "q" },
      { id: "2", label: "Dos", logoQuery: "q" },
      { id: "3", label: "Tres", logoQuery: "q" },
    ];

    const result = matchItemTimestamps(words, items, 30);

    expect(result.every((r) => !r.matched)).toBe(true);
    expect(result[0].startSeconds).toBeLessThan(result[1].startSeconds);
    expect(result[1].startSeconds).toBeLessThan(result[2].startSeconds);
    expect(result[2].startSeconds).toBeLessThanOrEqual(30);
  });

  it("descarta un match que sale antes que el del item anterior aceptado (falso positivo) y lo re-estima", () => {
    // "Segundo" aparece ANTES que "Primero" en la transcripción (caso raro/ruidoso) —
    // no debe hacer que el item 2 se muestre antes que el item 1 en pantalla.
    const words = [w("Segundo", 0, 0.5), w("luego", 0.5, 0.8), w("Primero", 5, 5.5)];
    const items: ChecklistItem[] = [
      { id: "1", label: "Primero", logoQuery: "q" },
      { id: "2", label: "Segundo", logoQuery: "q" },
    ];

    const result = matchItemTimestamps(words, items, 10);

    expect(result[0]).toEqual({ item: items[0], startSeconds: 5, matched: true });
    expect(result[1].matched).toBe(false);
    expect(result[1].startSeconds).toBeGreaterThanOrEqual(5);
    expect(result[1].startSeconds).toBeLessThanOrEqual(10);
  });

  it("nunca produce timestamps decrecientes en la lista completa, mezclando matches y estimados", () => {
    const words = [w("ManyChat", 8, 8.5)];
    const items: ChecklistItem[] = [
      { id: "1", label: "Claude", logoQuery: "q" }, // no está -> estimado
      { id: "2", label: "ManyChat", logoQuery: "q" }, // sí está en 8
      { id: "3", label: "AIVI", logoQuery: "q" }, // no está -> estimado, debe quedar >= 8
    ];

    const result = matchItemTimestamps(words, items, 20);

    for (let i = 1; i < result.length; i++) {
      expect(result[i].startSeconds).toBeGreaterThanOrEqual(result[i - 1].startSeconds);
    }
    expect(result[1]).toEqual({ item: items[1], startSeconds: 8, matched: true });
  });
});

describe("matchSceneTimestamps", () => {
  it("encuentra una escena y calcula su duración hasta que arranca la siguiente", () => {
    const words = [w("Había", 0, 0.3), w("una", 0.3, 0.5), w("vez", 0.5, 0.8), w("un", 5, 5.2), w("rey", 5.2, 5.6)];
    const scenes: PantallaDivididaScene[] = [
      { id: "s1", text: "Había una vez", act: "split" },
      { id: "s2", text: "un rey", act: "split" },
    ];

    const result = matchSceneTimestamps(words, scenes, 10);

    expect(result[0]).toEqual({ scene: scenes[0], startSeconds: 0, durationInSeconds: 5, matched: true });
    expect(result[1]).toEqual({ scene: scenes[1], startSeconds: 5, durationInSeconds: 5, matched: true });
  });

  it("la última escena dura hasta el final del video", () => {
    const words = [w("Fin", 8, 8.5)];
    const scenes: PantallaDivididaScene[] = [{ id: "s1", text: "Fin", act: "closing" }];

    const result = matchSceneTimestamps(words, scenes, 12);

    expect(result[0]).toEqual({ scene: scenes[0], startSeconds: 8, durationInSeconds: 4, matched: true });
  });

  it("si no encuentra el texto de una escena, le asigna tiempo estimado sin fallar", () => {
    const words = [w("hola", 0, 0.3)];
    const scenes: PantallaDivididaScene[] = [{ id: "s1", text: "texto que no está en la transcripción", act: "split" }];

    const result = matchSceneTimestamps(words, scenes, 20);

    expect(result[0].matched).toBe(false);
    expect(result[0].durationInSeconds).toBeGreaterThan(0);
    expect(result[0].startSeconds).toBeLessThanOrEqual(20);
  });

  it("funciona igual para escenas de cierre (act closing)", () => {
    const words = [w("moraleja", 9, 9.6)];
    const scenes: PantallaDivididaScene[] = [{ id: "s1", text: "moraleja", act: "closing" }];

    const result = matchSceneTimestamps(words, scenes, 10);

    expect(result[0]).toEqual({ scene: scenes[0], startSeconds: 9, durationInSeconds: 1, matched: true });
  });

  it("descarta un match fuera de orden y re-estima esa escena", () => {
    const words = [w("Segunda", 0, 0.5), w("luego", 0.5, 0.8), w("Primera", 5, 5.5)];
    const scenes: PantallaDivididaScene[] = [
      { id: "s1", text: "Primera", act: "split" },
      { id: "s2", text: "Segunda", act: "split" },
    ];

    const result = matchSceneTimestamps(words, scenes, 10);

    expect(result[0]).toEqual({ scene: scenes[0], startSeconds: 5, durationInSeconds: expect.any(Number), matched: true });
    expect(result[1].matched).toBe(false);
    expect(result[1].startSeconds).toBeGreaterThanOrEqual(5);
  });
});
