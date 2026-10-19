<script lang="ts">
  import { page as currentPage } from '$app/state';
  import { text } from '$lib/i18n';
  let { page, total, pageSize }: { page: number; total: number; pageSize: number } = $props();
  let language = $derived(currentPage.data.preferences?.language ?? 'de');
  let pages = $derived(Math.max(1, Math.ceil(total / pageSize)));
  function href(target: number) {
    const url = new URL(currentPage.url);
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith('/')) url.searchParams.delete(key);
    }
    url.searchParams.set('page', String(target));
    return url.pathname + url.search;
  }
</script>

<nav class="pagination" aria-label={text(language, 'Seitennavigation', 'Pagination')}>
  <span
    >{total}
    {text(language, 'Einträge', 'entries')} · {text(language, 'Seite', 'Page')}
    {page} / {pages}</span
  >
  <div class="actions">
    {#if page > 1}<a class="button secondary" href={href(page - 1)} rel="prev"
        >{text(language, 'Zurück', 'Previous')}</a
      >{/if}
    {#if page < pages}<a class="button secondary" href={href(page + 1)} rel="next"
        >{text(language, 'Weiter', 'Next')}</a
      >{/if}
  </div>
</nav>

<style>
  .pagination {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 1rem;
    margin: 1.25rem 0;
  }
</style>
