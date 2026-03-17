
CREATE OR REPLACE FUNCTION public.process_reservations(p_batch_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
AS $function$
BEGIN
  IF p_batch_id IS NOT NULL THEN
    DELETE FROM public.processed_reservations WHERE id IS NOT NULL;
  END IF;

  INSERT INTO public.processed_reservations (
    property_name, confirmation_number, reservation_date, arrival_date,
    departure_date, travel_agent_name, company_name, city, state, country,
    room_revenue, fb_revenue, total_revenue, lead_time_days, sales_channel,
    departure_month, departure_year
  )
  SELECT
    agg.property_name,
    agg.confirmation_number,
    agg.reservation_date,
    agg.arrival_date,
    agg.departure_date,
    agg.travel_agent_name,
    agg.company_name,
    agg.city,
    agg.state,
    agg.country,
    agg.room_revenue,
    agg.fb_revenue,
    agg.total_revenue,
    agg.lead_time_days,
    CASE
      WHEN agg.unified_source ~ '(booking|expedia|decolar)' THEN 'OTA'
      WHEN agg.unified_source ~ '(trend|ehlt|cvc|europlus|frt|bwt|brt|tbo|foco|masterop|dluna)' THEN 'Operadoras'
      WHEN agg.unified_source ~ 'azul linhas aereas' AND agg.unified_source !~ 'azul viagens' THEN 'Layover'
      WHEN agg.has_company THEN 'Empresas'
      WHEN agg.has_agent OR agg.has_source THEN 'Outros'
      WHEN agg.total_revenue > 0 THEN 'Particular'
      ELSE 'Outros'
    END,
    agg.departure_month,
    agg.departure_year
  FROM (
    SELECT
      r.property_name,
      r.confirmation_number,
      MIN(r.reservation_date) AS reservation_date,
      MIN(r.arrival_date) AS arrival_date,
      MAX(r.departure_date) AS departure_date,
      -- Metadata from operational rows only, prioritizing rows with company
      COALESCE(
        MAX(CASE WHEN LOWER(COALESCE(r.room_type,'')) NOT IN ('pm','pf') AND r.company_name IS NOT NULL AND r.company_name != '' THEN r.travel_agent_name END),
        MAX(CASE WHEN LOWER(COALESCE(r.room_type,'')) NOT IN ('pm','pf') THEN r.travel_agent_name END)
      ) AS travel_agent_name,
      COALESCE(
        MAX(CASE WHEN LOWER(COALESCE(r.room_type,'')) NOT IN ('pm','pf') AND r.company_name IS NOT NULL AND r.company_name != '' THEN r.company_name END),
        MAX(CASE WHEN LOWER(COALESCE(r.room_type,'')) NOT IN ('pm','pf') THEN r.company_name END)
      ) AS company_name,
      COALESCE(
        MAX(CASE WHEN LOWER(COALESCE(r.room_type,'')) NOT IN ('pm','pf') AND r.company_name IS NOT NULL AND r.company_name != '' THEN r.city END),
        MAX(CASE WHEN LOWER(COALESCE(r.room_type,'')) NOT IN ('pm','pf') THEN r.city END)
      ) AS city,
      COALESCE(
        MAX(CASE WHEN LOWER(COALESCE(r.room_type,'')) NOT IN ('pm','pf') AND r.company_name IS NOT NULL AND r.company_name != '' THEN r.state END),
        MAX(CASE WHEN LOWER(COALESCE(r.room_type,'')) NOT IN ('pm','pf') THEN r.state END)
      ) AS state,
      COALESCE(
        MAX(CASE WHEN LOWER(COALESCE(r.room_type,'')) NOT IN ('pm','pf') AND r.company_name IS NOT NULL AND r.company_name != '' THEN r.country END),
        MAX(CASE WHEN LOWER(COALESCE(r.room_type,'')) NOT IN ('pm','pf') THEN r.country END)
      ) AS country,
      -- STEP 1: Revenue from ALL rows (including PM/PF)
      SUM(COALESCE(r.room_revenue, 0)) AS room_revenue,
      SUM(COALESCE(r.fb_revenue, 0)) AS fb_revenue,
      CASE
        WHEN SUM(COALESCE(r.total_revenue, 0)) > 0 THEN SUM(COALESCE(r.total_revenue, 0))
        ELSE SUM(COALESCE(r.room_revenue, 0)) + SUM(COALESCE(r.fb_revenue, 0))
      END AS total_revenue,
      CASE
        WHEN MIN(r.arrival_date) IS NOT NULL AND MIN(r.reservation_date) IS NOT NULL
          THEN (MIN(r.arrival_date) - MIN(r.reservation_date))::INT
        ELSE NULL
      END AS lead_time_days,
      EXTRACT(MONTH FROM MAX(r.departure_date))::INT AS departure_month,
      EXTRACT(YEAR FROM MAX(r.departure_date))::INT AS departure_year,
      -- Unified source from operational rows ONLY
      LOWER(TRIM(
        COALESCE(STRING_AGG(DISTINCT CASE WHEN LOWER(COALESCE(r.room_type,'')) NOT IN ('pm','pf') AND TRIM(COALESCE(r.company_name,'')) != '' THEN TRIM(r.company_name) END, ' '), '')
        || ' ' ||
        COALESCE(STRING_AGG(DISTINCT CASE WHEN LOWER(COALESCE(r.room_type,'')) NOT IN ('pm','pf') AND TRIM(COALESCE(r.travel_agent_name,'')) != '' THEN TRIM(r.travel_agent_name) END, ' '), '')
      )) AS unified_source,
      -- Flags from operational rows only
      BOOL_OR(TRIM(COALESCE(r.company_name,'')) != '' AND LOWER(COALESCE(r.room_type,'')) NOT IN ('pm','pf')) AS has_company,
      BOOL_OR(TRIM(COALESCE(r.travel_agent_name,'')) != '' AND LOWER(COALESCE(r.room_type,'')) NOT IN ('pm','pf')) AS has_agent,
      BOOL_OR(TRIM(COALESCE(r.source_name,'')) != '' AND LOWER(COALESCE(r.room_type,'')) NOT IN ('pm','pf')) AS has_source
    FROM public.raw_reservations r
    WHERE LOWER(r.reservation_status) IN ('checked out', 'checked in', 'no show')
    GROUP BY r.confirmation_number, r.property_name
  ) agg
  ON CONFLICT (confirmation_number, property_name) DO UPDATE SET
    reservation_date = EXCLUDED.reservation_date,
    arrival_date = EXCLUDED.arrival_date,
    departure_date = EXCLUDED.departure_date,
    travel_agent_name = EXCLUDED.travel_agent_name,
    company_name = EXCLUDED.company_name,
    city = EXCLUDED.city,
    state = EXCLUDED.state,
    country = EXCLUDED.country,
    room_revenue = EXCLUDED.room_revenue,
    fb_revenue = EXCLUDED.fb_revenue,
    total_revenue = EXCLUDED.total_revenue,
    lead_time_days = EXCLUDED.lead_time_days,
    sales_channel = EXCLUDED.sales_channel,
    departure_month = EXCLUDED.departure_month,
    departure_year = EXCLUDED.departure_year;
END;
$function$;
