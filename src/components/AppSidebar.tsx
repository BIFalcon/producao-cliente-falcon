import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { LayoutDashboard, Briefcase, Database, Users, Building2, User, LogOut } from 'lucide-react';
import falconLogo from '@/assets/falcon-logo.png';

interface NavItem {
  to: string;
  label: string;
  icon: React.ElementType;
  visible: boolean;
  matchPrefix?: boolean;
}

const AppSidebar = () => {
  const { signOut, role, isSuperAdmin } = useAuth();
  const { pathname } = useLocation();

  const items: NavItem[] = [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, visible: true },
    { to: '/comercial', label: 'Comercial', icon: Briefcase, visible: true, matchPrefix: true },
    {
      to: '/upload',
      label: 'Central de Dados',
      icon: Database,
      visible: isSuperAdmin || role === 'master_admin' || role === 'editor',
    },
    { to: '/users', label: 'Usuários', icon: Users, visible: isSuperAdmin || role === 'master_admin' },
    { to: '/tenants', label: 'Tenants', icon: Building2, visible: isSuperAdmin },
  ];

  const isActive = (item: NavItem) =>
    item.matchPrefix ? pathname.startsWith(item.to) : pathname === item.to;

  return (
    <aside className="group fixed left-0 top-0 z-[60] flex h-screen w-14 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 ease-out hover:w-56">
      <div className="flex h-14 items-center gap-2 overflow-hidden px-3">
        <img src={falconLogo} alt="Falcon" className="h-7 w-7 shrink-0 object-contain" />
        <span className="whitespace-nowrap text-sm font-semibold text-sidebar-foreground opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          Sistema Falcon
        </span>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-2 py-2">
        {items.filter((i) => i.visible).map((item) => {
          const active = isActive(item);
          return (
            <Link
              key={item.to}
              to={item.to}
              title={item.label}
              className={`flex h-10 items-center gap-3 overflow-hidden rounded-md px-2.5 transition-colors ${
                active
                  ? 'bg-sidebar-primary/15 text-sidebar-primary'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
              }`}
            >
              <item.icon className="h-[18px] w-[18px] shrink-0" />
              <span
                className={`whitespace-nowrap text-sm opacity-0 transition-opacity duration-200 group-hover:opacity-100 ${
                  active ? 'font-semibold' : ''
                }`}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="flex flex-col gap-1 border-t border-sidebar-border px-2 py-2">
        <Link
          to="/profile"
          title="Meu perfil"
          className={`flex h-10 items-center gap-3 overflow-hidden rounded-md px-2.5 transition-colors ${
            pathname === '/profile'
              ? 'bg-sidebar-primary/15 text-sidebar-primary'
              : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
          }`}
        >
          <User className="h-[18px] w-[18px] shrink-0" />
          <span className="whitespace-nowrap text-sm opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            Meu perfil
          </span>
        </Link>
        <button
          type="button"
          onClick={signOut}
          title="Sair"
          className="flex h-10 items-center gap-3 overflow-hidden rounded-md px-2.5 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <LogOut className="h-[18px] w-[18px] shrink-0" />
          <span className="whitespace-nowrap text-sm opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            Sair
          </span>
        </button>
      </div>
    </aside>
  );
};

export default AppSidebar;
