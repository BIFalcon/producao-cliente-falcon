
-- Create channel_mapping table
CREATE TABLE public.channel_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canal text NOT NULL,
  segmento text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.channel_mapping ENABLE ROW LEVEL SECURITY;

-- Everyone authenticated can read
CREATE POLICY "Authenticated users can read channel_mapping"
ON public.channel_mapping FOR SELECT TO authenticated
USING (true);

-- Admins/editors can manage
CREATE POLICY "Admins and editors can manage channel_mapping"
ON public.channel_mapping FOR ALL TO authenticated
USING (has_role(auth.uid(), 'master_admin') OR has_role(auth.uid(), 'editor'));

-- Update process_reservations to use channel_mapping
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

  -- Load channel mapping into temp table for fast lookups
  CREATE TEMP TABLE tmp_channel_mapping ON COMMIT DROP AS
  SELECT
    LOWER(extensions.unaccent(BTRIM(cm.canal))) AS canal_normalized,
    CASE UPPER(BTRIM(cm.segmento))
      WHEN 'AGENCIA' THEN 'Outras Agências'
      WHEN 'OPERADORA' THEN 'Operadoras'
      WHEN 'EMPRESAS' THEN 'Empresas'
      WHEN 'GRUPOS' THEN 'Grupos'
      WHEN 'LAYOVER' THEN 'Layover'
      WHEN 'OTA' THEN 'OTA'
      WHEN 'PARTICULAR' THEN 'Particular'
      WHEN 'CLUBE DE FÉRIAS' THEN 'Clube de férias'
      WHEN 'CLUBE DE FERIAS' THEN 'Clube de férias'
      WHEN 'OUTROS' THEN 'Outras receitas (PM e PF)'
      ELSE 'Outras receitas (PM e PF)'
    END AS segmento_standard,
    -- priority number for sorting
    CASE UPPER(BTRIM(cm.segmento))
      WHEN 'OTA' THEN 1
      WHEN 'OPERADORA' THEN 2
      WHEN 'LAYOVER' THEN 3
      WHEN 'CLUBE DE FÉRIAS' THEN 4
      WHEN 'CLUBE DE FERIAS' THEN 4
      WHEN 'AGENCIA' THEN 5
      WHEN 'EMPRESAS' THEN 6
      WHEN 'GRUPOS' THEN 7
      WHEN 'PARTICULAR' THEN 8
      ELSE 9
    END AS priority
  FROM public.channel_mapping cm;

  -- Build operational signals using mapping table
  CREATE TEMP TABLE tmp_operational_signals ON COMMIT DROP AS
  SELECT
    o.confirmation_number, o.property_name,
    MAX(o.company_name) AS agg_company,
    MAX(o.travel_agent_name) AS agg_agent,
    -- Find highest priority match from mapping
    MIN(o.mapping_priority) AS best_mapping_priority,
    MAX(CASE WHEN o.mapping_priority = (SELECT MIN(o2.mapping_priority) FROM (
      SELECT v2.confirmation_number AS cn2, v2.property_name AS pn2,
             MIN(m2.priority) AS mapping_priority
      FROM tmp_valid_rows v2
      INNER JOIN tmp_channel_mapping m2
        ON POSITION(m2.canal_normalized IN
          LOWER(extensions.unaccent(COALESCE(v2.company_name, '') || ' ' || COALESCE(v2.travel_agent_name, '')))
        ) > 0
      WHERE v2.room_type_normalized NOT IN ('pm', 'pf', 'pz')
      GROUP BY v2.confirmation_number, v2.property_name
    ) o2 WHERE o2.cn2 = o.confirmation_number AND o2.pn2 = o.property_name)
    THEN o.mapping_segmento ELSE NULL END) AS best_mapping_segmento,
    BOOL_OR(o.has_agent) AS has_agent,
    BOOL_OR(o.has_company) AS has_company,
    BOOL_OR(o.has_source) AS has_source,
    TRUE AS has_operational_room
  FROM (
    SELECT
      v.confirmation_number, v.property_name, v.company_name, v.travel_agent_name, v.source_name,
      m.priority AS mapping_priority,
      m.segmento_standard AS mapping_segmento,
      v.travel_agent_name IS NOT NULL AS has_agent,
      v.company_name IS NOT NULL AS has_company,
      v.source_name IS NOT NULL AS has_source
    FROM tmp_valid_rows v
    LEFT JOIN tmp_channel_mapping m
      ON POSITION(m.canal_normalized IN
        LOWER(extensions.unaccent(COALESCE(v.company_name, '') || ' ' || COALESCE(v.travel_agent_name, '')))
      ) > 0
    WHERE v.room_type_normalized NOT IN ('pm', 'pf', 'pz')
  ) o
  GROUP BY o.confirmation_number, o.property_name;

  CREATE INDEX idx_tmp_ops_cn_pn ON tmp_operational_signals (confirmation_number, property_name);

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
      -- PM/PF rooms: always "Outras receitas (PM e PF)"
      WHEN s.has_operational_room IS NULL OR s.has_operational_room = false THEN 'Outras receitas (PM e PF)'
      -- Mapping match found: use highest priority segment
      WHEN s.best_mapping_segmento IS NOT NULL THEN s.best_mapping_segmento
      -- Group flag (only if no mapping match)
      WHEN COALESCE(g.has_group, false) THEN 'Grupos'
      -- Fallback: agent or company filled = Empresas
      WHEN COALESCE(s.has_agent, false) THEN 'Empresas'
      WHEN COALESCE(s.has_company, false) THEN 'Empresas'
      -- Source exists but no agent/company
      WHEN COALESCE(s.has_source, false) THEN 'Outras receitas (PM e PF)'
      -- Nothing at all
      WHEN s.has_operational_room THEN 'Particular'
      ELSE 'Outras receitas (PM e PF)'
    END,
    t.room_revenue, t.fb_revenue, t.total_revenue, t.roomnights,
    t.country, t.state, t.city, t.reservation_date, t.arrival_date,
    t.departure_date, t.departure_month, t.departure_year, t.lead_time_days
  FROM tmp_reservation_totals t
  LEFT JOIN tmp_operational_signals s
    ON s.confirmation_number = t.confirmation_number AND s.property_name = t.property_name
  LEFT JOIN tmp_group_flags g
    ON g.confirmation_number = t.confirmation_number AND g.property_name = t.property_name;

  IF p_batch_id IS NOT NULL THEN
    UPDATE public.upload_batches
    SET status = 'completed', completed_at = NOW(),
        processed_rows = (SELECT COUNT(*) FROM public.processed_reservations)
    WHERE id = p_batch_id;
  END IF;
END;
$function$;
