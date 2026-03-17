CREATE OR REPLACE FUNCTION public.get_concentration_metrics(p_property text DEFAULT NULL::text, p_year integer DEFAULT NULL::integer, p_channel text DEFAULT NULL::text)
 RETURNS TABLE(top1_share numeric, top3_share numeric, top5_share numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH ranked AS (
    SELECT
      pr.company_name,
      SUM(pr.total_revenue) AS rev,
      ROW_NUMBER() OVER (ORDER BY SUM(pr.total_revenue) DESC) AS rn
    FROM public.processed_reservations pr
    WHERE pr.company_name IS NOT NULL AND pr.company_name != ''
      AND (p_property IS NULL OR pr.property_name = p_property)
      AND (p_year IS NULL OR pr.departure_year = p_year)
      AND (p_channel IS NULL OR pr.sales_channel = p_channel)
    GROUP BY pr.company_name
  ),
  total AS (SELECT SUM(rev) AS t FROM ranked)
  SELECT
    ROUND(COALESCE(SUM(CASE WHEN r.rn <= 1 THEN r.rev END), 0) / NULLIF(MAX(t.t), 0) * 100, 2),
    ROUND(COALESCE(SUM(CASE WHEN r.rn <= 3 THEN r.rev END), 0) / NULLIF(MAX(t.t), 0) * 100, 2),
    ROUND(COALESCE(SUM(CASE WHEN r.rn <= 5 THEN r.rev END), 0) / NULLIF(MAX(t.t), 0) * 100, 2)
  FROM ranked r
  CROSS JOIN total t;
END;
$function$;