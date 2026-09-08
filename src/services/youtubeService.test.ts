import { describe, it, expect } from "vitest";
import { parseChannelInput, selectVideosForAnalysis } from "./youtubeService";

describe("parseChannelInput", () => {
  it("reconoce un @handle suelto", () => {
    expect(parseChannelInput("@TheCapitalExplained")).toEqual({ forHandle: "TheCapitalExplained" });
  });

  it("reconoce un @handle dentro de una URL", () => {
    expect(parseChannelInput("https://www.youtube.com/@TheCapitalExplained")).toEqual({
      forHandle: "TheCapitalExplained",
    });
  });

  it("reconoce una URL /channel/UCxxxx", () => {
    expect(parseChannelInput("https://www.youtube.com/channel/UC6vaWd0dpXVzU_D4jeeSAQg")).toEqual({
      id: "UC6vaWd0dpXVzU_D4jeeSAQg",
    });
  });

  it("reconoce un channelId crudo", () => {
    expect(parseChannelInput("UC6vaWd0dpXVzU_D4jeeSAQg")).toEqual({ id: "UC6vaWd0dpXVzU_D4jeeSAQg" });
  });

  it("reconoce una URL legacy /user/", () => {
    expect(parseChannelInput("https://www.youtube.com/user/SomeUser")).toEqual({ forUsername: "SomeUser" });
  });

  it("reconoce una URL legacy /c/", () => {
    expect(parseChannelInput("https://www.youtube.com/c/SomeCustomName")).toEqual({
      forUsername: "SomeCustomName",
    });
  });

  it("trata texto plano sin @ ni URL como username", () => {
    expect(parseChannelInput("SomeChannelName")).toEqual({ forUsername: "SomeChannelName" });
  });
});

describe("selectVideosForAnalysis", () => {
  const now = new Date("2026-09-08T00:00:00Z");

  it("selecciona los videos publicados en los últimos 30 días", () => {
    const items = [
      { videoId: "a", publishedAt: "2026-08-26T09:07:29Z" },
      { videoId: "b", publishedAt: "2026-06-01T00:00:00Z" },
    ];
    const result = selectVideosForAnalysis(items, now);
    expect(result).toEqual({ selected: [items[0]], usedFallback: false });
  });

  it("cae a los últimos 10 si no hay ninguno en los últimos 30 días", () => {
    const items = Array.from({ length: 15 }, (_, i) => ({
      videoId: `v${i}`,
      publishedAt: "2026-01-01T00:00:00Z",
    }));
    const result = selectVideosForAnalysis(items, now);
    expect(result.usedFallback).toBe(true);
    expect(result.selected).toHaveLength(10);
    expect(result.selected).toEqual(items.slice(0, 10));
  });
});
