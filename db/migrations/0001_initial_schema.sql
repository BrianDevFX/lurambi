CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE SCHEMA IF NOT EXISTS app;
CREATE OR REPLACE FUNCTION app.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;

CREATE TABLE IF NOT EXISTS public.wards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), constituency_name text NOT NULL DEFAULT 'Lurambi',
  county_name text NOT NULL DEFAULT 'Kakamega', name text NOT NULL UNIQUE, code text UNIQUE,
  registered_voters_target integer CHECK (registered_voters_target IS NULL OR registered_voters_target >= 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.polling_centres (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ward_id uuid NOT NULL REFERENCES public.wards(id) ON DELETE RESTRICT,
  name text NOT NULL, code text, total_registered_voters integer CHECK (total_registered_voters IS NULL OR total_registered_voters >= 0),
  latitude numeric(10,7), longitude numeric(10,7), synthetic boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (ward_id,name)
);
CREATE TABLE IF NOT EXISTS public.polling_stations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), polling_centre_id uuid NOT NULL REFERENCES public.polling_centres(id) ON DELETE RESTRICT,
  ward_id uuid NOT NULL REFERENCES public.wards(id) ON DELETE RESTRICT, station_name text NOT NULL,
  station_number integer NOT NULL DEFAULT 1 CHECK (station_number > 0), registered_voters_est integer,
  synthetic boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (polling_centre_id,station_name)
);
CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), phone text UNIQUE, password_hash text, full_name text NOT NULL,
  national_id text, national_id_masked text, role text NOT NULL DEFAULT 'mobilizer' CHECK (role IN ('admin','ward_coordinator','mobilizer')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','suspended')),
  home_ward_id uuid REFERENCES public.wards(id) ON DELETE SET NULL,
  home_polling_station_id uuid REFERENCES public.polling_stations(id) ON DELETE SET NULL,
  referral_code char(6) UNIQUE, approved_by uuid REFERENCES public.users(id), approved_at timestamptz,
  last_active_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.place_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), raw_alias text NOT NULL,
  canonical_type text NOT NULL CHECK (canonical_type IN ('ward','polling_centre','polling_station')),
  target_ward_id uuid REFERENCES public.wards(id) ON DELETE SET NULL,
  target_polling_centre_id uuid REFERENCES public.polling_centres(id) ON DELETE SET NULL,
  target_polling_station_id uuid REFERENCES public.polling_stations(id) ON DELETE SET NULL,
  confidence numeric(3,2) NOT NULL DEFAULT 1 CHECK (confidence BETWEEN 0 AND 1), notes text,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (raw_alias,canonical_type)
);
CREATE TABLE IF NOT EXISTS public.voter_register (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), national_id text NOT NULL UNIQUE, national_id_masked text NOT NULL,
  full_name text NOT NULL, first_name text, other_names text, gender char(1), date_of_birth date,
  constituency text NOT NULL DEFAULT 'Lurambi', ward_id uuid REFERENCES public.wards(id) ON DELETE SET NULL,
  ward_name_raw text, polling_centre_id uuid REFERENCES public.polling_centres(id) ON DELETE SET NULL,
  polling_centre_name_raw text, polling_station_id uuid REFERENCES public.polling_stations(id) ON DELETE SET NULL,
  voter_number text, is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), file_name text NOT NULL,
  import_type text NOT NULL CHECK (import_type IN ('entries','network_contacts','places','voter_register')),
  total_rows integer NOT NULL DEFAULT 0, imported_rows integer NOT NULL DEFAULT 0, duplicate_rows integer NOT NULL DEFAULT 0,
  rejected_rows integer NOT NULL DEFAULT 0, flagged_rows integer NOT NULL DEFAULT 0, unmapped_rows integer NOT NULL DEFAULT 0,
  summary_report jsonb NOT NULL DEFAULT '{}', created_by uuid REFERENCES public.users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_request_id uuid NOT NULL UNIQUE,
  mobilizer_id uuid REFERENCES public.users(id) ON DELETE SET NULL, ward_filed_id uuid NOT NULL REFERENCES public.wards(id) ON DELETE RESTRICT,
  polling_centre_id uuid REFERENCES public.polling_centres(id) ON DELETE SET NULL,
  polling_station_id uuid REFERENCES public.polling_stations(id) ON DELETE SET NULL,
  register_voter_id uuid REFERENCES public.voter_register(id) ON DELETE SET NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 160), phone_e164 text,
  national_id text, national_id_masked text,
  support_level text NOT NULL DEFAULT 'not_assessed' CHECK (support_level IN ('strong_supporter','leaning','undecided','opposed','not_reached','not_assessed')),
  issues text[] NOT NULL DEFAULT '{}', needs_transport boolean NOT NULL DEFAULT false, has_pvc boolean NOT NULL DEFAULT false, notes text,
  consent_at timestamptz, consent_text_version text,
  consent_status text NOT NULL DEFAULT 'given' CHECK (consent_status IN ('given','legacy_unconfirmed','withdrawn')),
  source text NOT NULL DEFAULT 'mobilizer' CHECK (source IN ('legacy','mobilizer','self_registered')),
  verification_status text NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified','verified','not_found','wrong_constituency','pending_id')),
  verification_notes text, verified_by uuid REFERENCES public.users(id), verified_at timestamptz,
  legacy_mobilizer_label text, captured_on timestamptz NOT NULL DEFAULT now(), import_batch_id uuid REFERENCES public.imports(id) ON DELETE SET NULL,
  row_hash text, flags text[] NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source='legacy' OR (consent_at IS NOT NULL AND consent_text_version IS NOT NULL)),
  CHECK (consent_status<>'legacy_unconfirmed' OR source='legacy')
);
CREATE UNIQUE INDEX IF NOT EXISTS entries_national_id_unique ON public.entries(national_id) WHERE national_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS entries_row_hash_unique ON public.entries(row_hash) WHERE row_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS entries_name_trgm_idx ON public.entries USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS entries_ward_created_idx ON public.entries(ward_filed_id,captured_on DESC);
CREATE INDEX IF NOT EXISTS entries_station_idx ON public.entries(polling_station_id);
CREATE INDEX IF NOT EXISTS entries_mobilizer_idx ON public.entries(mobilizer_id);
CREATE TABLE IF NOT EXISTS public.flag_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), entry_id uuid NOT NULL REFERENCES public.entries(id) ON DELETE CASCADE,
  flag_code text NOT NULL CHECK (flag_code IN ('DUPLICATE','POSSIBLE_DUPLICATE','NOT_IN_CONSTITUENCY','WRONG_CONSTITUENCY','WARD_MISMATCH','FILED_UNDER_DIFFERENT_WARD','MISSING_ID','INVALID_ID','INVALID_PHONE','SHARED_PHONE','UNMAPPED_PLACE','LOW_CONFIDENCE_MATCH')),
  severity text NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','critical')), details jsonb NOT NULL DEFAULT '{}',
  is_resolved boolean NOT NULL DEFAULT false, resolved_by uuid REFERENCES public.users(id), resolved_at timestamptz,
  resolution_notes text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(entry_id,flag_code)
);
CREATE INDEX IF NOT EXISTS flags_unresolved_idx ON public.flag_events(created_at) WHERE is_resolved=false;
CREATE TABLE IF NOT EXISTS public.duplicate_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), mobilizer_id uuid REFERENCES public.users(id),
  matched_entry_id uuid REFERENCES public.entries(id) ON DELETE SET NULL, attempted_name text NOT NULL, attempted_phone text,
  attempted_national_id text, attempted_ward_id uuid REFERENCES public.wards(id), match_reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.network_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), type text NOT NULL CHECK (type IN ('pastor','chp','other')),
  name text NOT NULL, phone_e164 text, national_id text, national_id_masked text, denomination text, community_unit text,
  sub_county text DEFAULT 'Lurambi', ward_id uuid REFERENCES public.wards(id) ON DELETE SET NULL,
  polling_station_id uuid REFERENCES public.polling_stations(id) ON DELETE SET NULL,
  reach_status text NOT NULL DEFAULT 'not_contacted' CHECK (reach_status IN ('not_contacted','contacted','meeting_held')),
  notes text, exclude_from_campaign_exports boolean NOT NULL DEFAULT false, import_batch_id uuid REFERENCES public.imports(id) ON DELETE SET NULL,
  row_hash text UNIQUE, synthetic boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.exports_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.users(id), export_type text NOT NULL,
  format text NOT NULL CHECK (format IN ('xlsx','csv','pdf')), filter_criteria jsonb NOT NULL DEFAULT '{}',
  row_count integer NOT NULL DEFAULT 0, file_name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES public.users(id), user_email text, user_role text,
  action text NOT NULL, entity_type text NOT NULL, entity_id text NOT NULL, old_values jsonb, new_values jsonb,
  reason text NOT NULL CHECK (length(btrim(reason))>0), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.data_subject_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_type text NOT NULL CHECK (request_type IN ('access','correction','deletion')),
  requester_name text NOT NULL, phone_e164 text NOT NULL, national_id text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','rejected')),
  notes text, resolved_by uuid REFERENCES public.users(id), resolved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.settings (
  key text PRIMARY KEY, value jsonb NOT NULL, description text, updated_by uuid REFERENCES public.users(id), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS voter_register_name_trgm_idx ON public.voter_register USING gin (full_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS voter_register_ward_idx ON public.voter_register(ward_id);
CREATE INDEX IF NOT EXISTS aliases_raw_trgm_idx ON public.place_aliases USING gin (raw_alias gin_trgm_ops);
CREATE INDEX IF NOT EXISTS network_contacts_ward_idx ON public.network_contacts(ward_id);
CREATE INDEX IF NOT EXISTS network_contacts_type_idx ON public.network_contacts(type);

INSERT INTO public.wards(name,code) VALUES
 ('Butsotso East','BE'),('Butsotso South','BS'),('Butsotso Central','BC'),('Sheywe','SH'),('Mahiakalo','MA'),('Shirere','SI')
ON CONFLICT (name) DO NOTHING;
INSERT INTO public.place_aliases(raw_alias,canonical_type,target_ward_id)
SELECT alias_name,'ward',ward.id FROM (VALUES ('Shieywe','Sheywe'),('Mahialako','Mahiakalo'),('Butsotso south','Butsotso South')) AS a(alias_name,canonical_name)
JOIN public.wards AS ward ON ward.name=a.canonical_name ON CONFLICT(raw_alias,canonical_type) DO NOTHING;
INSERT INTO public.settings(key,value,description) VALUES
 ('consent_policy','{"enabled":false,"version":"","text":""}','Consent wording is configured by an administrator.'),
 ('verification_providers','{"manual_enabled":true,"register_import_enabled":false,"external_link_enabled":false}','Provider switches.'),
 ('share_message_template','{"text":"Join our supporter list: {url}"}','Mobilizer referral message.'),
 ('issue_categories','["Transport","Healthcare","Education","Water","Roads","Jobs"]','Capture issue categories.'),
 ('exclude_legacy_unconfirmed_from_outreach','{"enabled":true}','Exclude legacy entries without confirmed consent from outreach exports.')
ON CONFLICT(key) DO NOTHING;
