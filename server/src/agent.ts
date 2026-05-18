import Anthropic from "@anthropic-ai/sdk";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, "prompts");

// Selección de modelo por endpoint. Cada uno cae a ANTHROPIC_MODEL si no está
// definido, lo que permite arrancar con un solo modelo y luego optimizar costes
// usando Haiku para tareas livianas (OCR / clasificación) y Sonnet/Opus para
// la redacción jurídica.
const MODEL_DEFAULT = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
const MODEL_GENERATOR = process.env.ANTHROPIC_MODEL_GENERATOR || MODEL_DEFAULT;
const MODEL_CLASSIFIER = process.env.ANTHROPIC_MODEL_CLASSIFIER || MODEL_DEFAULT;
const MODEL_VISION = process.env.ANTHROPIC_MODEL_VISION || MODEL_DEFAULT;

export const MODEL_CONFIG = {
  generator: MODEL_GENERATOR,
  classifier: MODEL_CLASSIFIER,
  vision: MODEL_VISION,
  default: MODEL_DEFAULT,
};

// =============================================================================
// Carta 1 (Imputación)
// =============================================================================

export type Carta1Input = {
  caseId: string;
  trabajador: { nombre: string; dni: string; puestoUnidad: string; unidad: "Marañón" | "Santa María" | "Palca" };
  faltaTipificada: string;
  normaAplicable?: string;
  conducta: string;
  fechaHechoISO: string;
  lugar?: string;
  plazoDescargo: string;
  anexos: string[];
  firma: { nombre: string; cargo: string };
  numeroCarta?: string;
  fechaCartaISO?: string;
};

export type Carta1Output = {
  asunto: string;
  fecha: string;
  numeroCarta: string;
  destinatario: { tratamiento: string; nombre: string; dni: string; puestoUnidad: string };
  cuerpo: {
    encabezado: string;
    introduccion: string;
    hechosImputados: string;
    normaAplicable: string;
    derechoDefensa: string;
    canalDescargo: string;
    cierreNoSancion: string;
    despedida: string;
  };
  firma: { nombre: string; cargo: string; empresa: string };
  anexos: string[];
  warnings: string[];
  refused: boolean;
  refusedReason: string | null;
};

// =============================================================================
// Carta 2 (Decisión final — sanción / despido / desistimiento)
// =============================================================================

export type Carta2Tipo = "carta2-amonestacion" | "carta2-suspension" | "carta2-despido" | "desistimiento";

export type Carta2Input = {
  caseId: string;
  trabajador: { nombre: string; dni: string; puestoUnidad: string; unidad: "Marañón" | "Santa María" | "Palca" };
  tipo: Carta2Tipo;
  carta1: { numero: string; fechaISO: string };
  descargoRecibidoISO?: string | null;
  descargoVencidoISO?: string | null;
  descargoContenido?: string;
  hechosImputados: string;
  evaluacion: string;
  suspension?: { dias: number; inicioISO: string; finISO: string; retornoISO: string };
  despido?: { causalArt25: string; fechaCeseISO: string };
  amonestacion?: { efectos: string };
  normaAplicada: string;
  firma: { nombre: string; cargo: string };
  numeroCarta?: string;
  fechaCartaISO?: string;
};

export type Carta2Output = {
  asunto: string;
  fecha: string;
  numeroCarta: string;
  destinatario: { tratamiento: string; nombre: string; dni: string; puestoUnidad: string };
  cuerpo: {
    encabezado: string;
    introduccion: string;
    decision: string;
    motivacion: string;
    normaAplicada: string;
    parrafoAdicional: string;
    despedida: string;
  };
  firma: { nombre: string; cargo: string; empresa: string };
  copia: string[];
  warnings: string[];
  refused: boolean;
  refusedReason: string | null;
};

// =============================================================================
// Métricas de tokens y caché — útiles para vigilar el coste
// =============================================================================

export type ModelUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;   // tokens leídos del prompt cache (~10% del coste)
  cacheWriteTokens: number;  // tokens escritos al cache (1.25× del coste normal una sola vez)
};

