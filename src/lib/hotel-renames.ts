// Hotéis que mudaram de nome. Chave = nome antigo normalizado (lowercase, sem acento).
const HOTEL_RENAMES: Record<string, string> = {
  'ibis styles tres rios': '3 Rios Plaza',
};

const normalize = (value: string): string =>
  value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();

/** Aplica renomeações conhecidas de hotel a qualquer nome vindo de planilha. */
export const applyHotelRename = <T>(value: T): T | string => {
  if (typeof value !== 'string' || !value.trim()) return value;
  const renamed = HOTEL_RENAMES[normalize(value)];
  return renamed ?? value;
};
