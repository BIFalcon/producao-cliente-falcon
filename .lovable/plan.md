# Room Nights por quarto + regra de Grupos

## 1. Regra de mapeamento de Grupos (como está hoje)

A tabela de mapeamento do tenant (`channel_mapping`) tem, em cada linha, um **canal** (texto) e um **segmento**. No processamento:

- O canal é normalizado (minúsculo, sem acento) e comparado com o `combined_text` da reserva (Company Name + Travel Agent Name + Source Name + Individual First Name) por "contém".
- Se casar, a reserva recebe o segmento do canal. Quando casa com vários canais, vale o de menor prioridade numérica: Operadora 2 → Layover 3 → Clube de Férias 4 → **Grupos 5** → Outras agências 6 → Empresas 7 → Particular 9.
- Reservas com receita total negativa são ignoradas nesse match quando o segmento seria Empresas ou Grupos.
- O mapeamento roda **depois** de OTA, Operadoras e Layover (regras por palavra-chave) e **antes** de Grupos por tarifa, PM/PF, Empresas e Particular.
- Mapeamento é sempre por tenant — não há cruzamento entre tenants.

Estado atual verificado no banco: cada tenant tem **uma única** linha com segmento GRUPOS, e o canal cadastrado é literalmente a palavra `GRUPOS`. Ou seja, ela só casa se o texto da reserva contiver "grupos" — na prática quem separa Grupos hoje é a regra seguinte: `rate_code_description` contendo `grupo`.

Nada dessa regra será alterado neste plano.

## 2. Room Nights: passar de média para soma por quarto

Confirmado nos dados: quando uma reserva tem vários quartos, ela vem em linhas separadas com o mesmo número de confirmação, cada linha com o **período completo da estadia** (ex.: confirmação 271510371 — 4 linhas, 2 noites cada, receita própria por linha, receita total já somada = R$ 4.183).

Hoje o processamento faz `AVG(number_of_nights)` por reserva, devolvendo 2 em vez de 8. Efeitos:

- Roomnights subestimado em toda reserva multi-quarto.
- ADR inflado (receita somada ÷ roomnights subdimensionado).

### Correção

- Trocar `AVG(number_of_nights)` por `SUM(number_of_nights)` na consolidação por reserva, mantendo o tratamento de linha com 0/nulo noites como 1.
- Nada mais muda: receitas continuam somadas, competência pela data de saída, classificação intocada.
- Reprocessar integralmente os dois tenants para aplicar o novo cálculo à base já existente.
- Validar antes/depois: total de roomnights e ADR por tenant e por canal, confirmando que a **receita total não muda**.

## Detalhes técnicos

- Migração alterando `public.process_reservations(p_tenant_id uuid, p_batch_id uuid)`: em `tmp_reservation_totals`, `AVG(v.number_of_nights)` → `SUM(v.number_of_nights)`.
- Reprocessamento: `select public.process_reservations('<tenant>', NULL)` para cada tenant ativo.
- Sem mudanças em frontend, RLS ou nas funções de agregação (`get_dashboard_kpis`, `get_company_table`, `get_agent_comparison`, `get_channel_*`) — todas já somam `roomnights` e derivam ADR a partir dele.
