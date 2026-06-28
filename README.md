# Poderosa — Sistema de Gestión Disciplinaria (demo + IA)

Demo del Sistema de Gestión Disciplinaria — Compañía Minera Poderosa S.A.

Originalmente un `index.html` autónomo; ahora con un **backend Node.js/TypeScript** que redacta borradores de **Carta 1 (Imputación)** con **ChatGPT** (API de OpenAI, modelo `gpt-5`), conforme al TUO del D.L. N° 728, RIT y criterios SUNAFIL.

> **Demo de ingeniería.** Los borradores los redacta un modelo y deben pasar siempre por revisión humana de RR.HH. y validación final de Legal antes de notificarse.

---

## Estructura

```
poderosa-disciplinario-demo/
├── index.html              SPA front (Carta 1 con IA + biblioteca de plantillas + Historial IA)
├── preview.png             OG image
├── render.yaml             Blueprint de deploy (Render free)
└── server/
    ├── package.json
    ├── tsconfig.json
    ├── .env.example        Plantilla de variables de entorno
    ├── CLAUDE.md           Contexto legal completo
    ├── supabase-schema.sql Schema SQL para activar el backend Supabase
    ├── data/               (gitignored) almacén filesystem (backend fs)
    └── src/
        ├── index.ts        Express + endpoints REST
        ├── agent.ts        Cliente OpenAI + inyección de plantilla cliente
        ├── prompts/
        │   ├── system.md   System prompt (reglas obligatorias, formato JSON)
        │   └── carta1.md   Plantilla canónica mínima de Carta 1
        └── storage/
            ├── types.ts             Contratos TemplateStorage / CartaStorage
            ├── index.ts             Factory: selecciona backend por env
            ├── fs-storage.ts        Backend filesystem (default, demo local)
            └── supabase-storage.ts  Backend Supabase (Postgres + Storage bucket)
```

## Persistencia y backends de storage

El servidor abstrae el almacenamiento detrás de dos backends intercambiables.
**Se elige automáticamente según `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`:**

| Backend | Cuándo se activa | Pros | Contras |
|---|---|---|---|
| `fs` (filesystem) | Default — sin variables Supabase | Cero infra, simple, ideal para dev | Plantillas se pierden en redeploy de Render free |
| `supabase` | Cuando ambas vars están definidas | Persistencia real, multi-instancia, auditoría SUNAFIL | Requiere setup inicial (5 min) |

Lo que se persiste (en cualquier backend):

- **Plantillas** subidas por Legal (archivos + metadata + texto extraído).
- **Historial de cartas generadas** — cada llamada a `/api/cartas/generate` deja un registro con el input, el output, el modelo, latencia, plantilla usada y estado (`borrador` → `revisada` → `notificada` / `descartada`).

El estado se cambia desde la nueva vista **Historial IA** del sidebar (panel con tabla, filtros por caso/tipo, y botones "Cargar preview" + cambio de estado por fila).

## Activar el backend Supabase (5 min)

