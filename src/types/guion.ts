export type ImageSource = "ai" | "real" | "character";

export interface GuionScene {
  id: string;
  text: string;
  visual: string;
  imageSource: ImageSource;
  apifyQuery?: string;
  /** URL exacta ya verificada (evita pagar otra búsqueda de Apify): se descarga directo. */
  realImageUrls?: string[];
  /** Logos reales (fondo transparente, se muestran en tarjeta) en vez de foto de escena a pantalla completa. */
  logo?: boolean;
  /** Escena "character" que usa tomas ya renderizadas localmente en vez de generar con kie.ai.
   * Si la narración supera MAX_CUT_SECONDS, se usan tantas como cortes se necesiten (en orden). */
  localImagePaths?: string[];
  /** Efecto de sonido opcional para esta escena (ElevenLabs sound-generation). */
  sfxPrompt?: string;
  /** Solo aplica con style "collage": "framed" (foto recortada chica, evitar),
   * "full" (foto a pantalla completa, default), "layered" (dos fotos superpuestas),
   * "silhouette-collage" (varias fotos en silueta a la vez), "flags-cascade"
   * (banderas entrando rápido), "vs-battle" (dos fotos enfrentadas tipo VS),
   * "stat-reveal" (foto + título + dato numérico) o "logo-cta" (logo entrando
   * + texto de llamado a la acción). */
  layout?: "framed" | "full" | "layered" | "silhouette-collage" | "flags-cascade" | "vs-battle" | "stat-reveal" | "logo-cta";
  /** Varias imágenes reales que se muestran juntas (no secuenciales): banderas
   * para "flags-cascade", o [veterano, nueva-generación] para "vs-battle". */
  collageImageUrls?: string[];
  /** Logo pequeño en una esquina, superpuesto sobre la foto principal (ej. logo de FIFA). */
  badgeLogoUrl?: string;
  /** Solo con layout "stat-reveal": el número grande (ej. "22") y su etiqueta (ej. "goles"). */
  statNumber?: string;
  statLabel?: string;
  /** Solo con layout "logo-cta": texto debajo del logo (ej. "SÍGUEME"). */
  ctaSubtext?: string;
}

export type VisualStyle = "neon" | "collage";

export interface Guion {
  slug: string;
  topic: string;
  voiceId?: string;
  characterImagePath?: string;
  /** "neon" (default, dark mode AIVI) o "collage" (scrapbook vintage: papel, halftone, marcador, garabatos). */
  style?: VisualStyle;
  scenes: GuionScene[];
}

export interface SceneImage {
  path: string;
  durationInSeconds: number;
}

export interface RenderedScene extends GuionScene {
  audioPath: string;
  sfxPath?: string;
  images: SceneImage[];
  collageImagePaths?: string[];
  badgeImagePath?: string;
  durationInSeconds: number;
}

export interface RenderedGuion {
  slug: string;
  topic: string;
  style?: VisualStyle;
  scenes: RenderedScene[];
}
