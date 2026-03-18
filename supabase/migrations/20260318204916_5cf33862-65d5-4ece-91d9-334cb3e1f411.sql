
-- Fix get_company_table: use total revenue of ALL channels as denominator for share %
CREATE OR REPLACE FUNCTION public.get_company_table(
  p_property text DEFAULT NULL,
  p_current_year integer DEFAULT NULL,
  p_previous_year integer DEFAULT NULL,
  p_channel text DEFAULT NULL
)
RETURNS TABLE(
  company_name text,
  revenue_current numeric,
  revenue_previous numeric,
  absolute_change numeric,
  pct_change numeric,
  revenue_share numeric,
  roomnights_current numeric,
  room_revenue_current numeric,
  adr_current numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_allowed text[];
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid());
  RETURN QUERY
  WITH current_yr AS (
    SELECT pr.company_name AS cn, SUM(pr.total_revenue) AS rev,
           SUM(pr.roomnights) AS rn, SUM(pr.room_revenue) AS room_rev
    FROM public.processed_reservations pr
    WHERE pr.company_name IS NOT NULL AND pr.company_name != ''
      AND (p_property IS NULL OR pr.property_name = p_property)
      AND (p_current_year IS NULL OR pr.departure_year = p_current_year)
      AND (p_channel IS NULL OR pr.sales_channel = p_channel)
      AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
    GROUP BY pr.company_name
  ),
  previous_yr AS (
    SELECT pr.company_name AS cn, SUM(pr.total_revenue) AS rev
    FROM public.processed_reservations pr
    WHERE pr.company_name IS NOT NULL AND pr.company_name != ''
      AND (p_property IS NULL OR pr.property_name = p_property)
      AND (p_previous_year IS NULL OR pr.departure_year = p_previous_year)
      AND (p_channel IS NULL OR pr.sales_channel = p_channel)
      AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
    GROUP BY pr.company_name
  ),
  -- Total revenue across ALL channels for the selected period
  grand_total AS (
    SELECT SUM(pr.total_revenue) AS t
    FROM public.processed_reservations pr
    WHERE (p_property IS NULL OR pr.property_name = p_property)
      AND (p_current_year IS NULL OR pr.departure_year = p_current_year)
      AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
  )
  SELECT COALESCE(c.cn, p.cn), COALESCE(c.rev, 0), COALESCE(p.rev, 0),
    COALESCE(c.rev, 0) - COALESCE(p.rev, 0),
    CASE WHEN COALESCE(p.rev, 0) > 0 THEN ROUND((COALESCE(c.rev, 0) - p.rev) / p.rev * 100, 2) ELSE NULL END,
    CASE WHEN gt.t > 0 THEN ROUND(COALESCE(c.rev, 0) / gt.t * 100, 2) ELSE 0 END,
    COALESCE(c.rn, 0), COALESCE(c.room_rev, 0),
    CASE WHEN COALESCE(c.rn, 0) > 0 THEN ROUND(COALESCE(c.room_rev, 0) / c.rn, 2) ELSE 0 END
  FROM current_yr c FULL OUTER JOIN previous_yr p ON c.cn = p.cn
  CROSS JOIN grand_total gt
  ORDER BY COALESCE(c.rev, 0) DESC;
END;
$$;

-- Fix get_concentration_metrics: use total revenue of ALL channels as denominator
CREATE OR REPLACE FUNCTION public.get_concentration_metrics(
  p_property text DEFAULT NULL,
  p_year integer DEFAULT NULL,
  p_channel text DEFAULT NULL
)
RETURNS TABLE(
  top1_share numeric,
  top3_share numeric,
  top5_share numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_allowed text[];
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid());
  RETURN QUERY
  WITH ranked AS (
    SELECT pr.company_name, SUM(pr.total_revenue) AS rev,
      ROW_NUMBER() OVER (ORDER BY SUM(pr.total_revenue) DESC) AS rn
    FROM public.processed_reservations pr
    WHERE pr.company_name IS NOT NULL AND pr.company_name != ''
      AND (p_property IS NULL OR pr.property_name = p_property)
      AND (p_year IS NULL OR pr.departure_year = p_year)
      AND (p_channel IS NULL OR pr.sales_channel = p_channel)
      AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
    GROUP BY pr.company_name
  ),
  -- Total revenue across ALL channels for the selected period
  grand_total AS (
    SELECT SUM(pr.total_revenue) AS t
    FROM public.processed_reservations pr
    WHERE (p_property IS NULL OR pr.property_name = p_property)
      AND (p_year IS NULL OR pr.departure_year = p_year)
      AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
  )
  SELECT
    ROUND(COALESCE(SUM(CASE WHEN r.rn <= 1 THEN r.rev END), 0) / NULLIF(MAX(gt.t), 0) * 100, 2),
    ROUND(COALESCE(SUM(CASE WHEN r.rn <= 3 THEN r.rev END), 0) / NULLIF(MAX(gt.t), 0) * 100, 2),
    ROUND(COALESCE(SUM(CASE WHEN r.rn <= 5 THEN r.rev END), 0) / NULLIF(MAX(gt.t), 0) * 100, 2)
  FROM ranked r CROSS JOIN grand_total gt;
END;
$$;
