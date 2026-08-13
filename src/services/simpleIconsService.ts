import fs from "fs";
import path from "path";
import { Resvg } from "@resvg/resvg-js";

interface SimpleIconEntry {
  title: string;
  slug: string;
  hex: string;
}

let cachedIcons: SimpleIconEntry[] | null = null;

function loadIcons(): SimpleIconEntry[] {
  if (!cachedIcons) {
    const dataPath = path.join(path.dirname(require.resolve("simple-icons")), "data", "simple-icons.json");
    cachedIcons = JSON.parse(fs.readFileSync(dataPath, "utf-8")) as SimpleIconEntry[];
  }
  return cachedIcons;
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

// Busca un logo en simple-icons (biblioteca curada a mano, MIT, ~3400 marcas,
// sin llamadas a ninguna API — vive en node_modules) por nombre de marca.
// Coincidencia exacta de slug normalizado contra el nombre — usar item.label
// ("ChatGPT", "Notebook LM"), no logoQuery (tiene texto extra tipo "app logo"
// que nunca va a matchear un slug). Devuelve null si la marca no está en la
// biblioteca (ej. Gamma, AiVi no están) — cae al resto de la cadena de búsqueda.
export function findSimpleIconSvg(brandName: string): { svg: string; hex: string } | null {
  const target = normalize(brandName);
  const entry = loadIcons().find((icon) => normalize(icon.slug) === target);
  if (!entry) return null;

  const svgPath = path.join(path.dirname(require.resolve("simple-icons")), "icons", `${entry.slug}.svg`);
  const svg = fs.readFileSync(svgPath, "utf-8");
  return { svg, hex: entry.hex };
}

// Renderiza el SVG (monocromo, sin color propio) a PNG con el color oficial
// de la marca, fondo blanco — mismo estilo que ya usa el resto del pipeline
// para logos (ver el prompt de kie.ai: "plain white background").
export function renderSimpleIconToPng(svg: string, hex: string, size = 512): Buffer {
  const colored = svg.replace("<svg ", `<svg fill="#${hex}" `);
  const resvg = new Resvg(colored, {
    fitTo: { mode: "width", value: size },
    background: "white",
  });
  return resvg.render().asPng();
}
