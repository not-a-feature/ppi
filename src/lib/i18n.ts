import german from './locales/de.json';
import english from './locales/en.json';

export type Language = 'de' | 'en';
export type Theme = 'light' | 'dark' | 'auto';
export type MessageKey = keyof typeof german;
export const messages: Record<MessageKey, string> = english;
const translations = { de: german, en: messages };
const germanFeedback = new Map<string, string>();
for (const [key, message] of Object.entries(messages)) {
  if (!germanFeedback.has(message)) germanFeedback.set(message, german[key as MessageKey]);
}

export function t(
  language: Language,
  key: MessageKey,
  values: Record<string, string | number> = {}
): string {
  return translations[language][key].replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : placeholder
  );
}
export function protocolCountLabel(language: Language, count: number | string): string {
  return t(language, Number(count) === 1 ? 'protocolCount.one' : 'Protokolle');
}
const statuses: Record<string, MessageKey> = {
  open: 'Offen',
  resolved: 'Abgeschlossen',
  blocked: 'Datei gesperrt',
  created: 'Eingereiht',
  retry: 'Wiederholung ausstehend',
  completed: 'Abgeschlossen',
  queued: 'Wartet auf Verarbeitung',
  processing: 'In Verarbeitung',
  running: 'In Verarbeitung',
  awaiting_review: 'Bereit zur Prüfung',
  pending: 'Offen',
  accepted: 'Angenommen',
  published: 'Veröffentlicht',
  rejected: 'Abgelehnt',
  changes_requested: 'Überarbeitung erbeten',
  withdrawn: 'Zurückgezogen',
  unpublished: 'Unveröffentlicht',
  safe: 'Datei geprüft',
  unsafe: 'Datei gesperrt',
  failed: 'Verarbeitung fehlgeschlagen',
  succeeded: 'Abgeschlossen',
  cancelled: 'Abgebrochen',
  active: 'Aktiv',
  suspended: 'Gesperrt',
  unverified: 'E-Mail unbestätigt',
  deletion_pending: 'Löschung beantragt',
  deleted: 'Gelöschtes Konto',
  clean: 'Datei geprüft',
  manual_review: 'Manuelle Prüfung',
  granted: 'Angenommen',
  denied: 'Abgelehnt',
  ready: 'Archiv ist bereit',
  invalidated: 'Archiv ist nicht mehr verfügbar'
};
export function statusLabel(language: Language, value: string): string {
  return Object.hasOwn(statuses, value) ? t(language, statuses[value]) : value;
}
const entries: Record<string, MessageKey> = {
  activation: 'Startguthaben',
  contribution: 'Beitragsbelohnung',
  bonus: 'Zusätzliche Belohnung',
  purchase: 'Veranstaltungszugang',
  periodic_grant: 'Regelmäßige Gutschrift',
  manual_adjustment: 'Manuelle Anpassung',
  reversal: 'Korrektur',
  legacy_opening: 'Übernommenes Guthaben',
  token_request: 'Tokenanfrage'
};
export function entryLabel(language: Language, kind: string): string {
  return Object.hasOwn(entries, kind) ? t(language, entries[kind]) : kind;
}
export function dateText(language: Language, value: string | Date, withTime = false): string {
  const date = new Date(value),
    locale = language === 'en' ? 'en-GB' : 'de-DE';
  return withTime
    ? date.toLocaleString(locale, { timeZone: 'Europe/Berlin' })
    : date.toLocaleDateString(locale, { timeZone: 'Europe/Berlin' });
}
export function feedbackText(language: Language, message: string): string {
  if (message.startsWith('Periodic grant '))
    return t(language, 'Regelmäßige Gutschrift ') + message.slice('Periodic grant '.length);
  if (message.startsWith('Technical checks passed. '))
    return (
      t(language, 'Technische Prüfungen bestanden. ') +
      message.slice('Technical checks passed. '.length)
    );
  if (Object.hasOwn(messages, message)) return t(language, message as MessageKey);
  return language === 'de' ? (germanFeedback.get(message) ?? message) : message;
}
const categories: Record<string, MessageKey> = {
  metadata: 'Metadaten',
  inappropriate: 'Unangemessener Inhalt',
  unavailable: 'Nicht erreichbar',
  other: 'Sonstiges'
};
export function categoryLabel(language: Language, category: string): string {
  return Object.hasOwn(categories, category) ? t(language, categories[category]) : category;
}
const queues: Record<string, MessageKey> = {
  file_check: 'Dateiprüfung',
  content_check: 'Inhaltsprüfung',
  pdf_ocr: 'PDF-Texterkennung',
  notification: 'Benachrichtigungen',
  periodic_grant: 'Tokengutschrift',
  prepare_archive: 'ZIP-Datei vorbereiten',
  delete_files: 'Dateien löschen',
  account_cleanup: 'Alte Konten löschen'
};
export function queueLabel(language: Language, name: string): string {
  return Object.hasOwn(queues, name) ? t(language, queues[name]) : name;
}
