export type ImageSource = "ai" | "real" | "character";

export interface GuionScene {
  id: string;
  text: string;
  visual: string;
  imageSource: ImageSource;
  apifyQuery?: string;
  /** Solo aplica a imageSource "ai": si la escena es sobre algo real e identificable
   * (persona, empresa, lugar, evento), busca primero una foto real en Wikimedia Commons
   * antes de generar con kie.ai (gratis y más fiel). Si no encuentra nada, cae a kie.ai. */
  wikipediaQuery?: string;
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

export type GuionType = "vox" | "social-checklist" | "youtube";

export interface VoxGuion {
  type?: "vox";
  slug: string;
  topic: string;
  voiceId?: string;
  characterImagePath?: string;
  /** "neon" (default, dark mode AIVI) o "collage" (scrapbook vintage: papel, halftone, marcador, garabatos). */
  style?: VisualStyle;
  scenes: GuionScene[];
}

export interface ChecklistItem {
  id: string;
  /** Texto a buscar en la transcripción del video (no se muestra en pantalla). */
  label: string;
  /** Query para buscar el logo/ícono en Wikimedia Commons, con fallback a kie.ai. */
  logoQuery: string;
}

export interface SocialChecklistGuion {
  type: "social-checklist";
  slug: string;
  topic: string;
  /** Ruta al video crudo del usuario hablando a cámara, ej. "content/raw/video-1-jhei.mov". */
  rawVideoPath: string;
  listTitle: string;
  items: ChecklistItem[];
  /** Si hay una segunda persona hablando de fondo (eco/apuntador), se transcribe con
   * diarización y se corta todo lo que no diga el hablante principal (quien habla
   * primero en el video). Default: false. */
  removeOtherSpeakers?: boolean;
}

export type Guion = VoxGuion | SocialChecklistGuion;

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

export interface RenderedChecklistItem extends ChecklistItem {
  startSeconds: number;
  /** false = no se encontró el label en la transcripción, se usó tiempo estimado. */
  matched: boolean;
  logoPath: string;
}

export interface RenderedSocialChecklistGuion {
  type: "social-checklist";
  slug: string;
  topic: string;
  videoPath: string;
  durationInSeconds: number;
  listTitle: string;
  items: RenderedChecklistItem[];
}
