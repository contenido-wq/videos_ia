import { describe, it, expect } from "vitest";
import { matchViralTitleReasons } from "./channelAnalysisService";
import type { ChannelVideo } from "./youtubeService";

function video(overrides: Partial<ChannelVideo>): ChannelVideo {
  return {
    videoId: "v",
    title: "Título",
    description: "",
    tags: [],
    publishedAt: "2026-01-01T00:00:00Z",
    thumbnailUrl: "https://example.com/thumb.jpg",
    viewCount: 0,
    ...overrides,
  };
}

describe("matchViralTitleReasons", () => {
  it("matchea cada video con su razón por título exacto, sin importar el orden", () => {
    const topByViews = [video({ title: "Título A", viewCount: 100 }), video({ title: "Título B", viewCount: 50 })];
    const rawReasons = [
      { title: "Título B", reason: "Razón B" },
      { title: "Título A", reason: "Razón A" },
    ];

    const result = matchViralTitleReasons(topByViews, rawReasons);

    expect(result).toEqual([
      { title: "Título A", viewCount: 100, reason: "Razón A" },
      { title: "Título B", viewCount: 50, reason: "Razón B" },
    ]);
  });

  it("deja reason vacío si no hay match para un título", () => {
    const topByViews = [video({ title: "Título A", viewCount: 100 })];
    const rawReasons: { title: string; reason: string }[] = [];

    const result = matchViralTitleReasons(topByViews, rawReasons);

    expect(result).toEqual([{ title: "Título A", viewCount: 100, reason: "" }]);
  });

  it("ignora razones devueltas que no matchean ningún video de la lista", () => {
    const topByViews = [video({ title: "Título A", viewCount: 100 })];
    const rawReasons = [{ title: "Título Inventado", reason: "no debería usarse" }];

    const result = matchViralTitleReasons(topByViews, rawReasons);

    expect(result).toEqual([{ title: "Título A", viewCount: 100, reason: "" }]);
  });
});
