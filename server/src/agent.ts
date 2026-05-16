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
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  return JSON.parse(candidate);
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
    max_tokens: 2048,
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
