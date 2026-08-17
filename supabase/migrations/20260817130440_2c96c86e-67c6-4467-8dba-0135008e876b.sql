-- 1. Company table: add month filter + previous-year roomnights
DROP FUNCTION IF EXISTS public.get_company_table(uuid, text[], integer, integer, text);
CREATE OR REPLACE FUNCTION public.get_company_table(
  p_tenant_id uuid,
  p_property text[] DEFAULT NULL::text[],
  p_current_year integer DEFAULT NULL::integer,
  p_previous_year integer DEFAULT NULL::integer,
  p_channel text DEFAULT NULL::text,
  p_month integer[] DEFAULT NULL::integer[]
)
RETURNS TABLE(company_name text, revenue_current numeric, revenue_previous numeric, absolute_change numeric, pct_change numeric, revenue_share numeric, roomnights_current numeric, roomnights_previous numeric, room_revenue_current numeric, adr_current numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_allowed text[];
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid(), p_tenant_id);
  RETURN QUERY
  WITH current_yr AS (
    SELECT pr.company_name AS cn, SUM(pr.total_revenue) AS rev, SUM(pr.roomnights) AS rn, SUM(pr.room_revenue) AS room_rev,
           SUM(CASE WHEN pr.room_revenue > 0 AND pr.roomnights > 0 AND (pr.room_revenue / pr.roomnights) >= 20 AND (pr.room_revenue / pr.roomnights) <= 2000 THEN pr.room_revenue ELSE 0 END) AS adr_room_rev,
           SUM(CASE WHEN pr.room_revenue > 0 AND pr.roomnights > 0 AND (pr.room_revenue / pr.roomnights) >= 20 AND (pr.room_revenue / pr.roomnights) <= 2000 THEN pr.roomnights ELSE 0 END) AS adr_rn
    FROM public.processed_reservations pr
    WHERE pr.tenant_id = p_tenant_id
      AND pr.company_name IS NOT NULL AND pr.company_name != ''
      AND (p_property IS NULL OR cardinality(p_property) = 0 OR pr.property_name = ANY(p_property))
      AND (p_current_year IS NULL OR pr.departure_year = p_current_year)
      AND (p_month IS NULL OR cardinality(p_month) = 0 OR pr.departure_month = ANY(p_month))
      AND (p_channel IS NULL OR pr.sales_channel = p_channel)
      AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
    GROUP BY pr.company_name
  ),
  previous_yr AS (
    SELECT pr.company_name AS cn, SUM(pr.total_revenue) AS rev, SUM(pr.roomnights) AS rn
    FROM public.processed_reservations pr
    WHERE pr.tenant_id = p_tenant_id
      AND pr.company_name IS NOT NULL AND pr.company_name != ''
      AND (p_property IS NULL OR cardinality(p_property) = 0 OR pr.property_name = ANY(p_property))
      AND (p_previous_year IS NULL OR pr.departure_year = p_previous_year)
      AND (p_month IS NULL OR cardinality(p_month) = 0 OR pr.departure_month = ANY(p_month))
      AND (p_channel IS NULL OR pr.sales_channel = p_channel)
      AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
    GROUP BY pr.company_name
  ),
  grand_total AS (
    SELECT SUM(pr.total_revenue) AS t
    FROM public.processed_reservations pr
    WHERE pr.tenant_id = p_tenant_id
      AND (p_property IS NULL OR cardinality(p_property) = 0 OR pr.property_name = ANY(p_property))
      AND (p_current_year IS NULL OR pr.departure_year = p_current_year)
      AND (p_month IS NULL OR cardinality(p_month) = 0 OR pr.departure_month = ANY(p_month))
      AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
  )
  SELECT COALESCE(c.cn, p.cn), COALESCE(c.rev, 0), COALESCE(p.rev, 0),
    COALESCE(c.rev, 0) - COALESCE(p.rev, 0),
    CASE WHEN COALESCE(p.rev, 0) > 0 THEN ROUND((COALESCE(c.rev, 0) - p.rev) / p.rev * 100, 2) ELSE NULL END,
    CASE WHEN gt.t > 0 THEN ROUND(COALESCE(c.rev, 0) / gt.t * 100, 2) ELSE 0 END,
    COALESCE(c.rn, 0), COALESCE(p.rn, 0), COALESCE(c.room_rev, 0),
    CASE WHEN COALESCE(c.adr_rn, 0) > 0 THEN ROUND(c.adr_room_rev / c.adr_rn, 2) ELSE NULL END
  FROM current_yr c FULL OUTER JOIN previous_yr p ON c.cn = p.cn
  CROSS JOIN grand_total gt
  ORDER BY COALESCE(c.rev, 0) DESC;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_company_table(uuid, text[], integer, integer, text, integer[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_company_table(uuid, text[], integer, integer, text, integer[]) TO authenticated, service_role;

-- 2. Agent comparison: add previous-year roomnights
DROP FUNCTION IF EXISTS public.get_agent_comparison(uuid, text[], integer, integer, integer[]);
CREATE OR REPLACE FUNCTION public.get_agent_comparison(p_tenant_id uuid, p_property text[] DEFAULT NULL::text[], p_current_year integer DEFAULT NULL::integer, p_previous_year integer DEFAULT NULL::integer, p_month integer[] DEFAULT NULL::integer[])
RETURNS TABLE(travel_agent_name text, revenue_current numeric, revenue_previous numeric, absolute_change numeric, pct_change numeric, roomnights_current numeric, roomnights_previous numeric, adr_current numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_allowed text[];
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid(), p_tenant_id);
  RETURN QUERY
  WITH cur AS (
    SELECT pr.travel_agent_name AS ag, SUM(pr.total_revenue) AS rev, SUM(pr.roomnights) AS rn,
           SUM(CASE WHEN pr.room_revenue > 0 AND pr.roomnights > 0 AND (pr.room_revenue / pr.roomnights) >= 20 AND (pr.room_revenue / pr.roomnights) <= 2000 THEN pr.room_revenue ELSE 0 END) AS adr_room_rev,
           SUM(CASE WHEN pr.room_revenue > 0 AND pr.roomnights > 0 AND (pr.room_revenue / pr.roomnights) >= 20 AND (pr.room_revenue / pr.roomnights) <= 2000 THEN pr.roomnights ELSE 0 END) AS adr_rn
    FROM processed_reservations pr
    WHERE pr.tenant_id = p_tenant_id
      AND pr.travel_agent_name IS NOT NULL AND pr.travel_agent_name != ''
      AND (p_property IS NULL OR cardinality(p_property) = 0 OR pr.property_name = ANY(p_property))
      AND (p_current_year IS NULL OR pr.departure_year = p_current_year)
      AND (p_month IS NULL OR cardinality(p_month) = 0 OR pr.departure_month = ANY(p_month))
      AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
    GROUP BY pr.travel_agent_name
  ),
  prev AS (
    SELECT pr.travel_agent_name AS ag, SUM(pr.total_revenue) AS rev, SUM(pr.roomnights) AS rn
    FROM processed_reservations pr
    WHERE pr.tenant_id = p_tenant_id
      AND pr.travel_agent_name IS NOT NULL AND pr.travel_agent_name != ''
      AND (p_property IS NULL OR cardinality(p_property) = 0 OR pr.property_name = ANY(p_property))
      AND (p_previous_year IS NULL OR pr.departure_year = p_previous_year)
      AND (p_month IS NULL OR cardinality(p_month) = 0 OR pr.departure_month = ANY(p_month))
      AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
    GROUP BY pr.travel_agent_name
  )
  SELECT COALESCE(c.ag, p.ag), COALESCE(c.rev, 0), COALESCE(p.rev, 0),
    COALESCE(c.rev, 0) - COALESCE(p.rev, 0),
    CASE WHEN COALESCE(p.rev, 0) > 0 THEN ROUND((COALESCE(c.rev, 0) - p.rev) / p.rev * 100, 2) ELSE NULL END,
    COALESCE(c.rn, 0), COALESCE(p.rn, 0),
    CASE WHEN COALESCE(c.adr_rn, 0) > 0 THEN ROUND(c.adr_room_rev / c.adr_rn, 2) ELSE NULL END
  FROM cur c FULL OUTER JOIN prev p ON c.ag = p.ag
  ORDER BY COALESCE(c.rev, 0) DESC;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_agent_comparison(uuid, text[], integer, integer, integer[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_agent_comparison(uuid, text[], integer, integer, integer[]) TO authenticated, service_role;

-- 3. Agent companies drilldown: add previous-year roomnights
DROP FUNCTION IF EXISTS public.get_agent_companies(uuid, text, text[], integer, integer, integer[]);
CREATE OR REPLACE FUNCTION public.get_agent_companies(p_tenant_id uuid, p_agent text, p_property text[] DEFAULT NULL::text[], p_current_year integer DEFAULT NULL::integer, p_previous_year integer DEFAULT NULL::integer, p_month integer[] DEFAULT NULL::integer[])
RETURNS TABLE(company_name text, revenue_current numeric, revenue_previous numeric, absolute_change numeric, pct_change numeric, roomnights_current numeric, roomnights_previous numeric, adr_current numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_allowed text[];
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid(), p_tenant_id);
  RETURN QUERY
  WITH cur AS (
    SELECT pr.company_name AS co, SUM(pr.total_revenue) AS rev, SUM(pr.roomnights) AS rn,
           SUM(CASE WHEN pr.room_revenue > 0 AND pr.roomnights > 0 AND (pr.room_revenue / pr.roomnights) >= 20 AND (pr.room_revenue / pr.roomnights) <= 2000 THEN pr.room_revenue ELSE 0 END) AS adr_room_rev,
           SUM(CASE WHEN pr.room_revenue > 0 AND pr.roomnights > 0 AND (pr.room_revenue / pr.roomnights) >= 20 AND (pr.room_revenue / pr.roomnights) <= 2000 THEN pr.roomnights ELSE 0 END) AS adr_rn
    FROM processed_reservations pr
    WHERE pr.tenant_id = p_tenant_id AND pr.travel_agent_name = p_agent
      AND pr.company_name IS NOT NULL AND pr.company_name != ''
      AND (p_property IS NULL OR cardinality(p_property) = 0 OR pr.property_name = ANY(p_property))
      AND (p_current_year IS NULL OR pr.departure_year = p_current_year)
      AND (p_month IS NULL OR cardinality(p_month) = 0 OR pr.departure_month = ANY(p_month))
      AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
    GROUP BY pr.company_name
  ),
  prev AS (
    SELECT pr.company_name AS co, SUM(pr.total_revenue) AS rev, SUM(pr.roomnights) AS rn
    FROM processed_reservations pr
    WHERE pr.tenant_id = p_tenant_id AND pr.travel_agent_name = p_agent
      AND pr.company_name IS NOT NULL AND pr.company_name != ''
      AND (p_property IS NULL OR cardinality(p_property) = 0 OR pr.property_name = ANY(p_property))
      AND (p_previous_year IS NULL OR pr.departure_year = p_previous_year)
      AND (p_month IS NULL OR cardinality(p_month) = 0 OR pr.departure_month = ANY(p_month))
      AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
    GROUP BY pr.company_name
  )
  SELECT COALESCE(c.co, p.co), COALESCE(c.rev, 0), COALESCE(p.rev, 0),
    COALESCE(c.rev, 0) - COALESCE(p.rev, 0),
    CASE WHEN COALESCE(p.rev, 0) > 0 THEN ROUND((COALESCE(c.rev, 0) - p.rev) / p.rev * 100, 2) ELSE NULL END,
    COALESCE(c.rn, 0), COALESCE(p.rn, 0),
    CASE WHEN COALESCE(c.adr_rn, 0) > 0 THEN ROUND(c.adr_room_rev / c.adr_rn, 2) ELSE NULL END
  FROM cur c FULL OUTER JOIN prev p ON c.co = p.co
  ORDER BY COALESCE(c.rev, 0) DESC;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_agent_companies(uuid, text, text[], integer, integer, integer[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_agent_companies(uuid, text, text[], integer, integer, integer[]) TO authenticated, service_role;

-- 4. CRM: tarifa acordo
ALTER TABLE public.crm_accounts ADD COLUMN IF NOT EXISTS agreed_rate numeric;