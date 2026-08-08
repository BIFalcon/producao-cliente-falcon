DO $do$
DECLARE
  r record;
  v_def text;
  v_new text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS idargs, pg_get_functiondef(p.oid) AS def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND (pg_get_functiondef(p.oid) LIKE '%p_property text DEFAULT%' OR pg_get_functiondef(p.oid) LIKE '%p_month integer DEFAULT%')
  LOOP
    v_def := r.def;
    v_new := replace(v_def, 'p_property text DEFAULT NULL::text', 'p_property text[] DEFAULT NULL::text[]');
    v_new := replace(v_new, 'p_month integer DEFAULT NULL::integer', 'p_month integer[] DEFAULT NULL::integer[]');
    v_new := regexp_replace(v_new, 'p_property IS NULL OR ([a-z_]+)\.property_name = p_property', 'p_property IS NULL OR cardinality(p_property) = 0 OR \1.property_name = ANY(p_property)', 'g');
    v_new := regexp_replace(v_new, 'p_month IS NULL OR ([a-z_]+)\.departure_month = p_month', 'p_month IS NULL OR cardinality(p_month) = 0 OR \1.departure_month = ANY(p_month)', 'g');
    IF v_new <> v_def THEN
      EXECUTE format('DROP FUNCTION IF EXISTS public.%I(%s)', r.proname, r.idargs);
      EXECUTE v_new;
    END IF;
  END LOOP;
END
$do$;

DO $do$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS idargs
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon', r.proname, r.idargs);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated, service_role', r.proname, r.idargs);
  END LOOP;
END
$do$;