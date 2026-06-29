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
  /** true cuando el nombre no calzó exacto/substring y se resolvió por similitud. */
  aproximado?: boolean;
  /** Similitud 0..1 cuando es un match aproximado (mayor = más probable). */
  score?: number;
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
  // No cachear el estado vacío: así, si el directorio se siembra después (o el
  // proyecto Supabase estaba pausado), la próxima consulta lo recarga sin reiniciar.
  loadSource = "vacío";
  console.warn("[organigrama] directorio vacío — aún no sembrado; se reintentará en la próxima consulta");
  return [];
}

// ---- Coincidencia difusa (cuando no hay match exacto/substring) ----

/** Distancia de edición Levenshtein (para tolerar typos y letras cambiadas). */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/** Similitud por bigramas (coeficiente de Sørensen–Dice), 0..1. */
function diceBigrams(a: string, b: string): number {
  const bigrams = (s: string): Map<string, number> => {
    const m = new Map<string, number>();
    const t = s.replace(/\s+/g, "");
    for (let i = 0; i < t.length - 1; i++) {
      const bg = t.slice(i, i + 2);
      m.set(bg, (m.get(bg) || 0) + 1);
    }
    return m;
  };
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const [bg, ca] of A) inter += Math.min(ca, B.get(bg) || 0);
  let total = 0;
  for (const c of A.values()) total += c;
  for (const c of B.values()) total += c;
  return (2 * inter) / total;
}

/**
 * Puntúa qué tan probable es que `cand` (nombre del directorio) sea el match de
 * `q` (lo que escribió el usuario). Combina solape de tokens (apellidos/nombres
 * en cualquier orden, tolerante a typos) con la similitud global por bigramas.
 * Devuelve 0..1.
 */
function fuzzyScore(q: string, cand: string): number {
  const qt = q.split(" ").filter(Boolean);
  const ct = cand.split(" ").filter(Boolean);
  if (!qt.length || !ct.length) return 0;

  // Para cada token de la query, el mejor token del candidato (exacto, prefijo,
  // o cercano por edición). Premia que cada palabra de la query exista.
  let acumulado = 0;
  for (const t of qt) {
    let mejor = 0;
    for (const c of ct) {
      let s: number;
      if (t === c) s = 1;
      else if (c.startsWith(t) || t.startsWith(c)) s = 0.9;
      else {
        const d = levenshtein(t, c);
        const max = Math.max(t.length, c.length);
        s = max ? 1 - d / max : 0; // 1 = igual, 0 = totalmente distinto
      }
      if (s > mejor) mejor = s;
    }
    acumulado += mejor;
  }
  const tokenScore = acumulado / qt.length;
  const dice = diceBigrams(q, cand);
  // El solape de tokens manda; los bigramas desempatan y captan transposiciones.
  return tokenScore * 0.7 + dice * 0.3;
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
  if (unicos.length) return unicos.slice(0, limit).map(toMatch);

  // Fallback difuso: ningún match exacto/substring → rankear TODO el directorio
  // por similitud y devolver los más probables. Umbral para evitar basura.
  const UMBRAL = 0.45;
  const puntuados = dir
    .map((e) => ({ e, s: fuzzyScore(nq, e.nombreNorm) }))
    .filter((x) => x.s >= UMBRAL)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit);
  return puntuados.map((x) => ({ ...toMatch(x.e), aproximado: true, score: Math.round(x.s * 100) / 100 }));
}

export async function organigramaInfo(): Promise<{ total: number; fuente: string }> {
  const dir = await load();
  return { total: dir.length, fuente: loadSource };
}
