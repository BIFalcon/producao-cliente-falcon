ALTER TABLE public.raw_reservations ADD COLUMN IF NOT EXISTS room_type text;

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
    r.property_name,
    r.confirmation_number,
    MIN(r.reservation_date),
    MIN(r.arrival_date),
    MAX(r.departure_date),
    COALESCE(
      MAX(CASE WHEN r.company_name IS NOT NULL AND r.company_name != '' THEN r.travel_agent_name END),
      MAX(r.travel_agent_name)
    ),
    COALESCE(
      MAX(CASE WHEN r.company_name IS NOT NULL AND r.company_name != '' THEN r.company_name END),
      MAX(r.company_name)
    ),
    COALESCE(
      MAX(CASE WHEN r.company_name IS NOT NULL AND r.company_name != '' THEN r.city END),
      MAX(r.city)
    ),
    COALESCE(
      MAX(CASE WHEN r.company_name IS NOT NULL AND r.company_name != '' THEN r.state END),
      MAX(r.state)
    ),
    COALESCE(
      MAX(CASE WHEN r.company_name IS NOT NULL AND r.company_name != '' THEN r.country END),
      MAX(r.country)
    ),
    SUM(COALESCE(r.room_revenue, 0)),
    SUM(COALESCE(r.fb_revenue, 0)),
    CASE
      WHEN SUM(COALESCE(r.total_revenue, 0)) > 0 THEN SUM(COALESCE(r.total_revenue, 0))
      ELSE SUM(COALESCE(r.room_revenue, 0)) + SUM(COALESCE(r.fb_revenue, 0))
    END,
    CASE
      WHEN MIN(r.arrival_date) IS NOT NULL AND MIN(r.reservation_date) IS NOT NULL
        THEN (MIN(r.arrival_date) - MIN(r.reservation_date))::INT
      ELSE NULL
    END,
    CASE
      WHEN LOWER(
        COALESCE(MAX(CASE WHEN r.company_name IS NOT NULL AND r.company_name != '' THEN r.company_name END), MAX(r.company_name), '')
        || ' ' ||
        COALESCE(MAX(CASE WHEN r.company_name IS NOT NULL AND r.company_name != '' THEN r.travel_agent_name END), MAX(r.travel_agent_name), '')
      ) ~ '(booking|expedia|decolar)' THEN 'OTA'
      WHEN LOWER(
        COALESCE(MAX(CASE WHEN r.company_name IS NOT NULL AND r.company_name != '' THEN r.company_name END), MAX(r.company_name), '')
        || ' ' ||
        COALESCE(MAX(CASE WHEN r.company_name IS NOT NULL AND r.company_name != '' THEN r.travel_agent_name END), MAX(r.travel_agent_name), '')
      ) ~ '(trend|ehlt|cvc|europlus|frt|bwt|brt|tbo|foco|masterop|dluna)' THEN 'Operadoras'
      WHEN LOWER(
        COALESCE(MAX(CASE WHEN r.company_name IS NOT NULL AND r.company_name != '' THEN r.company_name END), MAX(r.company_name), '')
        || ' ' ||
        COALESCE(MAX(CASE WHEN r.company_name IS NOT NULL AND r.company_name != '' THEN r.travel_agent_name END), MAX(r.travel_agent_name), '')
      ) ~ 'azul linhas aereas'
      AND NOT LOWER(
        COALESCE(MAX(CASE WHEN r.company_name IS NOT NULL AND r.company_name != '' THEN r.company_name END), MAX(r.company_name), '')
        || ' ' ||
        COALESCE(MAX(CASE WHEN r.company_name IS NOT NULL AND r.company_name != '' THEN r.travel_agent_name END), MAX(r.travel_agent_name), '')
      ) ~ 'azul viagens' THEN 'Layover'
      WHEN COALESCE(MAX(CASE WHEN r.company_name IS NOT NULL AND r.company_name != '' THEN r.company_name END), '') != '' THEN 'Empresas'
      WHEN COALESCE(MAX(CASE WHEN r.company_name IS NOT NULL AND r.company_name != '' THEN r.company_name END), MAX(r.company_name), '') = ''
        AND COALESCE(MAX(CASE WHEN r.company_name IS NOT NULL AND r.company_name != '' THEN r.travel_agent_name END), MAX(r.travel_agent_name), '') != ''
        THEN 'Outros'
      WHEN COALESCE(MAX(CASE WHEN r.company_name IS NOT NULL AND r.company_name != '' THEN r.company_name END), MAX(r.company_name), '') = ''
        AND COALESCE(MAX(CASE WHEN r.company_name IS NOT NULL AND r.company_name != '' THEN r.travel_agent_name END), MAX(r.travel_agent_name), '') = ''
        AND (SUM(COALESCE(r.total_revenue, 0)) + SUM(COALESCE(r.room_revenue, 0)) + SUM(COALESCE(r.fb_revenue, 0))) > 0
        THEN 'Particular'
      ELSE 'Outros'
    END,
    EXTRACT(MONTH FROM MAX(r.departure_date))::INT,
    EXTRACT(YEAR FROM MAX(r.departure_date))::INT
  FROM public.raw_reservations r
  WHERE LOWER(r.reservation_status) IN ('checked out', 'checked in', 'no show')
    AND (r.room_type IS NULL OR LOWER(r.room_type) NOT IN ('pm', 'pf'))
  GROUP BY r.confirmation_number, r.property_name
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