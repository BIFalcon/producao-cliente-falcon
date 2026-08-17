ALTER TABLE public.raw_reservations ADD COLUMN IF NOT EXISTS avg_daily_rate numeric;
ALTER TABLE public.processed_reservations ADD COLUMN IF NOT EXISTS avg_daily_rate numeric;

CREATE OR REPLACE FUNCTION public.insert_raw_reservations_batch(p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
AS $function$
DECLARE
  v_inserted integer := 0;
BEGIN
  INSERT INTO public.raw_reservations (
    tenant_id, property_name, reservation_status, confirmation_number,
    reservation_date, arrival_date, arrival_time, departure_date, departure_time,
    number_of_nights, travel_agent_name, company_name, city, state, country,
    room_revenue, fb_revenue, total_revenue, avg_daily_rate, room_type, source_name,
    individual_first_name, rate_code, rate_code_description, upload_batch_id
  )
  SELECT
    tenant_id, property_name, reservation_status, confirmation_number,
    reservation_date, arrival_date, arrival_time, departure_date, departure_time,
    number_of_nights, travel_agent_name, company_name, city, state, country,
    room_revenue, fb_revenue, total_revenue, avg_daily_rate, room_type, source_name,
    individual_first_name, rate_code, rate_code_description, upload_batch_id
  FROM jsonb_to_recordset(p_rows) AS x(
    tenant_id uuid, property_name text, reservation_status text, confirmation_number text,
    reservation_date date, arrival_date date, arrival_time time, departure_date date,
    departure_time time, number_of_nights numeric, travel_agent_name text, company_name text,
    city text, state text, country text, room_revenue numeric, fb_revenue numeric,
    total_revenue numeric, avg_daily_rate numeric, room_type text, source_name text,
    individual_first_name text, rate_code text, rate_code_description text, upload_batch_id uuid
  );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$function$;

CREATE OR REPLACE FUNCTION public.process_reservations(p_tenant_id uuid, p_batch_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN

  CREATE TEMP TABLE tmp_base_rows ON COMMIT DROP AS
  SELECT r.*, COALESCE(b.created_at, '1970-01-01'::timestamptz) AS batch_ts
  FROM public.raw_reservations r
  LEFT JOIN public.upload_batches b ON b.id = r.upload_batch_id
  WHERE r.tenant_id = p_tenant_id
    AND r.confirmation_number IS NOT NULL
    AND r.property_name IS NOT NULL
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
  JOIN tmp_latest_batch lb
    ON lb.confirmation_number = r.confirmation_number
   AND lb.property_name = r.property_name
   AND lb.batch_ts = r.batch_ts
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

  CREATE TEMP TABLE tmp_res_flags ON COMMIT DROP AS
  SELECT v.confirmation_number, v.property_name,
    BOOL_OR(v.rate_code_desc_normalized ~ 'grupo|group') AS has_group,
    BOOL_OR(
      v.company_name IS NOT NULL OR
      v.travel_agent_name IS NOT NULL OR
      v.source_name IS NOT NULL OR
      v.individual_first_name IS NOT NULL
    ) AS has_identity,
    BOOL_AND(v.room_type_normalized IN ('pm', 'pf', 'pz')) AS all_pm,
    BOOL_OR(
      v.combined_text LIKE '%booking%' OR
      v.combined_text LIKE '%expedia%' OR
      v.combined_text LIKE '%decolar%'
    ) AS is_ota,
    BOOL_OR(
      v.combined_text LIKE '%e-htl%' OR
      v.combined_text LIKE '%ehtl%' OR
      v.combined_text LIKE '%e htl%' OR
      v.combined_text LIKE '%azul viagens%'
    ) AS is_operadora,
    BOOL_OR(
      (v.combined_text LIKE '%azul linhas aereas%' OR
       v.combined_text LIKE '%azul linhas global master%' OR
       v.combined_text LIKE '%layover%')
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
      WHEN 'OPERADORA' THEN 2 WHEN 'LAYOVER' THEN 3
      WHEN 'AGENCIA' THEN 6 WHEN 'EMPRESAS' THEN 7
      WHEN 'GRUPOS' THEN 5 WHEN 'PARTICULAR' THEN 9
      ELSE 10
    END AS priority,
    NULL::text AS canal_regex
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

  UPDATE tmp_channel_mapping
  SET canal_regex = '\m' || regexp_replace(canal_normalized, '([.^$|?*+()\[\]{}\\])', '\\\&', 'g') || '\M';

  CREATE TEMP TABLE tmp_row_matches ON COMMIT DROP AS
  SELECT DISTINCT ON (v.confirmation_number, v.property_name, m.canal_normalized)
    v.confirmation_number, v.property_name, m.segmento_standard, m.priority
  FROM tmp_valid_rows v
  JOIN tmp_channel_mapping m ON v.combined_text ~ m.canal_regex
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

  CREATE INDEX idx_tmp_mapped_cn_pn ON tmp_mapped_channels (confirmation_number, property_name);

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
    room_revenue, fb_revenue, total_revenue, avg_daily_rate,
    sales_channel, lead_time_days, departure_month, departure_year, roomnights
  )
  SELECT p_tenant_id, rt.property_name, rt.confirmation_number,
    rt.reservation_date, rt.arrival_date, rt.departure_date,
    rt.travel_agent_name, rt.company_name,
    rt.city, rt.state, rt.country,
    rt.room_revenue, rt.fb_revenue, rt.total_revenue,
    COALESCE(rt.avg_daily_rate,
      CASE WHEN COALESCE(rt.roomnights, 0) > 0 AND rt.room_revenue > 0
           THEN rt.room_revenue / rt.roomnights END),
    CASE
      WHEN COALESCE(f.is_ota, false) THEN 'OTA'
      WHEN COALESCE(f.is_operadora, false) THEN 'Operadoras'
      WHEN COALESCE(f.is_layover, false) THEN 'Layover'
      WHEN mc.sales_channel IS NOT NULL THEN mc.sales_channel
      WHEN COALESCE(f.has_group, false) THEN 'Grupos'
      WHEN rt.travel_agent_name IS NOT NULL THEN 'Outras agências'
      WHEN rt.company_name IS NOT NULL THEN 'Empresas'
      WHEN NOT COALESCE(f.has_identity, false) AND COALESCE(f.all_pm, false)
        THEN 'Outras receitas (PM e PF)'
      ELSE 'Particular'
    END,
    rt.lead_time_days, rt.departure_month, rt.departure_year, rt.roomnights
  FROM tmp_reservation_totals rt
  LEFT JOIN tmp_res_flags f ON f.confirmation_number = rt.confirmation_number AND f.property_name = rt.property_name
  LEFT JOIN tmp_mapped_channels mc ON mc.confirmation_number = rt.confirmation_number AND mc.property_name = rt.property_name;

  IF p_batch_id IS NOT NULL THEN
    UPDATE public.upload_batches
    SET processed_rows = (SELECT COUNT(*) FROM tmp_valid_rows),
        status = 'completed', completed_at = now()
    WHERE id = p_batch_id;
  END IF;

END;
$function$;

CREATE OR REPLACE FUNCTION public.get_company_table(p_tenant_id uuid, p_property text[] DEFAULT NULL::text[], p_current_year integer DEFAULT NULL::integer, p_previous_year integer DEFAULT NULL::integer, p_channel text DEFAULT NULL::text, p_month integer[] DEFAULT NULL::integer[])
 RETURNS TABLE(company_name text, revenue_current numeric, revenue_previous numeric, absolute_change numeric, pct_change numeric, revenue_share numeric, roomnights_current numeric, roomnights_previous numeric, room_revenue_current numeric, adr_current numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_allowed text[];
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid(), p_tenant_id);
  RETURN QUERY
  WITH current_yr AS (
    SELECT pr.company_name AS cn, SUM(pr.total_revenue) AS rev, SUM(pr.roomnights) AS rn, SUM(pr.room_revenue) AS room_rev,
           SUM(pr.avg_daily_rate * pr.roomnights) FILTER (WHERE pr.avg_daily_rate > 0 AND pr.roomnights > 0) AS adr_weight,
           SUM(pr.roomnights) FILTER (WHERE pr.avg_daily_rate > 0 AND pr.roomnights > 0) AS adr_rn
    FROM public.processed_reservations pr
    WHERE pr.tenant_id = p_tenant_id
      AND pr.company_name IS NOT NULL AND pr.company_name != ''
      AND (p_property IS NULL OR cardinality(p_property) = 0 OR pr.property_name = ANY(p_property))
      AND (p_current_year IS NULL OR pr.departure_year = p_current_year)
      AND (p_month IS NULL OR cardinality(p_month) = 0 OR pr.departure_month = ANY(p_month))
      AND (p_channel IS NULL OR pr.sales_channel = p_channel)
      AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
    GROUP BY pr.company_name
  ),
  previous_yr AS (
    SELECT pr.company_name AS cn, SUM(pr.total_revenue) AS rev, SUM(pr.roomnights) AS rn
    FROM public.processed_reservations pr
    WHERE pr.tenant_id = p_tenant_id
      AND pr.company_name IS NOT NULL AND pr.company_name != ''
      AND (p_property IS NULL OR cardinality(p_property) = 0 OR pr.property_name = ANY(p_property))
      AND (p_previous_year IS NULL OR pr.departure_year = p_previous_year)
      AND (p_month IS NULL OR cardinality(p_month) = 0 OR pr.departure_month = ANY(p_month))
      AND (p_channel IS NULL OR pr.sales_channel = p_channel)
      AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
    GROUP BY pr.company_name
  ),
  grand_total AS (
    SELECT SUM(pr.total_revenue) AS t
    FROM public.processed_reservations pr
    WHERE pr.tenant_id = p_tenant_id
      AND (p_property IS NULL OR cardinality(p_property) = 0 OR pr.property_name = ANY(p_property))
      AND (p_current_year IS NULL OR pr.departure_year = p_current_year)
      AND (p_month IS NULL OR cardinality(p_month) = 0 OR pr.departure_month = ANY(p_month))
      AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
  )
  SELECT COALESCE(c.cn, p.cn), COALESCE(c.rev, 0), COALESCE(p.rev, 0),
    COALESCE(c.rev, 0) - COALESCE(p.rev, 0),
    CASE WHEN COALESCE(p.rev, 0) > 0 THEN ROUND((COALESCE(c.rev, 0) - p.rev) / p.rev * 100, 2) ELSE NULL END,
    CASE WHEN gt.t > 0 THEN ROUND(COALESCE(c.rev, 0) / gt.t * 100, 2) ELSE 0 END,
    COALESCE(c.rn, 0), COALESCE(p.rn, 0), COALESCE(c.room_rev, 0),
    CASE WHEN COALESCE(c.adr_rn, 0) > 0 THEN ROUND(c.adr_weight / c.adr_rn, 2) ELSE NULL END
  FROM current_yr c FULL OUTER JOIN previous_yr p ON c.cn = p.cn
  CROSS JOIN grand_total gt
  ORDER BY COALESCE(c.rev, 0) DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_agent_comparison(p_tenant_id uuid, p_property text[] DEFAULT NULL::text[], p_current_year integer DEFAULT NULL::integer, p_previous_year integer DEFAULT NULL::integer, p_month integer[] DEFAULT NULL::integer[])
 RETURNS TABLE(travel_agent_name text, revenue_current numeric, revenue_previous numeric, absolute_change numeric, pct_change numeric, roomnights_current numeric, roomnights_previous numeric, adr_current numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_allowed text[];
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid(), p_tenant_id);
  RETURN QUERY
  WITH cur AS (
    SELECT pr.travel_agent_name AS ag, SUM(pr.total_revenue) AS rev, SUM(pr.roomnights) AS rn,
           SUM(pr.avg_daily_rate * pr.roomnights) FILTER (WHERE pr.avg_daily_rate > 0 AND pr.roomnights > 0) AS adr_weight,
           SUM(pr.roomnights) FILTER (WHERE pr.avg_daily_rate > 0 AND pr.roomnights > 0) AS adr_rn
    FROM processed_reservations pr
    WHERE pr.tenant_id = p_tenant_id
      AND pr.travel_agent_name IS NOT NULL AND pr.travel_agent_name != ''
      AND (p_property IS NULL OR cardinality(p_property) = 0 OR pr.property_name = ANY(p_property))
      AND (p_current_year IS NULL OR pr.departure_year = p_current_year)
      AND (p_month IS NULL OR cardinality(p_month) = 0 OR pr.departure_month = ANY(p_month))
      AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
    GROUP BY pr.travel_agent_name
  ),
  prev AS (
    SELECT pr.travel_agent_name AS ag, SUM(pr.total_revenue) AS rev, SUM(pr.roomnights) AS rn
    FROM processed_reservations pr
    WHERE pr.tenant_id = p_tenant_id
      AND pr.travel_agent_name IS NOT NULL AND pr.travel_agent_name != ''
      AND (p_property IS NULL OR cardinality(p_property) = 0 OR pr.property_name = ANY(p_property))
      AND (p_previous_year IS NULL OR pr.departure_year = p_previous_year)
      AND (p_month IS NULL OR cardinality(p_month) = 0 OR pr.departure_month = ANY(p_month))
      AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
    GROUP BY pr.travel_agent_name
  )
  SELECT COALESCE(c.ag, p.ag), COALESCE(c.rev, 0), COALESCE(p.rev, 0),
    COALESCE(c.rev, 0) - COALESCE(p.rev, 0),
    CASE WHEN COALESCE(p.rev, 0) > 0 THEN ROUND((COALESCE(c.rev, 0) - p.rev) / p.rev * 100, 2) ELSE NULL END,
    COALESCE(c.rn, 0), COALESCE(p.rn, 0),
    CASE WHEN COALESCE(c.adr_rn, 0) > 0 THEN ROUND(c.adr_weight / c.adr_rn, 2) ELSE NULL END
  FROM cur c FULL OUTER JOIN prev p ON c.ag = p.ag
  ORDER BY COALESCE(c.rev, 0) DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_agent_companies(p_tenant_id uuid, p_agent text, p_property text[] DEFAULT NULL::text[], p_current_year integer DEFAULT NULL::integer, p_previous_year integer DEFAULT NULL::integer, p_month integer[] DEFAULT NULL::integer[])
 RETURNS TABLE(company_name text, revenue_current numeric, revenue_previous numeric, absolute_change numeric, pct_change numeric, roomnights_current numeric, roomnights_previous numeric, adr_current numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_allowed text[];
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid(), p_tenant_id);
  RETURN QUERY
  WITH cur AS (
    SELECT pr.company_name AS co, SUM(pr.total_revenue) AS rev, SUM(pr.roomnights) AS rn,
           SUM(pr.avg_daily_rate * pr.roomnights) FILTER (WHERE pr.avg_daily_rate > 0 AND pr.roomnights > 0) AS adr_weight,
           SUM(pr.roomnights) FILTER (WHERE pr.avg_daily_rate > 0 AND pr.roomnights > 0) AS adr_rn
    FROM processed_reservations pr
    WHERE pr.tenant_id = p_tenant_id AND pr.travel_agent_name = p_agent
      AND pr.company_name IS NOT NULL AND pr.company_name != ''
      AND (p_property IS NULL OR cardinality(p_property) = 0 OR pr.property_name = ANY(p_property))
      AND (p_current_year IS NULL OR pr.departure_year = p_current_year)
      AND (p_month IS NULL OR cardinality(p_month) = 0 OR pr.departure_month = ANY(p_month))
      AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
    GROUP BY pr.company_name
  ),
  prev AS (
    SELECT pr.company_name AS co, SUM(pr.total_revenue) AS rev, SUM(pr.roomnights) AS rn
    FROM processed_reservations pr
    WHERE pr.tenant_id = p_tenant_id AND pr.travel_agent_name = p_agent
      AND pr.company_name IS NOT NULL AND pr.company_name != ''
      AND (p_property IS NULL OR cardinality(p_property) = 0 OR pr.property_name = ANY(p_property))
      AND (p_previous_year IS NULL OR pr.departure_year = p_previous_year)
      AND (p_month IS NULL OR cardinality(p_month) = 0 OR pr.departure_month = ANY(p_month))
      AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
    GROUP BY pr.company_name
  )
  SELECT COALESCE(c.co, p.co), COALESCE(c.rev, 0), COALESCE(p.rev, 0),
    COALESCE(c.rev, 0) - COALESCE(p.rev, 0),
    CASE WHEN COALESCE(p.rev, 0) > 0 THEN ROUND((COALESCE(c.rev, 0) - p.rev) / p.rev * 100, 2) ELSE NULL END,
    COALESCE(c.rn, 0), COALESCE(p.rn, 0),
    CASE WHEN COALESCE(c.adr_rn, 0) > 0 THEN ROUND(c.adr_weight / c.adr_rn, 2) ELSE NULL END
  FROM cur c FULL OUTER JOIN prev p ON c.co = p.co
  ORDER BY COALESCE(c.rev, 0) DESC;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.insert_raw_reservations_batch(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.process_reservations(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_company_table(uuid, text[], integer, integer, text, integer[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_agent_comparison(uuid, text[], integer, integer, integer[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_agent_companies(uuid, text, text[], integer, integer, integer[]) FROM anon;