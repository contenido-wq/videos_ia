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

export type GuionType = "vox" | "social-checklist" | "youtube" | "pantalla-dividida" | "youtube-noticias-avatar" | "documental-doodle" | "cortes-documental";

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

export type Guion = VoxGuion | SocialChecklistGuion | PantallaDivididaGuion | YoutubeNoticiasAvatarGuion | DocumentalDoodleGuion | CortesDocumentalGuion;

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

export interface PantallaDivididaScene {
  id: string;
  /** Debe existir literalmente (substring normalizado) en la transcripción real del video. */
  text: string;
  act: "split" | "closing";
  /** Solo aplica a act "split". Imágenes ya generadas a mano (ChatGPT), en orden.
   * Se ciclan cada MAX_CUT_SECONDS dentro de la duración real de la escena. */
  localImagePaths?: string[];
  /** Solo aplica a act "split", si no hay localImagePaths: prompt para generar
   * la ilustración con IA (kie.ai). Se le agrega automáticamente un sufijo de
   * estilo fijo (flat vector illustration). Si la escena dura más de
   * MAX_CUT_SECONDS se generan varios cortes con encuadres alternos. */
  visual?: string;
  /** Texto que se muestra en pantalla, si difiere del texto real matcheado
   * contra la transcripción (ej. mostrar solo la palabra clave en vez de la
   * frase completa). Si no está, se muestra `text` tal cual. */
  displayText?: string;
  /** Substring exacto (case-insensitive) dentro del texto mostrado a resaltar
   * en amarillo dentro de la barra de texto. Solo aplica a act "split". */
  highlightWord?: string;
}

export interface PantallaDivididaGuion {
  type: "pantalla-dividida";
  slug: string;
  topic: string;
  /** Ruta al video crudo del presentador, ej. "content/raw/pantalla-dividida.mp4". */
  rawVideoPath: string;
  /** Igual semántica que en SocialChecklistGuion: corta cualquier tramo de otro hablante. */
  removeOtherSpeakers?: boolean;
  scenes: PantallaDivididaScene[];
  /** Ruta a un archivo de música de fondo ya elegido y con licencia
   * verificada por el usuario, ej. "content/musica/motivation-paulyudin.mp3".
   * Se reproduce desde el segundo 0, cortado a la duración total del video.
   * Opcional: si se omite, el video queda sin música de fondo (el whoosh/sting
   * de los cortes de acto sí se generan igual). */
  backgroundMusicPath?: string;
  /** Prompts para whoosh/sting, generados una vez por video. Ambos opcionales:
   * si se omite alguno, se usa un prompt por defecto. */
  soundDesign?: {
    whooshPrompt?: string;
    stingPrompt?: string;
  };
}

export interface RenderedPantallaDivididaScene {
  id: string;
  text: string;
  act: "split" | "closing";
  startSeconds: number;
  durationInSeconds: number;
  /** false = no se encontró el texto en la transcripción, se usó tiempo estimado. */
  matched: boolean;
  /** Vacío en escenas "closing". */
  images: SceneImage[];
  /** Texto a mostrar en pantalla; ya resuelto a `text` si el guion no definía uno distinto. */
  displayText: string;
  /** Substring a resaltar en amarillo dentro de displayText, si el guion lo definió. */
  highlightWord?: string;
}

export interface RenderedPantallaDivididaGuion {
  type: "pantalla-dividida";
  slug: string;
  topic: string;
  videoPath: string;
  durationInSeconds: number;
  scenes: RenderedPantallaDivididaScene[];
  sfx: {
    backgroundMusicPath?: string;
    whooshPath: string;
    whooshDurationInSeconds: number;
    stingPath: string;
    stingDurationInSeconds: number;
  };
}

export interface YoutubeNoticiasAvatarScene {
  id: string;
  /** Debe existir literalmente (substring normalizado) en la transcripción real del video. */
  text: string;
  /** Imágenes ya preparadas por el usuario, en orden. Se ciclan cada NEWS_AVATAR_CUT_SECONDS (4s)
   * dentro de la duración real de la escena. */
  localImagePaths: string[];
}

export interface YoutubeNoticiasAvatarGuion {
  type: "youtube-noticias-avatar";
  slug: string;
  topic: string;
  /** Ruta al video crudo del experto, ej. "content/raw/mi-noticia.mp4". */
  rawVideoPath: string;
  removeOtherSpeakers?: boolean;
  scenes: YoutubeNoticiasAvatarScene[];
  /** Default false. Se pregunta explícitamente en cada video, no va fijo. */
  subscribeButton?: boolean;
}

