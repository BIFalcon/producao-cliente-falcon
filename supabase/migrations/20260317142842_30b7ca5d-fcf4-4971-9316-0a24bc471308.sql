
CREATE OR REPLACE FUNCTION public.process_reservations(p_batch_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
    -- Classification using consolidated flags
    CASE
      WHEN LOWER(agg.combined_text) ~ '(booking|expedia|decolar)' THEN 'OTA'
      WHEN LOWER(agg.combined_text) ~ '(trend|ehlt|cvc|europlus|frt|bwt|brt|tbo|foco|masterop|dluna)' THEN 'Operadoras'
      WHEN LOWER(agg.combined_text) ~ 'azul linhas aereas'
        AND NOT LOWER(agg.combined_text) ~ 'azul viagens' THEN 'Layover'
      WHEN agg.has_company THEN 'Empresas'
      WHEN agg.has_agent OR agg.has_source THEN 'Outros'
      WHEN NOT agg.has_company AND NOT agg.has_agent AND NOT agg.has_source
        AND agg.total_revenue > 0 THEN 'Particular'
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
      -- Prioritize metadata from rows where company is filled
      COALESCE(
        MAX(CASE WHEN r.company_name IS NOT NULL AND r.company_name != '' THEN r.travel_agent_name END),
        MAX(r.travel_agent_name)
      ) AS travel_agent_name,
      COALESCE(
        MAX(CASE WHEN r.company_name IS NOT NULL AND r.company_name != '' THEN r.company_name END),
        MAX(r.company_name)
      ) AS company_name,
      COALESCE(
        MAX(CASE WHEN r.company_name IS NOT NULL AND r.company_name != '' THEN r.city END),
        MAX(r.city)
      ) AS city,
      COALESCE(
        MAX(CASE WHEN r.company_name IS NOT NULL AND r.company_name != '' THEN r.state END),
        MAX(r.state)
      ) AS state,
      COALESCE(
        MAX(CASE WHEN r.company_name IS NOT NULL AND r.company_name != '' THEN r.country END),
        MAX(r.country)
      ) AS country,
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
      -- Consolidated flags across ALL rows in the group
      BOOL_OR(r.company_name IS NOT NULL AND r.company_name != '') AS has_company,
      BOOL_OR(r.travel_agent_name IS NOT NULL AND r.travel_agent_name != '') AS has_agent,
      BOOL_OR(r.source_name IS NOT NULL AND r.source_name != '') AS has_source,
      -- Combined text for keyword matching (from ALL rows)
      STRING_AGG(DISTINCT LOWER(COALESCE(r.company_name, '')), ' ') || ' ' ||
      STRING_AGG(DISTINCT LOWER(COALESCE(r.travel_agent_name, '')), ' ') AS combined_text
    FROM public.raw_reservations r
    WHERE LOWER(r.reservation_status) IN ('checked out', 'checked in', 'no show')
      AND (r.room_type IS NULL OR LOWER(r.room_type) NOT IN ('pm', 'pf'))
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
