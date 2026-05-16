// Tipos compartidos y contratos para los backends de almacenamiento.
// Permiten alternar entre filesystem (demo, local) y Supabase (producción)
// sin tocar las rutas Express ni el frontend.

export type TemplateType =
  | "carta1"
  | "carta1-amonestacion"
  | "carta2-amonestacion"
  | "carta2-suspension"
  | "carta2-despido"
  | "flagrante"
  | "desistimiento"
  | "acta-notificacion"
  | "levantamiento"
  | "otro";

export const TEMPLATE_TYPES: TemplateType[] = [
  "carta1",
  "carta1-amonestacion",
  "carta2-amonestacion",
  "carta2-suspension",
  "carta2-despido",
  "flagrante",
  "desistimiento",
  "acta-notificacion",
  "levantamiento",
  "otro",
];

export type TemplateRecord = {
  id: string;
  filename: string;
  storedFilename: string;
  type: TemplateType;
  label: string;
  uploadedAt: string;
  sizeBytes: number;
  mimeType: string;
  textPreview: string;
  textChars: number;
  validatedBy?: string;
  version?: string;
};

export type TemplateUploadInput = {
  originalName: string;
  /** Ruta absoluta temporal del archivo cargado por multer (solo se usa para extraer texto y, en fs, mover a destino). */
  sourceAbsolutePath: string;
  /** Nombre con el que multer guardó el archivo (incluye uuid + extensión). */
  storedFilename: string;
  type: TemplateType;
  label?: string;
  validatedBy?: string;
  version?: string;
  mimeType: string;
  sizeBytes: number;
};

export interface TemplateStorage {
  list(): Promise<TemplateRecord[]>;
  get(id: string): Promise<TemplateRecord | null>;
  /** Devuelve el texto extraído (DOCX/PDF/TXT) — usado al inyectar plantilla en el prompt. */
  getText(id: string): Promise<string>;
  /** Devuelve `{ stream, contentType, filename }` para servir el archivo original. */
  openRaw(id: string): Promise<{
    stream: NodeJS.ReadableStream | null;
    redirectUrl?: string;
    contentType: string;
    filename: string;
  }>;
  add(input: TemplateUploadInput): Promise<TemplateRecord>;
  delete(id: string): Promise<boolean>;
}

// ============================================================================
// Cartas generadas (audit log)
// ============================================================================

export type CartaTipo =
  | "carta1"
  | "carta1-amonestacion"
  | "carta2-amonestacion"
  | "carta2-suspension"
  | "carta2-despido"
  | "flagrante"
  | "desistimiento"
  | "acta-notificacion"
  | "levantamiento";

export type CartaEstado = "borrador" | "revisada" | "notificada" | "descartada";

export type CartaRecord = {
  id: string;
  caseId: string;
  trabajadorNombre: string;
  trabajadorDni: string;
  unidad: string;
  tipo: CartaTipo;
  templateId: string | null;
  templateLabel: string | null;
  generatedAt: string;
  generatedBy: string | null;
  model: string;
  elapsedMs: number;
  estado: CartaEstado;
  warningsCount: number;
  refused: boolean;
  /** Snapshot del input del caso enviado a la IA (para auditoría). */
  inputJson: unknown;
  /** Salida estructurada del modelo (lo que pinta el preview). */
  outputJson: unknown;
};

export type CartaCreateInput = Omit<CartaRecord, "id" | "generatedAt" | "estado"> & {
  estado?: CartaEstado;
};

export interface CartaStorage {
  list(filter?: { caseId?: string; tipo?: CartaTipo; limit?: number }): Promise<CartaRecord[]>;
  get(id: string): Promise<CartaRecord | null>;
  create(input: CartaCreateInput): Promise<CartaRecord>;
  updateEstado(id: string, estado: CartaEstado): Promise<CartaRecord | null>;
}

export interface Storage {
  templates: TemplateStorage;
  cartas: CartaStorage;
}
