CREATE OR REPLACE FUNCTION app.normalize_kenyan_phone(p_phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE v text := regexp_replace(trim(coalesce(p_phone,'')), '[^0-9]', '', 'g');
BEGIN
  IF length(v)=9 AND left(v,1) IN ('7','1') THEN RETURN '+254'||v; END IF;
  IF length(v)=10 AND left(v,2) IN ('07','01') THEN RETURN '+254'||substring(v FROM 2); END IF;
  IF length(v)=12 AND left(v,4) IN ('2547','2541') THEN RETURN '+'||v; END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION app.mask_national_id(p_id text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN p_id ~ '^\d{7,8}$' THEN left(p_id,1)||repeat('*',greatest(length(p_id)-4,1))||right(p_id,3) ELSE NULL END
$$;

CREATE OR REPLACE FUNCTION app.persist_entry_flags(p_entry_id uuid,p_flags text[])
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE v_flag text;
BEGIN
  IF app.uid() IS NULL THEN RAISE EXCEPTION 'Acting user is required'; END IF;
  FOREACH v_flag IN ARRAY coalesce(p_flags,'{}'::text[]) LOOP
    INSERT INTO public.flag_events(entry_id,flag_code,severity)
    VALUES (p_entry_id,v_flag,CASE WHEN v_flag IN ('DUPLICATE','NOT_IN_CONSTITUENCY','WRONG_CONSTITUENCY') THEN 'critical'
      WHEN v_flag='SHARED_PHONE' THEN 'info' ELSE 'warning' END)
    ON CONFLICT (entry_id,flag_code) DO NOTHING;
  END LOOP;
END;
$$;
