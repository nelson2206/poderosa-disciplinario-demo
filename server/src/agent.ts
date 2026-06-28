import OpenAI from "openai";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, "prompts");

// Selección de modelo por endpoint (API de OpenAI / ChatGPT). Cada uno cae a
// OPENAI_MODEL si no está definido, lo que permite arrancar con un solo modelo
// y luego optimizar costes delegando las tareas livianas (OCR / clasificación)
// a un modelo más barato y reservando el modelo de razonamiento para la
// redacción jurídica.
//
// Modelo elegido para la GENERACIÓN de cartas: gpt-5 (modelo insignia de
// OpenAI con razonamiento). Es el que mejor se adapta a la redacción de
// medidas disciplinarias porque debe (a) aplicar reglas legales precisas —
// plazos del Art. 31, presunción de inocencia en Carta 1, tipicidad —,
// (b) decidir cuándo poblar `warnings[]` o `refused`, y (c) producir prosa
// formal en español peruano. El razonamiento explícito reduce errores en esas
// decisiones jurídicas de alto riesgo.
const MODEL_DEFAULT = process.env.OPENAI_MODEL || "gpt-5";
const MODEL_GENERATOR = process.env.OPENAI_MODEL_GENERATOR || MODEL_DEFAULT;
const MODEL_CLASSIFIER = process.env.OPENAI_MODEL_CLASSIFIER || MODEL_DEFAULT;
const MODEL_VISION = process.env.OPENAI_MODEL_VISION || MODEL_DEFAULT;

// Esfuerzo de razonamiento por defecto para la redacción (solo afecta a
// modelos de razonamiento como gpt-5 / familia o*). "medium" equilibra calidad
// jurídica y latencia; súbelo a "high" si se quiere máxima exhaustividad.
const REASONING_EFFORT = (process.env.OPENAI_REASONING_EFFORT || "medium") as OpenAI.ReasoningEffort;

export const MODEL_CONFIG = {
  generator: MODEL_GENERATOR,
  classifier: MODEL_CLASSIFIER,
  vision: MODEL_VISION,
  default: MODEL_DEFAULT,
};

// Los GPT-5 y la familia o* son modelos de razonamiento: usan
// `max_completion_tokens`, no admiten `temperature` distinta del valor por
// defecto y aceptan `reasoning_effort`. Lo detectamos por el nombre del modelo
// para enviar los parámetros correctos y no romper con gpt-4o/gpt-4.1.
function isReasoningModel(model: string): boolean {
  return /^(gpt-5|o\d)/i.test(model);
}

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
  /** Información del informe origen (LOG-Mina, etc.) para el párrafo de toma de conocimiento. */
  informeOrigen?: {
    numero: string;          // p.ej. "Log-Mina N.° 03"
    fechaISO: string;        // p.ej. "2026-05-03"
    area: string;            // p.ej. "logística"
  };
  /** PETS o procedimiento específico que el trabajador habría incumplido. */
  petsAplicable?: {
    nombre: string;          // p.ej. "Despacho de Explosivos, Accesorios y Agentes de Voladura"
    codigo: string;          // p.ej. "LOG_RLD_PE_013"
    numerales?: string[];    // p.ej. ["4.1.6.3", "4.1.6.5"]
  };
  /** Inciso aplicable del Art. 76° del RIT (p.ej. "v" para información inexacta/falsa). */
  art76Inciso?: string;
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
  cacheReadTokens: number;   // tokens del prompt servidos desde la caché de OpenAI (50% del coste)
  cacheWriteTokens: number;  // OpenAI no cobra escritura de caché → siempre 0 (se conserva por compatibilidad)
};

