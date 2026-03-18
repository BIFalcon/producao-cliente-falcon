
CREATE OR REPLACE FUNCTION public.get_channel_drilldown_multiyear(
  p_channel text,
  p_property text DEFAULT NULL,
  p_month integer DEFAULT NULL
)
RETURNS TABLE(item_name text, departure_year integer, revenue numeric, roomnights numeric, room_revenue numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_allowed text[];
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid());
  RETURN QUERY
  SELECT
    CASE WHEN p_channel IN ('OTA','Operadoras','Empresas','Layover','Grupos')
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