export interface RenderedYoutubeNoticiasAvatarScene {
  id: string;
  text: string;
  startSeconds: number;
  durationInSeconds: number;
  /** false = no se encontró el texto en la transcripción, se usó tiempo estimado. */
  matched: boolean;
  images: SceneImage[];
}

export interface CaptionWord {
  text: string;
  start: number;
  end: number;
}

export interface CaptionChunk {
  words: CaptionWord[];
  startSeconds: number;
  endSeconds: number;
}

export interface RenderedYoutubeNoticiasAvatarGuion {
  type: "youtube-noticias-avatar";
  slug: string;
  topic: string;
  videoPath: string;
  durationInSeconds: number;
  subscribeButton: boolean;
  scenes: RenderedYoutubeNoticiasAvatarScene[];
  captionChunks: CaptionChunk[];
}

export interface DocumentalDoodleScene {
  id: string;
  /** Texto que se narra en esta escena — se convierte a voz con ElevenLabs. */
  text: string;
  /** Descripción de la escena para generar la(s) imagen(es) con IA. El estilo
   * doodle/cartoon (contorno negro grueso, colores planos, etc.) se escribe
   * acá explícitamente al redactar el guion — no hay un sufijo automático. */
  visual: string;
}

export interface DocumentalDoodleGuion {
  type: "documental-doodle";
  slug: string;
  topic: string;
  /** Voz de ElevenLabs a usar; default si se omite (mismo default que vox). */
  voiceId?: string;
  scenes: DocumentalDoodleScene[];
}

export interface RenderedDocumentalDoodleScene {
  id: string;
  text: string;
  audioPath: string;
  startSeconds: number;
  durationInSeconds: number;
  images: SceneImage[]; // se ciclan cada DOODLE_CUT_SECONDS (5s)
}

export interface RenderedDocumentalDoodleGuion {
  type: "documental-doodle";
  slug: string;
  topic: string;
  durationInSeconds: number;
  scenes: RenderedDocumentalDoodleScene[];
  captionChunks: CaptionChunk[];
}

export interface CortesDocumentalCutaway {
  id: string;
  /** Frase literal de la transcripción real donde arranca el corte. */
  text: string;
  /** Imagen ya preparada por el usuario (9:16), ej. "content/personajes/<slug>/c1.png". */
  localImagePath?: string;
  /** Si no hay localImagePath: prompt para generar la imagen con IA (kie.ai, fallback pollinations). */
  visual?: string;
  /** 1.5–3 s; default 2.5. */
  durationSeconds?: number;
  /** Id de otro corte cuya imagen ya generada se usa como referencia para mantener el mismo personaje
   * (misma cara, edad y ropa). El corte referenciado debe aparecer ANTES en la lista. */
  basedOn?: string;
  /** Último corte: dura hasta el final del video (más la cola), con fundido a negro. Solo uno. */
  closing?: boolean;
}

export interface CortesDocumentalTitle {
  id: string;
  /** Frase literal de la transcripción real donde aparece el título. */
  text: string;
  /** Línea pequeña sobre el título, ej. "El que vive". */
  kicker?: string;
  /** Línea enorme, ej. "del aplauso". */
  headline: string;
  /** Default 2.5 s. */
  durationSeconds?: number;
}

export interface CortesDocumentalGuion {
  type: "cortes-documental";
  slug: string;
  topic: string;
  /** Ruta al video crudo del presentador, ej. "content/raw/<slug>.mov". */
  rawVideoPath: string;
  removeOtherSpeakers?: boolean;
  cutaways: CortesDocumentalCutaway[];
  titles?: CortesDocumentalTitle[];
  /** Música de fondo con licencia ya aprobada por el usuario, ej. "content/musica/motivation-paulyudin.mp3". */
  backgroundMusicPath?: string;
  /** Prompts de whoosh (entrada de cada corte) y hit (títulos y cierre); opcionales. */
  soundDesign?: { whooshPrompt?: string; hitPrompt?: string };
}

export type CortesDocumentalTransition = "flash" | "slide" | "zoom";

export interface RenderedCortesDocumentalCutaway {
  id: string;
  startSeconds: number;
  durationInSeconds: number;
  /** Ruta relativa a public/. */
  imagePath: string;
  /** Overlay/animación con que entra la imagen. */
  transition: CortesDocumentalTransition;
  closing?: boolean;
}

export interface RenderedCortesDocumentalTitle {
  id: string;
  startSeconds: number;
  durationInSeconds: number;
  kicker?: string;
  headline: string;
}

