DO $m$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.process_reservations(uuid,uuid,text)'::regprocedure);
  IF position('totvs operadora' in d) = 0 THEN
    d := replace(d, $s$OR v.combined_text LIKE '%e htl%' OR v.combined_text LIKE '%azul viagens%'$s$,
                    $s$OR v.combined_text LIKE '%e htl%' OR v.combined_text LIKE '%azul viagens%'
        OR LOWER(COALESCE(v.source_name, '')) = 'totvs operadora'$s$);
    IF position('totvs operadora' in d) = 0 THEN RAISE EXCEPTION 'pattern not found'; END IF;
    EXECUTE d;
  END IF;
END $m$;