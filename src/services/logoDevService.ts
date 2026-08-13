import { env } from "./env";

const IMG_BASE_URL = "https://img.logo.dev";

/**
 * Busca el logo de una marca por NOMBRE en Logo.dev (50M+ empresas, CDN,
 * gratis hasta 500K requests/mes — no confundir con Wikimedia/Apify, esto
 * está hecho específicamente para logos: sin búsqueda de texto de por medio,
 * sin riesgo de traer una imagen equivocada). Requiere LOGO_DEV_API_KEY
 * (publishable key, "pk_...", gratis en logo.dev/dashboard) en .env — si no
 * está configurada, o si la marca no se encuentra (404), devuelve null y el
 * pipeline cae al siguiente eslabón de la cadena (Google Images vía Apify).
 */
export async function findLogoDevUrl(companyName: string): Promise<string | null> {
  const apiKey = env.logoDevApiKey;
  if (!apiKey) return null;

  const slug = encodeURIComponent(companyName.trim());
  const url = `${IMG_BASE_URL}/name/${slug}?token=${apiKey}&format=png&size=512`;

  const res = await fetch(url);
  if (!res.ok) return null;

  return url;
}
