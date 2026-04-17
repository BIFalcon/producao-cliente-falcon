import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

type AppRole = 'super_admin' | 'master_admin' | 'editor' | 'viewer';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  role: AppRole | null;
  /** tenant_id from the user's own profile (null for super_admin) */
  profileTenantId: string | null;
  /** Effective tenant the app is operating on (super_admin can switch via setActiveTenantId) */
  tenantId: string | null;
  isSuperAdmin: boolean;
  setActiveTenantId: (tenantId: string | null) => void;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [profileTenantId, setProfileTenantId] = useState<string | null>(null);
  const [activeTenantId, setActiveTenantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchRoleAndTenant = async (userId: string) => {
    const [{ data: roleData }, { data: profileData }] = await Promise.all([
      supabase.from('user_roles').select('role').eq('user_id', userId).order('role', { ascending: true }).limit(1).maybeSingle(),
      supabase.from('profiles').select('tenant_id').eq('user_id', userId).maybeSingle(),
    ]);
    // Prefer super_admin role if present
    const { data: superCheck } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('role', 'super_admin')
      .maybeSingle();

    const effectiveRole = (superCheck?.role || roleData?.role || null) as AppRole | null;
    setRole(effectiveRole);
    setProfileTenantId(profileData?.tenant_id || null);
    // For non-super_admin, active tenant equals profile tenant
    if (effectiveRole !== 'super_admin') {
      setActiveTenantId(profileData?.tenant_id || null);
    }
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        setTimeout(() => fetchRoleAndTenant(session.user.id), 0);
      } else {
        setRole(null);
        setProfileTenantId(null);
        setActiveTenantId(null);
      }
      setLoading(false);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchRoleAndTenant(session.user.id);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const signUp = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const isSuperAdmin = role === 'super_admin';
  const tenantId = isSuperAdmin ? activeTenantId : profileTenantId;

  return (
    <AuthContext.Provider value={{
      user, session, role, profileTenantId, tenantId, isSuperAdmin,
      setActiveTenantId, loading, signIn, signUp, signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
