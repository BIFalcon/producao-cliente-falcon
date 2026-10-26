import { describe, expect, it } from 'vitest';
import { applyHotelRename } from '@/lib/hotel-renames';
import { parseTotvsMatrix } from '@/lib/totvs-parser';

describe('3 Rios hotel aliases', () => {
  it.each(['Hotel Tres Rios Plaza', 'Três Rios Plaza', 'IBIS STYLES TRES RIOS'])('unifies %s with the historical hotel', (name) => {
    expect(applyHotelRename(name)).toBe('3 Rios Plaza');
  });

  it('uses the historical hotel name for new TOTVS uploads', () => {
    const rows = parseTotvsMatrix([
      ['Hotel', 'Status Reserva', 'Número Reserva', 'Total Receita', 'Qtde Pernoites'],
      ['HOTEL TRÊS RIOS PLAZA', 'Checkout', '123', 500, 2],
    ], 0);
    expect(rows[0]?.property_name).toBe('3 Rios Plaza');
    expect(rows[0]?.total_revenue).toBe(500);
  });

  it('leaves other hotels unchanged', () => {
    expect(applyHotelRename('Vitoria Palace Hotel')).toBe('Vitoria Palace Hotel');
  });
});