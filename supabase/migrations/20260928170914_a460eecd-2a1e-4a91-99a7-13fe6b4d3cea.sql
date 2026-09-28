-- Bloco 4 (dry-run): somente leitura
CREATE OR REPLACE FUNCTION public.preview_raw_cleanup(p_tenant_id uuid, p_batch_id uuid DEFAULT NULL)
RETURNS TABLE(property_name text, linhas_a_apagar bigint, reservas_afetadas bigint, receita_linhas numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET statement_timeout TO '600s' AS $$
  WITH ranked AS (
    SELECT r.id, r.property_name, r.confirmation_number, r.total_revenue,
      dense_rank() OVER (PARTITION BY r.property_name, r.confirmation_number
        ORDER BY COALESCE(b.created_at, '1970-01-01'::timestamptz) DESC, r.upload_batch_id DESC NULLS LAST) AS rk
    FROM public.raw_reservations r
    LEFT JOIN public.upload_batches b ON b.id = r.upload_batch_id
    WHERE r.tenant_id = p_tenant_id
      AND COALESCE(r.confirmation_number, '') <> ''
      AND (p_batch_id IS NULL OR EXISTS (
        SELECT 1 FROM public.raw_reservations c
        WHERE c.tenant_id = p_tenant_id AND c.upload_batch_id = p_batch_id
          AND c.property_name = r.property_name AND c.confirmation_number = r.confirmation_number))
  )
  SELECT property_name, COUNT(*), COUNT(DISTINCT confirmation_number), COALESCE(SUM(total_revenue), 0)
  FROM ranked WHERE rk > 2 GROUP BY property_name ORDER BY 2 DESC;
$$;
REVOKE ALL ON FUNCTION public.preview_raw_cleanup(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preview_raw_cleanup(uuid, uuid) TO service_role;

-- Bloco 7: cobertura por hotel (somente leitura)
CREATE OR REPLACE FUNCTION public.get_upload_coverage(p_tenant_id uuid)
RETURNS TABLE(property_name text, reservas_mes_atual bigint, reservas_mes_anterior bigint,
  primeira_saida date, ultima_saida date, dias_sem_saida_mes_atual int[], dias_sem_saida_mes_anterior int[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cur date := date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo'))::date;
  v_prev date := (date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')) - interval '1 month')::date;
  v_yesterday date := (now() AT TIME ZONE 'America/Sao_Paulo')::date - 1;
BEGIN
  IF NOT (public.is_super_admin(auth.uid()) OR p_tenant_id = public.get_current_tenant_id()) THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;
  RETURN QUERY
  WITH props AS (
    SELECT p.property_name, MIN(p.departure_date) mn, MAX(p.departure_date) mx,
      COUNT(*) FILTER (WHERE p.departure_date >= v_cur AND p.departure_date < (v_cur + interval '1 month')) c_cur,
      COUNT(*) FILTER (WHERE p.departure_date >= v_prev AND p.departure_date < v_cur) c_prev
    FROM public.processed_reservations p WHERE p.tenant_id = p_tenant_id GROUP BY 1
  ),
  days AS (SELECT d::date d FROM generate_series(v_prev, GREATEST(v_yesterday, v_prev), interval '1 day') d),
  hits AS (
    SELECT DISTINCT p.property_name, p.departure_date d FROM public.processed_reservations p
    WHERE p.tenant_id = p_tenant_id AND p.departure_date >= v_prev AND p.departure_date <= v_yesterday
  )
  SELECT pr.property_name, pr.c_cur, pr.c_prev, pr.mn, pr.mx,
    COALESCE((SELECT array_agg(EXTRACT(DAY FROM dd.d)::int ORDER BY dd.d) FROM days dd
      WHERE dd.d >= v_cur AND dd.d <= v_yesterday
        AND NOT EXISTS (SELECT 1 FROM hits h WHERE h.property_name = pr.property_name AND h.d = dd.d)), '{}'),
    COALESCE((SELECT array_agg(EXTRACT(DAY FROM dd.d)::int ORDER BY dd.d) FROM days dd
      WHERE dd.d >= v_prev AND dd.d < v_cur AND dd.d <= v_yesterday
        AND NOT EXISTS (SELECT 1 FROM hits h WHERE h.property_name = pr.property_name AND h.d = dd.d)), '{}')
  FROM props pr ORDER BY pr.property_name;
END $$;
REVOKE ALL ON FUNCTION public.get_upload_coverage(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_upload_coverage(uuid) TO authenticated, service_role;

-- Blocos 4 e 5 dentro do processamento
DO $mig$
DECLARE
  v_def text := pg_get_functiondef('public.process_reservations(uuid,uuid,text)'::regprocedure);
  v_new text;
BEGIN
  v_new := replace(v_def, $a$  v_properties text[];
$a$, $b$  v_properties text[];
  v_pre_cnt bigint; v_pre_rev numeric; v_post_cnt bigint; v_post_rev numeric;
  v_coll_rows bigint := 0; v_coll_rev numeric := 0; v_cleaned bigint := 0; v_del bigint;
$b$);

  v_new := replace(v_new, $a$    CREATE TEMP TABLE tmp_valid_rows ON COMMIT DROP AS
$a$, $b$    -- Bloco 5: linhas elegíveis antes do DISTINCT ON
    SELECT COUNT(*), COALESCE(SUM(COALESCE(r.total_revenue, 0)), 0) INTO v_pre_cnt, v_pre_rev
    FROM tmp_base_rows r
    JOIN tmp_latest_batch lb ON lb.confirmation_number = r.confirmation_number
      AND lb.property_name = r.property_name AND lb.batch_ts = r.batch_ts
    WHERE (p_batch_id IS NULL OR lb.in_batch)
      AND LOWER(COALESCE(r.reservation_status, '')) IN ('checked out', 'checked in', 'no show');

    CREATE TEMP TABLE tmp_valid_rows ON COMMIT DROP AS
$b$);

  v_new := replace(v_new, $a$    CREATE INDEX idx_tmp_valid_cn_pn ON tmp_valid_rows (confirmation_number, property_name);
$a$, $b$    SELECT COUNT(*), COALESCE(SUM(total_revenue), 0) INTO v_post_cnt, v_post_rev FROM tmp_valid_rows;
    v_coll_rows := v_coll_rows + (v_pre_cnt - v_post_cnt);
    v_coll_rev := v_coll_rev + (v_pre_rev - v_post_rev);

    CREATE INDEX idx_tmp_valid_cn_pn ON tmp_valid_rows (confirmation_number, property_name);
$b$);

  v_new := replace(v_new, $a$  END LOOP;
$a$, $b$    -- Bloco 4: mantém lote atual + anterior de cada reserva do lote; apaga versões mais antigas
    IF p_batch_id IS NOT NULL THEN
      DELETE FROM public.raw_reservations d
      USING (
        SELECT x.id FROM (
          SELECT r2.id, dense_rank() OVER (PARTITION BY r2.confirmation_number
            ORDER BY COALESCE(b.created_at, '1970-01-01'::timestamptz) DESC, r2.upload_batch_id DESC NULLS LAST) AS rk
          FROM public.raw_reservations r2
          LEFT JOIN public.upload_batches b ON b.id = r2.upload_batch_id
          WHERE r2.tenant_id = p_tenant_id AND r2.property_name = v_property
            AND r2.confirmation_number IN (
              SELECT c.confirmation_number FROM public.raw_reservations c
              WHERE c.tenant_id = p_tenant_id AND c.property_name = v_property
                AND c.upload_batch_id = p_batch_id AND COALESCE(c.confirmation_number, '') <> '')
        ) x WHERE x.rk > 2
      ) old
      WHERE d.id = old.id;
      GET DIAGNOSTICS v_del = ROW_COUNT;
      v_cleaned := v_cleaned + v_del;
    END IF;

  END LOOP;

  IF p_batch_id IS NOT NULL THEN
    PERFORM public.increment_batch_metadata(p_batch_id, 'collapsed_rows', v_coll_rows);
    PERFORM public.increment_batch_metadata(p_batch_id, 'collapsed_revenue', v_coll_rev);
    PERFORM public.increment_batch_metadata(p_batch_id, 'raw_rows_cleaned', v_cleaned);
  END IF;
$b$);

  IF position('v_coll_rows := v_coll_rows' in v_new) = 0 OR position('INTO v_pre_cnt' in v_new) = 0
     OR position('raw_rows_cleaned' in v_new) = 0 OR position('v_cleaned bigint' in v_new) = 0 THEN
    RAISE EXCEPTION 'process_reservations: trechos esperados não encontrados; nada alterado';
  END IF;
  EXECUTE v_new;
END
$mig$;
REVOKE ALL ON FUNCTION public.process_reservations(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_reservations(uuid,uuid,text) TO service_role;
CREATE INDEX IF NOT EXISTS idx_raw_tenant_prop_conf ON public.raw_reservations (tenant_id, property_name, confirmation_number);
CREATE INDEX IF NOT EXISTS idx_raw_batch ON public.raw_reservations (upload_batch_id);