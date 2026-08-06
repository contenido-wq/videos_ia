import { downloadImageFromUrl } from "./apifyService";

const COMMONS_API_URL = "https://commons.wikimedia.org/w/api.php";

interface CommonsSearchResponse {
  query?: {
    pages?: Record<
      string,
      {
        title: string;
        imageinfo?: { url: string }[];
      }
    >;
  };
}

/**
 * Busca fotos reales en Wikimedia Commons (repositorio de imágenes de Wikipedia).
 * Gratis, sin API key. Úsalo primero para entidades reales e identificables
 * (personas, empresas, lugares, eventos) antes de generar con kie.ai.
 * Devuelve hasta `count` URLs distintas, o [] si no encontró nada.
 */
export async function findWikimediaImageUrls(query: string, count: number): Promise<string[]> {
  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: query,
    gsrnamespace: "6", // File:
    gsrlimit: String(Math.max(count, 5)),
    prop: "imageinfo",
    iiprop: "url",
    format: "json",
    origin: "*",
  });

  const res = await fetch(`${COMMONS_API_URL}?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Wikimedia Commons búsqueda falló: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as CommonsSearchResponse;
  const pages = data.query?.pages ? Object.values(data.query.pages) : [];

  const urls = pages
    .map((p) => p.imageinfo?.[0]?.url)
    .filter((url): url is string => typeof url === "string" && url.startsWith("http"));

  // Solo raster (png/jpg): el pipeline guarda todo con esa extensión, y un SVG
  // guardado como .png no se decodifica como imagen. Si Commons solo devuelve
  // SVGs, se descarta (se cae a kie.ai) en vez de arriesgar un archivo corrupto.
  const rasterUrls = urls.filter((url) => /\.(png|jpe?g)(\?|$)/i.test(url));

  if (rasterUrls.length === 0) return [];

  const picked: string[] = [];
  for (let i = 0; i < count; i++) {
    picked.push(rasterUrls[i % rasterUrls.length]);
  }
  return picked;
}

export async function downloadWikimediaImage(query: string, outputPath: string): Promise<string | null> {
  const [url] = await findWikimediaImageUrls(query, 1);
  if (!url) return null;
  return downloadImageFromUrl(url, outputPath);
}
