# Falcon BI Dashboard — Multi-Tenant

Dashboard de BI hoteleiro multi-tenant com isolamento total de dados por cliente.

## Hierarquia de papéis

| Papel | Escopo | Acessos |
|-------|--------|---------|
| `super_admin` | **Global** (sem tenant) | Gerencia todos os tenants e usuários do sistema. Pode alternar tenant ativo no dashboard. |
| `master_admin` | Um tenant fixo | Gerencia usuários, permissões e dados do seu próprio tenant. |
| `editor` | Um tenant fixo | Pode importar dados (Central de Dados) do seu tenant. |
| `viewer` | Um tenant fixo | Apenas visualização do dashboard. |

## Bootstrap do primeiro Super Admin

O `super_admin` **não** é criado pelos fluxos da UI — ele deve ser provisionado manualmente via SQL no banco para evitar privilege escalation.

### Passo a passo

1. **Criar o usuário no Auth** pelo painel administrativo do banco (ou via `auth.admin.createUser` por edge function autorizada). Anote o `user_id` gerado.

2. **Atribuir o papel `super_admin`** rodando o SQL abaixo (substitua o `user_id`):

```sql
-- Atribui super_admin global (tenant_id = NULL)
INSERT INTO public.user_roles (user_id, role, tenant_id)
VALUES ('<user_id>', 'super_admin', NULL);
```

3. **Não crie profile para o super_admin.** Ele opera fora de qualquer tenant. O `tenant_id` em `profiles` e `user_roles` ficam nulos para esse usuário.

4. **Login.** O super_admin faz login normalmente via tela `/auth`. No dashboard verá o seletor de tenant no header e a opção **Tenants** (rota `/tenants`).

### Verificação

```sql
-- Confirma que o usuário é super_admin
SELECT u.email, ur.role, ur.tenant_id
FROM auth.users u
JOIN public.user_roles ur ON ur.user_id = u.id
WHERE ur.role = 'super_admin';
```

## Garantias de segurança

- `super_admin` **não pode ser criado nem promovido** pelas edge functions `manage-users` / `manage-tenants` (bloqueado server-side).
- `super_admin` **não aparece** nas listagens de usuários de nenhum tenant (`get_all_users` filtra).
- RLS nas tabelas tem policies "Super admin full access" que dão bypass apenas para quem é `super_admin` confirmado via `is_super_admin(auth.uid())`.
- `master_admin` continua restrito ao seu próprio tenant via `has_role_in_tenant()`.
