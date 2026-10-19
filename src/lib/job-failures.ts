export const jobFailures = {
  timeout: { message: 'jobs.failure.timeout', hint: 'jobs.failure.timeoutHint' },
  connection: { message: 'jobs.failure.connection', hint: 'jobs.failure.connectionHint' },
  file_missing: { message: 'jobs.failure.fileMissing', hint: 'jobs.failure.fileMissingHint' },
  storage: { message: 'jobs.failure.storage', hint: 'jobs.failure.storageHint' },
  scanner: { message: 'jobs.failure.scanner', hint: 'jobs.failure.scannerHint' },
  signatures: { message: 'jobs.failure.signatures', hint: 'jobs.failure.signaturesHint' },
  pdf: { message: 'jobs.failure.pdf', hint: 'jobs.failure.pdfHint' },
  mail: { message: 'jobs.failure.mail', hint: 'jobs.failure.mailHint' },
  unknown: { message: 'jobs.failure.unknown', hint: 'jobs.failure.unknownHint' }
} as const;
export type JobFailureCode = keyof typeof jobFailures;

export function classifyJobFailure(error: unknown): JobFailureCode {
  const code = error instanceof Error && 'code' in error ? error.code : '';
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (
    code === '57014' ||
    code === '55P03' ||
    code === 'ETIMEDOUT' ||
    /statement timeout|lock timeout|query read timeout|timed out|exceeded.*(?:expire|timeout)/i.test(
      message
    )
  )
    return 'timeout';
  if (
    ['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', '57P01', '08006', '53300'].includes(
      String(code)
    )
  )
    return 'connection';
  if (code === 'ENOENT') return 'file_missing';
  if (['ENOSPC', 'EACCES', 'EPERM', 'EROFS'].includes(String(code))) return 'storage';
  if (message.startsWith('Virus signatures') || message === 'Virus signature date is unavailable.')
    return 'signatures';
  if (message === 'The virus scanner is unavailable or failed.') return 'scanner';
  if (
    message.startsWith('PDF structure check failed') ||
    message.startsWith('PDF must be unencrypted')
  )
    return 'pdf';
  if (['EAUTH', 'EENVELOPE', 'EMESSAGE', 'ETLS', 'ESOCKET', 'ECONNECTION'].includes(String(code)))
    return 'mail';
  return 'unknown';
}
