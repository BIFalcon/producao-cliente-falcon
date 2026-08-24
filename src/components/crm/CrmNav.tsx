import React from 'react';
import { Link, useLocation } from 'react-router-dom';

const tabs = [
  { to: '/comercial', label: 'Dashboard' },
  { to: '/comercial/contas', label: 'Contas Comerciais' },
  { to: '/comercial/interacoes', label: 'Interações' },
  { to: '/comercial/tarefas', label: 'Tarefas Futuras' },
];

const CrmNav = () => {
  const { pathname } = useLocation();
  return (
    <div className="inline-flex rounded-md border border-border bg-secondary/40 p-1">
      {tabs.map((t) => {
        const active = pathname === t.to;
        return (
          <Link
            key={t.to}
            to={t.to}
            className={`rounded px-3 py-1.5 text-xs transition-colors ${
              active
                ? 'bg-primary/15 font-semibold text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
};

export default CrmNav;
