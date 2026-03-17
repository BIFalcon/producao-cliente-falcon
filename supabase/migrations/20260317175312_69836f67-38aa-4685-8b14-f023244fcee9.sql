
CREATE OR REPLACE FUNCTION public.process_reservations(p_batch_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Step 1: Create temp table with pre-computed signals per row
  CREATE TEMP TABLE tmp_signals ON COMMIT DROP AS
  SELECT
    r.confirmation_number,
    r.property_name,
    r.room_revenue,
    r.fb_revenue,
    r.total_revenue,
    r.country,
    r.state,
    r.city,
    r.reservation_date,
    r.arrival_date,
    r.departure_date,
    r.company_name,
    r.travel_agent_name,
    r.source_name,
    r.room_type,
    COALESCE(r.room_type,'') NOT IN ('PM','PF','PZ') AS is_operational,
    LOWER(COALESCE(r.company_name,'') || ' ' || COALESCE(r.travel_agent_name,'') || ' ' || COALESCE(r.source_name,'')) AS unified_source
  FROM raw_reservations r
  WHERE r.confirmation_number IS NOT NULL
    AND r.property_name IS NOT NULL;

  -- Step 2: Clear processed data
  DELETE FROM processed_reservations WHERE true;

  -- Step 3: Aggregate and classify
  INSERT INTO processed_reservations (
    confirmation_number, property_name, company_name, travel_agent_name,
    sales_channel, room_revenue, fb_revenue, total_revenue,
    country, state, city, reservation_date, arrival_date, departure_date,
    departure_month, departure_year, lead_time_days
  )
  SELECT
    agg.confirmation_number,
    agg.property_name,
    agg.agg_company,
    agg.agg_agent,
    CASE
      WHEN agg.has_ota THEN 'OTA'
      WHEN agg.has_operadora THEN 'Operadoras'
      WHEN agg.has_layover THEN 'Layover'
      WHEN agg.has_agent THEN 'Outras Agências'
      WHEN agg.has_company THEN 'Empresas'
      WHEN agg.has_source THEN 'Outros'
      WHEN agg.has_operational_room AND agg.total_revenue > 0 THEN 'Particular'
      ELSE 'Outras Receitas (PM e PF)'
    END,
    agg.room_revenue,
    agg.fb_revenue,
    agg.total_revenue,
    agg.country,
    agg.state,
    agg.city,
    agg.reservation_date,
    agg.arrival_date,
    agg.departure_date,
    agg.departure_month,
    agg.departure_year,
    agg.lead_time_days
  FROM (
    SELECT
      s.confirmation_number,
      s.property_name,
      SUM(COALESCE(s.room_revenue, 0)) AS room_revenue,
      SUM(COALESCE(s.fb_revenue, 0)) AS fb_revenue,
      SUM(COALESCE(s.total_revenue, 0)) AS total_revenue,
      MAX(s.country) AS country,
      MAX(s.state) AS state,
      MAX(s.city) AS city,
      MIN(s.reservation_date) AS reservation_date,
      MIN(s.arrival_date) AS arrival_date,
      MAX(s.departure_date) AS departure_date,
      EXTRACT(MONTH FROM MAX(s.departure_date))::int AS departure_month,
      EXTRACT(YEAR FROM MAX(s.departure_date))::int AS departure_year,
      CASE
        WHEN MIN(s.reservation_date) IS NOT NULL AND MIN(s.arrival_date) IS NOT NULL
        THEN (MIN(s.arrival_date) - MIN(s.reservation_date))
        ELSE NULL
      END AS lead_time_days,
      MAX(CASE WHEN s.is_operational THEN s.company_name END) AS agg_company,
      MAX(CASE WHEN s.is_operational THEN s.travel_agent_name END) AS agg_agent,
      BOOL_OR(s.is_operational AND s.unified_source ~* '(booking|expedia|decolar)') AS has_ota,
      BOOL_OR(s.is_operational AND s.unified_source ~* '(trend|cvc|latam.travel|gol.linhas|abreu|flytour|idt.travel|affinity|oca.travel|tour.house|schultz|orinter|visual.turismo|luck.viagens|viagens.promo|sakura|lucky.travel|shift.travel|tam.viagens|newit.turismo|klas.turismo)') AS has_operadora,
      BOOL_OR(s.is_operational AND s.unified_source ~* 'azul linhas aereas' AND NOT s.unified_source ~* 'azul viagens') AS has_layover,
      BOOL_OR(s.is_operational AND COALESCE(TRIM(s.travel_agent_name),'') <> '') AS has_agent,
      BOOL_OR(s.is_operational AND COALESCE(TRIM(s.company_name),'') <> '') AS has_company,
      BOOL_OR(s.is_operational AND COALESCE(TRIM(s.source_name),'') <> '') AS has_source,
      BOOL_OR(s.is_operational) AS has_operational_room
    FROM tmp_signals s
    GROUP BY s.confirmation_number, s.property_name
  ) agg;

  IF p_batch_id IS NOT NULL THEN
    UPDATE upload_batches
    SET status = 'completed',
        completed_at = NOW(),
        processed_rows = (SELECT COUNT(*) FROM processed_reservations)
    WHERE id = p_batch_id;
  END IF;
END;
$function$;
