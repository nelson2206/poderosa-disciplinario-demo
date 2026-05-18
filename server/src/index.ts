import dotenv from "dotenv";
// override: true es importante — si el shell padre tiene una env var vacía
// (p.ej. ANTHROPIC_API_KEY=""), el .env del proyecto debe ganar.
dotenv.config({ override: true });
import express from "express";
import type { Request, Response, NextFunction } from "express";
import cors from "cors";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { promises as fs } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { generateCarta1, generateCarta2, extractTrabajadorFromImage, classifyIncidente, MODEL_CONFIG, type Carta1Input, type Carta2Input, type Carta2Tipo, type ClasificacionInput } from "./agent.js";
import {
  getStorage,
  getStorageKind,
  getFilesDir,
  TEMPLATE_TYPES,
  type CartaEstado,
  type CartaTipo,
  type TemplateType,
} from "./storage/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8787;
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || "*";
const STATIC_DIR = resolve(__dirname, "..", process.env.STATIC_DIR || "..");

const ALLOWED_MIME = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
  "text/html",
  "application/octet-stream",
]);
const ALLOWED_EXT = new Set([".pdf", ".docx", ".txt", ".md", ".html", ".htm"]);

// Para Supabase Storage no necesitamos disk storage; subimos a memoria y empujamos al bucket.
// Para filesystem usamos disk storage en getFilesDir().
const useSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);

const upload = multer({
  storage: useSupabase
    ? multer.memoryStorage()
    : multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, getFilesDir()),
        filename: (_req, file, cb) => {
          const ext = (file.originalname.match(/\.[^.]+$/) || [""])[0].toLowerCase();
          cb(null, `${randomUUID()}${ext}`);
        },
      }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = (file.originalname.match(/\.[^.]+$/) || [""])[0].toLowerCase();
    if (ALLOWED_EXT.has(ext) || ALLOWED_MIME.has(file.mimetype)) cb(null, true);
    else cb(new Error(`Tipo no soportado: ${file.originalname} (${file.mimetype}). Permitidos: ${[...ALLOWED_EXT].join(", ")}`));
  },
});

const app = express();
app.set("trust proxy", 1); // Para que express-rate-limit lea X-Forwarded-For correctamente en Render
app.use(cors({ origin: ALLOW_ORIGIN, exposedHeaders: ["X-RateLimit-Remaining"] }));
app.use(express.json({ limit: "1mb" }));

// ============================================================================
// Auth: token compartido vía X-Pod-Token (o query ?token= para descargas)
// ============================================================================
const POD_API_TOKEN = process.env.POD_API_TOKEN || "";
const POD_AUTH_OFF = process.env.POD_AUTH_OFF === "1" || process.env.POD_AUTH_OFF === "true";
const AUTH_DISABLED = POD_AUTH_OFF || POD_API_TOKEN === "" || POD_API_TOKEN === "dev";
if (AUTH_DISABLED) {
  const reason = POD_AUTH_OFF ? "POD_AUTH_OFF=1" : "POD_API_TOKEN vacío o 'dev'";
  console.warn(`[poderosa-server] Auth DESHABILITADO (${reason}) — el API está abierto al público con rate-limit.`);
}

function requireToken(req: Request, res: Response, next: NextFunction) {
  if (AUTH_DISABLED) return next();
  const header = (req.header("X-Pod-Token") || "").trim();
  const qs = (typeof req.query.token === "string" ? req.query.token : "").trim();
  if (header === POD_API_TOKEN || qs === POD_API_TOKEN) return next();
  res.status(401).json({ error: "Token inválido. Pega el código de acceso de Poderosa." });
}

// Rate limit en endpoints de generación (Anthropic cuesta dinero)
const generateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 15,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Demasiadas peticiones. Máximo 15 cartas por minuto." },
});

// Rate limit ligero global para todas las rutas /api/
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

app.use("/api", apiLimiter);

// ============================================================================
// /api/health: público (para uptime checks)
// ============================================================================
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    model: MODEL_CONFIG.default,
    models: MODEL_CONFIG,
    hasKey: Boolean(process.env.ANTHROPIC_API_KEY),
    storage: getStorageKind(),
    authEnabled: !AUTH_DISABLED,
    templateTypes: TEMPLATE_TYPES,
  });
});

