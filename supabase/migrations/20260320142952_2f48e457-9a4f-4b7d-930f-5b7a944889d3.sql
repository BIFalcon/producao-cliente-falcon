
CREATE OR REPLACE FUNCTION public.get_channel_drilldown_multiyear(
  p_channel text,
  p_property text DEFAULT NULL,
  p_month integer DEFAULT NULL
)
RETURNS TABLE(item_name text, departure_year integer, revenue numeric, roomnights numeric, room_revenue numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_allowed text[];
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid());
  RETURN QUERY
  SELECT
    CASE WHEN p_channel IN ('Empresas','Layover','Grupos')
         THEN COALESCE(NULLIF(pr.company_name,''), pr.travel_agent_name, 'Sem nome')
         ELSE COALESCE(NULLIF(pr.travel_agent_name,''), pr.company_name, 'Sem nome')
    END AS nm,
    pr.departure_year,
    SUM(pr.total_revenue),
    SUM(pr.roomnights),
    SUM(pr.room_revenue)
  FROM public.processed_reservations pr
  WHERE pr.sales_channel = p_channel
    AND (p_property IS NULL OR pr.property_name = p_property)
    AND (p_month IS NULL OR pr.departure_month = p_month)
    AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
  GROUP BY nm, pr.departure_year
  ORDER BY nm, pr.departure_year;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_channel_drilldown(
  p_channel text,
  p_property text DEFAULT NULL,
  p_current_year integer DEFAULT NULL,
  p_previous_year integer DEFAULT NULL,
  p_month integer DEFAULT NULL
)
RETURNS TABLE(item_name text, revenue_current numeric, revenue_previous numeric, absolute_change numeric, pct_change numeric, roomnights_current numeric, adr_current numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_allowed text[];
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid());
  RETURN QUERY
  WITH cur AS (
    SELECT
      CASE WHEN p_channel IN ('Empresas','Layover','Grupos')
           THEN COALESCE(NULLIF(pr.company_name,''), pr.travel_agent_name, 'Sem nome')
           ELSE COALESCE(NULLIF(pr.travel_agent_name,''), pr.company_name, 'Sem nome')
      END AS nm,
      SUM(pr.total_revenue) AS rev, SUM(pr.roomnights) AS rn, SUM(pr.room_revenue) AS room_rev,
      SUM(CASE WHEN pr.room_revenue > 0 AND pr.roomnights > 0 AND (pr.room_revenue / pr.roomnights) >= 20 AND (pr.room_revenue / pr.roomnights) <= 2000 THEN pr.room_revenue ELSE 0 END) AS adr_room_rev,
      SUM(CASE WHEN pr.room_revenue > 0 AND pr.roomnights > 0 AND (pr.room_revenue / pr.roomnights) >= 20 AND (pr.room_revenue / pr.roomnights) <= 2000 THEN pr.roomnights ELSE 0 END) AS adr_rn
    FROM processed_reservations pr
    WHERE pr.sales_channel = p_channel
      AND (p_property IS NULL OR pr.property_name = p_property)
      AND (p_current_year IS NULL OR pr.departure_year = p_current_year)
      AND (p_month IS NULL OR pr.departure_month = p_month)
      AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
    GROUP BY nm
  ),
  prev AS (
    SELECT
      CASE WHEN p_channel IN ('Empresas','Layover','Grupos')
           THEN COALESCE(NULLIF(pr.company_name,''), pr.travel_agent_name, 'Sem nome')
           ELSE COALESCE(NULLIF(pr.travel_agent_name,''), pr.company_name, 'Sem nome')
      END AS nm,
      SUM(pr.total_revenue) AS rev
    FROM processed_reservations pr
    WHERE pr.sales_channel = p_channel
      AND (p_property IS NULL OR pr.property_name = p_property)
      AND (p_previous_year IS NULL OR pr.departure_year = p_previous_year)
      AND (p_month IS NULL OR pr.departure_month = p_month)
      AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
    GROUP BY nm
  )
  SELECT COALESCE(c.nm, p.nm), COALESCE(c.rev, 0), COALESCE(p.rev, 0),
    COALESCE(c.rev, 0) - COALESCE(p.rev, 0),
    CASE WHEN COALESCE(p.rev, 0) > 0 THEN ROUND((COALESCE(c.rev, 0) - p.rev) / p.rev * 100, 2) ELSE NULL END,
    COALESCE(c.rn, 0),
    CASE WHEN COALESCE(c.adr_rn, 0) > 0 THEN ROUND(c.adr_room_rev / c.adr_rn, 2) ELSE NULL END
  FROM cur c FULL OUTER JOIN prev p ON c.nm = p.nm
  ORDER BY COALESCE(c.rev, 0) DESC;
END;
$$;
