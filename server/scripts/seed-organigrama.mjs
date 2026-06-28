// Sube el directorio de empleados (server/data/organigrama.json) a un bucket
// privado de Supabase, de modo que el backend en Render lo lea sin que los
// correos reales toquen el repositorio público.
//
// Uso (desde server/):
//   node --env-file=.env scripts/seed-organigrama.mjs
//
// El JSON se genera con scripts/organigrama-to-json.py a partir del xlsx.

import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUCKET = "org";
const OBJECT = "organigrama.json";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.error("Faltan SUPABASE_URL / SUPABASE_SERVICE_KEY. Corre con: node --env-file=.env scripts/seed-organigrama.mjs");
  process.exit(1);
}

const jsonPath = resolve(__dirname, "..", "data", "organigrama.json");
const buf = await readFile(jsonPath);
const count = JSON.parse(buf.toString("utf-8")).length;

const sb = createClient(url, key, { auth: { persistSession: false } });

// 1) Asegurar el bucket privado
const { error: bucketErr } = await sb.storage.createBucket(BUCKET, { public: false });
if (bucketErr && !/already exists/i.test(bucketErr.message)) {
  console.error("No se pudo crear el bucket:", bucketErr.message);
  process.exit(1);
}

// 2) Subir (upsert) el JSON
const { error: upErr } = await sb.storage.from(BUCKET).upload(OBJECT, buf, {
  contentType: "application/json",
  upsert: true,
});
if (upErr) {
  console.error("Fallo al subir:", upErr.message);
  process.exit(1);
}

console.log(`✓ Subidos ${count} empleados a Supabase Storage: ${BUCKET}/${OBJECT}`);
