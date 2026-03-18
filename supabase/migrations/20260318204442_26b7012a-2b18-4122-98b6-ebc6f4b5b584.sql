
CREATE OR REPLACE FUNCTION public.process_reservations(p_batch_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Detect group at RESERVATION level from ALL rows (including PM/PF/PZ)
  CREATE TEMP TABLE tmp_group_flags ON COMMIT DROP AS
  SELECT
    v.confirmation_number,
    v.property_name,
    BOOL_OR(v.rate_code_desc_normalized ~ 'grupo') AS has_group
  FROM tmp_valid_rows v
  GROUP BY v.confirmation_number, v.property_name;

  -- Operational signals from non-PM/PF/PZ rows only
  CREATE TEMP TABLE tmp_operational_signals ON COMMIT DROP AS
  SELECT
    o.confirmation_number, o.property_name,
    MAX(o.company_name) AS agg_company,
    MAX(o.travel_agent_name) AS agg_agent,
    BOOL_OR(o.has_ota) AS has_ota,
    BOOL_OR(o.has_operadora) AS has_operadora,
    BOOL_OR(o.has_layover) AS has_layover,
    BOOL_OR(o.has_agent) AS has_agent,
    BOOL_OR(o.has_company) AS has_company,
    BOOL_OR(o.has_source) AS has_source,
    TRUE AS has_operational_room
  FROM (
    SELECT
      v.confirmation_number, v.property_name, v.company_name, v.travel_agent_name, v.source_name,
      (POSITION('booking' IN LOWER(CONCAT_WS(' ', v.company_name, v.travel_agent_name, v.source_name))) > 0 OR
       POSITION('expedia' IN LOWER(CONCAT_WS(' ', v.company_name, v.travel_agent_name, v.source_name))) > 0 OR
       POSITION('decolar' IN LOWER(CONCAT_WS(' ', v.company_name, v.travel_agent_name, v.source_name))) > 0) AS has_ota,
      (POSITION('trend' IN LOWER(CONCAT_WS(' ', v.company_name, v.travel_agent_name, v.source_name))) > 0 OR
       POSITION('cvc' IN LOWER(CONCAT_WS(' ', v.company_name, v.travel_agent_name, v.source_name))) > 0 OR
       POSITION('latam.travel' IN LOWER(CONCAT_WS(' ', v.company_name, v.travel_agent_name, v.source_name))) > 0 OR
       POSITION('gol.linhas' IN LOWER(CONCAT_WS(' ', v.company_name, v.travel_agent_name, v.source_name))) > 0 OR
       POSITION('abreu' IN LOWER(CONCAT_WS(' ', v.company_name, v.travel_agent_name, v.source_name))) > 0 OR
       POSITION('flytour' IN LOWER(CONCAT_WS(' ', v.company_name, v.travel_agent_name, v.source_name))) > 0 OR
       POSITION('idt.travel' IN LOWER(CONCAT_WS(' ', v.company_name, v.travel_agent_name, v.source_name))) > 0 OR
       POSITION('affinity' IN LOWER(CONCAT_WS(' ', v.company_name, v.travel_agent_name, v.source_name))) > 0 OR
       POSITION('oca.travel' IN LOWER(CONCAT_WS(' ', v.company_name, v.travel_agent_name, v.source_name))) > 0 OR
       POSITION('tour.house' IN LOWER(CONCAT_WS(' ', v.company_name, v.travel_agent_name, v.source_name))) > 0 OR
       POSITION('schultz' IN LOWER(CONCAT_WS(' ', v.company_name, v.travel_agent_name, v.source_name))) > 0 OR
       POSITION('orinter' IN LOWER(CONCAT_WS(' ', v.company_name, v.travel_agent_name, v.source_name))) > 0 OR
       POSITION('visual.turismo' IN LOWER(CONCAT_WS(' ', v.company_name, v.travel_agent_name, v.source_name))) > 0 OR
       POSITION('luck.viagens' IN LOWER(CONCAT_WS(' ', v.company_name, v.travel_agent_name, v.source_name))) > 0 OR
       POSITION('viagens.promo' IN LOWER(CONCAT_WS(' ', v.company_name, v.travel_agent_name, v.source_name))) > 0 OR
       POSITION('sakura' IN LOWER(CONCAT_WS(' ', v.company_name, v.travel_agent_name, v.source_name))) > 0 OR
       POSITION('lucky.travel' IN LOWER(CONCAT_WS(' ', v.company_name, v.travel_agent_name, v.source_name))) > 0 OR
       POSITION('shift.travel' IN LOWER(CONCAT_WS(' ', v.company_name, v.travel_agent_name, v.source_name))) > 0 OR
       POSITION('tam.viagens' IN LOWER(CONCAT_WS(' ', v.company_name, v.travel_agent_name, v.source_name))) > 0 OR
       POSITION('newit.turismo' IN LOWER(CONCAT_WS(' ', v.company_name, v.travel_agent_name, v.source_name))) > 0 OR
       POSITION('klas.turismo' IN LOWER(CONCAT_WS(' ', v.company_name, v.travel_agent_name, v.source_name))) > 0) AS has_operadora,
      (POSITION('azul linhas aereas' IN LOWER(CONCAT_WS(' ', v.company_name, v.travel_agent_name, v.source_name))) > 0 AND
       POSITION('azul viagens' IN LOWER(CONCAT_WS(' ', v.company_name, v.travel_agent_name, v.source_name))) = 0) AS has_layover,
      v.travel_agent_name IS NOT NULL AS has_agent,
      v.company_name IS NOT NULL AS has_company,
      v.source_name IS NOT NULL AS has_source
    FROM tmp_valid_rows v
    WHERE v.room_type_normalized NOT IN ('pm', 'pf', 'pz')
  ) o
  GROUP BY o.confirmation_number, o.property_name;

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
      WHEN COALESCE(s.has_ota, false) THEN 'OTA'
      WHEN COALESCE(s.has_operadora, false) THEN 'Operadoras'
      WHEN COALESCE(s.has_layover, false) THEN 'Layover'
      WHEN COALESCE(s.has_agent, false) THEN 'Outras Agências'
      WHEN COALESCE(s.has_company, false) THEN 'Empresas'
      WHEN COALESCE(g.has_group, false) THEN 'Grupos'
      WHEN COALESCE(s.has_source, false) THEN 'Outros'
      WHEN COALESCE(s.has_operational_room, false) AND NOT COALESCE(g.has_group, false) THEN 'Particular'
      ELSE 'Outras Receitas (PM e PF)'
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
$$;
