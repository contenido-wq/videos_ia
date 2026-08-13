import { describe, it, expect } from "vitest";
import { computeCutFrames, computeActTwoStartFrame } from "./pantallaDivididaTiming";
import type { RenderedPantallaDivididaScene } from "../types/guion";

function scene(overrides: Partial<RenderedPantallaDivididaScene>): RenderedPantallaDivididaScene {
  return {
    id: "s",
    text: "",
    act: "split",
    startSeconds: 0,
    durationInSeconds: 0,
    matched: true,
    images: [],
    ...overrides,
  };
}

describe("computeCutFrames", () => {
  it("junta los cortes de todas las escenas split, en orden, con frames absolutos", () => {
    const scenes = [
      scene({
        id: "s1",
        durationInSeconds: 5,
        images: [
          { path: "a", durationInSeconds: 2.5 },
          { path: "b", durationInSeconds: 2.5 },
        ],
      }),
      scene({ id: "s2", durationInSeconds: 3, images: [{ path: "c", durationInSeconds: 3 }] }),
    ];

    const result = computeCutFrames(scenes, 30);

    expect(result).toEqual([0, 75, 150]);
  });

  it("ignora las escenas closing (no aportan cortes)", () => {
    const scenes = [
      scene({ id: "s1", durationInSeconds: 2, images: [{ path: "a", durationInSeconds: 2 }] }),
      scene({ id: "s2", act: "closing", durationInSeconds: 3, images: [] }),
    ];

    const result = computeCutFrames(scenes, 30);

    expect(result).toEqual([0]);
  });

  it("devuelve un array vacío si no hay escenas split", () => {
    const scenes = [scene({ id: "s1", act: "closing", durationInSeconds: 3, images: [] })];

    expect(computeCutFrames(scenes, 30)).toEqual([]);
  });
});

describe("computeActTwoStartFrame", () => {
  it("devuelve el frame donde arranca la primera escena closing", () => {
    const scenes = [
      scene({ id: "s1", durationInSeconds: 5, images: [] }),
      scene({ id: "s2", durationInSeconds: 3, images: [] }),
      scene({ id: "s3", act: "closing", durationInSeconds: 2, images: [] }),
    ];

    expect(computeActTwoStartFrame(scenes, 30)).toBe(240);
  });

  it("funciona si la escena closing no es la última", () => {
    const scenes = [
      scene({ id: "s1", durationInSeconds: 2, images: [] }),
      scene({ id: "s2", act: "closing", durationInSeconds: 3, images: [] }),
      scene({ id: "s3", durationInSeconds: 1, images: [] }),
    ];

    expect(computeActTwoStartFrame(scenes, 30)).toBe(60);
  });

  it("si no hay ninguna escena closing, devuelve la duración total", () => {
    const scenes = [
      scene({ id: "s1", durationInSeconds: 4, images: [] }),
      scene({ id: "s2", durationInSeconds: 2, images: [] }),
    ];

    expect(computeActTwoStartFrame(scenes, 30)).toBe(180);
  });
});
