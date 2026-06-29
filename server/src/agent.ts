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
  /** Contexto opcional: procedimiento/manual de cómo debió ejecutarse la labor (para contrastar la falta). NO es sustento legal. */
  procedimientoCorrecto?: string;
};

/** Extracto recuperado de los reglamentos de Poderosa (RAG) — única fuente de sustento. */
export type NormativaExtracto = { doc: string; ref: string; texto: string };

export type Carta1Output = {
  asunto: string;
  fecha: string;
  numeroCarta: string;
  destinatario: { tratamiento: string; nombre: string; dni: string; puestoUnidad: string };
  /** Estructura oficial de la carta de IMPUTACIÓN de Poderosa (ref. "IMPUTACION - BENDEZU"). */
  cuerpo: {
    referencia: string;          // "IMPUTACIÓN DE INCUMPLIMIENTO DE OBLIGACIONES DE TRABAJO"
    encabezado: string;          // "De nuestra consideración:"
    introduccion: string;        // apertura: Art. 9° LPCL + datos PODEROSA + se da inicio al proceso disciplinario distinto al despido
    hechosDetectados: string;    // HECHOS DETECTADOS / IMPUTADOS — en condicional ("habría", "configurarían")
    tipificacion: string;        // TIPIFICACIÓN: citas LITERALES, mayormente del RIT, luego RISST/Código
    mediosProbatorios: string[]; // lista de medios probatorios (informe, capturas, etc.)
    conclusionPreliminar: string;// CONCLUSIÓN PRELIMINAR ("usted habría incumplido…")
    plazoDescargos: string;      // PLAZO PARA PRESENTAR DESCARGOS (días + canal + cierre)
    despedida: string;           // "Atentamente,"
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
  /** Estructura oficial de la Decisión Final de Poderosa (post-descargo, en confirmación). */
  cuerpo: {
    referencia: string;        // "DECISIÓN FINAL A LAS INVESTIGACIONES SOBRE EL INCUMPLIMIENTO..."
    encabezado: string;        // "De nuestra consideración:"
    introduccion: string;      // recap: toma de conocimiento + carta de imputación (N°/fecha) + si presentó descargo
    hechosComprobados: string; // hechos AFIRMADOS (se identificó/verificó/constató/acreditó) — NO condicional
    analisisDescargo: string;  // evaluación del descargo: acepta lo que tenga mérito, refuta lo demás con fundamento; o "no presentó descargo → acreditado"
    tipificacion: string;      // citas literales de los artículos del RIT / Código de Ética (de la base normativa)
    decisionFinal: string;     // la sanción, con razonabilidad y proporcionalidad
    exhortacion: string;       // exhortación final + pedido de firma de cargo
    despedida: string;         // "Atentamente,"
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

// Núcleo normativo del RIT que el área de RR.HH. cita SIEMPRE en las imputaciones
// (marco disciplinario general). Texto literal validado por el cliente.
const NUCLEO_RIT = [
  "Reglamento Interno de Trabajo (RIT):",
  '"Artículo 3°.- Para efectos de su exigencia y cumplimiento, así como del pleno conocimiento de sus derechos y obligaciones, a cada colaborador se le hará entrega de un ejemplar del RIT (…), comprometiéndose a respetar y cumplir las normas establecidas en este, así como las disposiciones verbales y escritas que de ellas se deriven."',
  '"Artículo 62°.- Son obligaciones de los colaboradores de PODEROSA, cumplir con las siguientes normas: 1. Cumplir con la política del Sistema Integrado de Seguridad, Salud Ocupacional, Medio Ambiente y Calidad de PODEROSA. (…) 3. Cumplir y observar fielmente las normas, directivas, procedimientos, Código de Ética y Conducta vigente en la empresa. (…) 5. Acatar y cumplir las órdenes y directivas que por razones de trabajo sean impartidas por sus jefes y/o Superiores."',
  '"Artículo 63°.- Queda expresamente prohibido a los colaboradores, sujeto a las sanciones previstas en las disposiciones legales y reglamentarias, las siguientes acciones: (…) w) Incumplir las normas de carácter legal o internas de PODEROSA que imponen a los colaboradores determinadas conductas y obligaciones, incluyendo los contenidos en este reglamento."',
  '"Artículo 67°.- Es función de PODEROSA velar por la disciplina como condición necesaria e indispensable para el normal y eficiente desenvolvimiento del trabajo; para tal fin se han establecido las normas, procedimientos y medidas disciplinarias que se indican en el presente RIT."',
  '"Artículo 69°.- Las faltas en el trabajo están constituidas por aquellas acciones u omisiones del colaborador que implican violación de sus obligaciones en perjuicio de la seguridad, producción, productividad, disciplina y armonía en el centro de trabajo (…). También constituyen faltas en el trabajo, el incumplimiento o inobservancia de las normas, directivas, procedimientos y del Código de Ética y Conducta vigente en la empresa."',
  '"Artículo 70°.- Las medidas disciplinarias son las siguientes: a) Amonestación verbal. b) Amonestación escrita. c) Suspensión. d) Despido."',
  '"Artículo 72°.- Las sanciones serán impuestas teniendo en cuenta lo siguiente: a) Naturaleza y gravedad de la falta; b) Antecedentes disciplinarios del colaborador; (…) e) Código de Ética y Conducta; (…) g) Reiteración de la falta; h) Disposiciones legales vigentes."',
  '"Artículo 74°.- Amonestación escrita, es la medida correctiva aplicable cuando hay reincidencia en faltas primarias o en las que revisten relativa gravedad (…). También aplica a las faltas en el trabajo por incumplimiento o inobservancia de las normas, directivas, procedimientos y del Código de Ética y Conducta vigente en la empresa."',
  '"Artículo 75°.- Serán amonestados en forma verbal o escrita los servidores que incurren en las siguientes faltas (…): c) No cumplir con las disposiciones de Seguridad e Higiene Minera que sean leves; (…) e) No cumplir con las disposiciones emanadas de este RIT y que sean consideradas de carácter leve."',
  "",
  "Reglamento Interno de Seguridad y Salud Ocupacional (RISSO):",
  '"Numeral 6.- No obedecer el RISSO genera falta por los colaboradores y se aplicarán las sanciones de acuerdo al Reglamento Interno de Trabajo."',
  '"Numeral 8.- Son obligaciones de los supervisores de área: (…) b. Verificar que los colaboradores cumplan con el RISSO y procedimientos de trabajo realizando el seguimiento a la Disciplina Operativa en sus 4 etapas: disponibilidad, calidad, comunicación y cumplimiento, liderando y predicando con el ejemplo. (…) h. Verificar que las empresas contratistas mineras, conexas y otras cumplan con la política de seguridad y salud en el trabajo. (…) r. Realizar las observaciones de seguridad STOP en su área de responsabilidad, debiendo participar en los entrenamientos y cumplir con los programas establecidos."',
].join("\n");

function nucleoRitBlock(): string {
  return [
    "",
    "## Núcleo normativo OBLIGATORIO del RIT (citar SIEMPRE)",
    "Estos artículos del marco disciplinario general de Poderosa deben citarse SIEMPRE (texto literal, el RIT primero), ADEMÁS de los artículos específicos del caso que aparezcan en la base normativa. No los omitas:",
    NUCLEO_RIT,
    "",
  ].join("\n");
}

// Sustento normativo (RAG estricto): los extractos recuperados de los reglamentos
// de Poderosa son la ÚNICA fuente válida de citas legales.
function normativaBlock(hits?: NormativaExtracto[]): string {
  if (!hits || hits.length === 0) {
    return [
      "",
      "## Base normativa de Poderosa — ÚNICA fuente de sustento",
      "⚠ No se recuperaron extractos del índice normativo de Poderosa para este caso. NO cites artículos que no puedas sustentar con un documento de Poderosa, ni recurras a normas externas (D.L. 728, etc.): pobla `warnings[]` indicando que falta sustento normativo (índice no disponible o sin coincidencias) y que Legal debe completarlo.",
      "",
    ].join("\n");
  }
  const items = hits.map((h) => `- [${h.doc} · ${h.ref}]\n${h.texto}`).join("\n\n");
  return [
    "",
    "## Base normativa de Poderosa — ÚNICA fuente de sustento legal",
    "El sustento de la medida disciplinaria debe basarse EXCLUSIVAMENTE en los siguientes extractos de los reglamentos internos de Poderosa. Cita el documento y el artículo/numeral EXACTO (p.ej. \"RIT, Artículo 76°\" o \"RISST, numeral 4.1.6\"). Está PROHIBIDO citar normas que no aparezcan abajo o invocar legislación externa (D.L. 728, D.S. 024-2016-EM, etc.) salvo que esté contenida en estos extractos. Si la conducta imputada NO encuentra sustento aquí, NO inventes: pobla `warnings[]` señalando el vacío de sustento.",
    "",
    items,
    "",
  ].join("\n");
}

function procedimientoBlock(text?: string): string {
  if (!text || !text.trim()) return "";
  return [
    "",
    "## Procedimiento correcto (contexto del caso — cómo debió ejecutarse la labor)",
    "Usa esto SOLO como contexto para describir con precisión qué hizo o dejó de hacer el trabajador frente a cómo debió ejecutarse la labor. NO es sustento legal — el sustento sale únicamente de la base normativa de arriba.",
    "```",
    text.slice(0, 8000),
    "```",
    "",
  ].join("\n");
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
    normativa?: NormativaExtracto[];
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
    nucleoRitBlock(),
    plantillaClienteBlock(options.plantillaClienteTexto, options.plantillaClienteLabel),
    exemplaryBlock(options.exemplary),
  ].join("\n");

  const variablePart = [
    normativaBlock(options.normativa),
    procedimientoBlock(input.procedimientoCorrecto),
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
// Transcripción de documentos en imagen (informe / descargo / procedimiento)
// =============================================================================

/** Transcribe el texto completo de un documento fotografiado/escaneado (PNG/JPEG/WEBP) con el modelo de visión. */
export async function transcribirImagen(imageBase64: string, mediaType: string): Promise<{ texto: string; usage: ModelUsage }> {
  const { text, usage } = await chatJSON({
    model: MODEL_VISION,
    system: "Eres un asistente de RR.HH. que transcribe documentos a partir de imágenes (informes de incidente, correos, descargos, procedimientos). Devuelve el TEXTO completo y fiel del documento, conservando estructura, fechas, nombres, números, secciones y viñetas. No resumas, no interpretes y no inventes; si algo es ilegible, indícalo entre corchetes [ilegible].",
    userContent: [
      { type: "text", text: 'Transcribe TODO el texto legible de esta imagen del documento. Devuelve un único JSON: {"texto": "…transcripción completa…"}.' },
      { type: "image_url", image_url: { url: `data:${mediaType};base64,${imageBase64}` } },
    ],
    maxTokens: 8000,
    reasoningEffort: "low",
  });
  try {
    const parsed = extractJson(text) as { texto?: string };
    return { texto: (parsed.texto || "").trim(), usage };
  } catch {
    return { texto: text.trim(), usage }; // fallback: texto crudo
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
    normativa?: NormativaExtracto[];
  } = {}
): Promise<{ output: Carta2Output; usage: ModelUsage }> {
  const system = await loadPrompt("system.md");
  const plantilla = await loadPrompt("carta2.md");

  const cacheablePrefix = [
    `Redacta el borrador de la **DECISIÓN FINAL — ${input.tipo}** del procedimiento disciplinario para el siguiente caso, en el formato oficial de Poderosa de la plantilla. Reglas clave: (1) los hechos se **AFIRMAN/CONFIRMAN** (post-descargo) — NO uses condicional "habría"; (2) en \`analisisDescargo\` evalúa de verdad el descargo del trabajador: acepta lo que tenga mérito (puede atenuar la sanción o llevar a archivo) y **refuta** lo demás con fundamento en la base normativa; si no hay descargo y venció el plazo, indícalo y considera los hechos acreditados; (3) en \`tipificacion\` cita LITERALMENTE los artículos de la base normativa provista. Devuelve únicamente el JSON especificado en la plantilla (con las claves de \`cuerpo\`: referencia, encabezado, introduccion, hechosComprobados, analisisDescargo, tipificacion, decisionFinal, exhortacion, despedida).`,
    "",
    "## Plantilla canónica (referencia mínima de Legal)",
    plantilla,
    plantillaClienteBlock(options.plantillaClienteTexto, options.plantillaClienteLabel),
    exemplaryBlock(options.exemplary),
  ].join("\n");

  const variablePart = [normativaBlock(options.normativa), "## Datos del caso", "```json", JSON.stringify(input, null, 2), "```"].join("\n");

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

export type PersonaImputada = {
  nombre: string | null;
  dni: string | null;
  puesto: string | null;
  unidad: "Marañón" | "Santa María" | "Palca" | null;
  conducta: string;
  faltaTipificada: string;
  gravedad: "leve" | "grave" | "muy grave";
};

export type AnalisisInformeOutput = {
  trabajador: { nombre: string | null; dni: string | null; puesto: string | null; unidad: "Marañón" | "Santa María" | "Palca" | null };
  /** TODAS las personas a sancionar detectadas en el informe (1 o más). El primer elemento coincide con `trabajador`/`incidente`. */
  personas: PersonaImputada[];
  incidente: { fechaHechoISO: string | null; lugar: string | null; conducta: string; testigos: string[] };
  informeOrigen: { numero: string | null; fechaISO: string | null; area: string | null } | null;
  petsAplicable: { nombre: string | null; codigo: string | null; numerales: string[] } | null;
  anexos: string[];
  faltaTipificada: string;
  gravedadEstimada: "leve" | "grave" | "muy grave";
  tipoSugerido: "carta1" | "decision-final";
  normasPropuestas: NormaPropuesta[];
  resumenNormas: string;
  /** Propuesta de sanción del jefe/supervisor detectada en el texto, clasificada en las categorías de la decisión final, con evaluación de proporcionalidad. */
  sancionPropuesta: {
    detectada: boolean;
    categoria: "amonestacion" | "suspension" | "despido" | "archivo" | null;
    diasSuspension: number | null;
    textoOriginal: string | null;
    propuestaPor: string | null;
    confianza: "alta" | "media" | "baja";
    /** Evaluación de si la sanción propuesta es proporcional / procedente (va o no va). */
    evaluacion: {
      veredicto: "adecuada" | "excesiva" | "insuficiente" | "requiere-ajuste" | "prematura" | null;
      comentario: string;
      sancionRecomendada: { categoria: "amonestacion" | "suspension" | "despido" | "archivo" | null; diasSuspension: number | null } | null;
    };
  };
  confianza: "alta" | "media" | "baja";
  notas: string[];
};

const ANALISIS_PREFIX = [
  "Eres analista de RR.HH. de Compañía Minera Poderosa. Te entregan el TEXTO de un informe de incidente o un hilo de correos. Extrae los datos para armar una medida disciplinaria y propón las normas/cláusulas que la carta debería citar. IMPORTANTE: las normas propuestas deben provenir EXCLUSIVAMENTE de la 'Base normativa de Poderosa' incluida más abajo (reglamentos internos). Cita documento + artículo/numeral exacto. No invoques legislación externa que no aparezca en esos extractos.",
  "",
  "Devuelve ÚNICAMENTE un bloque JSON con este esquema EXACTO:",
  "```json",
  "{",
  '  "trabajador": { "nombre": "Juan Pérez Rojas o null", "dni": "70 234 567 o null", "puesto": "Operador de flotación o null", "unidad": "Marañón | Santa María | Palca | null" },',
  '  "personas": [ { "nombre": "…", "dni": "… o null", "puesto": "… o null", "unidad": "Marañón | Santa María | Palca | null", "conducta": "la conducta presunta de ESTA persona, en condicional", "faltaTipificada": "falta de esta persona", "gravedad": "leve | grave | muy grave" } ],',
  '  "incidente": { "fechaHechoISO": "2026-06-20T14:30 o 2026-06-20 o null", "lugar": "área / unidad o null", "conducta": "Redacción objetiva y formal del hecho, en presunción de inocencia (usa \'habría\', \'según el reporte\'). NO afirmes culpabilidad.", "testigos": ["Nombre (cargo)"] },',
  '  "informeOrigen": { "numero": "Log-Mina N.° 03 o null", "fechaISO": "2026-06-21 o null", "area": "logística o null" },',
  '  "petsAplicable": { "nombre": "o null", "codigo": "LOG_RLD_PE_013 o null", "numerales": ["4.1.6.3"] },',
  '  "anexos": ["Informe del incidente", "Captura del sistema", "Reporte del supervisor"],',
  '  "faltaTipificada": "Descripción corta de la falta (p.ej. Incumplimiento de obligaciones de trabajo / inobservancia del RIT).",',
  '  "gravedadEstimada": "leve | grave | muy grave",',
  '  "tipoSugerido": "carta1 | decision-final",',
  '  "normasPropuestas": [ { "norma": "Art. 25 inc. a) TUO D.L. 728", "detalle": "Por qué aplica a este hecho (1 frase)." }, { "norma": "RIT Art. 8.4.b", "detalle": "..." } ],',
  '  "resumenNormas": "Resumen en 3-6 frases, para revisión de RR.HH., de las cláusulas y normas que se citarán y por qué. Lenguaje claro.",',
  '  "sancionPropuesta": { "detectada": true, "categoria": "amonestacion | suspension | despido | archivo | null", "diasSuspension": 3, "textoOriginal": "cita textual de la propuesta del jefe", "propuestaPor": "nombre/cargo de quien la propone o null", "confianza": "alta | media | baja", "evaluacion": { "veredicto": "adecuada | excesiva | insuficiente | requiere-ajuste | prematura | null", "comentario": "Por qué va o no va, fundado en proporcionalidad y en la base normativa de Poderosa.", "sancionRecomendada": { "categoria": "amonestacion | suspension | despido | archivo | null", "diasSuspension": 3 } } },',
  '  "confianza": "alta | media | baja",',
  '  "notas": ["Datos que faltan o supuestos asumidos — para que RR.HH. los complete antes de generar."]',
  "}",
  "```",
  "",
  "Reglas:",
  "- Extrae SOLO lo que el texto sustenta. Si un dato no aparece, déjalo null/[] y anótalo en `notas`. NUNCA inventes DNI, nombres, números de informe ni fechas.",
  "- `personas`: lista a TODAS las personas a las que el informe atribuye una conducta sancionable (un mismo informe puede involucrar a varias). Cada una con su conducta específica y su falta. El PRIMER elemento debe coincidir con `trabajador`/`incidente`. Si solo hay una persona, `personas` tendrá un único elemento. NO incluyas a testigos, jefes que reportan ni terceros que no son objeto de sanción.",
  "- `unidad` solo puede ser exactamente \"Marañón\", \"Santa María\" o \"Palca\"; si no consta, null.",
  "- `conducta` debe respetar la presunción de inocencia (es para una Carta 1 de imputación): describe tiempo, lugar, modo y quién observó, sin declarar culpable al trabajador.",
  "- `tipoSugerido` = \"decision-final\" SOLO si el texto evidencia que ya hubo descargo del trabajador o venció su plazo; en otro caso \"carta1\".",
  "- `normasPropuestas`: incluye SIEMPRE los artículos del 'Núcleo normativo OBLIGATORIO del RIT' (Art. 3°, 62°, 63°w, 67°, 69°, 70°, 72°, 74°, 75° y RISSO 6, 8) más los artículos específicos del caso presentes en la 'Base normativa de Poderosa' (documento + ref exacta), cada uno con un `detalle` de por qué aplica. La mayoría deben ser del RIT. No cites normas externas que no aparezcan en los extractos ni en el núcleo.",
  "- `sancionPropuesta`: detecta si el informe o el hilo de correos contiene una PROPUESTA O RECOMENDACIÓN DE SANCIÓN del jefe/supervisor (frases como 'recomiendo amonestación', 'sugiero suspensión de 3 días', 'amerita el despido', 'propongo archivar el caso'). Clasifícala en `categoria`: \"amonestacion\" (amonestación escrita), \"suspension\" (suspensión sin goce — extrae los días en `diasSuspension`), \"despido\", o \"archivo\" (no sancionar / desestimar). Copia la frase exacta en `textoOriginal` y quién la propone en `propuestaPor`. Si NO hay una propuesta de sanción explícita, devuelve `detectada:false`, `categoria:null`, `diasSuspension:null` y `evaluacion.veredicto:null` — NUNCA inventes una sanción ni la deduzcas de la gravedad.",
  "- `sancionPropuesta.evaluacion`: SOLO si `detectada` es true, evalúa si la sanción propuesta por el jefe es proporcional y procedente ('va o no va'), fundándote en la gravedad de la falta, el principio de proporcionalidad y el sancionario/criterios de la 'Base normativa de Poderosa' de abajo. `veredicto`: \"adecuada\" (proporcional, procede), \"excesiva\" (demasiado severa para la falta), \"insuficiente\" (demasiado leve), \"requiere-ajuste\" (en línea pero ajustar, p.ej. los días), o \"prematura\" (aún no procede aplicar sanción — p.ej. falta el descargo del trabajador o vencer su plazo). En `comentario` explica el porqué en 1-2 frases citando la base normativa cuando aplique. Si el veredicto no es \"adecuada\", llena `sancionRecomendada` con la categoría/días más apropiados; si es adecuada, repite la misma. La decisión final es de RR.HH./Legal — esto es solo una recomendación.",
  "- Sé conservador: ante duda, baja la `confianza` y explica en `notas`.",
].join("\n");

export async function analizarInforme(
  texto: string,
  options: { normativa?: NormativaExtracto[] } = {}
): Promise<{ output: AnalisisInformeOutput; usage: ModelUsage }> {
  const system = await loadPrompt("system.md");
  const recorte = texto.length > 24000 ? texto.slice(0, 24000) + "\n\n[...texto truncado...]" : texto;
  const variablePart = [normativaBlock(options.normativa), nucleoRitBlock(), "## Texto del informe / hilo de correos", "```", recorte, "```"].join("\n");

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
