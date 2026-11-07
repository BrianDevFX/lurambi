CREATE UNIQUE INDEX IF NOT EXISTS users_national_id_unique
  ON public.users(national_id) WHERE national_id IS NOT NULL;

CREATE OR REPLACE FUNCTION app.persist_entry_flags(p_entry_id uuid,p_flags text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_flag text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id=app.uid() AND status='approved' AND role='mobilizer') THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501';
  END IF;
  FOREACH v_flag IN ARRAY coalesce(p_flags,'{}'::text[]) LOOP
    INSERT INTO public.flag_events(entry_id,flag_code,severity)
    VALUES (p_entry_id,v_flag,CASE WHEN v_flag IN ('DUPLICATE','NOT_IN_CONSTITUENCY','WRONG_CONSTITUENCY') THEN 'critical'
      WHEN v_flag='SHARED_PHONE' THEN 'info' ELSE 'warning' END)
    ON CONFLICT (entry_id,flag_code) DO NOTHING;
  END LOOP;
END;
$$;

UPDATE public.settings
   SET value = '{"enabled":true,"version":"phase-b-1","text":"I agree to be contacted by the Lurambi campaign about my support. I have read the Privacy Notice."}'::jsonb,
       updated_at = now()
 WHERE key = 'consent_policy' AND value->>'enabled' = 'false';

