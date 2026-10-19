export const adminAlertEvents = {
  job_failed: 'Job fehlgeschlagen',
  content_reported: 'Inhalt gemeldet',
  system_error: 'Anwendungs- / Workerfehler',
  protocol_uploaded: 'Protokoll hochgeladen'
} as const;
export type AdminAlertType = keyof typeof adminAlertEvents;
export type AdminAlertPreferences = Record<AdminAlertType, boolean>;