export interface RenderedCortesDocumentalGuion {
  type: "cortes-documental";
  slug: string;
  topic: string;
  videoPath: string;
  durationInSeconds: number;
  cutaways: RenderedCortesDocumentalCutaway[];
  titles: RenderedCortesDocumentalTitle[];
  captionChunks: CaptionChunk[];
  /** Cola extra después del video (el corte de cierre sigue sobre ella y se funde a negro). */
  outroSeconds: number;
  /** Encuadres del presentador (jump cuts): zoom que cambia de golpe en cada punto. */
  jumpCuts: { atSeconds: number; scale: number }[];
  sfx: {
    whooshPath: string;
    whooshDurationInSeconds: number;
    hitPath: string;
    hitDurationInSeconds: number;
  };
  music?: {
    path: string;
    /** Volumen lineal ya calculado para quedar bajo la voz. */
    volume: number;
  };
}

// ---------------------------------------------------------------------------
// Motion blanco: talking head que alterna con escenas cortas (2.5–3 s) hechas
// de fotos reales en capas — fondo, medio (objetos recortados) y frente
// (textos) — que se mueven en parallax, entran escalonadas con rebote y
// mantienen micromovimientos mientras están quietas.
// ---------------------------------------------------------------------------

export type MotionBlancoFrontKind = "pill" | "title" | "quote" | "verse" | "check" | "key";

/** Objeto recortado (PNG con transparencia) de la capa del medio. */
export interface MotionBlancoMidPlan {
  id: string;
  kind: "cutout";
  /** Qué generar con IA; el fondo blanco se quita después. */
  prompt: string;
  atPhrase?: string;
  /** Personajes (claves de `characters`) que deben salir idénticos a su referencia. */
  refs?: string[];
}

/** Texto de la capa del frente. Sin `atPhrase` entra escalonado desde el inicio de la escena. */
export interface MotionBlancoFrontPlan {
  kind: MotionBlancoFrontKind;
  text: string;
  atPhrase?: string;
}

/** Escena tal como se escribe a mano: anclada a frases del guion, no a segundos. */
export interface MotionBlancoScenePlan {
  id: string;
  fromPhrase: string;
  /** Si la sigue el presentador, termina al final de esta frase; si no, cuando arranca la escena siguiente. */
  toPhrase?: string;
  /** "split": foto arriba y presentador abajo. */
  layout?: "full" | "split";
  /** Prompt de la foto de fondo (se le agrega el estilo cinematográfico común). */
  bg: string;
  /** Personajes (claves de `characters`) que deben salir idénticos a su referencia. */
  refs?: string[];
  mid?: MotionBlancoMidPlan[];
  front?: MotionBlancoFrontPlan[];
}

/** Personaje recurrente: se genera siempre a partir de la misma imagen para que no cambie de cara ni de edad. */
export interface MotionBlancoCharacter {
  /** Ruta relativa a public/ de la imagen de referencia. */
  image: string;
  description: string;
}

export interface MotionBlancoPlan {
  title: { kicker: string; headline: string; toPhrase: string };
  characters?: Record<string, MotionBlancoCharacter>;
  scenes: MotionBlancoScenePlan[];
}

export interface RenderedMotionBlancoLayerItem {
  /** Momento en que entra (ya escalonado si no estaba anclado a una frase). */
  atSeconds: number;
}

export interface RenderedMotionBlancoMid extends RenderedMotionBlancoLayerItem {
  /** Ruta relativa a public/ del PNG recortado. */
  imagePath: string;
}

export interface RenderedMotionBlancoFront extends RenderedMotionBlancoLayerItem {
  kind: MotionBlancoFrontKind;
  text: string;
}

export interface RenderedMotionBlancoScene {
  id: string;
  layout: "full" | "split";
  startSeconds: number;
  durationInSeconds: number;
  /** Ruta relativa a public/ de la foto de fondo. */
  bgPath: string;
  mid: RenderedMotionBlancoMid[];
  front: RenderedMotionBlancoFront[];
}

export interface RenderedMotionBlancoGuion {
  type: "motion-blanco";
  slug: string;
  videoPath: string;
  durationInSeconds: number;
  title: { kicker: string; headline: string; durationInSeconds: number };
  scenes: RenderedMotionBlancoScene[];
  captionChunks: CaptionChunk[];
  jumpCuts: { atSeconds: number; scale: number; offsetX: number }[];
  music?: { path: string; volume: number };
}
