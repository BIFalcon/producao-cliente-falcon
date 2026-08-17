# Como funciona a extração e por que a receita de OTA está baixa

## 1. O caminho do dado (Central de Dados → Dashboard)

```text
Planilha (Excel/CSV)
  → leitura no navegador: detecta a linha de cabeçalho (varre as 15 primeiras linhas)
  → mapeia colunas por sinônimos (Property Name/Hotel, Travel Agent, Company, Source, Room Type, Rate Code Description, Individual First Name...)
  → renomeia hotéis (ex.: Ibis Styles Tres Rios → 3 Rios Plaza)
  → grava linha-a-linha em raw_reservations (dado cru, em blocos)
  → process_reservations(tenant, lote) consolida e classifica
  → processed_reservations (base que alimenta todos os KPIs e tabelas)
```

## 2. O que o processamento faz

1. **Filtro de validade**: só entram linhas com hotel e nº de confirmação e com status `Checked Out`, `Checked In` ou `No Show`. Reservas canceladas/`Reserved` são descartadas.
2. **Consolidação por reserva**: várias linhas do mesmo nº de confirmação + hotel viram uma reserva única — receitas somadas (quarto, A&B, total), roomnights pela média das linhas, chegada/saída pelas datas extremas, mês/ano pela data de saída (competência).
3. **Texto combinado**: para classificar, junta em um único texto normalizado (minúsculas, sem acento) `Company Name + Travel Agent Name + Source Name + Individual First Name`. Assim, tanto faz em qual coluna a operadora foi digitada.

## 3. Ordem de prioridade da classificação (a régua atual)

| # | Regra | Critério (no texto combinado) |
|---|---|---|
| 1 | **OTA** | contém `booking`, `expedia` ou `decolar` — vence tudo |
| 2 | **Operadoras** | `e-htl`/`ehtl`/`e htl`, `azul viagens` |
| 3 | **Layover** | `layover`, `azul linhas aereas`, `azul linhas global master` (exceto se for Azul Viagens) |
| 4 | **Tabela de mapeamento do tenant** | canal cadastrado na planilha de mapeamento (Operadora, Layover, Clube de Férias, Grupos, Outras agências, Empresas, Particular) |
| 5 | **Grupos** | descrição da tarifa contém `grupo` |
| 6 | **Empresas** | tem empresa ou agência preenchida (fallback) |
| 7 | **Outras receitas (PM e PF)** | reserva 100% em quartos `pm`/`pf`/`pz` |
| 8 | **Particular** | nada acima (fallback final) |

Há ainda uma trava final que reclassifica qualquer linha marcada como OTA que não contenha de fato booking/expedia/decolar.

## 4. O que está errado hoje (verificado no banco)

A régua está correta — **o problema é que grande parte da base do tenant "Falcon - Demais" nunca foi reprocessada com essa régua**:

- Reservas com `Booking / Expedia / Decolar` na agência, em Falcon - Demais: **154.852 reservas / R$ 48,0M**.
- Dessas, hoje aparecem como **Empresas: 154.108 reservas (R$ 47,8M)** e como **OTA: apenas 744 (R$ 185 mil)**.
- Pela data de processamento: os registros processados em 30/06 (148.184) e 03/08 (5.924) ficaram em Empresas; só o lote de 13/08 (744) saiu como OTA.
- **Causa**: quando o upload é feito no modo "Adicionar Registros", o processamento roda apenas para o lote enviado (`p_batch_id`). Os registros antigos permanecem com a classificação da versão antiga da lógica — a correção de OTA não é aplicada retroativamente.
- O tenant **Falcon - Nordeste** está correto (32.503 reservas / R$ 11,03M em OTA), porque foi reprocessado integralmente em 13/08.

Efeito colateral: além do OTA subestimado, "Empresas" está inflado em ~R$ 47,8M no tenant Demais.

## 5. Correção proposta

1. **Reprocessamento integral do tenant Falcon - Demais** (e de qualquer tenant com divergência), rodando o processamento sobre toda a base crua em vez de um lote só. Nada de dado cru é perdido: `processed_reservations` é reconstruído a partir de `raw_reservations`.
2. **Botão "Reprocessar toda a base"** na Central de Dados (visível para master admin), para que essa correção possa ser feita sem depender de intervenção manual sempre que a régua de classificação mudar.
3. **Verificação pós-correção**: conferir que nenhuma reserva com booking/expedia/decolar sobrou fora de OTA, e reportar os totais novos de OTA e Empresas por tenant.

## 6. Ponto a alinhar com você

Antes de eu ajustar a régua em si, confirme se estas leituras estão corretas:

- OTA = **apenas** Booking, Expedia e Decolar (nenhuma outra OTA, ex.: Airbnb, Hotelbeds, Agoda, Despegar/Decolar variantes?).
- Reservas `No Show` **devem** continuar entrando na receita (hoje entram).
- A receita usada é **Total Revenue** (quarto + A&B + extras), pela **data de saída** (competência). Se para OTA você espera comparar com receita líquida de comissão, isso não existe na planilha — teria que vir em coluna separada.

## Detalhes técnicos

- Função: `public.process_reservations(p_tenant_id uuid, p_batch_id uuid)`.
- Correção de dados: executar `process_reservations(<tenant>, NULL)` (modo full) via migração.
- Novo botão: chamada RPC a partir de `src/pages/UploadPage.tsx`, restrita a master admin/super admin, com diálogo de confirmação e feedback de conclusão.
