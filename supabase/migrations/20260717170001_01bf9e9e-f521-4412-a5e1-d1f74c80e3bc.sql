-- Allow users to update their own profile safely (cannot change tenant_id, user_id, or is_active)
CREATE POLICY "Users update own profile safely" ON public.profiles
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (
  auth.uid() = user_id
  AND tenant_id = (SELECT p.tenant_id FROM public.profiles p WHERE p.user_id = auth.uid())
  AND is_active = (SELECT COALESCE(p.is_active, true) FROM public.profiles p WHERE p.user_id = auth.uid())
);

-- Allow authenticated users to insert their own profile row (self-provisioning),
-- restricted to their own user_id. tenant_id assignment is otherwise controlled by admins/triggers.
CREATE POLICY "Users insert own profile" ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);