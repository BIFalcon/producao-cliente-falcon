DO $mig$
DECLARE
  v_def text := pg_get_functiondef('public.process_reservations(uuid,uuid,text)'::regprocedure);
  v_new text;
BEGIN
  v_new := replace(v_def,
$a$      CASE WHEN COALESCE(r.number_of_nights, 0) = 0 THEN 1 ELSE r.number_of_nights END AS number_of_nights,$a$,
$b$      CASE
        WHEN LOWER(COALESCE(r.reservation_status, '')) = 'no show' AND COALESCE(r.total_revenue, 0) = 0 THEN 0
        WHEN COALESCE(r.number_of_nights, 0) = 0 THEN 1
        ELSE r.number_of_nights
      END AS number_of_nights,$b$);
  IF v_new = v_def THEN
    RAISE EXCEPTION 'process_reservations: trecho de noites não encontrado; nada alterado';
  END IF;
  EXECUTE v_new;
END
$mig$;
REVOKE ALL ON FUNCTION public.process_reservations(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_reservations(uuid,uuid,text) TO service_role;