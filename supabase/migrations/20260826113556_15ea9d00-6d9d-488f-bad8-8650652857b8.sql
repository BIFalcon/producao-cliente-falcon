CREATE OR REPLACE FUNCTION public.process_reservations(p_tenant_id uuid, p_batch_id uuid DEFAULT NULL::uuid, p_property_name text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '1200s'
AS $function$
DECLARE
  v_property text;
  v_properties text[];
BEGIN
  IF p_property_name IS NOT NULL THEN
    v_properties := ARRAY[LOWER(extensions.unaccent(BTRIM(p_property_name)))];
  ELSE
    SELECT ARRAY_AGG(DISTINCT r.property_name) INTO v_properties
    FROM public.raw_reservations r
    WHERE r.tenant_id = p_tenant_id
      AND r.property_name IS NOT NULL
      AND (p_batch_id IS NULL OR r.upload_batch_id = p_batch_id);
  END IF;

  FOREACH v_property IN ARRAY COALESCE(v_properties, ARRAY[]::text[])
  LOOP
    DROP TABLE IF EXISTS tmp_base_rows, tmp_latest_batch, tmp_valid_rows,
      tmp_reservation_totals, tmp_res_flags, tmp_channel_mapping,
      tmp_row_matches, tmp_mapped_channels;

    CREATE TEMP TABLE tmp_base_rows ON COMMIT DROP AS
    SELECT r.*, COALESCE(b.created_at, '1970-01-01'::timestamptz) AS batch_ts
    FROM public.raw_reservations r
    LEFT JOIN public.upload_batches b ON b.id = r.upload_batch_id
    WHERE r.tenant_id = p_tenant_id
      AND r.confirmation_number IS NOT NULL
      AND r.property_name = v_property
      AND LOWER(COALESCE(r.reservation_status, '')) IN ('checked out', 'checked in', 'no show');

    CREATE INDEX idx_tmp_base_cn_pn ON tmp_base_rows (confirmation_number, property_name);

    CREATE TEMP TABLE tmp_latest_batch ON COMMIT DROP AS
    SELECT confirmation_number, property_name, MAX(batch_ts) AS batch_ts,
      BOOL_OR(p_batch_id IS NOT NULL AND upload_batch_id = p_batch_id) AS in_batch
    FROM tmp_base_rows
    GROUP BY confirmation_number, property_name;

    CREATE INDEX idx_tmp_latest_cn_pn ON tmp_latest_batch (confirmation_number, property_name);

    CREATE TEMP TABLE tmp_valid_rows ON COMMIT DROP AS
    SELECT DISTINCT ON (
      r.confirmation_number, r.property_name, r.arrival_date, r.departure_date,
      LOWER(COALESCE(BTRIM(r.room_type), '')), COALESCE(r.total_revenue, 0),
      LOWER(COALESCE(BTRIM(r.rate_code), ''))
    )
      r.confirmation_number, r.property_name,
      COALESCE(r.room_revenue, 0) AS room_revenue,
      COALESCE(r.fb_revenue, 0) AS fb_revenue,
      COALESCE(r.total_revenue, 0) AS total_revenue,
      r.avg_daily_rate,
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
    FROM tmp_base_rows r
    JOIN tmp_latest_batch lb ON lb.confirmation_number = r.confirmation_number
      AND lb.property_name = r.property_name AND lb.batch_ts = r.batch_ts
    WHERE p_batch_id IS NULL OR lb.in_batch;

    CREATE INDEX idx_tmp_valid_cn_pn ON tmp_valid_rows (confirmation_number, property_name);

    CREATE TEMP TABLE tmp_reservation_totals ON COMMIT DROP AS
    SELECT v.confirmation_number, v.property_name,
      SUM(v.room_revenue) AS room_revenue,
      SUM(v.fb_revenue) AS fb_revenue,
      SUM(v.total_revenue) AS total_revenue,
      AVG(v.number_of_nights) AS roomnights,
      AVG(v.avg_daily_rate) FILTER (WHERE v.avg_daily_rate IS NOT NULL AND v.avg_daily_rate > 0) AS avg_daily_rate,
      MAX(v.country) AS country, MAX(v.state) AS state, MAX(v.city) AS city,
      MAX(v.company_name) AS company_name, MAX(v.travel_agent_name) AS travel_agent_name,
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

    CREATE TEMP TABLE tmp_res_flags ON COMMIT DROP AS
    SELECT v.confirmation_number, v.property_name,
      BOOL_OR(v.rate_code_desc_normalized ~ 'grupo|group') AS has_group,
      BOOL_OR(
        v.company_name IS NOT NULL OR v.travel_agent_name IS NOT NULL
        OR v.source_name IS NOT NULL OR v.individual_first_name IS NOT NULL
      ) AS has_identity,
      BOOL_AND(v.room_type_normalized IN ('pm', 'pf', 'pz')) AS all_pm,
      BOOL_OR(
        v.combined_text LIKE '%booking%' OR v.combined_text LIKE '%expedia%' OR v.combined_text LIKE '%decolar%'
      ) AS is_ota,
      BOOL_OR(
        v.combined_text LIKE '%e-htl%' OR v.combined_text LIKE '%ehtl%'
        OR v.combined_text LIKE '%e htl%' OR v.combined_text LIKE '%azul viagens%'
      ) AS is_operadora,
      BOOL_OR(
        (v.combined_text LIKE '%azul linhas aereas%' OR v.combined_text LIKE '%azul linhas global master%'
         OR v.combined_text LIKE '%layover%')
        AND v.combined_text NOT LIKE '%azul viagens%'
      ) AS is_layover
    FROM tmp_valid_rows v
    GROUP BY v.confirmation_number, v.property_name;

    CREATE INDEX idx_tmp_flags_cn_pn ON tmp_res_flags (confirmation_number, property_name);

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
        WHEN 'OPERADORA' THEN 2
        WHEN 'LAYOVER' THEN 3
        WHEN 'AGENCIA' THEN 6
        WHEN 'EMPRESAS' THEN 7
        WHEN 'GRUPOS' THEN 5
        WHEN 'PARTICULAR' THEN 9
        ELSE 10
      END AS priority,
      NULL::text AS canal_regex
    FROM public.channel_mapping cm
    WHERE cm.tenant_id = p_tenant_id AND UPPER(BTRIM(cm.segmento)) <> 'OTA';

    UPDATE tmp_channel_mapping
    SET segmento_standard = 'Clube de férias', priority = 4
    WHERE segmento_standard = 'Outras receitas (PM e PF)'
      AND EXISTS (
        SELECT 1 FROM public.channel_mapping cm2
        WHERE cm2.tenant_id = p_tenant_id
          AND LOWER(extensions.unaccent(BTRIM(cm2.canal))) = tmp_channel_mapping.canal_normalized
          AND UPPER(BTRIM(cm2.segmento)) IN ('CLUBE DE FÉRIAS', 'CLUBE DE FERIAS')
      );

    UPDATE tmp_channel_mapping
    SET canal_regex = '\m' || regexp_replace(canal_normalized, '([.^$|?*+()\[\]{}\\])', '\\\&', 'g') || '\M'
    WHERE true;

    CREATE INDEX idx_tmp_channel_mapping_canal ON tmp_channel_mapping (canal_normalized);

    CREATE TEMP TABLE tmp_row_matches ON COMMIT DROP AS
    WITH distinct_texts AS (
      SELECT DISTINCT v.combined_text AS ct
      FROM tmp_valid_rows v
      WHERE COALESCE(BTRIM(v.combined_text), '') <> ''
    ),
    text_priority AS (
      SELECT DISTINCT ON (d.ct)
        d.ct, m.segmento_standard, m.priority
      FROM distinct_texts d
      JOIN tmp_channel_mapping m
        ON POSITION(m.canal_normalized IN d.ct) > 0
       AND d.ct ~ m.canal_regex
      WHERE m.canal_normalized <> ''
      ORDER BY d.ct, m.priority
    )
    SELECT DISTINCT v.confirmation_number, v.property_name, tp.segmento_standard, tp.priority
    FROM tmp_valid_rows v
    JOIN text_priority tp ON tp.ct = v.combined_text;

    CREATE TEMP TABLE tmp_mapped_channels ON COMMIT DROP AS
    SELECT DISTINCT ON (rm.confirmation_number, rm.property_name)
      rm.confirmation_number, rm.property_name, rm.segmento_standard AS sales_channel
    FROM tmp_row_matches rm
    JOIN tmp_reservation_totals rt ON rt.confirmation_number = rm.confirmation_number
      AND rt.property_name = rm.property_name
    WHERE NOT (rm.segmento_standard IN ('Empresas', 'Grupos') AND COALESCE(rt.total_revenue, 0) < 0)
    ORDER BY rm.confirmation_number, rm.property_name, rm.priority;

    CREATE INDEX idx_tmp_mapped_cn_pn ON tmp_mapped_channels (confirmation_number, property_name);

    IF p_batch_id IS NULL THEN
      DELETE FROM public.processed_reservations
      WHERE tenant_id = p_tenant_id AND property_name = v_property;
    ELSE
      DELETE FROM public.processed_reservations pr
      USING tmp_reservation_totals rt
      WHERE pr.tenant_id = p_tenant_id
        AND pr.confirmation_number = rt.confirmation_number
        AND pr.property_name = rt.property_name;
    END IF;

    INSERT INTO public.processed_reservations (
      tenant_id, property_name, confirmation_number, reservation_date, arrival_date, departure_date,
      travel_agent_name, company_name, city, state, country, room_revenue, fb_revenue, total_revenue,
      avg_daily_rate, sales_channel, lead_time_days, departure_month, departure_year, roomnights
    )
    SELECT
      p_tenant_id, rt.property_name, rt.confirmation_number, rt.reservation_date, rt.arrival_date, rt.departure_date,
      rt.travel_agent_name, rt.company_name, rt.city, rt.state, rt.country, rt.room_revenue, rt.fb_revenue, rt.total_revenue,
      COALESCE(rt.avg_daily_rate, CASE WHEN COALESCE(rt.roomnights, 0) > 0 AND rt.room_revenue > 0
        THEN rt.room_revenue / rt.roomnights END),
      CASE
        WHEN COALESCE(f.is_ota, false) THEN 'OTA'
        WHEN COALESCE(f.is_operadora, false) THEN 'Operadoras'
        WHEN COALESCE(f.is_layover, false) THEN 'Layover'
        WHEN mc.sales_channel IS NOT NULL THEN mc.sales_channel
        WHEN COALESCE(f.has_group, false) THEN 'Grupos'
        WHEN rt.travel_agent_name IS NOT NULL THEN 'Outras agências'
        WHEN rt.company_name IS NOT NULL THEN 'Empresas'
        WHEN NOT COALESCE(f.has_identity, false) AND COALESCE(f.all_pm, false) THEN 'Outras receitas (PM e PF)'
        ELSE 'Particular'
      END,
      rt.lead_time_days, rt.departure_month, rt.departure_year, rt.roomnights
    FROM tmp_reservation_totals rt
    LEFT JOIN tmp_res_flags f ON f.confirmation_number = rt.confirmation_number AND f.property_name = rt.property_name
    LEFT JOIN tmp_mapped_channels mc ON mc.confirmation_number = rt.confirmation_number AND mc.property_name = rt.property_name;

  END LOOP;

  IF p_batch_id IS NOT NULL THEN
    UPDATE public.upload_batches
    SET processed_rows = (
      SELECT COUNT(*) FROM public.raw_reservations
      WHERE tenant_id = p_tenant_id AND upload_batch_id = p_batch_id
    ),
    status = 'completed', completed_at = now()
    WHERE id = p_batch_id;
  END IF;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.process_reservations(uuid, uuid, text) FROM anon, PUBLIC;