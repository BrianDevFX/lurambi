CREATE OR REPLACE FUNCTION app.admin_update_entry(p_id uuid,p_patch jsonb,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE v_actor public.users%ROWTYPE; v_old jsonb; v_new jsonb;
BEGIN
  SELECT * INTO v_actor FROM public.users WHERE id=app.uid() AND role='admin' AND status='approved';
  IF v_actor.id IS NULL THEN RAISE EXCEPTION 'Admin role required' USING ERRCODE='42501'; END IF;
  IF length(btrim(coalesce(p_reason,'')))<3 THEN RAISE EXCEPTION 'A reason is required' USING ERRCODE='23514'; END IF;
  SELECT to_jsonb(e) INTO v_old FROM public.entries e WHERE e.id=p_id FOR UPDATE;
  IF v_old IS NULL THEN RAISE EXCEPTION 'Entry not found' USING ERRCODE='P0002'; END IF;
  UPDATE public.entries SET
    name=coalesce(p_patch->>'name',name), phone_e164=coalesce(p_patch->>'phone_e164',phone_e164),
    ward_filed_id=coalesce((p_patch->>'ward_filed_id')::uuid,ward_filed_id),
    polling_centre_id=coalesce((p_patch->>'polling_centre_id')::uuid,polling_centre_id),
    polling_station_id=coalesce((p_patch->>'polling_station_id')::uuid,polling_station_id),
    support_level=coalesce(p_patch->>'support_level',support_level), notes=coalesce(p_patch->>'notes',notes), updated_at=now()
  WHERE id=p_id RETURNING to_jsonb(entries) INTO v_new;
  INSERT INTO public.audit_log(user_id,user_role,action,entity_type,entity_id,old_values,new_values,reason)
  VALUES(v_actor.id,v_actor.role,'update','entry',p_id::text,v_old,v_new,btrim(p_reason));
  RETURN v_new;
END $$;

CREATE OR REPLACE FUNCTION app.resolve_flag(p_id uuid,p_resolution text,p_notes text DEFAULT '')
RETURNS void LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE v_actor public.users%ROWTYPE; v_old jsonb; v_new jsonb;
BEGIN
  SELECT * INTO v_actor FROM public.users WHERE id=app.uid() AND role='admin' AND status='approved';
  IF v_actor.id IS NULL THEN RAISE EXCEPTION 'Admin role required' USING ERRCODE='42501'; END IF;
  IF p_resolution NOT IN ('resolve','dismiss','merge') THEN RAISE EXCEPTION 'Invalid resolution' USING ERRCODE='23514'; END IF;
  SELECT to_jsonb(f) INTO v_old FROM public.flag_events f WHERE f.id=p_id FOR UPDATE;
  IF v_old IS NULL THEN RAISE EXCEPTION 'Flag not found' USING ERRCODE='P0002'; END IF;
  UPDATE public.flag_events SET is_resolved=true,resolved_by=v_actor.id,resolved_at=now(),resolution_notes=coalesce(p_notes,'') WHERE id=p_id RETURNING to_jsonb(flag_events) INTO v_new;
  INSERT INTO public.audit_log(user_id,user_role,action,entity_type,entity_id,old_values,new_values,reason)
  VALUES(v_actor.id,v_actor.role,p_resolution,'flag',p_id::text,v_old,v_new,coalesce(nullif(btrim(p_notes),''),p_resolution));
END $$;

CREATE OR REPLACE FUNCTION app.set_entry_verification(p_id uuid,p_status text,p_note text)
RETURNS void LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE v_actor public.users%ROWTYPE; v_old jsonb; v_new jsonb;
BEGIN
  SELECT * INTO v_actor FROM public.users WHERE id=app.uid() AND role='admin' AND status='approved';
  IF v_actor.id IS NULL THEN RAISE EXCEPTION 'Admin role required' USING ERRCODE='42501'; END IF;
  IF p_status NOT IN ('unverified','verified','not_found','wrong_constituency','pending_id') OR length(btrim(coalesce(p_note,'')))<2 THEN RAISE EXCEPTION 'Invalid status or evidence note' USING ERRCODE='23514'; END IF;
  SELECT jsonb_build_object('verification_status',verification_status,'verification_notes',verification_notes) INTO v_old FROM public.entries WHERE id=p_id FOR UPDATE;
  IF v_old IS NULL THEN RAISE EXCEPTION 'Entry not found' USING ERRCODE='P0002'; END IF;
  UPDATE public.entries SET verification_status=p_status,verification_notes=p_note,verified_by=v_actor.id,verified_at=now(),updated_at=now() WHERE id=p_id;
  SELECT jsonb_build_object('verification_status',verification_status,'verification_notes',verification_notes) INTO v_new FROM public.entries WHERE id=p_id;
  INSERT INTO public.audit_log(user_id,user_role,action,entity_type,entity_id,old_values,new_values,reason)
  VALUES(v_actor.id,v_actor.role,'set_verification','entry',p_id::text,v_old,v_new,p_note);
END $$;

CREATE OR REPLACE FUNCTION app.log_export(p_type text,p_format text,p_filters jsonb,p_rows integer,p_name text)
RETURNS void LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE v_actor public.users%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM public.users WHERE id=app.uid() AND status='approved';
  IF v_actor.id IS NULL OR v_actor.role NOT IN ('admin','ward_coordinator') THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
  INSERT INTO public.exports_log(user_id,export_type,format,filter_criteria,row_count,file_name)
  VALUES(v_actor.id,p_type,p_format,coalesce(p_filters,'{}'),p_rows,p_name);
END $$;
