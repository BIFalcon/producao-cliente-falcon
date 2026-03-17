
CREATE OR REPLACE FUNCTION public.process_reservations(p_batch_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Clear existing processed data
  DELETE FROM processed_reservations;

  INSERT INTO processed_reservations (
    confirmation_number,
    property_name,
    company_name,
    travel_agent_name,
    sales_channel,
    room_revenue,
    fb_revenue,
    total_revenue,
    country,
    state,
    city,
    reservation_date,
    arrival_date,
    departure_date,
    departure_month,
    departure_year,
    lead_time_days
  )
  SELECT
    agg.confirmation_number,
    agg.property_name,
    agg.agg_company,
    agg.agg_agent,
    -- Priority classification
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
    agg.departure_month,
    agg.departure_year,
    agg.lead_time_days
  FROM (
    SELECT
      r.confirmation_number,
      r.property_name,
      -- Aggregate revenue from ALL rows
      SUM(COALESCE(r.room_revenue, 0)) AS room_revenue,
      SUM(COALESCE(r.fb_revenue, 0)) AS fb_revenue,
      SUM(COALESCE(r.total_revenue, 0)) AS total_revenue,
      -- Pick first non-null values for dimensions
      MAX(r.country) AS country,
      MAX(r.state) AS state,
      MAX(r.city) AS city,
      MIN(r.reservation_date) AS reservation_date,
      MIN(r.arrival_date) AS arrival_date,
      MAX(r.departure_date) AS departure_date,
      EXTRACT(MONTH FROM MAX(r.departure_date))::int AS departure_month,
      EXTRACT(YEAR FROM MAX(r.departure_date))::int AS departure_year,
      -- Lead time
      CASE
        WHEN MIN(r.reservation_date) IS NOT NULL AND MIN(r.arrival_date) IS NOT NULL
        THEN (MIN(r.arrival_date) - MIN(r.reservation_date))
        ELSE NULL
      END AS lead_time_days,
      -- Aggregated company/agent from operational rows only
      MAX(CASE WHEN COALESCE(r.room_type,'') NOT IN ('PM','PF','PZ') THEN r.company_name END) AS agg_company,
      MAX(CASE WHEN COALESCE(r.room_type,'') NOT IN ('PM','PF','PZ') THEN r.travel_agent_name END) AS agg_agent,
      -- Build unified source from operational rows
      STRING_AGG(
        DISTINCT CASE WHEN COALESCE(r.room_type,'') NOT IN ('PM','PF','PZ') THEN
          LOWER(COALESCE(r.company_name,'') || ' ' || COALESCE(r.travel_agent_name,'') || ' ' || COALESCE(r.source_name,''))
        END, ' '
      ) AS unified_source,
      -- Signal detection on operational rows
      BOOL_OR(
        COALESCE(r.room_type,'') NOT IN ('PM','PF','PZ')
        AND (
          LOWER(COALESCE(r.company_name,'') || ' ' || COALESCE(r.travel_agent_name,'') || ' ' || COALESCE(r.source_name,''))
          ~* '(booking|expedia|decolar)'
        )
      ) AS has_ota,
      BOOL_OR(
        COALESCE(r.room_type,'') NOT IN ('PM','PF','PZ')
        AND (
          LOWER(COALESCE(r.company_name,'') || ' ' || COALESCE(r.travel_agent_name,'') || ' ' || COALESCE(r.source_name,''))
          ~* '(trend|cvc|latam[_ ]travel|gol[_ ]linhas|abreu|flytour|idt[_ ]travel|affinity|oca[_ ]travel|tour[_ ]house|schultz|orinter|visual[_ ]turismo|luck[_ ]viagens|viagens[_ ]promo|sakura|lucky[_ ]travel|shift[_ ]travel|tam[_ ]viagens|newit[_ ]turismo|klas[_ ]turismo)'
        )
      ) AS has_operadora,
      BOOL_OR(
        COALESCE(r.room_type,'') NOT IN ('PM','PF','PZ')
        AND (
          LOWER(COALESCE(r.company_name,'') || ' ' || COALESCE(r.travel_agent_name,'') || ' ' || COALESCE(r.source_name,''))
          ~* 'azul linhas aereas'
        )
        AND NOT (
          LOWER(COALESCE(r.company_name,'') || ' ' || COALESCE(r.travel_agent_name,'') || ' ' || COALESCE(r.source_name,''))
          ~* 'azul viagens'
        )
      ) AS has_layover,
      BOOL_OR(
        COALESCE(r.room_type,'') NOT IN ('PM','PF','PZ')
        AND COALESCE(TRIM(r.travel_agent_name),'') <> ''
      ) AS has_agent,
      BOOL_OR(
        COALESCE(r.room_type,'') NOT IN ('PM','PF','PZ')
        AND COALESCE(TRIM(r.company_name),'') <> ''
      ) AS has_company,
      BOOL_OR(
        COALESCE(r.room_type,'') NOT IN ('PM','PF','PZ')
        AND COALESCE(TRIM(r.source_name),'') <> ''
      ) AS has_source,
      -- Has at least one operational room
      BOOL_OR(COALESCE(r.room_type,'') NOT IN ('PM','PF','PZ')) AS has_operational_room
    FROM raw_reservations r
    WHERE r.confirmation_number IS NOT NULL
      AND r.property_name IS NOT NULL
    GROUP BY r.confirmation_number, r.property_name
  ) agg;

  -- Update batch status if provided
  IF p_batch_id IS NOT NULL THEN
    UPDATE upload_batches
    SET status = 'completed',
        completed_at = NOW(),
        processed_rows = (SELECT COUNT(*) FROM processed_reservations)
    WHERE id = p_batch_id;
  END IF;
END;
$$;