function extractUsage(model: string, response: Anthropic.Message): ModelUsage {
  const u = response.usage as Anthropic.Message["usage"] & {
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  return {
    model,
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
  };
}

// =============================================================================
// Prompt cache
// =============================================================================

const cache = new Map<string, string>();

async function loadPrompt(name: string): Promise<string> {
  if (cache.has(name)) return cache.get(name)!;
  const content = await readFile(join(PROMPTS_DIR, name), "utf-8");
  cache.set(name, content);
  return content;
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    return JSON.parse(fenced[1].trim());
  }
  const openOnly = text.match(/```(?:json)?\s*([\s\S]*)$/i);
  if (openOnly) {
    let candidate = openOnly[1].trim();
    const lastBrace = candidate.lastIndexOf("}");
    if (lastBrace > 0) candidate = candidate.slice(0, lastBrace + 1);
    return JSON.parse(candidate);
  }
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) {
    return JSON.parse(text.slice(first, last + 1));
  }
  return JSON.parse(text.trim());
}

function buildClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY no configurada en .env");
  return new Anthropic({ apiKey });
}

/** Bloque para el system prompt marcado como cacheable. */
function systemBlocks(systemMd: string): Anthropic.TextBlockParam[] {
  return [
    { type: "text", text: systemMd, cache_control: { type: "ephemeral" } },
  ];
}

/** Bloques de user content cuando hay una parte cacheable (plantilla) y una variable (caso). */
function userBlocksWithCachedPrefix(cacheablePrefix: string, variablePart: string): Anthropic.ContentBlockParam[] {
  return [
    { type: "text", text: cacheablePrefix, cache_control: { type: "ephemeral" } },
    { type: "text", text: variablePart },
  ];
}

function plantillaClienteBlock(text?: string, label?: string): string {
  if (!text) return "";
  return [
    "",
    `## Plantilla del cliente (preferida) — "${label || "plantilla cargada"}"`,
    "Usa el tono, estructura y fraseo de esta plantilla como guía principal. Si entra en conflicto con las reglas legales del system prompt, **prevalecen las reglas legales** y registra una advertencia en `warnings[]`.",
    "",
    "```",
    text.slice(0, 12000),
    "```",
    "",
  ].join("\n");
}

// =============================================================================
// Carta 1
// =============================================================================

/** Few-shot examples curados por Legal — se inyectan al prompt para que el
 *  modelo calque el estilo aprobado. La función `fetchExemplary` viene del
 *  llamador (storage); aquí solo recibimos los strings ya serializados. */
function exemplaryBlock(exemplary?: { caseSummary: string; outputJson: unknown }[]): string {
  if (!exemplary || exemplary.length === 0) return "";
  const items = exemplary.slice(0, 3).map((ex, i) => {
    return [
      `### Ejemplo ${i + 1} — aprobado por Legal de Poderosa`,
      "**Caso (resumen):**",
      ex.caseSummary,
      "",
      "**Carta final aprobada (JSON):**",
      "```json",
      JSON.stringify(ex.outputJson, null, 2),
      "```",
    ].join("\n");
  }).join("\n\n---\n\n");
  return [
    "",
    "## Ejemplos canónicos validados por Legal (calca este estilo y rigor)",
    items,
    "",
  ].join("\n");
}

export async function generateCarta1(
  input: Carta1Input,
  options: {
    plantillaClienteTexto?: string;
    plantillaClienteLabel?: string;
    exemplary?: { caseSummary: string; outputJson: unknown }[];
  } = {}
): Promise<{ output: Carta1Output; usage: ModelUsage }> {
  const client = buildClient();
  const system = await loadPrompt("system.md");
  const plantilla = await loadPrompt("carta1.md");

  // El prefijo cacheable contiene la plantilla canónica, plantilla del cliente
  // y few-shot examples de Legal. Se reutiliza entre llamadas del MISMO tipo
  // de carta, ahorrando ~90% en input tokens a partir de la 2ª (cache TTL ~5 min).
  const cacheablePrefix = [
    "Redacta el borrador de Carta 1 (Imputación) para el siguiente caso. Sigue estrictamente la plantilla y devuelve únicamente el JSON especificado.",
    "",
    "## Plantilla canónica (referencia mínima de Legal)",
    plantilla,
    plantillaClienteBlock(options.plantillaClienteTexto, options.plantillaClienteLabel),
    exemplaryBlock(options.exemplary),
  ].join("\n");

  const variablePart = [
    "## Datos del caso",
    "```json",
    JSON.stringify(input, null, 2),
    "```",
  ].join("\n");

  const response = await client.messages.create({
    model: MODEL_GENERATOR,
    max_tokens: 4096,
    system: systemBlocks(system),
    messages: [{ role: "user", content: userBlocksWithCachedPrefix(cacheablePrefix, variablePart) }],
  });
  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  if (!textBlock) throw new Error("Sin contenido de texto en respuesta del modelo");
  let parsed: Carta1Output;
  try {
    parsed = extractJson(textBlock.text) as Carta1Output;
  } catch (err) {
    throw new Error(`No se pudo parsear el JSON: ${(err as Error).message}\n\nRespuesta cruda:\n${textBlock.text}`);
  }
  return { output: parsed, usage: extractUsage(MODEL_GENERATOR, response) };
}

