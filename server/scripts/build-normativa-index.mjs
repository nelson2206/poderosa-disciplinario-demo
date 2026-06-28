// Construye el índice normativo (RAG) a partir de los reglamentos internos de Poderosa.
// Extrae texto de los PDFs → chunkea por artículo/sección → embebe (OpenAI) →
// sube a un bucket privado de Supabase (normativa/index.json) y deja un fallback
// local en server/data/normativa-index.json (gitignored).
//
// Uso (desde server/):
//   node --env-file=.env scripts/build-normativa-index.mjs "C:/ruta/a/Reglamentos internos"
//   node --env-file=.env scripts/build-normativa-index.mjs "<carpeta>" --dry   (solo chunking, sin OpenAI/Supabase)
//
// Los reglamentos son internos: el índice NO se commitea al repo público.

import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse/lib/pdf-parse.js");

const __dirname = dirname(fileURLToPath(import.meta.url));
const EMBED_MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-small";
const BUCKET = "normativa";
const OBJECT = "index.json";

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const carpeta = args.find((a) => !a.startsWith("--"));
if (!carpeta) {
  console.error('Falta la carpeta de PDFs. Uso: node --env-file=.env scripts/build-normativa-index.mjs "<carpeta>" [--dry]');
  process.exit(1);
}

// ---------- Chunking por artículo / sección ----------
const HEADER_RE = /^(art[íi]culo\s+n?[°º.]?\s*\d+[°º]?|art\.?\s*\d+[°º]?|t[íi]tulo\s+[ivxlcdm0-9]+|cap[íi]tulo\s+[ivxlcdm0-9]+|secci[óo]n\s+[ivxlcdm0-9]+|pol[íi]tica\s+\w+|\d{1,2}(\.\d{1,2}){1,4}\.?)\b/i;
const MAX_CHARS = 3200;
const MIN_CHARS = 60;

function splitLong(t, max) {
  if (t.length <= max) return [t];
  const out = [];
  const sentences = t.split(/(?<=[.;:])\s+/);
  let buf = "";
  for (const s of sentences) {
    if ((buf + " " + s).length > max && buf) { out.push(buf.trim()); buf = s; }
    else buf += (buf ? " " : "") + s;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

function windowText(text, max, overlap) {
  const clean = text.replace(/\s+/g, " ").trim();
  const out = [];
  for (let i = 0; i < clean.length; i += (max - overlap)) {
    out.push(clean.slice(i, i + max));
  }
  return out;
}

function chunkDoc(doc, raw) {
  const text = raw.replace(/\r/g, "");
  const lines = text.split("\n").map((l) => l.trim());
  const chunks = [];
  let curRef = "Disposiciones generales";
  let curBuf = [];
  const flush = () => {
    const t = curBuf.join(" ").replace(/\s+/g, " ").trim();
    if (t.length >= MIN_CHARS) for (const piece of splitLong(t, MAX_CHARS)) chunks.push({ doc, ref: curRef, texto: piece });
    curBuf = [];
  };
  for (const line of lines) {
    if (!line) continue;
    if (line.length < 120 && HEADER_RE.test(line)) { flush(); curRef = line.slice(0, 90); }
    else curBuf.push(line);
  }
  flush();
  // Fallback: documento sin estructura de artículos detectable.
  if (chunks.length < 3 && text.length > 6000) {
    return windowText(text, MAX_CHARS, 300).map((piece, i) => ({ doc, ref: `Sección ${i + 1}`, texto: piece }));
  }
  return chunks;
}

function docName(file) {
  return file.replace(/\.pdf$/i, "").replace(/\s+/g, " ").trim();
}

// ---------- Embeddings (OpenAI) ----------
async function embedBatch(texts) {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const out = [];
  const BATCH = 64;
  for (let i = 0; i < texts.length; i += BATCH) {
    const slice = texts.slice(i, i + BATCH);
    const res = await client.embeddings.create({ model: EMBED_MODEL, input: slice });
    for (const d of res.data) out.push(d.embedding);
    process.stdout.write(`  embebido ${Math.min(i + BATCH, texts.length)}/${texts.length}\r`);
  }
  process.stdout.write("\n");
  return out;
}

// ---------- Main ----------
const files = readdirSync(carpeta).filter((f) => f.toLowerCase().endsWith(".pdf"));
if (!files.length) { console.error("No hay PDFs en", carpeta); process.exit(1); }

let chunks = [];
for (const f of files) {
  const buf = await readFile(resolve(carpeta, f));
  const parsed = await pdfParse(buf);
  const c = chunkDoc(docName(f), parsed.text || "");
  console.log(`${String(c.length).padStart(4)} chunks · ${f}`);
  chunks = chunks.concat(c);
}
chunks = chunks.map((c, i) => ({ id: i, ...c }));
console.log(`\nTotal: ${chunks.length} chunks de ${files.length} documentos.`);

if (DRY) {
  const sample = chunks.slice(0, 5).map((c) => ({ doc: c.doc, ref: c.ref, texto: c.texto.slice(0, 120) + "…" }));
  console.log("\nMuestra de chunks:\n" + JSON.stringify(sample, null, 2));
  const outDir = resolve(__dirname, "..", "data");
  await mkdir(outDir, { recursive: true });
  await writeFile(resolve(outDir, "normativa-chunks-dry.json"), JSON.stringify(chunks, null, 0), "utf-8");
  console.log("\n[--dry] Sin embeddings ni subida. Chunks escritos en server/data/normativa-chunks-dry.json");
  process.exit(0);
}

if (!process.env.OPENAI_API_KEY) { console.error("Falta OPENAI_API_KEY"); process.exit(1); }
console.log(`\nEmbeddings con ${EMBED_MODEL}…`);
const vectors = await embedBatch(chunks.map((c) => c.texto));
const indexed = chunks.map((c, i) => ({ ...c, embedding: vectors[i] }));
const payload = { model: EMBED_MODEL, dims: vectors[0]?.length || 0, builtChunks: indexed.length, chunks: indexed };

// Fallback local
const outDir = resolve(__dirname, "..", "data");
await mkdir(outDir, { recursive: true });
const localPath = resolve(outDir, "normativa-index.json");
await writeFile(localPath, JSON.stringify(payload), "utf-8");
console.log(`Índice local: ${localPath}`);

// Supabase (bucket privado)
const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
if (url && key) {
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { error: bErr } = await sb.storage.createBucket(BUCKET, { public: false });
  if (bErr && !/already exists/i.test(bErr.message)) { console.error("Bucket:", bErr.message); process.exit(1); }
  const { error: uErr } = await sb.storage.from(BUCKET).upload(OBJECT, Buffer.from(JSON.stringify(payload)), { contentType: "application/json", upsert: true });
  if (uErr) { console.error("Subida:", uErr.message); process.exit(1); }
  console.log(`✓ Índice subido a Supabase: ${BUCKET}/${OBJECT} (${indexed.length} chunks, ${payload.dims} dims)`);
} else {
  console.log("⚠ Sin SUPABASE_* — solo se escribió el índice local (dev).");
}
