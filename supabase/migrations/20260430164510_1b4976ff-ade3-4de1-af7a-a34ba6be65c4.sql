-- 1) Indexes to accelerate RLS lookups (the real source of IO)
-- has_role / has_role_in_tenant / is_super_admin all filter by (user_id, role[, tenant_id])
CREATE INDEX IF NOT EXISTS idx_user_roles_user_role_tenant
  ON public.user_roles (user_id, role, tenant_id);

-- get_current_tenant_id filters profiles by user_id (already has profiles_user_id_key UNIQUE)
-- but ensure a covering lookup including tenant_id
CREATE INDEX IF NOT EXISTS idx_profiles_user_tenant
  ON public.profiles (user_id) INCLUDE (tenant_id);

-- get_allowed_properties filters user_hotel_permissions by (user_id, tenant_id)
CREATE INDEX IF NOT EXISTS idx_uhp_user_tenant_prop
  ON public.user_hotel_permissions (user_id, tenant_id) INCLUDE (property_name);

-- 2) Drop unused / duplicate indexes (idx_scan = 0, all redundant with PK or composite indexes)
DROP INDEX IF EXISTS public.idx_channel_mapping_tenant_id;
DROP INDEX IF EXISTS public.idx_channel_mapping_tenant_canal;
DROP INDEX IF EXISTS public.idx_user_hotel_permissions_user_tenant;
DROP INDEX IF EXISTS public.idx_user_hotel_permissions_tenant;
DROP INDEX IF EXISTS public.idx_user_roles_tenant;
DROP INDEX IF EXISTS public.idx_profiles_tenant;
DROP INDEX IF EXISTS public.idx_upload_batches_tenant;
DROP INDEX IF EXISTS public.idx_upload_batches_tenant_status;
DROP INDEX IF EXISTS public.idx_upload_batches_tenant_created;
DROP INDEX IF EXISTS public.idx_processed_reservations_tenant_channel;
DROP INDEX IF EXISTS public.idx_processed_reservations_tenant_year_month;
DROP INDEX IF EXISTS public.idx_processed_reservations_tenant_dep_date;
DROP INDEX IF EXISTS public.idx_processed_reservations_tenant_id;
DROP INDEX IF EXISTS public.idx_processed_reservations_tenant_property;
DROP INDEX IF EXISTS public.idx_processed_reservations_tenant_arr_date;
DROP INDEX IF EXISTS public.idx_raw_reservations_tenant_status;
DROP INDEX IF EXISTS public.idx_raw_reservations_tenant_property;
DROP INDEX IF EXISTS public.idx_raw_reservations_batch;
DROP INDEX IF EXISTS public.idx_raw_reservations_conf_prop;
DROP INDEX IF EXISTS public.idx_raw_res_batch;
DROP INDEX IF EXISTS public.idx_raw_reservations_tenant_id;

-- 3) Refresh planner stats
ANALYZE public.user_roles;
ANALYZE public.profiles;
ANALYZE public.user_hotel_permissions;
ANALYZE public.processed_reservations;
ANALYZE public.raw_reservations;