// Backend de almacenamiento en filesystem.
// Por defecto en desarrollo. En Render free funciona pero ojo: el disco es efímero por deploy.

import { createReadStream, existsSync, mkdirSync, promises as fs } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import mammoth from "mammoth";
// @ts-ignore — pdf-parse no expone types nominales para el subpath
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import type {
  CartaCreateInput,
  CartaEstado,
  CartaFeedbackInput,
  CartaRecord,
  CartaStorage,
  CartaTipo,
  Storage,
  TemplateRecord,
  TemplateStorage,
  TemplateUploadInput,
} from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DATA_DIR = process.env.POD_DATA_DIR
  ? resolve(process.env.POD_DATA_DIR)
  : resolve(__dirname, "..", "..", "data");
const FILES_DIR = join(DATA_DIR, "templates");
const TEMPLATES_INDEX = join(DATA_DIR, "templates.json");
const CARTAS_INDEX = join(DATA_DIR, "cartas-generadas.json");

if (!existsSync(FILES_DIR)) mkdirSync(FILES_DIR, { recursive: true });

async function extractText(absolutePath: string, mime: string, ext: string): Promise<string> {
  if (ext === ".docx" || mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const { value } = await mammoth.extractRawText({ path: absolutePath });
    return value;
  }
  if (ext === ".pdf" || mime === "application/pdf") {
    const buf = await fs.readFile(absolutePath);
    const parsed = await pdfParse(buf);
    return parsed.text;
  }
  if (ext === ".txt" || ext === ".md" || ext === ".html" || ext === ".htm" || mime.startsWith("text/")) {
    return await fs.readFile(absolutePath, "utf-8");
  }
  throw new Error(`Tipo de archivo no soportado: ${ext || mime}`);
}

function getExt(p: string): string {
  const m = p.match(/\.[^./\\]+$/);
  return (m ? m[0] : "").toLowerCase();
}

async function readJsonArray<T>(path: string): Promise<T[]> {
  try {
    const raw = await fs.readFile(path, "utf-8");
    return JSON.parse(raw) as T[];
  } catch {
    return [];
  }
}

async function writeJsonArray<T>(path: string, data: T[]): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, JSON.stringify(data, null, 2), "utf-8");
}

// ============================================================================
// Templates (filesystem)
// ============================================================================

const fsTemplates: TemplateStorage = {
  async list() {
    const all = await readJsonArray<TemplateRecord>(TEMPLATES_INDEX);
    return all.sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1));
  },

  async get(id) {
    const all = await readJsonArray<TemplateRecord>(TEMPLATES_INDEX);
    return all.find((t) => t.id === id) || null;
  },

  async getText(id) {
    const rec = await this.get(id);
    if (!rec) throw new Error(`Plantilla no encontrada: ${id}`);
    const path = join(FILES_DIR, rec.storedFilename);
    return await extractText(path, rec.mimeType, getExt(path));
  },

  async openRaw(id) {
    const rec = await this.get(id);
    if (!rec) throw new Error(`Plantilla no encontrada: ${id}`);
    const path = join(FILES_DIR, rec.storedFilename);
    return {
      stream: createReadStream(path),
      contentType: rec.mimeType,
      filename: rec.filename,
    };
  },

  async add(input: TemplateUploadInput) {
    const ext = getExt(input.sourceAbsolutePath);
    // sourceAbsolutePath ya está dentro de FILES_DIR (multer lo escribió ahí); extrae texto in-place.
    const fullText = await extractText(input.sourceAbsolutePath, input.mimeType, ext);
    const preview = fullText.replace(/\s+/g, " ").trim().slice(0, 400);
    const record: TemplateRecord = {
      id: randomUUID(),
      filename: input.originalName,
      storedFilename: input.storedFilename,
      type: input.type,
      label: input.label?.trim() || input.originalName,
      uploadedAt: new Date().toISOString(),
      sizeBytes: input.sizeBytes,
      mimeType: input.mimeType,
      textPreview: preview,
      textChars: fullText.length,
      validatedBy: input.validatedBy,
      version: input.version,
    };
    const all = await readJsonArray<TemplateRecord>(TEMPLATES_INDEX);
    all.push(record);
    await writeJsonArray(TEMPLATES_INDEX, all);
    return record;
  },

  async delete(id) {
    const all = await readJsonArray<TemplateRecord>(TEMPLATES_INDEX);
    const idx = all.findIndex((t) => t.id === id);
    if (idx < 0) return false;
    const [removed] = all.splice(idx, 1);
    await writeJsonArray(TEMPLATES_INDEX, all);
    try {
      await fs.unlink(join(FILES_DIR, removed.storedFilename));
    } catch {
      /* archivo ya no existe — el índice ya quitó la referencia */
    }
    return true;
  },
};

// ============================================================================
// Cartas generadas (filesystem)
// ============================================================================

const fsCartas: CartaStorage = {
  async list(filter) {
    let all = await readJsonArray<CartaRecord>(CARTAS_INDEX);
    if (filter?.caseId) all = all.filter((c) => c.caseId === filter.caseId);
    if (filter?.tipo) all = all.filter((c) => c.tipo === filter.tipo);
    if (filter?.exemplary) all = all.filter((c) => c.isExemplary === true);
    all.sort((a, b) => (a.generatedAt < b.generatedAt ? 1 : -1));
    if (filter?.limit) all = all.slice(0, filter.limit);
    return all;
  },

  async get(id) {
    const all = await readJsonArray<CartaRecord>(CARTAS_INDEX);
    return all.find((c) => c.id === id) || null;
  },

  async create(input: CartaCreateInput) {
    const record: CartaRecord = {
      ...input,
      id: randomUUID(),
      generatedAt: new Date().toISOString(),
      estado: input.estado || "borrador",
      rating: null,
      feedbackText: null,
      validatedByLegal: false,
      isExemplary: false,
      finalEditedOutput: null,
      feedbackBy: null,
      feedbackAt: null,
    };
    const all = await readJsonArray<CartaRecord>(CARTAS_INDEX);
    all.push(record);
    await writeJsonArray(CARTAS_INDEX, all);
    return record;
  },

  async updateEstado(id, estado: CartaEstado) {
    const all = await readJsonArray<CartaRecord>(CARTAS_INDEX);
    const idx = all.findIndex((c) => c.id === id);
    if (idx < 0) return null;
    all[idx].estado = estado;
    await writeJsonArray(CARTAS_INDEX, all);
    return all[idx];
  },

  async updateFeedback(id, feedback: CartaFeedbackInput) {
    const all = await readJsonArray<CartaRecord>(CARTAS_INDEX);
    const idx = all.findIndex((c) => c.id === id);
    if (idx < 0) return null;
    const now = new Date().toISOString();
    if (feedback.rating !== undefined) all[idx].rating = feedback.rating;
    if (feedback.feedbackText !== undefined) all[idx].feedbackText = feedback.feedbackText;
    if (feedback.validatedByLegal !== undefined) all[idx].validatedByLegal = feedback.validatedByLegal;
    if (feedback.isExemplary !== undefined) all[idx].isExemplary = feedback.isExemplary;
    if (feedback.finalEditedOutput !== undefined) all[idx].finalEditedOutput = feedback.finalEditedOutput;
    if (feedback.feedbackBy !== undefined) all[idx].feedbackBy = feedback.feedbackBy;
    all[idx].feedbackAt = now;
    await writeJsonArray(CARTAS_INDEX, all);
    return all[idx];
  },
};

export const fsStorage: Storage = {
  templates: fsTemplates,
  cartas: fsCartas,
};

export function getFilesDir(): string {
  return FILES_DIR;
}
