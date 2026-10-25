import { error, fail, redirect } from '@sveltejs/kit';
import { DomainError } from '#lib/server/domain/index.js';
import type { Actor } from '#lib/server/domain/index.js';
export function actor(locals: App.Locals): Actor {
  if (!locals.actor) redirect(303, '/login');
  return locals.actor;
}
export function admin(locals: App.Locals): Actor {
  const current = actor(locals);
  if (!current.isAdmin) error(403, 'Administratorrechte erforderlich.');
  return current;
}
export const field = (form: FormData, key: string) => String(form.get(key) ?? '').trim();
const errors: Record<string, string> = {
  stale_metadata: 'Die Metadaten wurden inzwischen geändert. Bitte die Seite neu laden.',
  invalid_lectures: 'Bitte zwischen einer und zwanzig Veranstaltungen auswählen.',
  invalid_examiners: 'Bitte höchstens zwanzig unterschiedliche prüfende Personen angeben.',
  insufficient_credits:
    'Dein Guthaben reicht für diesen Zugang nicht aus. Du kannst ein Protokoll beitragen oder Tokens anfragen.',
  stale_review:
    'Die Einreichung wurde inzwischen geändert. Bitte die Seite neu laden und die Entscheidung erneut prüfen.',
  account_ineligible: 'Ein aktives, bestätigtes studentisches Konto ist erforderlich.',
  admin_required: 'Administratorrechte erforderlich.',
  invalid_id: 'Die angegebene Kennung ist ungültig.',
  not_found: 'Der angeforderte Eintrag wurde nicht gefunden.',
  lectures_required: 'Bitte zwischen einer und zwanzig Veranstaltungen auswählen.',
  invalid_lecture: 'Eine gewählte Veranstaltung ist nicht mehr verfügbar.',
  invalid_examiner: 'Die gewählte prüfende Person ist nicht mehr verfügbar.',
  invalid_contributor: 'Mitwirkende müssen gültige zx-Kennungen verwenden.',
  invalid_input: 'Bitte die Eingaben und die erlaubte Textlänge prüfen.',
  invalid_date: 'Bitte ein gültiges Prüfungsdatum eingeben.',
  request_key_reused:
    'Diese Anfrage wurde bereits mit anderen Angaben übermittelt. Bitte die Seite neu laden.',
  unsafe_file: 'Die Datei muss vor der Veröffentlichung die technische Prüfung bestehen.',
  uploader_required: 'Nur das einreichende Konto kann eine Verbesserung übermitteln.',
  improvement_unrewarded: 'Verbesserungen erhalten keine weiteren Tokens.',
  invalid_policy:
    'Bitte die Tokenbeträge und Zugangsdauer prüfen. Die ausgezeichnete Belohnung muss mindestens der Standardbelohnung entsprechen.',
  last_admin: 'Das letzte aktive Administratorkonto kann nicht entfernt werden.',
  stale_policy:
    'Die Tokenregeln wurden inzwischen geändert. Bitte die Seite neu laden und die Vergabe erneut prüfen.',
  stale_recipients: 'Die berechtigten Empfänger haben sich geändert. Bitte die Seite neu laden.',
  invalid_term: 'Bitte ein Semester aus der Liste auswählen.',
  lecture_approval_required:
    'Alle vorgeschlagenen Veranstaltungen müssen vor der Veröffentlichung freigegeben werden.',
  files_deleted: 'Die Dateien dieser Einreichung wurden entfernt.',
  lecture_proposal_unavailable:
    'Dieser Veranstaltungsname ist nicht verfügbar. Bitte einen anderen Namen wählen oder die Redaktion kontaktieren.'
};
export const errorMessage = (cause: DomainError) => errors[cause.code] ?? cause.message;
export async function loadResult<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (cause) {
    if (cause instanceof DomainError) error(cause.status, errorMessage(cause));
    throw cause;
  }
}
export async function actionResult(operation: () => Promise<unknown>, message: string) {
  try {
    await operation();
    return { message };
  } catch (cause) {
    if (cause instanceof DomainError) return fail(cause.status, { error: errorMessage(cause) });
    throw cause;
  }
}
export function uploadFile(form: FormData): File {
  const value = form.get('file');
  if (!(value instanceof File) || !value.size)
    throw new DomainError(400, 'file_required', 'Bitte eine PDF- oder TXT-Datei auswählen.');
  return value;
}
export function protocolValues(form: FormData) {
  return {
    lectureIds: form.getAll('lectureIds').map(String),
    newLectureNames: form.getAll('newLectureNames').map(String),
    examinerId: field(form, 'examinerId'),
    examinerName: field(form, 'examinerName'),
    examDate: field(form, 'examDate'),
    term: field(form, 'term'),
    remarks: field(form, 'remarks'),
    collaboratorZx: field(form, 'collaboratorZx')
  };
}

export function validateProtocolDetails(
  values: ReturnType<typeof protocolValues>,
  requireDate = true
) {
  if (!values.examinerName && !values.examinerId)
    throw new DomainError(400, 'examiner_required', 'Bitte eine prüfende Person angeben.');
  if (!requireDate) return;
  if (!values.examDate)
    throw new DomainError(400, 'exam_date_required', 'Bitte das Prüfungsdatum angeben.');
  const date = new Date(values.examDate);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(values.examDate) ||
    values.examDate.startsWith('0000') ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== values.examDate
  )
    throw new DomainError(400, 'invalid_date', 'Bitte ein gültiges Prüfungsdatum angeben.');
}
