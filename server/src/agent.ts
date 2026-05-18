import Anthropic from "@anthropic-ai/sdk";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, "prompts");

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
  /** Referencia a la Carta 1 que abrió el procedimiento (obligatoria). */
  carta1: { numero: string; fechaISO: string };
  /** Fecha en que el trabajador presentó descargo. Null/undefined → se considera no presentado y se debe usar `descargoVencidoISO`. */
  descargoRecibidoISO?: string | null;
  /** Si no hubo descargo, fecha en que venció el plazo. */
  descargoVencidoISO?: string | null;
  /** Texto del descargo (o resumen de éste) presentado por el trabajador, para que el modelo lo aborde en la motivación. */
  descargoContenido?: string;
  /** Hechos imputados (los mismos de la Carta 1 — el modelo verifica la consistencia). */
  hechosImputados: string;
  /** Evaluación interna previa (qué hizo RR.HH./Legal con el descargo: aceptado/rechazado/parcial y por qué). */
  evaluacion: string;
  /** Para suspensión: número de días + fecha inicio + fecha fin + fecha retorno. */
  suspension?: { dias: number; inicioISO: string; finISO: string; retornoISO: string };
  /** Para despido: causal específica del Art. 25 (con inciso). */
  despido?: { causalArt25: string; fechaCeseISO: string };
  /** Para amonestación: efectos (p.ej. "observación al expediente personal"). */
  amonestacion?: { efectos: string };
  /** Norma aplicada (Art. D.L. 728 + Art. RIT + Sancionario interno). */
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
// Prompts cache
// =============================================================================

const cache = new Map<string, string>();

async function loadPrompt(name: string): Promise<string> {
  if (cache.has(name)) return cache.get(name)!;
  const content = await readFile(join(PROMPTS_DIR, name), "utf-8");
  cache.set(name, content);
  return content;
}

function extractJson(text: string): unknown {
  // 1) Bloque cercado completo ```json ... ```
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    return JSON.parse(fenced[1].trim());
  }
  // 2) Bloque cercado sin cierre (respuesta truncada por max_tokens):
  //    captura desde ```json hasta el final, intenta cerrar braces y parsear.
  const openOnly = text.match(/```(?:json)?\s*([\s\S]*)$/i);
  if (openOnly) {
    let candidate = openOnly[1].trim();
    // Recortamos comentarios o texto residual fuera del último '}'
    const lastBrace = candidate.lastIndexOf("}");
    if (lastBrace > 0) candidate = candidate.slice(0, lastBrace + 1);
    return JSON.parse(candidate);
  }
  // 3) Sin cercados: intenta encontrar el primer '{' y el último '}'
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) {
    return JSON.parse(text.slice(first, last + 1));
  }
  return JSON.parse(text.trim());
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

async function callModel(system: string, userMessage: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY no configurada en .env");
  const client = new Anthropic({ apiKey });
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system,
    messages: [{ role: "user", content: userMessage }],
  });
  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  if (!textBlock) throw new Error("Respuesta del modelo sin contenido de texto");
  return textBlock.text;
}

export async function generateCarta1(
  input: Carta1Input,
  options: { plantillaClienteTexto?: string; plantillaClienteLabel?: string } = {}
): Promise<Carta1Output> {
  const system = await loadPrompt("system.md");
  const plantilla = await loadPrompt("carta1.md");

  const userMessage = [
    "Redacta el borrador de Carta 1 (Imputación) para el siguiente caso. Sigue estrictamente la plantilla y devuelve únicamente el JSON especificado.",
    "",
    "## Plantilla canónica (referencia mínima de Legal)",
    plantilla,
    plantillaClienteBlock(options.plantillaClienteTexto, options.plantillaClienteLabel),
    "## Datos del caso",
    "```json",
    JSON.stringify(input, null, 2),
    "```",
  ].join("\n");

  const text = await callModel(system, userMessage);
  try {
    return extractJson(text) as Carta1Output;
  } catch (err) {
    throw new Error(`No se pudo parsear el JSON: ${(err as Error).message}\n\nRespuesta cruda:\n${text}`);
  }
}

// =============================================================================
// OCR / Vision: extraer datos del colaborador desde una imagen (DNI, ficha, etc.)
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