function extractUsage(model: string, response: OpenAI.Chat.Completions.ChatCompletion): ModelUsage {
  const u = response.usage;
  return {
    model,
    inputTokens: u?.prompt_tokens ?? 0,
    outputTokens: u?.completion_tokens ?? 0,
    // OpenAI cachea automáticamente los prefijos de prompt (>1024 tokens) sin
    // necesidad de marcadores; reporta los aciertos en prompt_tokens_details.
    cacheReadTokens: u?.prompt_tokens_details?.cached_tokens ?? 0,
    cacheWriteTokens: 0,
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

function buildClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY no configurada en .env");
  return new OpenAI({ apiKey });
}

type ChatContentPart = OpenAI.Chat.Completions.ChatCompletionContentPart;

/**
 * Helper único para llamar a la API de Chat Completions pidiendo JSON estricto.
 * La caché de prompt es automática en OpenAI: basta con poner la parte estable
 * (system + plantilla + few-shots) al inicio y la variable (el caso) al final,
 * como ya hacen los llamadores, para que los prefijos largos se sirvan de caché.
 */
async function chatJSON(opts: {
  model: string;
  system: string;
  userContent: string | ChatContentPart[];
  maxTokens: number;
  reasoningEffort?: OpenAI.ReasoningEffort;
}): Promise<{ text: string; usage: ModelUsage }> {
  const client = buildClient();
  const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
    model: opts.model,
    max_completion_tokens: opts.maxTokens,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.userContent },
    ],
  };
  if (isReasoningModel(opts.model)) {
    // Modelos de razonamiento: temperature fija (1) y reasoning_effort configurable.
    params.reasoning_effort = opts.reasoningEffort ?? REASONING_EFFORT;
  } else {
    // gpt-4o / gpt-4.1, etc.: documento legal → baja temperatura para consistencia.
    params.temperature = 0.2;
  }

  const response = await client.chat.completions.create(params);
  const text = response.choices[0]?.message?.content ?? "";
  if (!text) throw new Error("Sin contenido de texto en respuesta del modelo");
  return { text, usage: extractUsage(opts.model, response) };
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
  const system = await loadPrompt("system.md");
  // Formato único de Poderosa — el sistema ya no expone subtipos al usuario.
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

  // En modelos de razonamiento el presupuesto de salida incluye los tokens de
  // razonamiento, por eso es holgado: la carta completa puede superar los 3k.
  const { text, usage } = await chatJSON({
    model: MODEL_GENERATOR,
    system,
    userContent: `${cacheablePrefix}\n\n${variablePart}`,
    maxTokens: 16000,
  });
  let parsed: Carta1Output;
  try {
    parsed = extractJson(text) as Carta1Output;
  } catch (err) {
    throw new Error(`No se pudo parsear el JSON: ${(err as Error).message}\n\nRespuesta cruda:\n${text}`);
  }
  return { output: parsed, usage };
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
  // OpenAI recibe la imagen como data URL dentro de un content part image_url.
  const { text, usage } = await chatJSON({
    model: MODEL_VISION,
    system: VISION_SYSTEM,
    userContent: [
      { type: "text", text: VISION_USER_TEXT },
      { type: "image_url", image_url: { url: `data:${mediaType};base64,${imageBase64}` } },
    ],
    maxTokens: 2048,
    reasoningEffort: "low", // OCR simple: minimiza latencia si el modelo razona
  });
  try {
    return { output: extractJson(text) as TrabajadorExtraido, usage };
  } catch (err) {
    throw new Error(`No se pudo parsear el JSON de extracción: ${(err as Error).message}\n${text}`);
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
  const system = await loadPrompt("system.md");
  const variablePart = ["## Input", "```json", JSON.stringify(input, null, 2), "```"].join("\n");

  const { text, usage } = await chatJSON({
    model: MODEL_CLASSIFIER,
    system,
    userContent: `${CLASIFICACION_PREFIX}\n\n${variablePart}`,
    maxTokens: 4096,
    reasoningEffort: "low", // clasificación liviana: prioriza latencia/coste
  });
  try {
    return { output: extractJson(text) as ClasificacionOutput, usage };
  } catch (err) {
    throw new Error(`No se pudo parsear JSON de clasificación: ${(err as Error).message}\n${text}`);
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

  const { text, usage } = await chatJSON({
    model: MODEL_GENERATOR,
    system,
    userContent: `${cacheablePrefix}\n\n${variablePart}`,
    maxTokens: 16000,
  });
  let parsed: Carta2Output;
  try {
    parsed = extractJson(text) as Carta2Output;
  } catch (err) {
    throw new Error(`No se pudo parsear el JSON: ${(err as Error).message}\n\nRespuesta cruda:\n${text}`);
  }
  return { output: parsed, usage };
}

// =============================================================================
// Análisis de informe / hilo de correos → campos de la medida + normas
// =============================================================================

export type NormaPropuesta = { norma: string; detalle: string };

export type AnalisisInformeOutput = {
  trabajador: { nombre: string | null; dni: string | null; puesto: string | null; unidad: "Marañón" | "Santa María" | "Palca" | null };
  incidente: { fechaHechoISO: string | null; lugar: string | null; conducta: string; testigos: string[] };
  informeOrigen: { numero: string | null; fechaISO: string | null; area: string | null } | null;
  petsAplicable: { nombre: string | null; codigo: string | null; numerales: string[] } | null;
  anexos: string[];
  faltaTipificada: string;
  gravedadEstimada: "leve" | "grave" | "muy grave";
  tipoSugerido: "carta1" | "decision-final";
  normasPropuestas: NormaPropuesta[];
  resumenNormas: string;
  confianza: "alta" | "media" | "baja";
  notas: string[];
};

const ANALISIS_PREFIX = [
  "Eres analista de RR.HH. de Compañía Minera Poderosa. Te entregan el TEXTO de un informe de incidente o un hilo de correos. Extrae los datos para armar una medida disciplinaria y propón las normas/cláusulas que la carta debería citar, fundándote en el marco legal del system prompt (TUO D.L. 728, RIT, D.S. 024-2016-EM, Ley 29783, precedente TFL 568-2021, PETS).",
  "",
  "Devuelve ÚNICAMENTE un bloque JSON con este esquema EXACTO:",
  "```json",
  "{",
  '  "trabajador": { "nombre": "Juan Pérez Rojas o null", "dni": "70 234 567 o null", "puesto": "Operador de flotación o null", "unidad": "Marañón | Santa María | Palca | null" },',
  '  "incidente": { "fechaHechoISO": "2026-06-20T14:30 o 2026-06-20 o null", "lugar": "área / unidad o null", "conducta": "Redacción objetiva y formal del hecho, en presunción de inocencia (usa \'habría\', \'según el reporte\'). NO afirmes culpabilidad.", "testigos": ["Nombre (cargo)"] },',
  '  "informeOrigen": { "numero": "Log-Mina N.° 03 o null", "fechaISO": "2026-06-21 o null", "area": "logística o null" },',
  '  "petsAplicable": { "nombre": "o null", "codigo": "LOG_RLD_PE_013 o null", "numerales": ["4.1.6.3"] },',
  '  "anexos": ["Informe del incidente", "Captura del sistema", "Reporte del supervisor"],',
  '  "faltaTipificada": "Descripción corta de la falta (p.ej. Incumplimiento de obligaciones de trabajo / inobservancia del RIT).",',
  '  "gravedadEstimada": "leve | grave | muy grave",',
  '  "tipoSugerido": "carta1 | decision-final",',
  '  "normasPropuestas": [ { "norma": "Art. 25 inc. a) TUO D.L. 728", "detalle": "Por qué aplica a este hecho (1 frase)." }, { "norma": "RIT Art. 8.4.b", "detalle": "..." } ],',
  '  "resumenNormas": "Resumen en 3-6 frases, para revisión de RR.HH., de las cláusulas y normas que se citarán y por qué. Lenguaje claro.",',
  '  "confianza": "alta | media | baja",',
  '  "notas": ["Datos que faltan o supuestos asumidos — para que RR.HH. los complete antes de generar."]',
  "}",
  "```",
  "",
  "Reglas:",
  "- Extrae SOLO lo que el texto sustenta. Si un dato no aparece, déjalo null/[] y anótalo en `notas`. NUNCA inventes DNI, nombres, números de informe ni fechas.",
  "- `unidad` solo puede ser exactamente \"Marañón\", \"Santa María\" o \"Palca\"; si no consta, null.",
  "- `conducta` debe respetar la presunción de inocencia (es para una Carta 1 de imputación): describe tiempo, lugar, modo y quién observó, sin declarar culpable al trabajador.",
  "- `tipoSugerido` = \"decision-final\" SOLO si el texto evidencia que ya hubo descargo del trabajador o venció su plazo; en otro caso \"carta1\".",
  "- `normasPropuestas`: cita artículos/incisos concretos (D.L. 728, RIT, D.S. 024-2016-EM, Ley 29783, PETS). Cada uno con un `detalle` de por qué aplica. Si el hecho es de seguridad minera (EPP, PETS, PETAR, zona restringida), incluye D.S. 024-2016-EM.",
  "- Sé conservador: ante duda, baja la `confianza` y explica en `notas`.",
].join("\n");

export async function analizarInforme(texto: string): Promise<{ output: AnalisisInformeOutput; usage: ModelUsage }> {
  const system = await loadPrompt("system.md");
  const recorte = texto.length > 24000 ? texto.slice(0, 24000) + "\n\n[...texto truncado...]" : texto;
  const variablePart = ["## Texto del informe / hilo de correos", "```", recorte, "```"].join("\n");

  const { text, usage } = await chatJSON({
    model: MODEL_GENERATOR,
    system,
    userContent: `${ANALISIS_PREFIX}\n\n${variablePart}`,
    maxTokens: 8000,
  });
  try {
    return { output: extractJson(text) as AnalisisInformeOutput, usage };
  } catch (err) {
    throw new Error(`No se pudo parsear el JSON de análisis: ${(err as Error).message}\n${text}`);
  }
}
