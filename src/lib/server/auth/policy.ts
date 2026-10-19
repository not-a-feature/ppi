export const studentIdentifierPattern = /^zx[a-z]{3}[0-9]{2}$/;
export const studentEmailPattern = /^zx[a-z]{3}[0-9]{2}@student\.uni-tuebingen\.de$(?![\s\S])/;

export function studentEmail(identifier: string): string {
  const normalized = identifier.trim().toLowerCase();
  if (!studentIdentifierPattern.test(normalized)) {
    throw new Error('Use a zx identifier such as zxabc01.');
  }
  return `${normalized}@student.uni-tuebingen.de`;
}
