import { describe, it, expect } from "vitest";
import { findSimpleIconSvg, renderSimpleIconToPng } from "./simpleIconsService";

describe("findSimpleIconSvg", () => {
  it("encuentra una marca conocida por nombre exacto", () => {
    const result = findSimpleIconSvg("Claude Code");
    expect(result).not.toBeNull();
    expect(result?.svg).toContain("<svg");
    expect(result?.hex).toMatch(/^[0-9A-Fa-f]{6}$/);
  });

  it("no distingue mayúsculas/espacios/tildes", () => {
    const result = findSimpleIconSvg("notebook lm");
    expect(result).not.toBeNull();
    expect(result?.svg).toContain("NotebookLM");
  });

  it("devuelve null para una marca que no está en la biblioteca", () => {
    // Gamma (la app de presentaciones con IA) no está en simple-icons.
    expect(findSimpleIconSvg("Gamma")).toBeNull();
  });

  it("devuelve null para un nombre inventado", () => {
    expect(findSimpleIconSvg("Esta Marca No Existe Seguro 12345")).toBeNull();
  });
});

describe("renderSimpleIconToPng", () => {
  it("renderiza un PNG válido (firma de archivo PNG)", () => {
    const icon = findSimpleIconSvg("Claude Code");
    if (!icon) throw new Error("fixture no encontrada");
    const png = renderSimpleIconToPng(icon.svg, icon.hex);
    // Firma PNG: 89 50 4E 47 0D 0A 1A 0A
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });
});
