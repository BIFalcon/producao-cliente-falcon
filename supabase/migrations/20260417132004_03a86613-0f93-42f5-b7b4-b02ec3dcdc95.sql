-- 1) Add super_admin to enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'super_admin';
