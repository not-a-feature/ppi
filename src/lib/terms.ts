import { t, type Language } from './i18n';

export function termLabel(language: Language, term: string | null | undefined): string {
  if (!term) return t(language, 'Nicht angegeben');
  if (/^SS\d{4}$/.test(term)) return t(language, 'Sommer ') + term.slice(4);
  if (/^WS\d{4}\/\d{2}$/.test(term)) return 'Winter ' + term.slice(4);
  return term;
}

export function termOptions(now = new Date()): { value: string; label: string }[] {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: 'numeric'
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === 'year')!.value);
  const month = Number(parts.find((part) => part.type === 'month')!.value);
  const current = month >= 10 ? year * 2 + 1 : month >= 4 ? year * 2 : (year - 1) * 2 + 1;

  return Array.from({ length: 8 }, (_, index) => current + index - 6).map((semester) => {
    const start = Math.floor(semester / 2);
    const value = semester % 2 === 0 ? `SS${start}` : `WS${start}/${String(start + 1).slice(-2)}`;
    return { value, label: value };
  });
}

export function isValidTerm(value: string, now = new Date(), inheritedTerm?: string): boolean {
  if (inheritedTerm === '' && value === '') return true;
  const term = /^(SS|WS)(\d{4})(?:\/(\d{2}))?$/.exec(value);
  if (
    !term ||
    (term[1] === 'SS' ? term[3] !== undefined : term[3] !== String(Number(term[2]) + 1).slice(-2))
  )
    return false;
  const year = Number(
    new Intl.DateTimeFormat('en', { timeZone: 'Europe/Berlin', year: 'numeric' }).format(now)
  );
  return value === inheritedTerm || (Number(term[2]) >= year - 10 && Number(term[2]) <= year + 1);
}
