ALTER FUNCTION public.process_reservations(uuid, uuid) SET statement_timeout = '600s';
ALTER FUNCTION public.process_reservations(uuid, uuid) SET search_path = public;

CREATE INDEX IF NOT EXISTS idx_raw_reservations_tenant_batch ON public.raw_reservations (tenant_id, upload_batch_id);
CREATE INDEX IF NOT EXISTS idx_processed_reservations_tenant_cn_pn ON public.processed_reservations (tenant_id, confirmation_number, property_name);