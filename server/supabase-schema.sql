-- Schema para Compañía Minera Poderosa — Sistema disciplinario
-- Copia y pega completo en el SQL Editor de Supabase (Project → SQL → New query → Run).
-- Idempotente: se puede correr varias veces sin romper nada.

-- =============================================================================
-- Extensiones
-- =============================================================================
create extension if not exists "pgcrypto"; -- para gen_random_uuid()

-- =============================================================================
-- Tabla: templates (biblioteca de plantillas validadas por Legal)
-- =============================================================================
create table if not exists public.templates (
  id              uuid primary key default gen_random_uuid(),
  filename        text not null,
  stored_path     text not null,                       -- path dentro del bucket "templates" de Supabase Storage
  type            text not null,
  label           text not null,
  uploaded_at     timestamptz not null default now(),
  size_bytes      bigint not null,
  mime_type       text not null,
  text_preview    text not null default '',
  text_chars      integer not null default 0,
  /** Texto completo extraído (DOCX/PDF/TXT) — cacheado para no re-parsear en cada generación. */
  full_text       text not null default '',
  validated_by    text,
  version         text,
  constraint templates_type_check check (type in (
    'carta1','carta1-amonestacion','carta2-amonestacion','carta2-suspension',
    'carta2-despido','flagrante','desistimiento','acta-notificacion','levantamiento','otro'
  ))
);

create index if not exists templates_type_idx on public.templates(type);
create index if not exists templates_uploaded_at_idx on public.templates(uploaded_at desc);

-- =============================================================================
-- Tabla: cartas_generadas (audit log)
-- =============================================================================
create table if not exists public.cartas_generadas (
  id                  uuid primary key default gen_random_uuid(),
  case_id             text not null,
  trabajador_nombre   text not null,
  trabajador_dni      text not null,
  unidad              text not null,
  tipo                text not null,
  template_id         uuid references public.templates(id) on delete set null,
  template_label      text,
  generated_at        timestamptz not null default now(),
  generated_by        text,
  model               text not null,
  elapsed_ms          integer not null,
  estado              text not null default 'borrador',
  warnings_count      integer not null default 0,
  refused             boolean not null default false,
  input_json          jsonb not null,
  output_json         jsonb not null,
  constraint cartas_tipo_check check (tipo in (
    'carta1','carta1-amonestacion','carta2-amonestacion','carta2-suspension',
    'carta2-despido','flagrante','desistimiento','acta-notificacion','levantamiento'
  )),
  constraint cartas_estado_check check (estado in ('borrador','revisada','notificada','descartada'))
);

create index if not exists cartas_case_id_idx on public.cartas_generadas(case_id);
create index if not exists cartas_unidad_idx on public.cartas_generadas(unidad);
create index if not exists cartas_generated_at_idx on public.cartas_generadas(generated_at desc);
create index if not exists cartas_tipo_idx on public.cartas_generadas(tipo);

-- =============================================================================
-- Migración: columnas de feedback / mejora continua (idempotente)
-- =============================================================================
-- rating: -1 (mala), 0 (neutra), 1 (buena). Default NULL = sin valoración.
alter table public.cartas_generadas add column if not exists rating smallint;
-- Texto libre del revisor sobre qué mejoraría o qué editó
alter table public.cartas_generadas add column if not exists feedback_text text;
-- Bandera explícita: Legal revisó y validó la carta para uso real
alter table public.cartas_generadas add column if not exists validated_by_legal boolean not null default false;
-- Bandera: marca esta carta como "ejemplo canónico" para que el modelo la use como few-shot
alter table public.cartas_generadas add column if not exists is_exemplary boolean not null default false;
-- Output final tras edición humana (lo que realmente se notificó)
alter table public.cartas_generadas add column if not exists final_edited_output jsonb;
-- Quién dejó el feedback
alter table public.cartas_generadas add column if not exists feedback_by text;
alter table public.cartas_generadas add column if not exists feedback_at timestamptz;

create index if not exists cartas_exemplary_idx on public.cartas_generadas(is_exemplary) where is_exemplary = true;
create index if not exists cartas_rating_idx on public.cartas_generadas(rating) where rating is not null;

-- =============================================================================
-- Storage bucket: "templates"
-- =============================================================================
-- Crea el bucket donde se guardan los archivos físicos de las plantillas.
-- PRIVATE por defecto: la app firma URLs cuando necesita servirlos.
insert into storage.buckets (id, name, public)
values ('templates', 'templates', false)
on conflict (id) do nothing;

-- =============================================================================
-- Row-Level Security
-- =============================================================================
-- La app accede con el SERVICE_ROLE key (bypassa RLS) desde el backend.
-- Se activa RLS para evitar exposición accidental si alguien usa el anon key:
alter table public.templates enable row level security;
alter table public.cartas_generadas enable row level security;

-- (Sin policies definidas → solo service_role puede leer/escribir. Justo lo que queremos.)
-- Cuando integres SSO/auth, añade aquí policies por unidad / rol.

-- =============================================================================
-- Permisos para service_role
-- =============================================================================
-- En proyectos creados con "Automatically expose new tables" desactivado, el rol
-- service_role no recibe GRANTs por defecto. Se otorgan explícitamente aquí.
grant usage on schema public to service_role;
-- IMPORTANTE: Supabase tiene un event trigger que revoca privilegios DML automáticamente
-- cuando "Automatically expose new tables" está apagado en la creación del proyecto.
-- Hay que otorgar SELECT/INSERT/UPDATE/DELETE explícitamente (GRANT ALL no es suficiente
-- porque solo concede los privilegios que el trigger no revoca: REFERENCES, TRIGGER, TRUNCATE).
grant select, insert, update, delete on public.templates to service_role;
grant select, insert, update, delete on public.cartas_generadas to service_role;
grant all privileges on all sequences in schema public to service_role;
-- Default privileges para futuras tablas/sequences en el schema público
alter default privileges in schema public grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
