// Backend de almacenamiento sobre Supabase: Postgres para metadata, Storage para archivos.
// Activado cuando SUPABASE_URL y SUPABASE_SERVICE_KEY están definidos.
// El SERVICE_KEY bypassa RLS — debe vivir SOLO en el backend, nunca tocar el frontend.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { promises as fs } from "node:fs";
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
  TemplateType,
  TemplateUploadInput,
} from "./types.js";

const BUCKET = "templates";

function getClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL y SUPABASE_SERVICE_KEY son obligatorias para el backend Supabase");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function extractTextFromBuffer(buf: Buffer, mime: string, originalName: string): Promise<string> {
  const lowerName = originalName.toLowerCase();
  if (lowerName.endsWith(".docx") || mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return value;
  }
  if (lowerName.endsWith(".pdf") || mime === "application/pdf") {
    const parsed = await pdfParse(buf);
    return parsed.text;
  }
  if (mime.startsWith("text/") || /\.(txt|md|html|htm)$/i.test(lowerName)) {
    return buf.toString("utf-8");
  }
  throw new Error(`Tipo de archivo no soportado: ${originalName} (${mime})`);
}

// ============================================================================
// Mapeos DB ↔ tipos del dominio
// ============================================================================

type TemplateRow = {
  id: string;
  filename: string;
  stored_path: string;
  type: string;
  label: string;
  uploaded_at: string;
  size_bytes: number;
  mime_type: string;
  text_preview: string;
  text_chars: number;
  full_text: string;
  validated_by: string | null;
  version: string | null;
};

function rowToTemplate(r: TemplateRow): TemplateRecord {
  return {
    id: r.id,
    filename: r.filename,
    storedFilename: r.stored_path,
    type: r.type as TemplateType,
    label: r.label,
    uploadedAt: r.uploaded_at,
    sizeBytes: r.size_bytes,
    mimeType: r.mime_type,
    textPreview: r.text_preview,
    textChars: r.text_chars,
    validatedBy: r.validated_by ?? undefined,
    version: r.version ?? undefined,
  };
}

type CartaRow = {
  id: string;
  case_id: string;
  trabajador_nombre: string;
  trabajador_dni: string;
  unidad: string;
  tipo: string;
  template_id: string | null;
  template_label: string | null;
  generated_at: string;
  generated_by: string | null;
  model: string;
  elapsed_ms: number;
  estado: string;
  warnings_count: number;
  refused: boolean;
  input_json: unknown;
  output_json: unknown;
  rating: number | null;
  feedback_text: string | null;
  validated_by_legal: boolean;
  is_exemplary: boolean;
  final_edited_output: unknown | null;
  feedback_by: string | null;
  feedback_at: string | null;
};

function rowToCarta(r: CartaRow): CartaRecord {
  return {
    id: r.id,
    caseId: r.case_id,
    trabajadorNombre: r.trabajador_nombre,
    trabajadorDni: r.trabajador_dni,
    unidad: r.unidad,
    tipo: r.tipo as CartaTipo,
    templateId: r.template_id,
    templateLabel: r.template_label,
    generatedAt: r.generated_at,
    generatedBy: r.generated_by,
    model: r.model,
    elapsedMs: r.elapsed_ms,
    estado: r.estado as CartaEstado,
    warningsCount: r.warnings_count,
    refused: r.refused,
    inputJson: r.input_json,
    outputJson: r.output_json,
    rating: r.rating,
    feedbackText: r.feedback_text,
    validatedByLegal: r.validated_by_legal,
    isExemplary: r.is_exemplary,
    finalEditedOutput: r.final_edited_output,
    feedbackBy: r.feedback_by,
    feedbackAt: r.feedback_at,
  };
}

// ============================================================================
// Templates (Supabase)
// ============================================================================

