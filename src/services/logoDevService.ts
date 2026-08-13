import { env } from "./env";

const IMG_BASE_URL = "https://img.logo.dev";

/**
 * Busca el logo de una marca por NOMBRE en Logo.dev (50M+ empresas, CDN,
 * gratis hasta 500K requests/mes). Requiere LOGO_DEV_API_KEY (publishable
 * key, "pk_...", gratis en logo.dev/dashboard) en .env — si no está
 * configurada, devuelve null.
 *
 * OJO — este endpoint (por nombre) NUNCA da 404: si no encuentra la marca,
 * devuelve 200 OK con una letra genérica en vez de la nada (comprobado en
 * vivo), del mismo tamaño de archivo que un logo real — no hay forma
 * confiable de distinguirlos desde acá. La única forma correcta de saber si
 * hubo match real es la Search API (api.logo.dev/search), que sí devuelve
 * vacío en un no-match, pero pide una "secret key" (sk_...) aparte de la
 * publishable key que usa este endpoint. Por eso este servicio se usa como
 * ÚLTIMO recurso en la cadena de logos (después de Google Images/Wikimedia,
 * antes de generar con IA) — no como fuente temprana y confiable.
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
