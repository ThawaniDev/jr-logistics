/**
 * JR's own shipping label for orders it received from carrier-mode partners (Omniful requires a public PDF URL; Fastcoo receives the same
 * link through Update3plDetails). Dependency-free: a one-page A6 PDF with a Code 128-B barcode of the AWB, drawn as rectangles.
 * The standard PDF fonts cannot shape Arabic, so text that is not Latin-1 is left out of the label (the driver app shows it) — decision I16.
 */

// Code 128 bar/space widths, values 0–106 (103–105 = start A/B/C, 106 = stop). Each symbol is 11 modules; the stop is 13.
export const CODE128 = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213", "221312", "231212", "112232", "122132", "122231", "113222",
  "123122", "123221", "223211", "221132", "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321",
  "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313", "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121",
  "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111", "314111", "221411", "431111", "111224",
  "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113",
  "114311", "411113", "411311", "113141", "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];

/** Code 128-B modules (true = bar) including quiet-zone-free start/check/stop. Only printable ASCII is allowed. */
export function code128Modules(text: string): boolean[] {
  if (!/^[\x20-\x7e]+$/.test(text)) throw new Error("Code 128-B encodes printable ASCII only");
  const values = [104, ...[...text].map((ch) => ch.charCodeAt(0) - 32)];
  const check = values.reduce((sum, v, i) => sum + v * (i === 0 ? 1 : i), 0) % 103;
  const out: boolean[] = [];
  for (const v of [...values, check, 106]) {
    let bar = true;
    for (const w of CODE128[v]) { for (let k = 0; k < Number(w); k++) out.push(bar); bar = !bar; }
  }
  return out;
}

/** PDF text string: Latin-1 only (WinAnsi), with the three special characters escaped. Anything else → null (not printable). */
export function pdfText(s: string | null | undefined): string | null {
  if (!s) return null;
  const v = s.replace(/\s+/g, " ").trim();
  if (!v || /[^\x20-\x7e\xa0-\xff]/.test(v)) return null;
  return v.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…`.replace("…", "...") : s);

export interface LabelInput {
  awb: string; partner: string; orderRef: string | null; parcelCode: string | null; sender: string | null;
  recipientName: string | null; recipientPhone: string | null; address: string | null; city: string | null;
  codCents: number | null; pieces: number | null; weightGrams: number | null; createdAt: Date;
}

export function labelPdf(l: LabelInput): Buffer {
  const W = 298, H = 420, M = 16; // A6 in points
  const ops: string[] = [];
  const text = (x: number, y: number, size: number, s: string | null, bold = false) => { if (s) ops.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${x} ${y} Td (${s}) Tj ET`); };
  const line = (y: number) => ops.push(`${M} ${y} m ${W - M} ${y} l S`);
  ops.push("0 g 0 G 0.8 w");
  ops.push(`${M / 2} ${M / 2} ${W - M} ${H - M} re S`);
  text(M, H - 36, 18, "JR Logistics", true);
  text(M, H - 52, 9, pdfText(clip(`via ${l.partner}${l.orderRef ? ` · order ${l.orderRef}` : ""}`, 60)?.replace("·", "-") ?? null));
  line(H - 62);
  // Barcode: fit the modules into the printable width.
  const mods = code128Modules(l.awb);
  const unit = Math.min(1.6, (W - 2 * M - 20) / mods.length);
  const bw = unit * mods.length, x0 = (W - bw) / 2, y0 = H - 160, bh = 80;
  for (let i = 0; i < mods.length; ) {
    if (!mods[i]) { i++; continue; }
    let j = i; while (j < mods.length && mods[j]) j++;
    ops.push(`${(x0 + i * unit).toFixed(3)} ${y0} ${((j - i) * unit).toFixed(3)} ${bh} re f`);
    i = j;
  }
  text(W / 2 - l.awb.length * 4.2, y0 - 18, 14, pdfText(l.awb), true);
  line(y0 - 30);
  let y = y0 - 50;
  const row = (label: string, value: string | null, size = 10) => { if (!value) return; text(M, y, 8, pdfText(label)); text(M + 62, y, size, value, size > 10); y -= size + 8; };
  row("Deliver to", pdfText(clip(l.recipientName ?? "", 34)) ?? (l.recipientName ? "(see JR app)" : null), 12);
  row("Phone", pdfText(l.recipientPhone));
  row("Address", pdfText(clip(l.address ?? "", 44)) ?? (l.address ? "(see JR app)" : null));
  row("City", pdfText(l.city), 12);
  line(y + 4); y -= 10;
  row("Cash on delivery", l.codCents && l.codCents > 0 ? `SAR ${(l.codCents / 100).toFixed(2)}` : "Prepaid - collect nothing", l.codCents && l.codCents > 0 ? 12 : 10);
  row("Pieces", l.pieces ? String(l.pieces) : null);
  row("Weight", l.weightGrams ? `${(l.weightGrams / 1000).toFixed(2)} kg` : null);
  row("JR parcel", pdfText(l.parcelCode));
  row("From", pdfText(clip(l.sender ?? "", 40)));
  text(M, M + 6, 7, pdfText(`Printed ${l.createdAt.toISOString().slice(0, 10)} - track at JR with ${l.awb}`));

  const stream = ops.join("\n");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>`,
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  ];
  let pdf = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(pdf, "latin1")); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}
