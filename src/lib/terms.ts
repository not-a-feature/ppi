import { text, type Language } from './i18n';

export function termLabel(language: Language, term: string | null | undefined): string {
  if (!term) return text(language, 'Nicht angegeben', 'Not specified');
  if (/^SS\d{4}$/.test(term)) return text(language, 'Sommer ', 'Summer ') + term.slice(4);
  if (/^WS\d{4}\/\d{2}$/.test(term)) return 'Winter ' + term.slice(4);
  return term;
}

export function termOptions(now = new Date()): { value: string; label: string }[] {
  const year = Number(
    new Intl.DateTimeFormat('en', { timeZone: 'Europe/Berlin', year: 'numeric' }).format(now)
  );
  return Array.from({ length: 12 }, (_, offset) => year + 1 - offset).flatMap((start) => [
    {
      value: `WS${start}/${String(start + 1).slice(-2)}`,
      label: `WS${start}/${String(start + 1).slice(-2)}`
    },
    { value: `SS${start}`, label: `SS${start}` }
  ]);
}

export function isValidTerm(value: string, now = new Date()): boolean {
  return termOptions(now).some((term) => term.value === value);
}

export function validateTerm(value: string, now = new Date()): string {
  if (!isValidTerm(value, now)) throw new RangeError('Choose a valid semester.');
  return value;
}
