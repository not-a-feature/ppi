<script lang="ts">
  import { untrack, type Snippet } from 'svelte';
  import { afterNavigate, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import SearchForm from './SearchForm.svelte';
  import Pagination from './Pagination.svelte';
  let {
    entries,
    query = '',
    initialPage = 1,
    pageSize = 30,
    initialFilters = {},
    matches,
    filters,
    header,
    children
  }: {
    entries: Record<string, any>[];
    query?: string;
    initialPage?: number;
    pageSize?: number;
    initialFilters?: Record<string, string>;
    matches?: (entry: Record<string, any>, filters: Record<string, string>) => boolean;
    filters?: Snippet<[Record<string, string>]>;
    header?: Snippet<[Record<string, any>[]]>;
    children: Snippet<[Record<string, any>[], number]>;
  } = $props();
  let search = $state(untrack(() => query));
  let values = $state(untrack(() => ({ ...initialFilters })));
  let requestedPage = $state(untrack(() => initialPage));
  let needle = $derived(search.trim().normalize('NFKC').toLocaleLowerCase('de-DE'));
  let indexed = $derived(
    entries.map((entry) => ({
      entry,
      text: Object.values(entry)
        .map((value) =>
          value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
        )
        .join(' ')
        .normalize('NFKC')
        .toLocaleLowerCase('de-DE')
    }))
  );
  let filtered = $derived(
    indexed
      .filter(
        ({ entry, text }) =>
          (!needle || text.includes(needle)) && (!matches || matches(entry, values))
      )
      .map(({ entry }) => entry)
  );
  let displayPage = $derived(
    Math.min(requestedPage, Math.max(1, Math.ceil(filtered.length / pageSize)))
  );
  let start = $derived((displayPage - 1) * pageSize);
  let visible = $derived(filtered.slice(start, start + pageSize));
  function updateUrl() {
    const url = new URL(page.url);
    url.searchParams.delete('q');
    url.searchParams.delete('page');
    if (search) url.searchParams.set('q', search);
    if (requestedPage > 1) url.searchParams.set('page', String(requestedPage));
    for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
    replaceState(url, page.state);
  }
  afterNavigate(({ type, to }) => {
    if (!to || (type !== 'popstate' && type !== 'link')) return;
    search = to.url.searchParams.get('q') ?? '';
    requestedPage = Math.max(1, Number(to.url.searchParams.get('page')) || 1);
    values = Object.fromEntries(
      Object.keys(initialFilters).map((key) => [
        key,
        to.url.searchParams.get(key) ?? initialFilters[key]
      ])
    );
  });
</script>

{@render header?.(visible)}
<SearchForm
  query={search}
  onSearch={(form) => {
    search = String(form.get('q') ?? '');
    for (const key of Object.keys(values)) values[key] = String(form.get(key) ?? '');
    requestedPage = 1;
    updateUrl();
  }}
>
  {@render filters?.(values)}
</SearchForm>
{@render children(visible, start)}
<Pagination
  page={displayPage}
  total={filtered.length}
  {pageSize}
  onPageChange={(next) => {
    requestedPage = next;
    updateUrl();
  }}
/>
