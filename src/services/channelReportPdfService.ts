import { jsPDF } from "jspdf";
import type { ChannelInfo } from "./youtubeService";
import type { ChannelAnalysisResult } from "./channelAnalysisService";

const PAGE_MARGIN = 15;
const CONTENT_WIDTH = 180;
const PAGE_BOTTOM = 280;

export interface ChannelReportData {
  channel: ChannelInfo;
  analysis: ChannelAnalysisResult;
  characterImageBuffer: Buffer | null;
  characterImagePrompt: string | null;
}

interface FetchedImage {
  data: string;
  format: "JPEG" | "PNG";
}

async function fetchImageAsBase64(url: string): Promise<FetchedImage | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    const format: "JPEG" | "PNG" = url.toLowerCase().includes(".png") ? "PNG" : "JPEG";
    return { data: buffer.toString("base64"), format };
  } catch {
    return null;
  }
}

function ensureSpace(doc: jsPDF, y: number, neededHeight: number): number {
  if (y + neededHeight > PAGE_BOTTOM) {
    doc.addPage();
    return PAGE_MARGIN;
  }
  return y;
}

function addSectionTitle(doc: jsPDF, text: string, y: number): number {
  const startY = ensureSpace(doc, y, 15);
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(text, PAGE_MARGIN, startY);
  doc.setFont("helvetica", "normal");
  return startY + 10;
}

function addWrappedText(doc: jsPDF, text: string, y: number, fontSize = 11): number {
  doc.setFontSize(fontSize);
  const lines = doc.splitTextToSize(text, CONTENT_WIDTH) as string[];
  const lineHeight = fontSize * 0.42;
  const blockHeight = lines.length * lineHeight;
  const startY = ensureSpace(doc, y, blockHeight);
  doc.text(lines, PAGE_MARGIN, startY);
  return startY + blockHeight + 6;
}

export async function buildChannelReportPdf(data: ChannelReportData): Promise<Buffer> {
  const { channel, analysis, characterImageBuffer, characterImagePrompt } = data;
  const doc = new jsPDF();
  let y = PAGE_MARGIN;

  // 1. Portada
  doc.setFontSize(24);
  doc.setFont("helvetica", "bold");
  doc.text(channel.title, PAGE_MARGIN, y + 10);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  doc.text(channel.handle ?? channel.channelId, PAGE_MARGIN, y + 20);
  y += 30;

  const banner = channel.bannerUrl ? await fetchImageAsBase64(channel.bannerUrl) : null;
  if (banner) {
    doc.addImage(
      `data:image/${banner.format.toLowerCase()};base64,${banner.data}`,
      banner.format,
      PAGE_MARGIN,
      y,
      CONTENT_WIDTH,
      70,
    );
    y += 78;
  }

  const profile = await fetchImageAsBase64(channel.profileImageUrl);
  if (profile) {
    doc.addImage(
      `data:image/${profile.format.toLowerCase()};base64,${profile.data}`,
      profile.format,
      PAGE_MARGIN,
      y,
      30,
      30,
    );
    y += 38;
  }

  // 2. Qué hace el canal
  doc.addPage();
  y = PAGE_MARGIN;
  y = addSectionTitle(doc, "Qué hace el canal", y);
  y = addWrappedText(doc, channel.description || "(el canal no tiene descripción configurada)", y);
  y = ensureSpace(doc, y, 20);
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Temas recurrentes:", PAGE_MARGIN, y);
  doc.setFont("helvetica", "normal");
  y += 8;
  y = addWrappedText(doc, analysis.topics.map((t) => `• ${t}`).join("\n"), y);

  // 3. Personaje
  doc.addPage();
  y = PAGE_MARGIN;
  y = addSectionTitle(doc, "Personaje", y);
  if (analysis.character.present && analysis.character.description) {
    if (characterImageBuffer) {
      const base64 = characterImageBuffer.toString("base64");
      y = ensureSpace(doc, y, 88);
      doc.addImage(`data:image/png;base64,${base64}`, "PNG", PAGE_MARGIN, y, 120, 80);
      y += 88;
    } else {
      y = addWrappedText(doc, "(no se pudo generar la imagen — usá el prompt de abajo para generarla manualmente)", y);
    }
    y = addWrappedText(doc, analysis.character.description, y);
    if (characterImagePrompt) {
      y = ensureSpace(doc, y, 16);
      doc.setFont("helvetica", "bold");
      doc.text("Prompt para regenerar la imagen:", PAGE_MARGIN, y);
      doc.setFont("helvetica", "normal");
      y += 8;
      y = addWrappedText(doc, characterImagePrompt, y, 9);
    }
    y = addWrappedText(
      doc,
      "Esta imagen fue generada a partir de las miniaturas reales de este canal. Si el canal no es tuyo, es solo referencia interna de moodboard — no publiques esta imagen ni una copia visualmente idéntica; usala para inspirarte en un personaje propio y distinto.",
      y,
      9,
    );
  } else {
    y = addWrappedText(doc, "Este canal no muestra un personaje visual consistente en la muestra analizada.", y);
  }

  // 4. Títulos más virales
  doc.addPage();
  y = PAGE_MARGIN;
  y = addSectionTitle(doc, "Títulos más virales", y);
  for (const insight of analysis.viralTitles) {
    y = addWrappedText(doc, `"${insight.title}" — ${insight.viewCount.toLocaleString("es")} vistas`, y, 12);
    y = addWrappedText(doc, insight.reason || "(sin explicación disponible)", y, 10);
  }

  // 5. Disclaimer
  doc.addPage();
  y = PAGE_MARGIN;
  y = addSectionTitle(doc, "Disclaimer sugerido", y);
  y = addWrappedText(doc, analysis.disclaimer, y);
  y = addWrappedText(
    doc,
    'Este texto complementa la descripción del video, pero NO reemplaza activar el toggle "Contenido alterado o sintético" en YouTube Studio al subir el video.',
    y,
    9,
  );

  // 6. Metadatos del canal
  doc.addPage();
  y = PAGE_MARGIN;
  y = addSectionTitle(doc, "Metadatos del canal", y);
  const createdDate = new Date(channel.publishedAt).toLocaleDateString("es");
  const metadataLines = [
    `Suscriptores: ${channel.subscriberCount.toLocaleString("es")}`,
    `Vistas totales: ${channel.viewCount.toLocaleString("es")}`,
    `Cantidad de videos: ${channel.videoCount.toLocaleString("es")}`,
    `Canal creado: ${createdDate}`,
    `País: ${channel.country ?? "No especificado"}`,
  ].join("\n");
  y = addWrappedText(doc, metadataLines, y);

  const arrayBuffer = doc.output("arraybuffer");
  return Buffer.from(arrayBuffer);
}
