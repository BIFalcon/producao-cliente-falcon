DO $mig$
DECLARE
  v_def text := pg_get_functiondef('public.process_reservations(uuid,uuid,text)'::regprocedure);
  v_new text;
BEGIN
  -- 1) Lote mais recente passa a ser escolhido considerando TODOS os status
  v_new := replace(v_def,
$a$      AND r.property_name = v_property
      AND LOWER(COALESCE(r.reservation_status, '')) IN ('checked out', 'checked in', 'no show')
$a$,
$b$      AND r.property_name = v_property
$b$);
  -- 2) Filtro de status aplicado depois da escolha do lote
  v_new := replace(v_new,
$a$      AND lb.property_name = r.property_name AND lb.batch_ts = r.batch_ts
    WHERE p_batch_id IS NULL OR lb.in_batch;$a$,
$b$      AND lb.property_name = r.property_name AND lb.batch_ts = r.batch_ts
    WHERE (p_batch_id IS NULL OR lb.in_batch)
      AND LOWER(COALESCE(r.reservation_status, '')) IN ('checked out', 'checked in', 'no show');$b$);
  -- 3) Em modo lote, remove todas as reservas do lote (inclusive as que ficaram canceladas)
  v_new := replace(v_new,
$a$      USING tmp_reservation_totals rt
      WHERE pr.tenant_id = p_tenant_id
        AND pr.confirmation_number = rt.confirmation_number
        AND pr.property_name = rt.property_name;$a$,
$b$      USING tmp_latest_batch lb
      WHERE pr.tenant_id = p_tenant_id
        AND lb.in_batch
        AND pr.confirmation_number = lb.confirmation_number
        AND pr.property_name = lb.property_name;$b$);

  IF v_new = v_def
     OR position($x$lb.in_batch
        AND pr.confirmation_number$x$ in v_new) = 0
     OR position($x$WHERE (p_batch_id IS NULL OR lb.in_batch)$x$ in v_new) = 0
     OR position($x$AND r.property_name = v_property
      AND LOWER$x$ in v_new) > 0 THEN
    RAISE EXCEPTION 'process_reservations: trechos esperados não encontrados; nada alterado';
  END IF;
  EXECUTE v_new;
END
$mig$;
REVOKE ALL ON FUNCTION public.process_reservations(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_reservations(uuid,uuid,text) TO service_role;