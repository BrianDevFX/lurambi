CREATE OR REPLACE FUNCTION app.public_join(p_referral_code text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_referrer public.users%ROWTYPE; v_policy jsonb; v_id text; v_masked text; v_phone text; v_name text;
  v_ward uuid; v_centre uuid; v_station uuid; v_request uuid:=gen_random_uuid(); v_entry uuid;
  v_flags text[]:='{}'; v_existing public.entries%ROWTYPE; v_register_id uuid; v_register_ward uuid; v_constituency text; v_similarity real;
  v_status text:='unverified'; v_issues text[]:='{}'; v_issue text;
BEGIN
  SELECT * INTO v_referrer FROM public.users WHERE referral_code=upper(p_referral_code) AND role='mobilizer' AND status='approved';
  IF v_referrer.id IS NULL THEN RETURN jsonb_build_object('ok',false); END IF;
  SELECT value INTO v_policy FROM public.settings WHERE key='consent_policy';
  IF coalesce((v_policy->>'enabled')::boolean,false) IS NOT TRUE OR coalesce((p_payload->>'consent')::boolean,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Consent is required' USING ERRCODE='23514';
  END IF;
  v_name:=btrim(p_payload->>'name'); v_ward:=nullif(p_payload->>'ward_id','')::uuid;
  v_centre:=nullif(p_payload->>'polling_centre_id','')::uuid; v_station:=nullif(p_payload->>'polling_station_id','')::uuid;
  IF length(v_name)<2 OR length(v_name)>160 THEN RAISE EXCEPTION 'Invalid name' USING ERRCODE='23514'; END IF;
  IF v_ward IS NULL OR v_centre IS NULL OR v_station IS NULL OR
    NOT EXISTS(SELECT 1 FROM public.polling_centres WHERE id=v_centre AND ward_id=v_ward) OR
    NOT EXISTS(SELECT 1 FROM public.polling_stations WHERE id=v_station AND polling_centre_id=v_centre AND ward_id=v_ward) THEN
    RAISE EXCEPTION 'Invalid polling place' USING ERRCODE='23514';
  END IF;
  v_id:=regexp_replace(coalesce(p_payload->>'national_id',''), '\D','','g');
  IF v_id ~ '^\d{7,8}$' THEN v_masked:=app.mask_national_id(v_id);
  ELSIF v_id='' THEN v_id:=NULL; v_flags:=array_append(v_flags,'MISSING_ID'); v_status:='pending_id';
  ELSE v_id:=NULL; v_flags:=array_append(v_flags,'INVALID_ID'); END IF;
  v_phone:=app.normalize_kenyan_phone(p_payload->>'phone');
  IF v_phone IS NULL THEN v_flags:=array_append(v_flags,'INVALID_PHONE'); END IF;
  IF v_phone IS NOT NULL AND EXISTS(SELECT 1 FROM public.entries WHERE phone_e164=v_phone) THEN v_flags:=array_append(v_flags,'SHARED_PHONE'); END IF;
  IF v_id IS NOT NULL THEN
    SELECT id,ward_id,constituency INTO v_register_id,v_register_ward,v_constituency FROM public.voter_register WHERE national_id=v_id LIMIT 1;
    IF v_register_id IS NOT NULL THEN
      IF lower(coalesce(v_constituency,''))<>'lurambi' THEN v_flags:=array_append(v_flags,'NOT_IN_CONSTITUENCY');v_flags:=array_append(v_flags,'WRONG_CONSTITUENCY');END IF;
      IF v_register_ward IS NOT NULL AND v_register_ward IS DISTINCT FROM v_ward THEN v_flags:=array_append(v_flags,'FILED_UNDER_DIFFERENT_WARD');END IF;
    ELSIF coalesce((p_payload->>'not_found_in_register')::boolean,false) THEN v_status:='not_found'; END IF;
  END IF;
  IF v_id IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended(v_id,0)); END IF;
  IF v_id IS NOT NULL THEN SELECT * INTO v_existing FROM public.entries e WHERE e.national_id=v_id LIMIT 1;
  ELSE
    SELECT e.* INTO v_existing FROM public.entries e WHERE e.polling_centre_id=v_centre AND e.polling_station_id=v_station AND similarity(lower(btrim(e.name)),lower(v_name))>=0.70 AND (e.phone_e164=v_phone OR e.ward_filed_id=v_ward) ORDER BY similarity(lower(btrim(e.name)),lower(v_name)) DESC LIMIT 1;
    IF v_existing.id IS NOT NULL THEN SELECT similarity(lower(btrim(v_existing.name)),lower(v_name)) INTO v_similarity; END IF;
  END IF;
  IF v_existing.id IS NOT NULL AND (v_id IS NOT NULL OR v_similarity>=0.85) THEN
    INSERT INTO public.duplicate_attempts(mobilizer_id,matched_entry_id,attempted_name,attempted_phone,attempted_national_id,attempted_ward_id,match_reason)
    VALUES(v_referrer.id,v_existing.id,v_name,v_phone,v_id,v_ward,'public join duplicate');
    RETURN jsonb_build_object('ok',false);
  END IF;
  IF v_existing.id IS NOT NULL THEN v_flags:=array_append(v_flags,'POSSIBLE_DUPLICATE'); END IF;
  IF jsonb_typeof(p_payload->'issues')='array' THEN SELECT coalesce(array_agg(value),'{}'::text[]) INTO v_issues FROM jsonb_array_elements_text(p_payload->'issues'); END IF;
  INSERT INTO public.entries(client_request_id,mobilizer_id,ward_filed_id,polling_centre_id,polling_station_id,name,phone_e164,national_id,national_id_masked,support_level,issues,needs_transport,has_pvc,notes,consent_at,consent_text_version,consent_status,source,verification_status,flags)
  VALUES(v_request,v_referrer.id,v_ward,v_centre,v_station,v_name,v_phone,v_id,v_masked,'strong_supporter',v_issues,false,false,NULL,now(),v_policy->>'version','given','self_registered',v_status,v_flags) RETURNING id INTO v_entry;
  FOREACH v_issue IN ARRAY v_flags LOOP
    INSERT INTO public.flag_events(entry_id,flag_code,severity) VALUES(v_entry,v_issue,CASE WHEN v_issue IN('NOT_IN_CONSTITUENCY','WRONG_CONSTITUENCY') THEN 'critical' WHEN v_issue='SHARED_PHONE' THEN 'info' ELSE 'warning' END) ON CONFLICT DO NOTHING;
  END LOOP;
  RETURN jsonb_build_object('ok',true);
END $$;
