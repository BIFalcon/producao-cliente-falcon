CREATE OR REPLACE FUNCTION public.get_dashboard_kpis_competencia(p_tenant_id uuid, p_property text[] DEFAULT NULL, p_year integer DEFAULT NULL, p_channel text DEFAULT NULL, p_month integer[] DEFAULT NULL)
RETURNS TABLE(total_revenue numeric, total_roomnights numeric, room_revenue numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_allowed text[];
BEGIN
  IF NOT (public.is_super_admin(auth.uid()) OR public.get_current_tenant_id() = p_tenant_id) THEN RETURN; END IF;
  v_allowed := public.get_allowed_properties(auth.uid(), p_tenant_id);
  RETURN QUERY
  SELECT SUM(n.total_revenue_alloc), SUM(n.nights_in_month), SUM(n.room_revenue_alloc)
  FROM public.reservation_nights_by_month n
  WHERE n.tenant_id = p_tenant_id
    AND (p_property IS NULL OR cardinality(p_property) = 0 OR n.property_name = ANY(p_property))
    AND (p_year IS NULL OR n.ref_year = p_year)
    AND (p_month IS NULL OR cardinality(p_month) = 0 OR n.ref_month = ANY(p_month))
    AND (p_channel IS NULL OR n.sales_channel = p_channel)
    AND (v_allowed IS NULL OR n.property_name = ANY(v_allowed));
END;
$$;
REVOKE ALL ON FUNCTION public.get_dashboard_kpis_competencia(uuid, text[], integer, text, integer[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_kpis_competencia(uuid, text[], integer, text, integer[]) TO authenticated;