const supabaseTemplates: TemplateStorage = {
  async list() {
    const sb = getClient();
    const { data, error } = await sb
      .from("templates")
      .select("*")
      .order("uploaded_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data as TemplateRow[]).map(rowToTemplate);
  },

  async get(id) {
    const sb = getClient();
    const { data, error } = await sb.from("templates").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? rowToTemplate(data as TemplateRow) : null;
  },

  async getText(id) {
    const sb = getClient();
    const { data, error } = await sb.from("templates").select("full_text").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error(`Plantilla no encontrada: ${id}`);
    return (data as { full_text: string }).full_text;
  },

  async openRaw(id) {
    const sb = getClient();
    const rec = await this.get(id);
    if (!rec) throw new Error(`Plantilla no encontrada: ${id}`);
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(rec.storedFilename, 60);
    if (error || !data) throw new Error(error?.message || "No se pudo firmar URL del archivo");
    return {
      stream: null,
      redirectUrl: data.signedUrl,
      contentType: rec.mimeType,
      filename: rec.filename,
    };
  },

  async add(input: TemplateUploadInput) {
    const sb = getClient();
    // input.sourceAbsolutePath aquí es un archivo temporal escrito por el handler en /api/templates
    // (multer.memoryStorage → buffer → tmp file). Lo leemos, extraemos texto, subimos y registramos.
    const buf = await fs.readFile(input.sourceAbsolutePath);
    const fullText = await extractTextFromBuffer(buf, input.mimeType, input.originalName);
    const preview = fullText.replace(/\s+/g, " ").trim().slice(0, 400);

    const storedPath = input.storedFilename;
    const { error: upErr } = await sb.storage.from(BUCKET).upload(storedPath, buf, {
      contentType: input.mimeType,
      upsert: false,
    });
    if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`);

    const row = {
      filename: input.originalName,
      stored_path: storedPath,
      type: input.type,
      label: input.label?.trim() || input.originalName,
      size_bytes: input.sizeBytes,
      mime_type: input.mimeType,
      text_preview: preview,
      text_chars: fullText.length,
      full_text: fullText,
      validated_by: input.validatedBy ?? null,
      version: input.version ?? null,
    };
    const { data, error } = await sb.from("templates").insert(row).select("*").single();
    if (error) {
      // Rollback del archivo si la fila falla
      await sb.storage.from(BUCKET).remove([storedPath]).catch(() => {});
      throw new Error(error.message);
    }
    return rowToTemplate(data as TemplateRow);
  },

  async delete(id) {
    const sb = getClient();
    const rec = await this.get(id);
    if (!rec) return false;
    const { error: delErr } = await sb.from("templates").delete().eq("id", id);
    if (delErr) throw new Error(delErr.message);
    await sb.storage.from(BUCKET).remove([rec.storedFilename]).catch(() => {});
    return true;
  },
};

// ============================================================================
// Cartas (Supabase)
// ============================================================================

const supabaseCartas: CartaStorage = {
  async list(filter) {
    const sb = getClient();
    let q = sb.from("cartas_generadas").select("*").order("generated_at", { ascending: false });
    if (filter?.caseId) q = q.eq("case_id", filter.caseId);
    if (filter?.tipo) q = q.eq("tipo", filter.tipo);
    if (filter?.exemplary) q = q.eq("is_exemplary", true);
    if (filter?.limit) q = q.limit(filter.limit);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data as CartaRow[]).map(rowToCarta);
  },

  async get(id) {
    const sb = getClient();
    const { data, error } = await sb.from("cartas_generadas").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? rowToCarta(data as CartaRow) : null;
  },

  async create(input: CartaCreateInput) {
    const sb = getClient();
    const row = {
      case_id: input.caseId,
      trabajador_nombre: input.trabajadorNombre,
      trabajador_dni: input.trabajadorDni,
      unidad: input.unidad,
      tipo: input.tipo,
      template_id: input.templateId,
      template_label: input.templateLabel,
      generated_by: input.generatedBy,
      model: input.model,
      elapsed_ms: input.elapsedMs,
      estado: input.estado || "borrador",
      warnings_count: input.warningsCount,
      refused: input.refused,
      input_json: input.inputJson,
      output_json: input.outputJson,
    };
    const { data, error } = await sb.from("cartas_generadas").insert(row).select("*").single();
    if (error) throw new Error(error.message);
    return rowToCarta(data as CartaRow);
  },

  async updateEstado(id, estado: CartaEstado) {
    const sb = getClient();
    const { data, error } = await sb
      .from("cartas_generadas")
      .update({ estado })
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? rowToCarta(data as CartaRow) : null;
  },

  async updateFeedback(id, feedback: CartaFeedbackInput) {
    const sb = getClient();
    const patch: Record<string, unknown> = { feedback_at: new Date().toISOString() };
    if (feedback.rating !== undefined) patch.rating = feedback.rating;
    if (feedback.feedbackText !== undefined) patch.feedback_text = feedback.feedbackText;
    if (feedback.validatedByLegal !== undefined) patch.validated_by_legal = feedback.validatedByLegal;
    if (feedback.isExemplary !== undefined) patch.is_exemplary = feedback.isExemplary;
    if (feedback.finalEditedOutput !== undefined) patch.final_edited_output = feedback.finalEditedOutput;
    if (feedback.feedbackBy !== undefined) patch.feedback_by = feedback.feedbackBy;
    const { data, error } = await sb
      .from("cartas_generadas")
      .update(patch)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? rowToCarta(data as CartaRow) : null;
  },
};

export const supabaseStorage: Storage = {
  templates: supabaseTemplates,
  cartas: supabaseCartas,
};
