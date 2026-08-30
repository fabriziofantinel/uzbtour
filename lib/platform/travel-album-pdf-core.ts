import { PDFDocument, StandardFonts, rgb, type PDFPage } from "pdf-lib";
import type { TravelerExperience } from "./traveler-experience";

const A4: [number, number] = [595.28, 841.89];
const margin = 46;

type AlbumPhoto = TravelerExperience["photos"][number];
export type AlbumPhotoSource = (photo: AlbumPhoto) => Promise<{ bytes: Uint8Array; contentType: string } | null>;

function clean(value: string) {
  return value.normalize("NFKC").replace(/[\u2010-\u2015]/g, "-").replace(/[^\x20-\x7E\u00C0-\u00FF]/g, "");
}

function lines(text: string, max = 82) {
  const words = clean(text).split(/\s+/).filter(Boolean), result: string[] = [];
  let current = "";
  for (const word of words) {
    if (`${current} ${word}`.trim().length > max && current) { result.push(current); current = word; }
    else current = `${current} ${word}`.trim();
  }
  if (current) result.push(current);
  return result;
}

export async function createTravelAlbumPdfDocument(experience: TravelerExperience, loadPhoto: AlbumPhotoSource) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const primary = rgb(0.14, 0.48, 0.42), ink = rgb(0.08, 0.17, 0.21), muted = rgb(0.33, 0.39, 0.38);
  let page!: PDFPage, y = 0;
  const newPage = () => {
    page = pdf.addPage(A4);
    y = A4[1] - margin;
    page.drawText(clean(experience.journey.agencyName), { x: margin, y, size: 10, font: bold, color: primary });
    y -= 28;
  };
  const ensure = (space: number) => { if (y - space < margin + 16) newPage(); };
  const text = (value: string, size = 10, isBold = false, color = ink, indent = 0) => {
    const wrapped = lines(value, Math.max(28, Math.floor(84 - indent / 5 - size)));
    ensure(wrapped.length * (size + 4) + 4);
    for (const row of wrapped) { page.drawText(row, { x: margin + indent, y, size, font: isBold ? bold : regular, color }); y -= size + 4; }
  };
  newPage();
  text(experience.journey.title, 24, true); y -= 4;
  text(`${experience.journey.startsOn} - ${experience.journey.endsOn} | ${experience.journey.partyName}`, 11, false, muted); y -= 20;
  text("Il diario del nostro viaggio", 16, true, primary); y -= 16;
  for (const day of experience.days) {
    ensure(90); text(`Giorno ${day.number} - ${day.title || day.city || day.date}`, 14, true);
    if (day.description) text(day.description, 10);
    const note = experience.notes.find((entry) => entry.dayId === day.id);
    if (note?.text) { y -= 3; text(`Ricordo del gruppo: ${note.text}`, 10, false, muted, 10); }
    const score = experience.challengeResults.filter((entry) => entry.dayId === day.id).reduce((sum, entry) => sum + entry.score, 0);
    const photos = experience.photos.filter((entry) => entry.dayId === day.id);
    text(`${photos.length} foto | ${score} punti ottenuti`, 9, true, muted); y -= 12;
  }
  if (experience.photos.length) {
    newPage(); text("Album fotografico", 18, true, primary); y -= 12;
    for (const photo of experience.photos.slice(0, 40)) {
      try {
        const asset = await loadPhoto(photo);
        if (!asset || !/^image\/(png|jpeg)$/.test(asset.contentType)) continue;
        const image = asset.contentType === "image/png" ? await pdf.embedPng(asset.bytes) : await pdf.embedJpg(asset.bytes);
        const scaled = image.scale(Math.min(1, 470 / image.width, 300 / image.height));
        ensure(scaled.height + 44);
        page.drawImage(image, { x: margin, y: y - scaled.height, width: scaled.width, height: scaled.height });
        y -= scaled.height + 14;
        text(`Giorno ${photo.dayNumber} | ${photo.addedBy}`, 9, true, muted); y -= 16;
      } catch { /* Una foto non leggibile non impedisce l'esportazione del diario. */ }
    }
  }
  const pages = pdf.getPages();
  pages.forEach((entry, index) => entry.drawText(`Pagina ${index + 1} di ${pages.length}`, {
    x: A4[0] - margin - 70, y: 24, size: 8, font: regular, color: muted,
  }));
  pdf.setTitle(clean(experience.journey.title));
  pdf.setAuthor(clean(experience.journey.agencyName));
  pdf.setSubject("Diario finale del viaggio");
  pdf.setCreator("SMF Travel");
  return pdf.save();
}