export async function extractTrabajadorFromImage(
  imageBase64: string,
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif"
): Promise<TrabajadorExtraido> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY no configurada en .env");
  const client = new Anthropic({ apiKey });
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

  const system = `Eres un asistente de RR.HH. de Compañía Minera Poderosa que extrae datos identificatorios desde imágenes (DNI peruano, ficha del trabajador, credencial corporativa).

Reglas:
- Devuelve SIEMPRE un único bloque JSON sin texto adicional.
- Si un campo no se puede leer, déjalo como null en lugar de inventarlo.
- 'unidad' solo puede ser exactamente "Marañón", "Santa María" o "Palca" — si no aparece o no estás seguro, déjalo null.
- DNI formato peruano: 8 dígitos. Devuélvelo con espacios cada 2 dígitos, p.ej. "70 234 567".
- 'confianza' refleja qué tan claros se ven los datos: "alta" si todos son legibles, "media" si algunos campos faltan o tienen dudas, "baja" si la imagen es ilegible o no parece relevante.
- 'notas' es un array de strings con cualquier observación (calidad de imagen, campos ambiguos, sugerencias para RR.HH.).`;

  const userText = `Extrae los datos identificatorios del trabajador en esta imagen. Devuelve el JSON con este esquema exacto:

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

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
          { type: "text", text: userText },
        ],
      },
    ],
  });
  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  if (!textBlock) throw new Error("Sin contenido de texto en respuesta del modelo");
  try {
    return extractJson(textBlock.text) as TrabajadorExtraido;
  } catch (err) {
    throw new Error(`No se pudo parsear el JSON de extracción: ${(err as Error).message}\n${textBlock.text}`);
  }
}

// =============================================================================
// Clasificación: dada la descripción del incidente, sugiere el tipo de carta
// =============================================================================

export type ClasificacionInput = {
  conducta: string;
  /** Antecedentes del trabajador (opcional, ayuda al modelo a decidir gravedad). */
  antecedentes?: string;
  /** Si el trabajador ya respondió al descargo, indica si este es paso post-descargo */
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

export async function classifyIncidente(input: ClasificacionInput): Promise<ClasificacionOutput> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY no configurada en .env");
  const client = new Anthropic({ apiKey });
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

  const system = await loadPrompt("system.md");

  const tiposLegibles = [
    "`carta1` — Imputación de falta + plazo de descargo (preaviso despido), antes de evaluar descargo",
    "`carta1-amonestacion` — Imputación previa a sanción menor (amonestación/suspensión), antes del descargo",
    "`carta2-amonestacion` — Decisión final: amonestación escrita (post-descargo)",
    "`carta2-suspension` — Decisión final: suspensión sin goce (post-descargo)",
    "`carta2-despido` — Decisión final: despido (post-descargo)",
    "`flagrante` — Sanción por falta flagrante sin proceso previo, debidamente acreditada",
  ].join("\n- ");

  const userMessage = [
    "Clasifica el incidente y sugiere el tipo de carta más apropiado del catálogo de Poderosa.",
    "",
    "## Catálogo de tipos",
    "- " + tiposLegibles,
    "",
    "## Input",
    "```json",
    JSON.stringify(input, null, 2),
    "```",
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

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system,
    messages: [{ role: "user", content: userMessage }],
  });
  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  if (!textBlock) throw new Error("Sin contenido de texto en respuesta del modelo");
  try {
    return extractJson(textBlock.text) as ClasificacionOutput;
  } catch (err) {
    throw new Error(`No se pudo parsear JSON de clasificación: ${(err as Error).message}\n${textBlock.text}`);
  }
}

export async function generateCarta2(
  input: Carta2Input,
  options: { plantillaClienteTexto?: string; plantillaClienteLabel?: string } = {}
): Promise<Carta2Output> {
  const system = await loadPrompt("system.md");
  const plantilla = await loadPrompt("carta2.md");

  const userMessage = [
    `Redacta el borrador de **Carta 2 — ${input.tipo}** (decisión final del procedimiento disciplinario) para el siguiente caso. Sigue estrictamente la plantilla, evalúa explícitamente el descargo en la motivación, y devuelve únicamente el JSON especificado.`,
    "",
    "## Plantilla canónica (referencia mínima de Legal)",
    plantilla,
    plantillaClienteBlock(options.plantillaClienteTexto, options.plantillaClienteLabel),
    "## Datos del caso",
    "```json",
    JSON.stringify(input, null, 2),
    "```",
  ].join("\n");

  const text = await callModel(system, userMessage);
  try {
    return extractJson(text) as Carta2Output;
  } catch (err) {
    throw new Error(`No se pudo parsear el JSON: ${(err as Error).message}\n\nRespuesta cruda:\n${text}`);
  }
}
