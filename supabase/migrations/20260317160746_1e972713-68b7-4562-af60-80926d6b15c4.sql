
-- Debug function: get Particular classification diagnostics
CREATE OR REPLACE FUNCTION public.get_particular_debug(
  p_property text DEFAULT NULL,
  p_year integer DEFAULT NULL,
  p_month integer DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result json;
BEGIN
  WITH particular_reservations AS (
    SELECT
      pr.confirmation_number,
      pr.property_name,
      pr.company_name,
      pr.travel_agent_name,
      pr.total_revenue,
      pr.sales_channel,
      pr.departure_year,
      pr.departure_month
    FROM processed_reservations pr
    WHERE pr.sales_channel = 'Particular'
      AND (p_property IS NULL OR pr.property_name = p_property)
      AND (p_year IS NULL OR pr.departure_year = p_year)
      AND (p_month IS NULL OR pr.departure_month = p_month)
  ),
  -- Get raw data for these reservations to check source_name and room_type
  raw_info AS (
    SELECT
      rr.confirmation_number,
      rr.property_name,
      STRING_AGG(DISTINCT NULLIF(TRIM(rr.source_name), ''), ', ') AS source_names,
      STRING_AGG(DISTINCT NULLIF(TRIM(rr.room_type), ''), ', ') AS room_types
    FROM raw_reservations rr
    INNER JOIN particular_reservations p
      ON rr.confirmation_number = p.confirmation_number
      AND rr.property_name = p.property_name
    GROUP BY rr.confirmation_number, rr.property_name
  ),
  -- Summary stats
  summary AS (
    SELECT
      COUNT(*) AS total_reservations,
      COALESCE(SUM(total_revenue), 0) AS total_revenue,
      COUNT(*) FILTER (WHERE company_name IS NOT NULL AND TRIM(company_name) <> '') AS with_company,
      COUNT(*) FILTER (WHERE travel_agent_name IS NOT NULL AND TRIM(travel_agent_name) <> '') AS with_agent
    FROM particular_reservations
  ),
  raw_summary AS (
    SELECT
      COUNT(*) FILTER (WHERE source_names IS NOT NULL) AS with_source
    FROM raw_info
  ),
  -- Check mixed classification: reservations where some rows are Particular but others are not
  mixed_check AS (
    SELECT COUNT(DISTINCT pr.confirmation_number || '|' || pr.property_name) AS mixed_count
    FROM processed_reservations pr
    WHERE pr.sales_channel <> 'Particular'
      AND (p_property IS NULL OR pr.property_name = p_property)
      AND (p_year IS NULL OR pr.departure_year = p_year)
      AND (p_month IS NULL OR pr.departure_month = p_month)
      AND EXISTS (
        SELECT 1 FROM particular_reservations pp
        WHERE pp.confirmation_number = pr.confirmation_number
          AND pp.property_name = pr.property_name
      )
  ),
  -- Sample of 20
  sample AS (
    SELECT json_agg(row_to_json(s)) AS rows
    FROM (
      SELECT
        p.confirmation_number,
        p.property_name,
        p.company_name,
        p.travel_agent_name,
        ri.source_names AS source_name,
        ri.room_types AS room_type,
        p.total_revenue
      FROM particular_reservations p
      LEFT JOIN raw_info ri
        ON p.confirmation_number = ri.confirmation_number
        AND p.property_name = ri.property_name
      ORDER BY p.total_revenue DESC NULLS LAST
      LIMIT 20
    ) s
  )
  SELECT json_build_object(
    'total_reservations', (SELECT total_reservations FROM summary),
    'total_revenue', (SELECT total_revenue FROM summary),
    'with_company', (SELECT with_company FROM summary),
    'with_agent', (SELECT with_agent FROM summary),
    'with_source', (SELECT with_source FROM raw_summary),
    'mixed_classification_count', (SELECT mixed_count FROM mixed_check),
    'pure_particular_count', (SELECT total_reservations FROM summary) - (SELECT mixed_count FROM mixed_check),
    'sample', COALESCE((SELECT rows FROM sample), '[]'::json)
  ) INTO result;

  RETURN result;
END;
$$;
