CREATE OR REPLACE FUNCTION public.insert_raw_reservations_batch(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
AS $$
DECLARE
  v_inserted integer := 0;
BEGIN
  INSERT INTO public.raw_reservations (
    tenant_id,
    property_name,
    reservation_status,
    confirmation_number,
    reservation_date,
    arrival_date,
    arrival_time,
    departure_date,
    departure_time,
    number_of_nights,
    travel_agent_name,
    company_name,
    city,
    state,
    country,
    room_revenue,
    fb_revenue,
    total_revenue,
    room_type,
    source_name,
    individual_first_name,
    rate_code,
    rate_code_description,
    upload_batch_id
  )
  SELECT
    tenant_id,
    property_name,
    reservation_status,
    confirmation_number,
    reservation_date,
    arrival_date,
    arrival_time,
    departure_date,
    departure_time,
    number_of_nights,
    travel_agent_name,
    company_name,
    city,
    state,
    country,
    room_revenue,
    fb_revenue,
    total_revenue,
    room_type,
    source_name,
    individual_first_name,
    rate_code,
    rate_code_description,
    upload_batch_id
  FROM jsonb_to_recordset(p_rows) AS x(
    tenant_id uuid,
    property_name text,
    reservation_status text,
    confirmation_number text,
    reservation_date date,
    arrival_date date,
    arrival_time time,
    departure_date date,
    departure_time time,
    number_of_nights numeric,
    travel_agent_name text,
    company_name text,
    city text,
    state text,
    country text,
    room_revenue numeric,
    fb_revenue numeric,
    total_revenue numeric,
    room_type text,
    source_name text,
    individual_first_name text,
    rate_code text,
    rate_code_description text,
    upload_batch_id uuid
  );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;