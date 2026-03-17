export const formatRevenue = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return 'R$ 0';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000) {
    return `${sign}R$ ${(abs / 1_000_000).toFixed(2).replace('.', ',')}M`;
  }
  if (abs >= 1_000) {
    return `${sign}R$ ${(abs / 1_000).toFixed(0)} mil`;
  }
  return `${sign}R$ ${abs.toFixed(0)}`;
};

export const formatRevenueTable = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return '0';
  return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
};

export const formatPercent = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
};

export const formatNumber = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return '0';
  return new Intl.NumberFormat('pt-BR').format(value);
};

export const MONTH_NAMES = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'
];

export const MONTH_NAMES_FULL = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

const PT_SPECIAL: Record<string, string> = {
  'sao': 'São', 'santo': 'Santo', 'santa': 'Santa',
  'rio': 'Rio', 'belo': 'Belo', 'porto': 'Porto',
  'campo': 'Campo', 'campos': 'Campos', 'vila': 'Vila',
  'do': 'do', 'da': 'da', 'dos': 'dos', 'das': 'das',
  'de': 'de', 'e': 'e', 'em': 'em', 'no': 'no', 'na': 'na',
};

export const toTitleCase = (text: string | null | undefined): string => {
  if (!text) return '—';
  return text
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((word, index) => {
      if (PT_SPECIAL[word] && index > 0) return PT_SPECIAL[word];
      if (PT_SPECIAL[word] && index === 0) {
        // First word always capitalized
        return word.charAt(0).toUpperCase() + word.slice(1);
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
};
