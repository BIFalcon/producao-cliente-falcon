-- Performance indexes for large dataset uploads (500k+ rows)

-- raw_reservations: speed up tenant-scoped deletes/inserts and status filtering
CREATE INDEX IF NOT EXISTS idx_raw_reservations_tenant_id ON public.raw_reservations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_raw_reservations_tenant_status ON public.raw_reservations(tenant_id, reservation_status);
CREATE INDEX IF NOT EXISTS idx_raw_reservations_tenant_property ON public.raw_reservations(tenant_id, property_name);
CREATE INDEX IF NOT EXISTS idx_raw_reservations_batch ON public.raw_reservations(upload_batch_id);
CREATE INDEX IF NOT EXISTS idx_raw_reservations_conf_prop ON public.raw_reservations(confirmation_number, property_name);

-- processed_reservations: dashboard and tenant-scoped queries
CREATE INDEX IF NOT EXISTS idx_processed_reservations_tenant_id ON public.processed_reservations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_processed_reservations_tenant_property ON public.processed_reservations(tenant_id, property_name);
CREATE INDEX IF NOT EXISTS idx_processed_reservations_tenant_channel ON public.processed_reservations(tenant_id, sales_channel);
CREATE INDEX IF NOT EXISTS idx_processed_reservations_tenant_year_month ON public.processed_reservations(tenant_id, departure_year, departure_month);
CREATE INDEX IF NOT EXISTS idx_processed_reservations_tenant_dep_date ON public.processed_reservations(tenant_id, departure_date);
CREATE INDEX IF NOT EXISTS idx_processed_reservations_tenant_arr_date ON public.processed_reservations(tenant_id, arrival_date);

-- channel_mapping: fast lookup per tenant
CREATE INDEX IF NOT EXISTS idx_channel_mapping_tenant_id ON public.channel_mapping(tenant_id);
CREATE INDEX IF NOT EXISTS idx_channel_mapping_tenant_canal ON public.channel_mapping(tenant_id, canal);

-- upload_batches: status/history listing
CREATE INDEX IF NOT EXISTS idx_upload_batches_tenant_status ON public.upload_batches(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_upload_batches_tenant_created ON public.upload_batches(tenant_id, created_at DESC);

-- user_hotel_permissions: quick allowed-properties resolution
CREATE INDEX IF NOT EXISTS idx_user_hotel_permissions_user_tenant ON public.user_hotel_permissions(user_id, tenant_id);

-- ANALYZE so the planner picks up the new indexes
ANALYZE public.raw_reservations;
ANALYZE public.processed_reservations;
ANALYZE public.channel_mapping;
ANALYZE public.upload_batches;