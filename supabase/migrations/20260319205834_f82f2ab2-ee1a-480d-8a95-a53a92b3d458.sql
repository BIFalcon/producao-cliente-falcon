
CREATE OR REPLACE FUNCTION public.process_reservations(p_batch_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '300s'
AS $function$
BEGIN
  CREATE TEMP TABLE tmp_valid_rows ON COMMIT DROP AS
  SELECT
    r.confirmation_number,
    r.property_name,
    COALESCE(r.room_revenue, 0) AS room_revenue,
    COALESCE(r.fb_revenue, 0) AS fb_revenue,
    COALESCE(r.total_revenue, 0) AS total_revenue,
    CASE WHEN COALESCE(r.number_of_nights, 0) = 0 THEN 1 ELSE r.number_of_nights END AS number_of_nights,
    NULLIF(BTRIM(r.country), '') AS country,
    NULLIF(BTRIM(r.state), '') AS state,
    NULLIF(BTRIM(r.city), '') AS city,
    r.reservation_date,
    r.arrival_date,
    r.departure_date,
    NULLIF(BTRIM(r.company_name), '') AS company_name,
    NULLIF(BTRIM(r.travel_agent_name), '') AS travel_agent_name,
    NULLIF(BTRIM(r.source_name), '') AS source_name,
    LOWER(COALESCE(BTRIM(r.room_type), '')) AS room_type_normalized,
    LOWER(extensions.unaccent(COALESCE(BTRIM(r.rate_code_description), ''))) AS rate_code_desc_normalized
  FROM public.raw_reservations r
  WHERE r.confirmation_number IS NOT NULL
    AND r.property_name IS NOT NULL
    AND LOWER(COALESCE(r.reservation_status, '')) IN ('checked out', 'checked in', 'no show');

  CREATE INDEX idx_tmp_valid_cn_pn ON tmp_valid_rows (confirmation_number, property_name);

  CREATE TEMP TABLE tmp_reservation_totals ON COMMIT DROP AS
  SELECT
    v.confirmation_number, v.property_name,
    SUM(v.room_revenue) AS room_revenue,
    SUM(v.fb_revenue) AS fb_revenue,
    SUM(v.total_revenue) AS total_revenue,
    AVG(v.number_of_nights) AS roomnights,
    MAX(v.country) AS country, MAX(v.state) AS state, MAX(v.city) AS city,
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
  SELECT
    v.confirmation_number,
    v.property_name,
    BOOL_OR(v.rate_code_desc_normalized ~ 'grupo') AS has_group
  FROM tmp_valid_rows v
  GROUP BY v.confirmation_number, v.property_name;

  CREATE INDEX idx_tmp_group_cn_pn ON tmp_group_flags (confirmation_number, property_name);

  CREATE TEMP TABLE tmp_channel_mapping ON COMMIT DROP AS
  SELECT
    LOWER(extensions.unaccent(BTRIM(cm.canal))) AS canal_normalized,
    CASE UPPER(BTRIM(cm.segmento))
      WHEN 'AGENCIA' THEN 'Outras agências'
      WHEN 'OPERADORA' THEN 'Operadoras'
      WHEN 'EMPRESAS' THEN 'Empresas'
      WHEN 'GRUPOS' THEN 'Grupos'
      WHEN 'LAYOVER' THEN 'Layover'
      WHEN 'OTA' THEN 'OTA'
      WHEN 'PARTICULAR' THEN 'Particular'
      ELSE 'Outras receitas (PM e PF)'
    END AS segmento_standard,
    CASE UPPER(BTRIM(cm.segmento))
      WHEN 'OTA' THEN 1
      WHEN 'OPERADORA' THEN 2
      WHEN 'LAYOVER' THEN 3
      WHEN 'AGENCIA' THEN 6
      WHEN 'EMPRESAS' THEN 7
      WHEN 'GRUPOS' THEN 5
      WHEN 'PARTICULAR' THEN 9
      ELSE 10
    END AS priority
  FROM public.channel_mapping cm;

  UPDATE tmp_channel_mapping
  SET segmento_standard = 'Clube de férias', priority = 4
  WHERE segmento_standard = 'Outras receitas (PM e PF)'
    AND EXISTS (
      SELECT 1 FROM public.channel_mapping cm2
      WHERE LOWER(extensions.unaccent(BTRIM(cm2.canal))) = tmp_channel_mapping.canal_normalized
        AND UPPER(BTRIM(cm2.segmento)) IN ('CLUBE DE FÉRIAS', 'CLUBE DE FERIAS')
    );

  CREATE TEMP TABLE tmp_row_matches ON COMMIT DROP AS
  SELECT DISTINCT ON (v.confirmation_number, v.property_name, m.canal_normalized)
    v.confirmation_number,
    v.property_name,
    v.company_name,
    v.travel_agent_name,
    v.source_name,
    m.segmento_standard,
    m.priority AS mapping_priority,
    v.travel_agent_name IS NOT NULL AS has_agent,
    v.company_name IS NOT NULL AS has_company,
    v.source_name IS NOT NULL AS has_source
  FROM tmp_valid_rows v
  INNER JOIN tmp_channel_mapping m
    ON POSITION(m.canal_normalized IN
      LOWER(extensions.unaccent(COALESCE(v.company_name, '') || ' ' || COALESCE(v.travel_agent_name, '')))
    ) > 0;

  CREATE TEMP TABLE tmp_best_mapping ON COMMIT DROP AS
  SELECT DISTINCT ON (confirmation_number, property_name)
    confirmation_number, property_name, segmento_standard, mapping_priority
  FROM tmp_row_matches
  ORDER BY confirmation_number, property_name, mapping_priority;

  CREATE TEMP TABLE tmp_operational_signals ON COMMIT DROP AS
  SELECT
    v.confirmation_number,
    v.property_name,
    MAX(v.company_name) AS agg_company,
    MAX(v.travel_agent_name) AS agg_agent,
    BOOL_OR(v.travel_agent_name IS NOT NULL) AS has_agent,
    BOOL_OR(v.company_name IS NOT NULL) AS has_company,
    BOOL_OR(v.source_name IS NOT NULL) AS has_source,
    TRUE AS has_operational_room
  FROM tmp_valid_rows v
  WHERE v.room_type_normalized NOT IN ('pm', 'pf', 'pz')
  GROUP BY v.confirmation_number, v.property_name;

  CREATE INDEX idx_tmp_ops_cn_pn ON tmp_operational_signals (confirmation_number, property_name);

  CREATE TEMP TABLE tmp_layover_flags ON COMMIT DROP AS
  SELECT
    v.confirmation_number,
    v.property_name,
    BOOL_OR(
      (
        POSITION('azul linhas aereas' IN LOWER(extensions.unaccent(COALESCE(v.company_name, '') || ' ' || COALESCE(v.travel_agent_name, '')))) > 0
        OR POSITION('azul linhas global master' IN LOWER(extensions.unaccent(COALESCE(v.company_name, '') || ' ' || COALESCE(v.travel_agent_name, '')))) > 0
      )
      AND POSITION('azul viagens' IN LOWER(extensions.unaccent(COALESCE(v.company_name, '') || ' ' || COALESCE(v.travel_agent_name, '')))) = 0
    ) AS is_layover
  FROM tmp_valid_rows v
  GROUP BY v.confirmation_number, v.property_name;

  CREATE TEMP TABLE tmp_operadora_flags ON COMMIT DROP AS
  SELECT
    v.confirmation_number,
    v.property_name,
    BOOL_OR(
      POSITION('e-htl' IN LOWER(extensions.unaccent(COALESCE(v.company_name, '') || ' ' || COALESCE(v.travel_agent_name, '')))) > 0
      OR POSITION('ehtl' IN LOWER(extensions.unaccent(COALESCE(v.company_name, '') || ' ' || COALESCE(v.travel_agent_name, '')))) > 0
      OR POSITION('e htl' IN LOWER(extensions.unaccent(COALESCE(v.company_name, '') || ' ' || COALESCE(v.travel_agent_name, '')))) > 0
      OR POSITION('azul viagens' IN LOWER(extensions.unaccent(COALESCE(v.company_name, '') || ' ' || COALESCE(v.travel_agent_name, '')))) > 0
    ) AS is_operadora
  FROM tmp_valid_rows v
  GROUP BY v.confirmation_number, v.property_name;

  DELETE FROM public.processed_reservations WHERE true;

  INSERT INTO public.processed_reservations (
    confirmation_number, property_name, company_name, travel_agent_name,
    sales_channel, room_revenue, fb_revenue, total_revenue, roomnights,
    country, state, city, reservation_date, arrival_date, departure_date,
    departure_month, departure_year, lead_time_days
  )
  SELECT
    t.confirmation_number, t.property_name, s.agg_company, s.agg_agent,
    CASE
      -- 1. OTA: handled via mapping table (priority 1)
      -- 2. OPERADORAS: hardcoded check
      WHEN COALESCE(op.is_operadora, false) THEN 'Operadoras'
      -- 3. LAYOVER: hardcoded check
      WHEN COALESCE(ly.is_layover, false) THEN 'Layover'
      -- 4. Mapping table covers OTA(1), Operadoras(2), Layover(3), Clube de férias(4), Grupos(5), Outras agências(6), Empresas(7)
      WHEN bm.segmento_standard IS NOT NULL THEN bm.segmento_standard
      -- 5. GRUPOS: rate code description (overrides PM/PF room type)
      WHEN COALESCE(g.has_group, false) THEN 'Grupos'
      -- 6-7. FALLBACK: agent or company present = Empresas
      WHEN COALESCE(s.has_agent, false) OR COALESCE(s.has_company, false) THEN 'Empresas'
      -- 8. PM/PF: no operational room, only if nothing above matched
      WHEN s.has_operational_room IS NULL OR s.has_operational_room = false THEN 'Outras receitas (PM e PF)'
      -- 9. PARTICULAR: absolute last resort
      ELSE 'Particular'
    END,
    t.room_revenue, t.fb_revenue, t.total_revenue, t.roomnights,
    t.country, t.state, t.city, t.reservation_date, t.arrival_date,
    t.departure_date, t.departure_month, t.departure_year, t.lead_time_days
  FROM tmp_reservation_totals t
  LEFT JOIN tmp_operational_signals s
    ON s.confirmation_number = t.confirmation_number AND s.property_name = t.property_name
  LEFT JOIN tmp_best_mapping bm
    ON bm.confirmation_number = t.confirmation_number AND bm.property_name = t.property_name
  LEFT JOIN tmp_group_flags g
    ON g.confirmation_number = t.confirmation_number AND g.property_name = t.property_name
  LEFT JOIN tmp_layover_flags ly
    ON ly.confirmation_number = t.confirmation_number AND ly.property_name = t.property_name
  LEFT JOIN tmp_operadora_flags op
    ON op.confirmation_number = t.confirmation_number AND op.property_name = t.property_name;

  IF p_batch_id IS NOT NULL THEN
    UPDATE public.upload_batches
    SET status = 'completed', completed_at = NOW(),
        processed_rows = (SELECT COUNT(*) FROM public.processed_reservations)
    WHERE id = p_batch_id;
  END IF;
END;
$function$;
