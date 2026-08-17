CREATE OR REPLACE FUNCTION public.process_reservations(p_tenant_id uuid, p_batch_id uuid DEFAULT NULL::uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN

  CREATE TEMP TABLE tmp_valid_rows ON COMMIT DROP AS
  SELECT r.confirmation_number, r.property_name,
    COALESCE(r.room_revenue, 0) AS room_revenue,
    COALESCE(r.fb_revenue, 0) AS fb_revenue,
    COALESCE(r.total_revenue, 0) AS total_revenue,
    CASE WHEN COALESCE(r.number_of_nights, 0) = 0 THEN 1 ELSE r.number_of_nights END AS number_of_nights,
    NULLIF(BTRIM(r.country), '') AS country,
    NULLIF(BTRIM(r.state), '') AS state,
    NULLIF(BTRIM(r.city), '') AS city,
    r.reservation_date, r.arrival_date, r.departure_date,
    NULLIF(BTRIM(r.company_name), '') AS company_name,
    NULLIF(BTRIM(r.travel_agent_name), '') AS travel_agent_name,
    NULLIF(BTRIM(r.source_name), '') AS source_name,
    NULLIF(BTRIM(r.individual_first_name), '') AS individual_first_name,
    LOWER(COALESCE(BTRIM(r.room_type), '')) AS room_type_normalized,
    LOWER(extensions.unaccent(COALESCE(BTRIM(r.rate_code_description), ''))) AS rate_code_desc_normalized,
    LOWER(extensions.unaccent(
      COALESCE(BTRIM(r.company_name), '') || ' ' ||
      COALESCE(BTRIM(r.travel_agent_name), '') || ' ' ||
      COALESCE(BTRIM(r.source_name), '') || ' ' ||
      COALESCE(BTRIM(r.individual_first_name), '')
    )) AS combined_text
  FROM public.raw_reservations r
  WHERE r.tenant_id = p_tenant_id
    AND (p_batch_id IS NULL OR r.upload_batch_id = p_batch_id)
    AND r.confirmation_number IS NOT NULL
    AND r.property_name IS NOT NULL
    AND LOWER(COALESCE(r.reservation_status, '')) IN ('checked out', 'checked in', 'no show');

  CREATE INDEX idx_tmp_valid_cn_pn ON tmp_valid_rows (confirmation_number, property_name);

  CREATE TEMP TABLE tmp_reservation_totals ON COMMIT DROP AS
  SELECT v.confirmation_number, v.property_name,
    SUM(v.room_revenue) AS room_revenue,
    SUM(v.fb_revenue) AS fb_revenue,
    SUM(v.total_revenue) AS total_revenue,
    AVG(v.number_of_nights) AS roomnights,
    MAX(v.country) AS country, MAX(v.state) AS state, MAX(v.city) AS city,
    MAX(v.company_name) AS company_name,
    MAX(v.travel_agent_name) AS travel_agent_name,
    MIN(v.reservation_date) AS reservation_date,
    MIN(v.arrival_date) AS arrival_date,
    MAX(v.departure_date) AS departure_date,
    EXTRACT(MONTH FROM MAX(v.departure_date))::int AS departure_month,
    EXTRACT(YEAR FROM MAX(v.departure_date))::int AS departure_year,
    CASE WHEN MIN(v.reservation_date) IS NOT NULL AND MIN(v.arrival_date) IS NOT NULL
      THEN (MIN(v.arrival_date) - MIN(v.reservation_date)) ELSE NULL END AS lead_time_days
  FROM tmp_valid_rows v
  GROUP BY v.confirmation_number, v.property_name;

  CREATE INDEX idx_tmp_totals_cn_pn ON tmp_reservation_totals (confirmation_number, property_name);

  CREATE TEMP TABLE tmp_group_flags ON COMMIT DROP AS
  SELECT v.confirmation_number, v.property_name,
    BOOL_OR(v.rate_code_desc_normalized ~ 'grupo') AS has_group
  FROM tmp_valid_rows v
  GROUP BY v.confirmation_number, v.property_name;

  CREATE TEMP TABLE tmp_identity_flags ON COMMIT DROP AS
  SELECT v.confirmation_number, v.property_name,
    BOOL_OR(
      v.company_name IS NOT NULL OR
      v.travel_agent_name IS NOT NULL OR
      v.source_name IS NOT NULL OR
      v.individual_first_name IS NOT NULL
    ) AS has_identity
  FROM tmp_valid_rows v
  GROUP BY v.confirmation_number, v.property_name;

  CREATE TEMP TABLE tmp_channel_mapping ON COMMIT DROP AS
  SELECT
    LOWER(extensions.unaccent(BTRIM(cm.canal))) AS canal_normalized,
    CASE UPPER(BTRIM(cm.segmento))
      WHEN 'AGENCIA' THEN 'Outras agências'
      WHEN 'OPERADORA' THEN 'Operadoras'
      WHEN 'EMPRESAS' THEN 'Empresas'
      WHEN 'GRUPOS' THEN 'Grupos'
      WHEN 'LAYOVER' THEN 'Layover'
      WHEN 'PARTICULAR' THEN 'Particular'
      ELSE 'Outras receitas (PM e PF)'
    END AS segmento_standard,
    CASE UPPER(BTRIM(cm.segmento))
      WHEN 'OPERADORA' THEN 2 WHEN 'LAYOVER' THEN 3
      WHEN 'AGENCIA' THEN 6 WHEN 'EMPRESAS' THEN 7
      WHEN 'GRUPOS' THEN 5 WHEN 'PARTICULAR' THEN 9
      ELSE 10
    END AS priority
  FROM public.channel_mapping cm
  WHERE cm.tenant_id = p_tenant_id AND UPPER(BTRIM(cm.segmento)) <> 'OTA';

  UPDATE tmp_channel_mapping SET segmento_standard = 'Clube de férias', priority = 4
  WHERE segmento_standard = 'Outras receitas (PM e PF)'
    AND EXISTS (
      SELECT 1 FROM public.channel_mapping cm2
      WHERE cm2.tenant_id = p_tenant_id
        AND LOWER(extensions.unaccent(BTRIM(cm2.canal))) = tmp_channel_mapping.canal_normalized
        AND UPPER(BTRIM(cm2.segmento)) IN ('CLUBE DE FÉRIAS', 'CLUBE DE FERIAS')
    );

  CREATE TEMP TABLE tmp_row_matches ON COMMIT DROP AS
  SELECT DISTINCT ON (v.confirmation_number, v.property_name, m.canal_normalized)
    v.confirmation_number, v.property_name, m.segmento_standard, m.priority
  FROM tmp_valid_rows v
  JOIN tmp_channel_mapping m ON v.combined_text LIKE '%' || m.canal_normalized || '%'
  WHERE m.canal_normalized <> ''
  ORDER BY v.confirmation_number, v.property_name, m.canal_normalized, m.priority;

  CREATE TEMP TABLE tmp_mapped_channels ON COMMIT DROP AS
  SELECT DISTINCT ON (rm.confirmation_number, rm.property_name)
    rm.confirmation_number, rm.property_name, rm.segmento_standard AS sales_channel
  FROM tmp_row_matches rm
  JOIN tmp_reservation_totals rt ON rt.confirmation_number = rm.confirmation_number
    AND rt.property_name = rm.property_name
  WHERE NOT (rm.segmento_standard IN ('Empresas', 'Grupos') AND COALESCE(rt.total_revenue, 0) < 0)
  ORDER BY rm.confirmation_number, rm.property_name, rm.priority;

  CREATE TEMP TABLE tmp_ota_flags ON COMMIT DROP AS
  SELECT v.confirmation_number, v.property_name,
    BOOL_OR(
      v.combined_text LIKE '%booking%' OR
      v.combined_text LIKE '%expedia%' OR
      v.combined_text LIKE '%decolar%'
    ) AS is_ota
  FROM tmp_valid_rows v GROUP BY v.confirmation_number, v.property_name;

  CREATE TEMP TABLE tmp_operadora_flags ON COMMIT DROP AS
  SELECT v.confirmation_number, v.property_name,
    BOOL_OR(
      v.combined_text LIKE '%e-htl%' OR
      v.combined_text LIKE '%ehtl%' OR
      v.combined_text LIKE '%e htl%' OR
      v.combined_text LIKE '%azul viagens%'
    ) AS is_operadora
  FROM tmp_valid_rows v GROUP BY v.confirmation_number, v.property_name;

  CREATE TEMP TABLE tmp_layover_flags ON COMMIT DROP AS
  SELECT v.confirmation_number, v.property_name,
    BOOL_OR(
      (v.combined_text LIKE '%azul linhas aereas%' OR
       v.combined_text LIKE '%azul linhas global master%' OR
       v.combined_text LIKE '%layover%')
      AND v.combined_text NOT LIKE '%azul viagens%'
    ) AS is_layover
  FROM tmp_valid_rows v GROUP BY v.confirmation_number, v.property_name;

  IF p_batch_id IS NULL THEN
    DELETE FROM public.processed_reservations WHERE tenant_id = p_tenant_id;
  ELSE
    DELETE FROM public.processed_reservations pr
    USING tmp_reservation_totals rt
    WHERE pr.tenant_id = p_tenant_id
      AND pr.confirmation_number = rt.confirmation_number
      AND pr.property_name = rt.property_name;
  END IF;

  INSERT INTO public.processed_reservations (
    tenant_id, property_name, confirmation_number,
    reservation_date, arrival_date, departure_date,
    travel_agent_name, company_name,
    city, state, country,
    room_revenue, fb_revenue, total_revenue,
    sales_channel, lead_time_days, departure_month, departure_year, roomnights
  )
  SELECT p_tenant_id, rt.property_name, rt.confirmation_number,
    rt.reservation_date, rt.arrival_date, rt.departure_date,
    rt.travel_agent_name, rt.company_name,
    rt.city, rt.state, rt.country,
    rt.room_revenue, rt.fb_revenue, rt.total_revenue,
    CASE
      WHEN COALESCE(ota.is_ota, false) THEN 'OTA'
      WHEN COALESCE(op.is_operadora, false) THEN 'Operadoras'
      WHEN COALESCE(ly.is_layover, false) THEN 'Layover'
      WHEN mc.sales_channel IS NOT NULL THEN mc.sales_channel
      WHEN COALESCE(gf.has_group, false) THEN 'Grupos'
      WHEN NOT COALESCE(idf.has_identity, false)
        AND EXISTS (
          SELECT 1 FROM tmp_valid_rows v2
          WHERE v2.confirmation_number = rt.confirmation_number
            AND v2.property_name = rt.property_name
            AND v2.room_type_normalized IN ('pm', 'pf', 'pz')
        ) AND NOT EXISTS (
          SELECT 1 FROM tmp_valid_rows v2
          WHERE v2.confirmation_number = rt.confirmation_number
            AND v2.property_name = rt.property_name
            AND v2.room_type_normalized NOT IN ('pm', 'pf', 'pz')
        ) THEN 'Outras receitas (PM e PF)'
      WHEN rt.travel_agent_name IS NOT NULL OR rt.company_name IS NOT NULL THEN 'Empresas'
      ELSE 'Particular'
    END,
    rt.lead_time_days, rt.departure_month, rt.departure_year, rt.roomnights
  FROM tmp_reservation_totals rt
  LEFT JOIN tmp_group_flags gf ON gf.confirmation_number = rt.confirmation_number AND gf.property_name = rt.property_name
  LEFT JOIN tmp_identity_flags idf ON idf.confirmation_number = rt.confirmation_number AND idf.property_name = rt.property_name
  LEFT JOIN tmp_mapped_channels mc ON mc.confirmation_number = rt.confirmation_number AND mc.property_name = rt.property_name
  LEFT JOIN tmp_ota_flags ota ON ota.confirmation_number = rt.confirmation_number AND ota.property_name = rt.property_name
  LEFT JOIN tmp_operadora_flags op ON op.confirmation_number = rt.confirmation_number AND op.property_name = rt.property_name
  LEFT JOIN tmp_layover_flags ly ON ly.confirmation_number = rt.confirmation_number AND ly.property_name = rt.property_name;

  UPDATE public.processed_reservations pr
  SET sales_channel = CASE
    WHEN EXISTS (SELECT 1 FROM tmp_operadora_flags op
      WHERE op.confirmation_number = pr.confirmation_number
        AND op.property_name = pr.property_name AND op.is_operadora) THEN 'Operadoras'
    WHEN EXISTS (SELECT 1 FROM tmp_layover_flags ly
      WHERE ly.confirmation_number = pr.confirmation_number
        AND ly.property_name = pr.property_name AND ly.is_layover) THEN 'Layover'
    WHEN EXISTS (SELECT 1 FROM tmp_mapped_channels mc
      WHERE mc.confirmation_number = pr.confirmation_number
        AND mc.property_name = pr.property_name)
      THEN (SELECT mc2.sales_channel FROM tmp_mapped_channels mc2
        WHERE mc2.confirmation_number = pr.confirmation_number
          AND mc2.property_name = pr.property_name LIMIT 1)
    WHEN EXISTS (SELECT 1 FROM tmp_group_flags gf
      WHERE gf.confirmation_number = pr.confirmation_number
        AND gf.property_name = pr.property_name AND gf.has_group) THEN 'Grupos'
    WHEN pr.travel_agent_name IS NOT NULL OR pr.company_name IS NOT NULL THEN 'Empresas'
    ELSE 'Particular'
  END
  WHERE pr.tenant_id = p_tenant_id
    AND pr.sales_channel = 'OTA'
    AND NOT EXISTS (
      SELECT 1 FROM tmp_ota_flags ota
      WHERE ota.confirmation_number = pr.confirmation_number
        AND ota.property_name = pr.property_name
        AND ota.is_ota = true
    );

  IF p_batch_id IS NOT NULL THEN
    UPDATE public.upload_batches
    SET processed_rows = (SELECT COUNT(*) FROM tmp_valid_rows),
        status = 'completed', completed_at = now()
    WHERE id = p_batch_id;
  END IF;

END;
$function$;