1. Crea cuenta en [supabase.com](https://supabase.com) → **New project** (gratis, sin tarjeta). Elige región (Sao Paulo es la más cercana a Perú).
2. En el dashboard del proyecto: **SQL Editor → New query** → pega el contenido de `server/supabase-schema.sql` → **Run**. Crea tablas, índices, bucket "templates" y activa RLS.
3. **Project Settings → API**: copia `Project URL` y `service_role` key (la `secret`, NO la `anon`).
4. En tu `.env` local o en las vars de Render:
   ```
   SUPABASE_URL=https://<proyecto>.supabase.co
   SUPABASE_SERVICE_KEY=eyJhbGciOi...
   ```
5. Reinicia el server. `GET /api/health` ahora debe devolver `"storage":"supabase"`.

> El `service_role` key **bypassa RLS** — vive solo en el backend, nunca en el frontend.

## Plan free de Supabase

- 500 MB DB + 1 GB Storage + 2 GB egress / 50 k MAU
- No requiere tarjeta
- Pausa proyectos tras 7 días sin actividad (un push lo despierta en segundos)

## Marco legal cubierto

- **TUO del D.L. N° 728** (D.S. 003-97-TR) — Arts. 25 (faltas graves), 31 (procedimiento de despido, plazo 6/9 días), 32 (descargo), 41 (carta de despido).
- **Precedente vinculante TFL 568-2021-SUNAFIL** — plazo razonable de descargo para **toda** sanción disciplinaria, no solo despido (aplica a amonestación y suspensión).
- **D.S. 024-2016-EM** — Reglamento de Seguridad y Salud Ocupacional en Minería (faltas de EPP, PETS, PETAR).
- **Ley 29783** + D.S. 005-2012-TR — Seguridad y Salud en el Trabajo (régimen general).
- **Excepciones por flagrancia** — sanción inmediata sin proceso previo, debidamente acreditada en la carta.
- **Nulidades del despido (Art. 29)** — embarazo, sindicalización, queja administrativa: el modelo rechaza redactar despidos por estas causales.

Todo esto vive en `server/CLAUDE.md` — el system prompt lo respeta y `warnings[]` los infringe.

## Tipos de carta soportados (catálogo cerrado)

| Código | Carta | Estado |
|---|---|---|
| `carta1` | Imputación de cargos / preaviso de despido | ✅ End-to-end |
| `carta1-amonestacion` | Imputación previa a sanción menor | 📥 Plantilla cargable, generador pendiente |
| `carta2-amonestacion` | Amonestación escrita | 📥 Plantilla cargable, generador pendiente |
| `carta2-suspension` | Suspensión sin goce | 📥 Plantilla cargable, generador pendiente |
| `carta2-despido` | Carta de despido | 📥 Plantilla cargable, generador pendiente |
| `flagrante` | Sanción por falta flagrante | 📥 Plantilla cargable, generador pendiente |
| `desistimiento` | Desistimiento del procedimiento | 📥 Plantilla cargable, generador pendiente |
| `acta-notificacion` | Acta de notificación | 📥 Plantilla cargable, generador pendiente |
| `levantamiento` | Levantamiento de medida | 📥 Plantilla cargable, generador pendiente |

## Requisitos

- Node.js 20+
- Una API key de OpenAI (`https://platform.openai.com/api-keys`)

## Puesta en marcha

```powershell
cd server
copy .env.example .env
# Edita .env y pon tu OPENAI_API_KEY real
npm install
npm run dev
```

Esto arranca el servidor en `http://localhost:8787` y **sirve también `index.html`** desde la raíz del repo. Abre:

```
http://localhost:8787/
```

Ve a **Generar Carta 1** en el sidebar, edita los campos del formulario (o deja la descripción libre del incidente como ejemplo), y pulsa **✨ Redactar con IA**. El preview de la carta se rehidrata con la redacción de ChatGPT. Las advertencias del modelo aparecen en el panel naranja.

### Endpoints

**Salud**
- `GET /api/health` — modelo activo, si la API key está cargada, tipos de plantilla aceptados.

**Cartas**
- `POST /api/cartas/generate` — body JSON con el caso + `templateId` opcional. Devuelve `{ carta, elapsedMs, templateUsed }`.

**Plantillas (biblioteca de RR.HH./Legal)**
- `GET /api/templates` — lista de plantillas con metadata.
- `POST /api/templates` — multipart (`file`, `type`, `label?`, `version?`, `validatedBy?`). Acepta `.docx`, `.pdf`, `.txt`, `.md`, `.html` hasta 10 MB. Extrae texto al subir.
- `GET /api/templates/:id` — metadata + texto extraído (para preview).
- `GET /api/templates/:id/raw` — descarga el archivo original (Supabase: redirect a signed URL).
- `DELETE /api/templates/:id` — borra registro y archivo del bucket.

**Historial IA (cartas generadas — auditoría SUNAFIL)**
- `GET /api/cartas?caseId=...&tipo=...&limit=N` — lista de cartas generadas (sin input/output JSON pesado).
- `GET /api/cartas/:id` — registro completo incluyendo el output del modelo (re-cargable en el preview).
- `PATCH /api/cartas/:id/estado` — body `{estado: "borrador"|"revisada"|"notificada"|"descartada"}`.

Ejemplo de petición:

```json
{
  "caseId": "CD-2026-047",
  "trabajador": { "nombre": "Juan Pérez Rojas", "dni": "70 234 567", "puestoUnidad": "Operador de flotación — Unidad Marañón", "unidad": "Marañón" },
  "faltaTipificada": "Uso indebido de EPP",
  "normaAplicable": "Art. 25 incisos a) y h) del TUO del D.L. N° 728",
  "conducta": "Ingresó al área de flotación sin respirador durante el cambio de turno",
  "fechaHechoISO": "2026-04-28T14:30:00-05:00",
  "lugar": "Área de flotación — Planta concentradora · Unidad Marañón",
  "plazoDescargo": "seis (6) días naturales",
  "anexos": ["Reporte del supervisor de turno", "Registro CCTV área flotación", "Cargo de notificación con acuse de recibo"],
  "firma": { "nombre": "María Salas Rivera", "cargo": "Jefa de RR.HH. — Unidad Marañón" },
  "numeroCarta": "RH-CD-2026-047/01"
}
```

## Biblioteca de plantillas

Sección dedicada en **Parámetros → Plantillas** del front:

- Subir archivos aprobados por Legal (Carta 1, Carta 2 en sus variantes, acta de notificación, etc.) en `.docx`, `.pdf`, `.txt`, `.md` o `.html`.
- El backend extrae el texto al vuelo (Mammoth para DOCX, pdf-parse para PDF, lectura directa para texto).
- Cada plantilla se etiqueta con un **tipo** (catálogo cerrado, ver tabla arriba), opcionalmente con etiqueta humana y versión.
- En la vista **Generar Carta 1** aparece un selector que filtra plantillas compatibles (`carta1`, `carta1-amonestacion`).
- Cuando se selecciona una plantilla, su texto se inyecta al prompt del modelo con instrucción: "Usa su tono y estructura como guía principal, pero las reglas legales prevalecen."
- Botones por fila: **Ver** (preview en modal), **Descargar original**, **Eliminar**.

## Cómo se garantiza el rigor legal

1. **System prompt** (`server/src/prompts/system.md`) impone presunción de inocencia, plazos según tipo de carta, tipicidad precisa, y rechazo de solicitudes ilegales (incluido despido nulo del Art. 29).
2. **CLAUDE.md** (`server/CLAUDE.md`) — contexto legal completo (D.L. 728, TFL 568-2021, D.S. 024-2016-EM, mapa de cartas).
3. **Plantilla canónica** (`server/src/prompts/carta1.md`) — referencia mínima de Legal.
4. **Plantillas cargadas por Legal** — sobreescriben tono y estructura, **nunca las reglas legales**.
5. **Salida JSON estructurada** que el frontend mapea a párrafos del preview.
6. **`warnings[]`** — datos faltantes, riesgos de tipificación, falta de pruebas, conflictos plantilla-vs-ley.
7. **`refused: true`** si la solicitud es claramente ilegal (plazos menores al mínimo, despido por causal nula, anticipación de sanción en Carta 1).

## Despliegue: Render — plan **free** (frontend + backend en un solo servicio)

El Express del backend ya sirve `index.html` como estático (`STATIC_DIR=..`), así que **todo se despliega como un único servicio**. URL única, mismo origen → sin CORS, sin GitHub Pages.

### Limitaciones del plan free (importante)

- **Duerme tras 15 min** de inactividad → primer request ~30s (cold start). Después responde normal.
- **Sin disco persistente**: las plantillas subidas viven en `server/data/` y **se borran en cada redeploy**. Sobreviven a los sleeps y restarts automáticos. Para una demo es tolerable; para producción real, plan Starter ($7/mes) + disk ($1/mes) o storage externo (Cloudflare R2).
- **750 horas/mes** — suficiente para 1 servicio corriendo 24/7.
- **No requiere tarjeta** para empezar.

### Pasos (≈ 5 minutos)

1. Push del repo a GitHub.
2. Crea cuenta en [render.com](https://render.com) (login con GitHub).
3. **New → Blueprint → conecta el repo `poderosa-disciplinario-demo`.** Render detecta `render.yaml` automáticamente.
4. Te pedirá el valor de `OPENAI_API_KEY` (está marcada `sync: false` precisamente para no commitearla). Pega tu clave de [platform.openai.com](https://platform.openai.com/api-keys).
5. **Apply.** Render compila (`cd server && npm ci && npm run build`) y arranca (`npm start`).
6. Cuando el deploy termine: la URL es algo como `https://poderosa-disciplinario.onrender.com`.
7. Verifica `https://poderosa-disciplinario.onrender.com/api/health` → debe responder `"hasKey":true`.
8. Abre la raíz → ves el SPA. Sube una plantilla, genera Carta 1 con IA. Listo.

### Después: dominio + auth + rate limit

- **Dominio propio**: Render → Settings → Custom Domain → añade `cartas.poderosa.com.pe` y configura el CNAME en tu DNS.
- **Restringir CORS**: cambia `ALLOW_ORIGIN` de `*` al dominio final.
- **Auth**: el endpoint `/api/cartas/generate` sigue abierto. Antes de exponer a usuarios reales, añade SSO (Microsoft Entra de Poderosa, Google Workspace) o al menos un header secreto compartido. Si quieres, lo monto.
- **Rate limit**: `express-rate-limit` para acotar gasto si la URL se filtra.

### Si superas el free tier o quieres más

| Opción | Coste | Qué resuelve |
|---|---|---|
| Render **Starter** | $7/mes | Sin sleep, sin cold start |
| Render **Disk** | $1/mes (1 GB) | Plantillas persistentes en redeploys |
| Cloudflare **R2** | Gratis hasta 10 GB | Plantillas en S3-compatible storage, sobreviven cualquier deploy |
| Migrar a **Workers + R2** | Gratis (límites altos) | 100% gratis para siempre, pero requiere reescribir Express → Workers (~4-6h) |

## Roadmap

- [x] Carta 1 — Imputación, end-to-end
- [x] Biblioteca de plantillas (upload, listado, preview, eliminación)
- [x] Selector de plantilla en Carta 1 (inyección al prompt)
- [ ] Carta 2 — Amonestación / Suspensión / Despido, tras descargo evaluado
- [ ] Acta de notificación + Desistimiento + Levantamiento
- [ ] Flujo de falta flagrante (sin proceso previo)
- [ ] **Tool calling / conectores** sobre el SDK de OpenAI: jurisprudencia (vLex/CourtListener), DMS interno, firma electrónica
- [ ] Integración con el módulo "Reportes SUNAFIL"
- [ ] Versionado de plantillas (historial, diff entre versiones)
- [ ] Política de retención + auditoría de quién subió cada plantilla

## Notas técnicas

- Esta iteración usa el SDK oficial `openai` (Chat Completions) directo, pidiendo salida en JSON estricto (`response_format: json_object`). El paso siguiente es incorporar *tool calling* (búsqueda en jurisprudencia, lookup del catálogo de faltas vía BD, etc.). La función `generateCarta1()` está pensada para encapsular ese cambio sin tocar el resto.
- Modelo por defecto: `gpt-5` (modelo de razonamiento, el mejor para la redacción jurídica). Override vía `OPENAI_MODEL` en `.env`. Para clasificación/visión puedes delegar a `gpt-5-mini` / `gpt-4o` con los overrides por endpoint.
- La caché de prompt es **automática** en OpenAI: los prefijos estables (system + plantilla + few-shots) se sirven de caché sin marcadores; basta con mantener la parte variable (el caso) al final del prompt.
- CORS abierto por defecto (`ALLOW_ORIGIN=*`) para facilitar abrir `index.html` directamente. En producción, restringir.
