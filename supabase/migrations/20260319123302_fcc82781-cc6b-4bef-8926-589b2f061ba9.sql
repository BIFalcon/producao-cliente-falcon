CREATE TABLE IF NOT EXISTS public.user_hotel_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  property_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, property_name)
);

ALTER TABLE public.user_hotel_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Master admins can manage hotel permissions"
  ON public.user_hotel_permissions
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'master_admin'));

CREATE POLICY "Users can view own permissions"
  ON public.user_hotel_permissions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);