// =============================================================================
// OCR: extraer datos del colaborador desde una imagen
// =============================================================================

export type TrabajadorExtraido = {
  nombre: string | null;
  dni: string | null;
  puesto: string | null;
  unidad: "Marañón" | "Santa María" | "Palca" | null;
  fechaIngreso: string | null;
  confianza: "alta" | "media" | "baja";
  notas: string[];
};

const VISION_SYSTEM = `Eres un asistente de RR.HH. de Compañía Minera Poderosa que extrae datos identificatorios desde imágenes (DNI peruano, ficha del trabajador, credencial corporativa).

Reglas:
- Devuelve SIEMPRE un único bloque JSON sin texto adicional.
- Si un campo no se puede leer, déjalo como null en lugar de inventarlo.
- 'unidad' solo puede ser exactamente "Marañón", "Santa María" o "Palca" — si no aparece o no estás seguro, déjalo null.
- DNI formato peruano: 8 dígitos. Devuélvelo con espacios cada 2 dígitos, p.ej. "70 234 567".
- 'confianza' refleja qué tan claros se ven los datos: "alta" si todos son legibles, "media" si algunos campos faltan o tienen dudas, "baja" si la imagen es ilegible o no parece relevante.
- 'notas' es un array de strings con cualquier observación (calidad de imagen, campos ambiguos, sugerencias para RR.HH.).`;

const VISION_USER_TEXT = `Extrae los datos identificatorios del trabajador en esta imagen. Devuelve el JSON con este esquema exacto:

\`\`\`json
{
  "nombre": "Juan Pérez Rojas",
  "dni": "70 234 567",
  "puesto": "Operador de flotación",
  "unidad": "Marañón",
  "fechaIngreso": "2019-03-15 o null",
  "confianza": "alta",
  "notas": []
}
\`\`\``;

export async function extractTrabajadorFromImage(
  imageBase64: string,
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif"
): Promise<{ output: TrabajadorExtraido; usage: ModelUsage }> {
  const client = buildClient();
  const response = await client.messages.create({
    model: MODEL_VISION,
    max_tokens: 1024,
    // System cacheable: el system prompt de vision es estático
    system: systemBlocks(VISION_SYSTEM),
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
          // El texto de instrucción es estático → también lo cacheamos
          { type: "text", text: VISION_USER_TEXT, cache_control: { type: "ephemeral" } },
        ],
      },
    ],
  });
  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  if (!textBlock) throw new Error("Sin contenido de texto en respuesta del modelo");
  try {
    return { output: extractJson(textBlock.text) as TrabajadorExtraido, usage: extractUsage(MODEL_VISION, response) };
  } catch (err) {
    throw new Error(`No se pudo parsear el JSON de extracción: ${(err as Error).message}\n${textBlock.text}`);
  }
}

// =============================================================================
// Clasificación del incidente → tipo de carta
// =============================================================================

export type ClasificacionInput = {
  conducta: string;
  antecedentes?: string;
  yaTuvoDescargo?: boolean;
};

export type ClasificacionOutput = {
  tipoSugerido: Carta2Tipo | "carta1" | "carta1-amonestacion" | "flagrante";
  confianza: "alta" | "media" | "baja";
  razonamiento: string;
  gravedadEstimada: "leve" | "grave" | "muy grave";
  normaSugerida: string;
  advertencias: string[];
};