CREATE OR REPLACE FUNCTION app.approve_mobilizer(p_target_id uuid,p_referral_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_actor public.users%ROWTYPE; v_target public.users%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM public.users WHERE id=app.uid();
  IF v_actor.id IS NULL OR v_actor.status<>'approved' OR v_actor.role NOT IN ('admin','ward_coordinator') THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_target FROM public.users WHERE id=p_target_id FOR UPDATE;
  IF v_target.id IS NULL OR v_target.role<>'mobilizer' OR v_target.status<>'pending' THEN
    RAISE EXCEPTION 'Pending mobilizer not found' USING ERRCODE='P0002';
  END IF;
  IF v_actor.role='ward_coordinator' AND (v_actor.home_ward_id IS NULL OR v_actor.home_ward_id IS DISTINCT FROM v_target.home_ward_id) THEN
    RAISE EXCEPTION 'Not authorized for this ward' USING ERRCODE='42501';
  END IF;
  IF length(p_referral_code)<>6 THEN RAISE EXCEPTION 'Invalid referral code' USING ERRCODE='23514'; END IF;
  UPDATE public.users SET status='approved',referral_code=p_referral_code,approved_by=v_actor.id,approved_at=now(),updated_at=now()
   WHERE id=v_target.id;
  RETURN jsonb_build_object('id',v_target.id,'full_name',v_target.full_name,'phone',v_target.phone,'role',v_target.role,
    'status','approved','home_ward_id',v_target.home_ward_id,'referral_code',p_referral_code);
END;
$$;

CREATE OR REPLACE FUNCTION app.suspend_mobilizer(p_target_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_actor public.users%ROWTYPE; v_target public.users%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM public.users WHERE id=app.uid();
  IF v_actor.id IS NULL OR v_actor.status<>'approved' OR v_actor.role NOT IN ('admin','ward_coordinator') THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_target FROM public.users WHERE id=p_target_id FOR UPDATE;
  IF v_target.id IS NULL OR v_target.role<>'mobilizer' OR v_target.status='suspended' THEN
    RAISE EXCEPTION 'Mobilizer not found' USING ERRCODE='P0002';
  END IF;
  IF v_actor.role='ward_coordinator' AND (v_actor.home_ward_id IS NULL OR v_actor.home_ward_id IS DISTINCT FROM v_target.home_ward_id) THEN
    RAISE EXCEPTION 'Not authorized for this ward' USING ERRCODE='42501';
  END IF;
  UPDATE public.users SET status='suspended',updated_at=now() WHERE id=v_target.id;
  RETURN jsonb_build_object('id',v_target.id,'full_name',v_target.full_name,'role',v_target.role,'status','suspended','home_ward_id',v_target.home_ward_id);
END;
$$;

CREATE OR REPLACE FUNCTION app.search_my_entries(p_query text)
RETURNS TABLE(id uuid,name text,phone_e164 text,national_id_masked text,ward_filed_id uuid,
  polling_centre_id uuid,polling_station_id uuid,flags text[],captured_on timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_query text:=btrim(coalesce(p_query,'')); v_id text:=regexp_replace(coalesce(p_query,''),'[^0-9]','','g');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id=app.uid() AND role='mobilizer' AND status='approved') THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501';
  END IF;
  IF length(v_query)<3 AND v_id !~ '^\d{7,8}$' THEN RAISE EXCEPTION 'Search must have at least 3 characters' USING ERRCODE='23514'; END IF;
  RETURN QUERY
    SELECT e.id,e.name,e.phone_e164,e.national_id_masked,e.ward_filed_id,e.polling_centre_id,e.polling_station_id,e.flags,e.captured_on
      FROM public.entries e
     WHERE e.mobilizer_id=app.uid()
       AND (e.name ILIKE '%'||v_query||'%' OR coalesce(e.phone_e164,'') ILIKE '%'||v_query||'%'
            OR (v_id ~ '^\d{7,8}$' AND e.national_id=v_id))
     ORDER BY e.captured_on DESC LIMIT 10;
END;
$$;

CREATE OR REPLACE FUNCTION app.submit_entry(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor public.users%ROWTYPE;
  v_existing public.entries%ROWTYPE;
  v_entry_id uuid;
  v_request_id uuid;
  v_name text:=btrim(coalesce(p_payload->>'name',''));
  v_phone text:=app.normalize_kenyan_phone(p_payload->>'phone');
  v_raw_id text:=regexp_replace(coalesce(p_payload->>'national_id',''),'[^0-9]','','g');
  v_national_id text;
  v_masked_id text;
  v_ward_id uuid:=(p_payload->>'ward_filed_id')::uuid;
  v_centre_id uuid:=(p_payload->>'polling_centre_id')::uuid;
  v_station_id uuid:=(p_payload->>'polling_station_id')::uuid;
  v_register_id uuid;
  v_register_ward uuid;
  v_register_constituency text;
  v_flags text[]:=ARRAY[]::text[];
  v_issues text[]:=ARRAY[]::text[];
  v_status text:='unverified';
  v_policy jsonb;
  v_match record;
  v_existing_masked_name text;
  v_consent_version text:=p_payload->>'consent_text_version';
BEGIN
  SELECT * INTO v_actor FROM public.users WHERE id=app.uid();
  IF v_actor.id IS NULL OR v_actor.role<>'mobilizer' OR v_actor.status<>'approved' THEN
    RAISE EXCEPTION 'Only approved mobilizers can capture entries' USING ERRCODE='42501';
  END IF;
  IF v_name='' OR length(v_name)<2 OR length(v_name)>160 THEN RAISE EXCEPTION 'Invalid name' USING ERRCODE='23514'; END IF;
  IF coalesce((p_payload->>'consent')::boolean,false) IS NOT TRUE THEN RAISE EXCEPTION 'Consent is required' USING ERRCODE='23514'; END IF;
  SELECT value INTO v_policy FROM public.settings WHERE key='consent_policy';
  IF coalesce((v_policy->>'enabled')::boolean,false) IS NOT TRUE OR v_consent_version IS NULL OR v_consent_version IS DISTINCT FROM v_policy->>'version' THEN
    RAISE EXCEPTION 'Consent wording is not configured' USING ERRCODE='23514';
  END IF;
  IF v_ward_id IS NULL OR v_centre_id IS NULL OR v_station_id IS NULL THEN RAISE EXCEPTION 'Choose a ward, centre and station' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.polling_centres WHERE id=v_centre_id AND ward_id=v_ward_id) OR
     NOT EXISTS (SELECT 1 FROM public.polling_stations WHERE id=v_station_id AND polling_centre_id=v_centre_id AND ward_id=v_ward_id) THEN
    RAISE EXCEPTION 'Place hierarchy is invalid' USING ERRCODE='23514';
  END IF;
  IF (p_payload->>'client_request_id') IS NULL THEN RAISE EXCEPTION 'Request ID is required' USING ERRCODE='23514'; END IF;
  v_request_id:=(p_payload->>'client_request_id')::uuid;
  SELECT * INTO v_existing FROM public.entries WHERE client_request_id=v_request_id;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.mobilizer_id IS DISTINCT FROM v_actor.id THEN RAISE EXCEPTION 'Request ID already used' USING ERRCODE='23505'; END IF;
    RETURN jsonb_build_object('ok',true,'idempotent',true,'entry',jsonb_build_object('id',v_existing.id,'name',v_existing.name,
      'phone_e164',v_existing.phone_e164,'national_id_masked',v_existing.national_id_masked,'ward_filed_id',v_existing.ward_filed_id,
      'polling_centre_id',v_existing.polling_centre_id,'polling_station_id',v_existing.polling_station_id,'flags',v_existing.flags,
      'verification_status',v_existing.verification_status,'captured_on',v_existing.captured_on));
  END IF;
  IF length(v_raw_id) IN (7,8) THEN v_national_id:=v_raw_id; v_masked_id:=app.mask_national_id(v_raw_id);
  ELSIF length(v_raw_id)=0 THEN v_national_id:=NULL; v_masked_id:=NULL; v_flags:=array_append(v_flags,'MISSING_ID'); v_status:='pending_id';
  ELSE v_national_id:=NULL; v_masked_id:=NULL; v_flags:=array_append(v_flags,'INVALID_ID'); END IF;
  IF v_phone IS NULL THEN v_flags:=array_append(v_flags,'INVALID_PHONE'); END IF;
  IF p_payload->>'home_ward_id' IS NOT NULL AND (p_payload->>'home_ward_id')::uuid IS DISTINCT FROM v_ward_id THEN
    v_flags:=array_append(v_flags,'WARD_MISMATCH');
  END IF;
  IF v_national_id IS NOT NULL THEN
    SELECT id,ward_id,constituency INTO v_register_id,v_register_ward,v_register_constituency
      FROM public.voter_register WHERE national_id=v_national_id LIMIT 1;
  END IF;
  IF v_register_id IS NOT NULL THEN
    IF coalesce(lower(v_register_constituency),'')<>lower('Lurambi') THEN
      v_flags:=array_append(v_flags,'NOT_IN_CONSTITUENCY');
      v_flags:=array_append(v_flags,'WRONG_CONSTITUENCY');
    END IF;
    IF v_register_ward IS NOT NULL AND v_register_ward IS DISTINCT FROM v_ward_id THEN v_flags:=array_append(v_flags,'FILED_UNDER_DIFFERENT_WARD'); END IF;
  ELSIF v_national_id IS NOT NULL AND coalesce((p_payload->>'not_found_in_register')::boolean,false) THEN
    v_status:='not_found';
  END IF;
  IF v_phone IS NOT NULL AND EXISTS (SELECT 1 FROM public.entries e WHERE e.phone_e164=v_phone) THEN
    v_flags:=array_append(v_flags,'SHARED_PHONE');
  END IF;

  IF v_national_id IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended(v_national_id,0)); END IF;
  SELECT e.*,CASE WHEN v_national_id IS NULL THEN similarity(lower(btrim(e.name)),lower(v_name)) ELSE 1.0 END AS match_score INTO v_match
    FROM public.entries e
   WHERE (v_national_id IS NOT NULL AND e.national_id=v_national_id)
      OR (v_national_id IS NULL AND e.polling_centre_id=v_centre_id AND e.polling_station_id=v_station_id
          AND similarity(lower(btrim(e.name)),lower(v_name))>=0.70 AND (e.phone_e164=v_phone OR e.ward_filed_id=v_ward_id))
   ORDER BY match_score DESC LIMIT 1;
  IF v_match.id IS NOT NULL THEN
    IF (v_national_id IS NOT NULL) OR coalesce(v_match.match_score,1)>=0.85 THEN
      INSERT INTO public.duplicate_attempts(mobilizer_id,matched_entry_id,attempted_name,attempted_phone,attempted_national_id,attempted_ward_id,match_reason)
      VALUES (v_actor.id,v_match.id,v_name,v_phone,v_national_id,v_ward_id,CASE WHEN v_national_id IS NOT NULL THEN 'normalised ID match' ELSE 'name and place match' END);
      v_existing_masked_name:=left(v_match.name,1)||repeat('*',least(greatest(length(v_match.name)-1,1),8));
      RETURN jsonb_build_object('ok',false,'duplicate',true,'message','A matching entry already exists.',
        'existing',jsonb_build_object('masked_name',v_existing_masked_name,'national_id_masked',v_match.national_id_masked,'ward_filed_id',v_match.ward_filed_id));
    ELSE
      v_flags:=array_append(v_flags,'POSSIBLE_DUPLICATE');
    END IF;
  END IF;

  IF p_payload ? 'issues' AND jsonb_typeof(p_payload->'issues')='array' THEN
    SELECT coalesce(array_agg(value),'{}'::text[]) INTO v_issues FROM jsonb_array_elements_text(p_payload->'issues');
  END IF;
  INSERT INTO public.entries(client_request_id,mobilizer_id,ward_filed_id,polling_centre_id,polling_station_id,register_voter_id,
    name,phone_e164,national_id,national_id_masked,support_level,issues,needs_transport,has_pvc,notes,consent_at,consent_text_version,
    consent_status,source,verification_status,flags)
  VALUES (v_request_id,v_actor.id,v_ward_id,v_centre_id,v_station_id,v_register_id,v_name,v_phone,v_national_id,v_masked_id,
    coalesce(p_payload->>'support_level','not_assessed'),v_issues,coalesce((p_payload->>'needs_transport')::boolean,false),
    coalesce((p_payload->>'has_pvc')::boolean,false),nullif(btrim(p_payload->>'notes'),''),now(),v_consent_version,'given','mobilizer',v_status,v_flags)
  RETURNING id INTO v_entry_id;
  PERFORM app.persist_entry_flags(v_entry_id,v_flags);
  SELECT * INTO v_existing FROM public.entries WHERE id=v_entry_id;
  RETURN jsonb_build_object('ok',true,'idempotent',false,'entry',jsonb_build_object('id',v_existing.id,'name',v_existing.name,
    'phone_e164',v_existing.phone_e164,'national_id_masked',v_existing.national_id_masked,'ward_filed_id',v_existing.ward_filed_id,
    'polling_centre_id',v_existing.polling_centre_id,'polling_station_id',v_existing.polling_station_id,'flags',v_existing.flags,
    'verification_status',v_existing.verification_status,'captured_on',v_existing.captured_on));
END;
$$;
