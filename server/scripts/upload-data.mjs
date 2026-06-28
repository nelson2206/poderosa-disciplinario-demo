// Sube a Supabase los archivos de datos YA construidos localmente (sin recomputar):
//   data/organigrama.json -> bucket org/organigrama.json
//   data/index.json       -> bucket normativa/index.json
// Con reintentos/backoff para esperar a que un proyecto recién reanudado termine de despertar.
//
// Uso (desde server/):
//   NODE_TLS_REJECT_UNAUTHORIZED=0 node --env-file=.env scripts/upload-data.mjs

import { createClient } from "@supabase/supabase-js";
import { readFile, access } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) { console.error("Faltan SUPABASE_URL / SUPABASE_SERVICE_KEY"); process.exit(1); }
const sb = createClient(url, key, { auth: { persistSession: false } });
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const jobs = [
  { bucket: "org", object: "organigrama.json", path: resolve(__dirname, "..", "data", "organigrama.json") },
  { bucket: "normativa", object: "index.json", path: resolve(__dirname, "..", "data", "index.json") },
];

async function uploadJob(j) {
  const { error: bErr } = await sb.storage.createBucket(j.bucket, { public: false, fileSizeLimit: "50MB" });
  if (bErr && !/already exists/i.test(bErr.message)) throw new Error("bucket: " + bErr.message);
  const buf = await readFile(j.path);
  const { error: uErr } = await sb.storage.from(j.bucket).upload(j.object, buf, { contentType: "application/json", upsert: true });
  if (uErr) throw new Error("upload: " + uErr.message);
  return buf.length;
}

for (const j of jobs) {
  await access(j.path);
  let ok = false;
  for (let attempt = 1; attempt <= 10 && !ok; attempt++) {
    try {
      const bytes = await uploadJob(j);
      console.log(`✓ ${j.bucket}/${j.object} subido (${(bytes / 1048576).toFixed(1)} MB)`);
      ok = true;
    } catch (e) {
      console.log(`  intento ${attempt}/10 · ${j.bucket}: ${e.message}`);
      if (attempt < 10) await delay(15000);
    }
  }
  if (!ok) { console.error(`✗ No se pudo subir ${j.bucket}/${j.object} (¿base aún despertando?)`); process.exit(1); }
}
console.log("LISTO ✓ — reinicia el servicio en Render para que recargue.");
