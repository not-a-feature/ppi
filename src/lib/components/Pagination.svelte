<script lang="ts">
  import { page as currentPage } from '$app/state';
  import { t } from '$lib/i18n';
  let {
    page,
    total,
    pageSize,
    onPageChange
  }: { page: number; total: number; pageSize: number; onPageChange?: (page: number) => void } =
    $props();
  let language = $derived(currentPage.data.preferences?.language ?? 'de');
  let pages = $derived(Math.max(1, Math.ceil(total / pageSize)));
  let links = $derived([
    { target: page - 1, rel: 'prev', label: 'Zurück' },
    { target: page + 1, rel: 'next', label: 'Weiter' }
  ] as const);
  function href(target: number) {
    const url = new URL(currentPage.url);
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith('/')) url.searchParams.delete(key);
    }
    url.searchParams.set('page', String(target));
    return url.pathname + url.search;
  }
</script>

<nav class="pagination" aria-label={t(language, 'Seitennavigation')}>
  <span
    >{total}
    {t(language, 'Einträge')} · {t(language, 'Seite')}
    {page} / {pages}</span
  >
  <div class="actions">
    {#each links as link}
      {#if link.target >= 1 && link.target <= pages}<a
          class="button secondary"
          href={href(link.target)}
          rel={link.rel}
          onclick={(event) => {
            if (onPageChange) {
              event.preventDefault();
              onPageChange(link.target);
            }
          }}>{t(language, link.label)}</a
        >{/if}
    {/each}
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
