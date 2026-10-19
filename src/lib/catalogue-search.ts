export function matchesLecture(lecture: { name: string; aliases: string[] }, query: string) {
  const normalized = query.trim().normalize('NFKC').toLocaleLowerCase('de-DE');
  return [lecture.name, ...lecture.aliases].some((value) =>
    value.normalize('NFKC').toLocaleLowerCase('de-DE').includes(normalized)
  );
}
