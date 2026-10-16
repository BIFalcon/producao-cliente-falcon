import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { readFileSync, existsSync } from 'fs';
import { findTotvsHeaderRow, parseTotvsMatrix, mapTotvsStatus } from '@/lib/totvs-parser';

const H = ['Hotel','Status Reserva','Data Reserva','Valor da Diária','Cliente','Tarifa','Categoria de Tarifa','Segmento','Tipo UH','Origem','Hóspede','Número Reserva','Data Chegada','Data Saída','Cidade','Estado','Qtde Atend ñ Efet','Qtde Reservas','Total Receita','Qtde Pernoites','Receita Efetiva'];
const row = (o: Partial<Record<string, unknown>>) => H.map((h) => o[h] ?? null);

describe('TOTVS parser', () => {
  it('maps statuses to the existing vocabulary', () => {
    expect(mapTotvsStatus('Checkout')).toBe('checked out');
    expect(mapTotvsStatus('No-Show')).toBe('no show');
    expect(mapTotvsStatus('Cancelada')).toBe('cancelled');
    expect(mapTotvsStatus('Checkin')).toBe('in house');
  });

  it('revenue is lodging only and duplicate pair keeps the row with city', () => {
    const base = { Hotel: 'HOTEL X', 'Status Reserva': 'Checkout', Cliente: 'ACME LTDA', Segmento: '0401 - Empresa Nacional', 'Número Reserva': 833, 'Data Chegada': 46148, 'Data Saída': 46150, 'Total Receita': 500, 'Qtde Pernoites': 2 };
    const m = [H, row(base), row({ ...base, Cidade: 'Três Rios', Estado: 'RiodeJaneiro' })];
    const rows = parseTotvsMatrix(m, findTotvsHeaderRow(m));
    expect(rows).toHaveLength(1);
    expect(rows[0].city).toBe('Três Rios');
    expect(rows[0].room_revenue).toBe(500);
    expect(rows[0].fb_revenue).toBe(0);
    expect(rows[0].company_name).toBe('ACME LTDA');
  });

  it('agency segment goes to travel agent; PARTICULAR has no company', () => {
    const m = [H,
      row({ Hotel: 'H', 'Status Reserva': 'Checkout', Cliente: 'DECOLAR. COM LTDA.', Segmento: '0201 - Agência Nacional', 'Número Reserva': 1, 'Total Receita': 1, 'Qtde Pernoites': 1 }),
      row({ Hotel: 'H', 'Status Reserva': 'Checkout', Cliente: 'PARTICULAR', Segmento: '0101 - Particular', 'Número Reserva': 2, 'Total Receita': 1, 'Qtde Pernoites': 1 })];
    const rows = parseTotvsMatrix(m, 0);
    expect(rows[0].travel_agent_name).toBe('DECOLAR. COM LTDA.');
    expect(rows[1].company_name).toBe('');
  });

  const f = '/mnt/user-uploads/Relatorio_produçao_final.xls';
  it.runIf(existsSync(f))('real file parses', () => {
    const wb = XLSX.read(readFileSync(f));
    const m: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });
    const rows = parseTotvsMatrix(m, findTotvsHeaderRow(m));
    console.log('rows', m.length - 1, '->', rows.length);
    expect(rows.length).toBeLessThan(m.length - 1);
  });
});

describe('TOTVS operadora segment', () => {
  it('Operadora segment marks the client as operadora', () => {
    const m = [H, row({ Hotel: 'H', 'Status Reserva': 'Checkout', Cliente: 'CVC', Segmento: '03 - Operadora', 'Número Reserva': 9, 'Total Receita': 1, 'Qtde Pernoites': 1 })];
    const r = parseTotvsMatrix(m, 0)[0];
    expect(r.source_name).toBe('totvs operadora');
    expect(r.travel_agent_name).toBe('CVC');
  });
});
