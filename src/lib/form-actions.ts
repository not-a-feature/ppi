export function namedAction(url: URL, name: string): string {
  const params = new URLSearchParams(url.searchParams);
  for (const key of [...params.keys()]) {
    if (key.startsWith('/')) params.delete(key);
  }
  const query = params.toString();
  return `?/${name}${query ? `&${query}` : ''}`;
}
