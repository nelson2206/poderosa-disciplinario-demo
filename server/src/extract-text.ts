// Extrae texto plano de un archivo cargado (PDF / DOCX / TXT / MD / HTML / EML).
// Se usa para el intake de informes y hilos de correo en /api/cartas/analizar-informe.

import mammoth from "mammoth";
// @ts-ignore — pdf-parse no expone types nominales para el subpath
import pdfParse from "pdf-parse/lib/pdf-parse.js";

export async function extractTextFromBuffer(buf: Buffer, mime: string, originalName: string): Promise<string> {
  const name = (originalName || "").toLowerCase();
  if (name.endsWith(".docx") || mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return value;
  }
  if (name.endsWith(".pdf") || mime === "application/pdf") {
    const parsed = await pdfParse(buf);
    return parsed.text;
  }
  if (name.endsWith(".msg")) {
    // .msg de Outlook es binario (OLE) — no se parsea de forma fiable sin lib extra.
    throw new Error("El formato .msg de Outlook no es legible directamente. Expórtalo como PDF / .eml, o pega el texto del correo.");
  }
  // .eml, .txt, .md, .html, .htm y cualquier text/*: tratar como texto plano.
  // (cualquier otro tipo cae igualmente a utf-8 como último recurso).
  return buf.toString("utf-8");
}