const CLASIFICACION_PREFIX = [
  "Clasifica el incidente y sugiere el tipo de carta más apropiado del catálogo de Poderosa.",
  "",
  "## Catálogo de tipos",
  "- `carta1` — Imputación de falta + plazo de descargo (preaviso despido), antes de evaluar descargo",
  "- `carta1-amonestacion` — Imputación previa a sanción menor (amonestación/suspensión), antes del descargo",
  "- `carta2-amonestacion` — Decisión final: amonestación escrita (post-descargo)",
  "- `carta2-suspension` — Decisión final: suspensión sin goce (post-descargo)",
  "- `carta2-despido` — Decisión final: despido (post-descargo)",
  "- `flagrante` — Sanción por falta flagrante sin proceso previo, debidamente acreditada",
  "",
  "## Output esperado (un único bloque JSON, sin texto fuera)",
  "```json",
  "{",
  '  "tipoSugerido": "carta1",',
  '  "confianza": "alta",',
  '  "razonamiento": "Explicación breve (2-3 frases) de por qué este tipo y no otro.",',
  '  "gravedadEstimada": "grave",',
  '  "normaSugerida": "Art. 25 inc. a) del TUO del D.L. N° 728 + Art. 8.4.b del RIT",',
  '  "advertencias": []',
  "}",
  "```",
  "",
  "Reglas:",
  "- Si `yaTuvoDescargo` es false (o no viene), el tipo SOLO puede ser `carta1`, `carta1-amonestacion`, o `flagrante` (este último solo si la flagrancia está clara en la descripción).",
  "- Si `yaTuvoDescargo` es true, el tipo SOLO puede ser `carta2-*`.",
  "- Si la descripción es ambigua o vacía, devuelve confianza='baja' con advertencias.",
  "- 'gravedadEstimada' debe ser coherente con el sancionario interno: leve → amonestación, grave → suspensión, muy grave → despido.",
].join("\n");

export async function classifyIncidente(input: ClasificacionInput): Promise<{ output: ClasificacionOutput; usage: ModelUsage }> {
  const client = buildClient();
  const system = await loadPrompt("system.md");
  const variablePart = ["## Input", "```json", JSON.stringify(input, null, 2), "```"].join("\n");

  const response = await client.messages.create({
    model: MODEL_CLASSIFIER,
    max_tokens: 2048,
    system: systemBlocks(system),
    messages: [{ role: "user", content: userBlocksWithCachedPrefix(CLASIFICACION_PREFIX, variablePart) }],
  });
  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  if (!textBlock) throw new Error("Sin contenido de texto en respuesta del modelo");
  try {
    return { output: extractJson(textBlock.text) as ClasificacionOutput, usage: extractUsage(MODEL_CLASSIFIER, response) };
  } catch (err) {
    throw new Error(`No se pudo parsear JSON de clasificación: ${(err as Error).message}\n${textBlock.text}`);
  }
}

// =============================================================================
// Carta 2
// =============================================================================

export async function generateCarta2(
  input: Carta2Input,
  options: {
    plantillaClienteTexto?: string;
    plantillaClienteLabel?: string;
    exemplary?: { caseSummary: string; outputJson: unknown }[];
  } = {}
): Promise<{ output: Carta2Output; usage: ModelUsage }> {
  const client = buildClient();
  const system = await loadPrompt("system.md");
  const plantilla = await loadPrompt("carta2.md");

  const cacheablePrefix = [
    `Redacta el borrador de **Carta 2 — ${input.tipo}** (decisión final del procedimiento disciplinario) para el siguiente caso. Sigue estrictamente la plantilla, evalúa explícitamente el descargo en la motivación, y devuelve únicamente el JSON especificado.`,
    "",
    "## Plantilla canónica (referencia mínima de Legal)",
    plantilla,
    plantillaClienteBlock(options.plantillaClienteTexto, options.plantillaClienteLabel),
    exemplaryBlock(options.exemplary),
  ].join("\n");

  const variablePart = ["## Datos del caso", "```json", JSON.stringify(input, null, 2), "```"].join("\n");

  const response = await client.messages.create({
    model: MODEL_GENERATOR,
    max_tokens: 4096,
    system: systemBlocks(system),
    messages: [{ role: "user", content: userBlocksWithCachedPrefix(cacheablePrefix, variablePart) }],
  });
  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  if (!textBlock) throw new Error("Sin contenido de texto en respuesta del modelo");
  let parsed: Carta2Output;
  try {
    parsed = extractJson(textBlock.text) as Carta2Output;
  } catch (err) {
    throw new Error(`No se pudo parsear el JSON: ${(err as Error).message}\n\nRespuesta cruda:\n${textBlock.text}`);
  }
  return { output: parsed, usage: extractUsage(MODEL_GENERATOR, response) };
}
