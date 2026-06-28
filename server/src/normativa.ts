// Recuperación semántica (RAG) sobre los reglamentos internos de Poderosa.
// Es la ÚNICA fuente de sustento legal de las medidas disciplinarias.
//
// El índice (chunks + embeddings) se construye con scripts/build-normativa-index.mjs
// y vive en un bucket privado de Supabase (normativa/index.json), con fallback a
// server/data/normativa-index.json (gitignored). Contiene texto de reglamentos
// internos: NUNCA se commitea al repo público.

import { promises as fs } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export type NormativaChunk = { id: number; doc: string; ref: string; texto: string; embedding: number[] };
type NormativaIndex = { model?: string; dims?: number; chunks: NormativaChunk[] };
export type NormativaHit = { doc: string; ref: string; texto: string; score: number };

let cache: NormativaIndex | null = null;
let norms: number[] | null = null; // ||embedding|| precomputado por chunk
let loadSource: "supabase" | "local" | "vacío" = "vacío";

async function fromSupabase(): Promise<NormativaIndex | null> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(url, key, { auth: { persistSession: false } });
    const { data, error } = await sb.storage.from("normativa").download("index.json");
    if (error || !data) return null;
    const parsed = JSON.parse(await data.text());
    return Array.isArray(parsed?.chunks) ? (parsed as NormativaIndex) : null;
  } catch (err) {
    console.warn("[normativa] no se pudo leer del bucket Supabase:", (err as Error).message);
    return null;
  }
}

async function fromLocalFile(): Promise<NormativaIndex | null> {
  const candidates = [
    resolve(process.cwd(), "data", "normativa-index.json"),
    resolve(__dirname, "..", "data", "normativa-index.json"),
    resolve(__dirname, "..", "..", "data", "normativa-index.json"),
  ];
  for (const p of candidates) {
    try {
      const parsed = JSON.parse(await fs.readFile(p, "utf-8"));
      if (Array.isArray(parsed?.chunks)) return parsed as NormativaIndex;
    } catch {
      /* siguiente */
    }
  }
  return null;
}

async function load(): Promise<NormativaIndex> {
  if (cache) return cache;
  const sb = await fromSupabase();
  if (sb?.chunks?.length) { cache = sb; loadSource = "supabase"; norms = cache.chunks.map((c) => Math.hypot(...c.embedding)); return cache; }
  const local = await fromLocalFile();
  if (local?.chunks?.length) { cache = local; loadSource = "local"; norms = cache.chunks.map((c) => Math.hypot(...c.embedding)); return cache; }
  // No cachear el estado vacío: si el índice se construye después (o el proyecto
  // Supabase estaba pausado), la próxima consulta lo recarga sin reiniciar.
  loadSource = "vacío";
  console.warn("[normativa] índice vacío — aún no construido; se reintentará en la próxima consulta");
  return { chunks: [] };
}

async function embedQuery(text: string, model: string): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey });
    const res = await client.embeddings.create({ model, input: text.slice(0, 8000) });
    return res.data[0]?.embedding ?? null;
  } catch (err) {
    console.warn("[normativa] fallo al embeber la consulta:", (err as Error).message);
    return null;
  }
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/**
 * Recupera los `k` extractos de los reglamentos de Poderosa más relevantes a la
 * consulta (cosine similarity). Devuelve [] si no hay índice o no se pudo embeber
 * (el llamador debe entonces advertir que no hay sustento disponible).
 */
export async function buscarNormativa(query: string, k = 8, opts: { preferRIT?: boolean } = {}): Promise<NormativaHit[]> {
  const idx = await load();
  if (!idx.chunks.length || !query || query.trim().length < 3) return [];
  const model = idx.model || process.env.EMBEDDING_MODEL || "text-embedding-3-small";
  const q = await embedQuery(query, model);
  if (!q) return [];
  const qn = Math.hypot(...q) || 1;
  // El RIT es el documento "REGLAMENTO INTERNO" (no "… DE SEGURIDAD" ni "… DE MEDIO").
  const esRIT = (doc: string) => /^reglamento interno$/i.test((doc || "").trim());
  const scored = idx.chunks.map((c, i) => {
    let score = dot(q, c.embedding) / ((norms?.[i] || 1) * qn);
    if (opts.preferRIT && esRIT(c.doc)) score *= 1.12; // sesgo para que el top-K traiga más artículos del RIT
    return { c, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).map(({ c, score }) => ({ doc: c.doc, ref: c.ref, texto: c.texto, score }));
}

export async function normativaInfo(): Promise<{ total: number; fuente: string }> {
  const idx = await load();
  return { total: idx.chunks.length, fuente: loadSource };
}
