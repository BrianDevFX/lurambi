CREATE OR REPLACE FUNCTION app.log_export(p_type text,p_format text,p_filters jsonb,p_rows integer,p_name text)
RETURNS void LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE v_actor public.users%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM public.users WHERE id=app.uid() AND status='approved';
  IF v_actor.id IS NULL OR v_actor.role NOT IN ('admin','ward_coordinator','mobilizer') THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
  INSERT INTO public.exports_log(user_id,export_type,format,filter_criteria,row_count,file_name)
  VALUES(v_actor.id,p_type,p_format,coalesce(p_filters,'{}'),p_rows,p_name);
END $$;