// ============================================================================
// Templates
// ============================================================================

// Todas las rutas /api/templates, /api/cartas y /api/colaboradores requieren token
app.use("/api/templates", requireToken);
app.use("/api/cartas", requireToken);
app.use("/api/colaboradores", requireToken);

// ============================================================================
// Colaboradores — extracción de datos desde imagen (Claude Vision)
// ============================================================================

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024 }, // 6 MB — Claude vision suele bajar de eso al base64
  fileFilter: (_req, file, cb) => {
    if (["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.mimetype)) cb(null, true);
    else cb(new Error(`Tipo no soportado: ${file.mimetype}. Permitidos: PNG, JPEG, WEBP, GIF.`));
  },
});

app.post("/api/colaboradores/extraer", generateLimiter, imageUpload.single("imagen"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Falta el archivo de imagen (campo 'imagen')" });
    const base64 = req.file.buffer.toString("base64");
    const mime = req.file.mimetype as "image/png" | "image/jpeg" | "image/webp" | "image/gif";
    const t0 = Date.now();
    const { output, usage } = await extractTrabajadorFromImage(base64, mime);
    res.json({ trabajador: output, elapsedMs: Date.now() - t0, usage });
  } catch (err) {
    console.error("[/api/colaboradores/extraer] error:", (err as Error).message);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ============================================================================
// Cartas — clasificación automática del tipo según incidente
// ============================================================================

app.post("/api/cartas/clasificar", generateLimiter, async (req, res) => {
  try {
    const body = req.body as ClasificacionInput | undefined;
    if (!body || !body.conducta || typeof body.conducta !== "string" || body.conducta.trim().length < 10) {
      return res.status(400).json({ error: "Campo 'conducta' requerido (mínimo 10 caracteres)" });
    }
    const t0 = Date.now();
    const { output, usage } = await classifyIncidente(body);
    res.json({ ...output, elapsedMs: Date.now() - t0, usage });
  } catch (err) {
    console.error("[/api/cartas/clasificar] error:", (err as Error).message);
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/api/templates", async (_req, res) => {
  try {
    const s = await getStorage();
    res.json({ templates: await s.templates.list() });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/api/templates", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Falta el archivo (campo 'file')" });
    const type = (req.body.type || "otro") as TemplateType;
    if (!TEMPLATE_TYPES.includes(type)) {
      if (req.file.path) await fs.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ error: `type inválido. Permitidos: ${TEMPLATE_TYPES.join(", ")}` });
    }
    const s = await getStorage();
    const ext = (req.file.originalname.match(/\.[^.]+$/) || [""])[0].toLowerCase();
    const storedFilename = req.file.filename || `${randomUUID()}${ext}`;

    // Si es Supabase (memoria), escribimos el buffer a un tmp para que extractText lo lea.
    // Si es fs (disk), req.file.path ya apunta al archivo definitivo.
    let sourceAbsolutePath = req.file.path;
    let tmpToCleanup: string | null = null;
    if (!sourceAbsolutePath && req.file.buffer) {
      const tmpDir = resolve(__dirname, "..", "data", "tmp");
      await fs.mkdir(tmpDir, { recursive: true });
      sourceAbsolutePath = join(tmpDir, storedFilename);
      await fs.writeFile(sourceAbsolutePath, req.file.buffer);
      tmpToCleanup = sourceAbsolutePath;
    }

    const record = await s.templates.add({
      originalName: req.file.originalname,
      sourceAbsolutePath,
      storedFilename,
      type,
      label: req.body.label,
      validatedBy: req.body.validatedBy,
      version: req.body.version,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
    });

    if (tmpToCleanup) await fs.unlink(tmpToCleanup).catch(() => {});
    res.status(201).json({ template: record });
  } catch (err) {
    if (req.file?.path) await fs.unlink(req.file.path).catch(() => {});
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/api/templates/:id", async (req, res) => {
  try {
    const s = await getStorage();
    const rec = await s.templates.get(req.params.id);
    if (!rec) return res.status(404).json({ error: "No encontrada" });
    const text = await s.templates.getText(req.params.id);
    res.json({ template: rec, text });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/api/templates/:id/raw", async (req, res) => {
  try {
    const s = await getStorage();
    const opened = await s.templates.openRaw(req.params.id);
    if (opened.redirectUrl) return res.redirect(opened.redirectUrl);
    if (!opened.stream) return res.status(404).json({ error: "Archivo no disponible" });
    res.setHeader("Content-Type", opened.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(opened.filename)}"`);
    opened.stream.pipe(res);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.delete("/api/templates/:id", async (req, res) => {
  try {
    const s = await getStorage();
    const ok = await s.templates.delete(req.params.id);
    if (!ok) return res.status(404).json({ error: "No encontrada" });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ============================================================================
// Cartas — generación + historial persistido
// ============================================================================

function validateCarta1Input(body: unknown): { ok: true; input: Carta1Input; templateId?: string; generatedBy?: string } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Body vacío o inválido" };
  const b = body as Record<string, unknown>;
  const required = ["caseId", "trabajador", "faltaTipificada", "conducta", "fechaHechoISO", "plazoDescargo", "anexos", "firma"];
  for (const k of required) {
    if (b[k] === undefined || b[k] === null || b[k] === "") return { ok: false, error: `Campo requerido: ${k}` };
  }
  if (!Array.isArray(b.anexos)) return { ok: false, error: "anexos debe ser un array" };
  const templateId = typeof b.templateId === "string" && b.templateId.length > 0 ? b.templateId : undefined;
  const generatedBy = typeof b.generatedBy === "string" && b.generatedBy.length > 0 ? b.generatedBy : undefined;
  const { templateId: _t, generatedBy: _g, ...rest } = b;
  return { ok: true, input: rest as unknown as Carta1Input, templateId, generatedBy };
}

app.post("/api/cartas/generate", generateLimiter, async (req, res) => {
  const v = validateCarta1Input(req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });
  try {
    const s = await getStorage();
    const t0 = Date.now();
    let plantillaClienteTexto: string | undefined;
    let plantillaClienteLabel: string | undefined;
    let templateUsed: { id: string; label: string; type: string } | null = null;

    if (v.templateId) {
      const rec = await s.templates.get(v.templateId);
      if (!rec) return res.status(400).json({ error: `templateId no encontrado: ${v.templateId}` });
      plantillaClienteTexto = await s.templates.getText(v.templateId);
      plantillaClienteLabel = rec.label;
      templateUsed = { id: rec.id, label: rec.label, type: rec.type };
    }

    // Few-shot: tomar hasta 3 cartas marcadas como ejemplares del mismo tipo
    const exemplaryList = await s.cartas.list({ exemplary: true, tipo: "carta1", limit: 3 });
    const exemplary = exemplaryList
      .filter((c) => c.validatedByLegal === true || (c.rating ?? 0) >= 1)
      .map((c) => ({
        caseSummary: `Trabajador ${c.trabajadorNombre} · Unidad ${c.unidad} · ${(c.inputJson as { conducta?: string })?.conducta?.slice(0, 200) ?? ""}`,
        outputJson: c.finalEditedOutput ?? c.outputJson,
      }));

    const { output: carta, usage } = await generateCarta1(v.input, { plantillaClienteTexto, plantillaClienteLabel, exemplary });
    const elapsedMs = Date.now() - t0;

    const persisted = await s.cartas.create({
      caseId: v.input.caseId,
      trabajadorNombre: v.input.trabajador?.nombre || "",
      trabajadorDni: v.input.trabajador?.dni || "",
      unidad: v.input.trabajador?.unidad || "",
      tipo: "carta1" as CartaTipo,
      templateId: templateUsed?.id ?? null,
      templateLabel: templateUsed?.label ?? null,
      generatedBy: v.generatedBy ?? null,
      model: usage.model,
      elapsedMs,
      warningsCount: Array.isArray(carta.warnings) ? carta.warnings.length : 0,
      refused: Boolean(carta.refused),
      inputJson: v.input,
      outputJson: carta,
    });

    res.json({ carta, elapsedMs, templateUsed, usage, persisted: { id: persisted.id, generatedAt: persisted.generatedAt } });
  } catch (err) {
    const msg = (err as Error).message;
    console.error("[/api/cartas/generate] error:", msg);
    res.status(500).json({ error: msg });
  }
});

function validateCarta2Input(body: unknown): { ok: true; input: Carta2Input; templateId?: string; generatedBy?: string } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Body vacío o inválido" };
  const b = body as Record<string, unknown>;
  const required = ["caseId", "trabajador", "tipo", "carta1", "hechosImputados", "evaluacion", "normaAplicada", "firma"];
  for (const k of required) {
    if (b[k] === undefined || b[k] === null || b[k] === "") return { ok: false, error: `Campo requerido: ${k}` };
  }
  const validTipos: Carta2Tipo[] = ["carta2-amonestacion", "carta2-suspension", "carta2-despido", "desistimiento"];
  if (!validTipos.includes(b.tipo as Carta2Tipo)) {
    return { ok: false, error: `tipo inválido. Permitidos: ${validTipos.join(", ")}` };
  }
  if (b.tipo === "carta2-suspension" && !b.suspension) {
    return { ok: false, error: "Para 'carta2-suspension' se requiere el objeto `suspension` con dias/inicioISO/finISO/retornoISO" };
  }
  if (b.tipo === "carta2-despido" && !b.despido) {
    return { ok: false, error: "Para 'carta2-despido' se requiere el objeto `despido` con causalArt25/fechaCeseISO" };
  }
  const templateId = typeof b.templateId === "string" && b.templateId.length > 0 ? b.templateId : undefined;
  const generatedBy = typeof b.generatedBy === "string" && b.generatedBy.length > 0 ? b.generatedBy : undefined;
  const { templateId: _t, generatedBy: _g, ...rest } = b;
  return { ok: true, input: rest as unknown as Carta2Input, templateId, generatedBy };
}

app.post("/api/cartas/generate-carta2", generateLimiter, async (req, res) => {
  const v = validateCarta2Input(req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });
  try {
    const s = await getStorage();
    const t0 = Date.now();
    let plantillaClienteTexto: string | undefined;
    let plantillaClienteLabel: string | undefined;
    let templateUsed: { id: string; label: string; type: string } | null = null;

    if (v.templateId) {
      const rec = await s.templates.get(v.templateId);
      if (!rec) return res.status(400).json({ error: `templateId no encontrado: ${v.templateId}` });
      plantillaClienteTexto = await s.templates.getText(v.templateId);
      plantillaClienteLabel = rec.label;
      templateUsed = { id: rec.id, label: rec.label, type: rec.type };
    }

    // Few-shot: ejemplares del mismo subtipo de Carta 2
    const exemplaryList = await s.cartas.list({ exemplary: true, tipo: v.input.tipo, limit: 3 });
    const exemplary = exemplaryList
      .filter((c) => c.validatedByLegal === true || (c.rating ?? 0) >= 1)
      .map((c) => ({
        caseSummary: `Trabajador ${c.trabajadorNombre} · ${c.unidad} · ${(c.inputJson as { hechosImputados?: string })?.hechosImputados?.slice(0, 200) ?? ""}`,
        outputJson: c.finalEditedOutput ?? c.outputJson,
      }));

    const { output: carta, usage } = await generateCarta2(v.input, { plantillaClienteTexto, plantillaClienteLabel, exemplary });
    const elapsedMs = Date.now() - t0;

    const persisted = await s.cartas.create({
      caseId: v.input.caseId,
      trabajadorNombre: v.input.trabajador?.nombre || "",
      trabajadorDni: v.input.trabajador?.dni || "",
      unidad: v.input.trabajador?.unidad || "",
      tipo: v.input.tipo,
      templateId: templateUsed?.id ?? null,
      templateLabel: templateUsed?.label ?? null,
      generatedBy: v.generatedBy ?? null,
      model: usage.model,
      elapsedMs,
      warningsCount: Array.isArray(carta.warnings) ? carta.warnings.length : 0,
      refused: Boolean(carta.refused),
      inputJson: v.input,
      outputJson: carta,
    });

    res.json({ carta, elapsedMs, templateUsed, usage, persisted: { id: persisted.id, generatedAt: persisted.generatedAt } });
  } catch (err) {
    const msg = (err as Error).message;
    console.error("[/api/cartas/generate-carta2] error:", msg);
    res.status(500).json({ error: msg });
  }
});

app.get("/api/cartas", async (req, res) => {
  try {
    const s = await getStorage();
    const caseId = typeof req.query.caseId === "string" ? req.query.caseId : undefined;
    const tipo = typeof req.query.tipo === "string" ? (req.query.tipo as CartaTipo) : undefined;
    const limit = req.query.limit ? Math.min(200, Number(req.query.limit)) : 100;
    const list = await s.cartas.list({ caseId, tipo, limit });
    // Versión liviana: omitir input/output JSON pesados
    const summaries = list.map(({ inputJson: _i, outputJson: _o, ...rest }) => rest);
    res.json({ cartas: summaries });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/api/cartas/:id", async (req, res) => {
  try {
    const s = await getStorage();
    const rec = await s.cartas.get(req.params.id);
    if (!rec) return res.status(404).json({ error: "No encontrada" });
    res.json({ carta: rec });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/api/cartas/exemplary", async (req, res) => {
  try {
    const s = await getStorage();
    const tipo = typeof req.query.tipo === "string" ? (req.query.tipo as CartaTipo) : undefined;
    const limit = req.query.limit ? Math.min(20, Number(req.query.limit)) : 5;
    const list = await s.cartas.list({ exemplary: true, tipo, limit });
    // Solo con rating positivo o validados por Legal
    const filtered = list.filter((c) => c.validatedByLegal === true || (c.rating ?? 0) >= 1);
    const summaries = filtered.map(({ inputJson: _i, outputJson: _o, finalEditedOutput: _f, ...rest }) => rest);
    res.json({ cartas: summaries });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.patch("/api/cartas/:id/feedback", async (req, res) => {
  try {
    const body = req.body || {};
    const allowed = ["rating", "feedbackText", "validatedByLegal", "isExemplary", "finalEditedOutput", "feedbackBy"];
    const patch: Record<string, unknown> = {};
    for (const k of allowed) if (k in body) patch[k] = body[k];
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: "Sin campos a actualizar" });
    }
    if (patch.rating !== undefined && patch.rating !== null && ![-1, 0, 1].includes(patch.rating as number)) {
      return res.status(400).json({ error: "rating debe ser -1, 0 o 1" });
    }
    const s = await getStorage();
    const updated = await s.cartas.updateFeedback(req.params.id, patch);
    if (!updated) return res.status(404).json({ error: "No encontrada" });
    res.json({ carta: updated });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.patch("/api/cartas/:id/estado", async (req, res) => {
  try {
    const estado = (req.body?.estado as CartaEstado | undefined) ?? undefined;
    if (!estado || !["borrador", "revisada", "notificada", "descartada"].includes(estado)) {
      return res.status(400).json({ error: "estado inválido" });
    }
    const s = await getStorage();
    const updated = await s.cartas.updateEstado(req.params.id, estado);
    if (!updated) return res.status(404).json({ error: "No encontrada" });
    res.json({ carta: updated });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ============================================================================
// Static
// ============================================================================

// Sirve index.html con el POD_API_TOKEN inyectado en el meta tag, de modo que
// el frontend nunca tenga que pedir al usuario que pegue el token. El placeholder
// "__POD_API_TOKEN__" se reemplaza por el valor real (o por cadena vacía si auth
// está deshabilitado en dev).
async function serveIndexInjected(_req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const indexPath = resolve(STATIC_DIR, "index.html");
    const html = await import("node:fs/promises").then(m => m.readFile(indexPath, "utf-8"));
    const token = (process.env.POD_API_TOKEN || "").replace(/"/g, "&quot;");
    const injected = html.replace('content="__POD_API_TOKEN__"', `content="${token}"`);
    res.set("Cache-Control", "no-store").type("html").send(injected);
  } catch (err) {
    next();
  }
}
app.get("/", serveIndexInjected);
app.get("/index.html", serveIndexInjected);

app.use(express.static(STATIC_DIR));

app.listen(PORT, async () => {
  await getStorage(); // fuerza inicialización para que getStorageKind reporte correctamente
  console.log(`[poderosa-server] escuchando en http://localhost:${PORT}`);
  console.log(`[poderosa-server] storage backend: ${getStorageKind()}`);
  console.log(`[poderosa-server] sirviendo estáticos desde ${STATIC_DIR}`);
  if (!process.env.ANTHROPIC_API_KEY) console.warn("[poderosa-server] ANTHROPIC_API_KEY no está configurada — /api/cartas/generate fallará");
});
