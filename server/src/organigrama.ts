// Directorio de empleados (organigrama) — resuelve el jefe directo y su correo
// a partir del nombre del trabajador.
//
// Fuente de datos (en orden de preferencia):
//   1. Bucket privado de Supabase  →  org/organigrama.json  (producción / Render).
//   2. Archivo local               →  server/data/organigrama.json  (dev, gitignored).
//
// El JSON se genera con scripts/organigrama-to-json.py y se sube con
// scripts/seed-organigrama.mjs. Contiene correos corporativos reales: NUNCA se
// commitea al repo (público) — por eso el bucket privado en producción.

import { promises as fs } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export type EmpleadoOrg = {
  n: string;
  nombre: string;
  nombreNorm: string;
  puesto: string;
  gerencia: string;
  area: string;
  supervisor: string;
  jefe: string;
  gerente: string;
  correoEmpleado: string | null;
  correoJefe: string | null;
  correoGerente: string | null;
};

/** Forma que consume el frontend al resolver el jefe de un trabajador. */
export type JefeMatch = {
  trabajador: string;
  puesto: string;
  gerencia: string;
  area: string;
  jefe: string;
  correoJefe: string | null;
  gerente: string;
  correoGerente: string | null;
};

let cache: EmpleadoOrg[] | null = null;
let loadSource: "supabase" | "local" | "vacío" = "vacío";

function normalizar(s: string): string {
  return (s || "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ");
}

async function fromSupabase(): Promise<EmpleadoOrg[] | null> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(url, key, { auth: { persistSession: false } });
    const { data, error } = await sb.storage.from("org").download("organigrama.json");
    if (error || !data) return null;
    const text = await data.text();
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? (parsed as EmpleadoOrg[]) : null;
  } catch (err) {
    console.warn("[organigrama] no se pudo leer del bucket Supabase:", (err as Error).message);
    return null;
  }
}

async function fromLocalFile(): Promise<EmpleadoOrg[] | null> {
  const candidates = [
    resolve(process.cwd(), "data", "organigrama.json"),
    resolve(__dirname, "..", "data", "organigrama.json"),
    resolve(__dirname, "..", "..", "data", "organigrama.json"),
  ];
  for (const p of candidates) {
    try {
      const text = await fs.readFile(p, "utf-8");
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed as EmpleadoOrg[];
    } catch {
      /* siguiente candidato */
    }
  }
  return null;
}

async function load(): Promise<EmpleadoOrg[]> {
  if (cache) return cache;
  const sb = await fromSupabase();
  if (sb && sb.length) {
    cache = sb;
    loadSource = "supabase";
    return cache;
  }
  const local = await fromLocalFile();
  if (local && local.length) {
    cache = local;
    loadSource = "local";
    return cache;
  }
  cache = [];
  loadSource = "vacío";
  console.warn("[organigrama] directorio vacío — corre scripts/organigrama-to-json.py + seed-organigrama.mjs");
  return cache;
}

function toMatch(e: EmpleadoOrg): JefeMatch {
  return {
    trabajador: e.nombre,
    puesto: e.puesto,
    gerencia: e.gerencia,
    area: e.area,
    jefe: e.jefe || e.supervisor,
    correoJefe: e.correoJefe,
    gerente: e.gerente,
    correoGerente: e.correoGerente,
  };
}

/**
 * Busca empleados por nombre. Estrategia: coincidencia exacta normalizada →
 * "empieza con" → "incluye". Devuelve hasta `limit` resultados (el primero es
 * el mejor candidato). Si no hay match, devuelve [].
 */
export async function buscarOrganigrama(q: string, limit = 8): Promise<JefeMatch[]> {
  const dir = await load();
  const nq = normalizar(q);
  if (!nq || nq.length < 2) return [];

  const exactos = dir.filter((e) => e.nombreNorm === nq);
  if (exactos.length) return exactos.slice(0, limit).map(toMatch);

  const empieza = dir.filter((e) => e.nombreNorm.startsWith(nq));
  const incluye = dir.filter((e) => e.nombreNorm.includes(nq) && !e.nombreNorm.startsWith(nq));
  // También por tokens: que todas las palabras de la query estén en el nombre.
  const tokens = nq.split(" ").filter(Boolean);
  const porTokens = dir.filter(
    (e) => tokens.length > 1 && tokens.every((t) => e.nombreNorm.includes(t)) && !e.nombreNorm.includes(nq)
  );

  const ordenado = [...empieza, ...incluye, ...porTokens];
  const vistos = new Set<string>();
  const unicos = ordenado.filter((e) => (vistos.has(e.n) ? false : (vistos.add(e.n), true)));
  return unicos.slice(0, limit).map(toMatch);
}

export async function organigramaInfo(): Promise<{ total: number; fuente: string }> {
  const dir = await load();
  return { total: dir.length, fuente: loadSource };
}
