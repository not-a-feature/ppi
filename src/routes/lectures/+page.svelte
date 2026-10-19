<script lang="ts">
  import { untrack } from 'svelte';
  import { afterNavigate, replaceState } from '$app/navigation';
  import { matchesLecture } from '$lib/catalogue-search';
  import { page } from '$app/state';
  import Pagination from '$lib/components/Pagination.svelte';
  import { t as translate, protocolCountLabel, type MessageKey } from '$lib/i18n';
  let { data } = $props();
  const t = (key: MessageKey, values?: Record<string, string | number>) =>
    translate(data.preferences.language, key, values);
  let query = $state(untrack(() => data.q));
  let onlyWithProtocols = $state(untrack(() => data.onlyWithProtocols));
  let view = $state<'cards' | 'list'>(untrack(() => data.view));
  let requestedPage = $state(untrack(() => data.page));
  let filtered = $derived(
    data.lectures.filter(
      (lecture) =>
        matchesLecture(lecture, query) && (!onlyWithProtocols || lecture.protocol_count > 0)
    )
  );
  let displayPage = $derived(Math.min(requestedPage, Math.max(1, Math.ceil(filtered.length / 30))));
  let visible = $derived(filtered.slice((displayPage - 1) * 30, displayPage * 30));
  function catalogueUrl() {
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    if (!onlyWithProtocols) params.set('files', 'all');
    if (view === 'list') params.set('view', 'list');
    if (requestedPage > 1) params.set('page', String(requestedPage));
    return '/lectures' + (params.size ? '?' + params.toString() : '');
  }
  function searchNow(resetPage = true) {
    if (resetPage) requestedPage = 1;
    replaceState(catalogueUrl(), page.state);
  }
  function changeView(next: 'cards' | 'list') {
    view = next;
    const url = new URL(page.url);
    if (next === 'list') url.searchParams.set('view', 'list');
    else url.searchParams.delete('view');
    replaceState(url, page.state);
  }
  afterNavigate(({ type, to }) => {
    if (!to || (type !== 'popstate' && type !== 'link')) return;
    query = to.url.searchParams.get('q') ?? '';
    onlyWithProtocols = to.url.searchParams.get('files') !== 'all';
    view = to.url.searchParams.get('view') === 'list' ? 'list' : 'cards';
    requestedPage = Math.max(1, Number(to.url.searchParams.get('page')) || 1);
  });
</script>

<div class="catalogue-heading"><h1>{t('Prüfungsprotokolle')}</h1></div>
<section aria-label={t('Veranstaltungskatalog')}>
  <form
    method="GET"
    role="search"
    class="catalogue-search"
    onsubmit={(event) => {
      event.preventDefault();
      searchNow();
    }}
  >
    <label for="search">{t('Veranstaltung suchen')}</label>
    <div class="search-field">
      <svg aria-hidden="true" viewBox="0 0 24 24" width="21" height="21"
        ><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg
      >
      <input
        id="search"
        name="q"
        type="search"
        placeholder={t('Name der Veranstaltung')}
        bind:value={query}
        oninput={(event) => {
          query = event.currentTarget.value;
          searchNow();
        }}
        maxlength="200"
        autocomplete="off"
      />
    </div>
    {#if !onlyWithProtocols}<input type="hidden" name="files" value="all" />{/if}
    {#if view === 'list'}<input type="hidden" name="view" value="list" />{/if}
    <noscript><button>{t('Suchen')}</button></noscript>
  </form>
  <div class="catalogue-toolbar">
    <label class="protocol-filter"
      ><input
        type="checkbox"
        bind:checked={onlyWithProtocols}
        onchange={(event) => {
          onlyWithProtocols = event.currentTarget.checked;
          searchNow();
        }}
      />{t('Nur mit freigegebenen Protokollen')}</label
    >
    <div class="view-toggle" role="group" aria-label={t('Ansicht')}>
      <button type="button" aria-pressed={view === 'cards'} onclick={() => changeView('cards')}>
        <svg aria-hidden="true" viewBox="0 0 20 20" width="17" height="17"
          ><rect x="2" y="2" width="6" height="6" /><rect x="12" y="2" width="6" height="6" /><rect
            x="2"
            y="12"
            width="6"
            height="6"
          /><rect x="12" y="12" width="6" height="6" /></svg
        >{t('Karten')}
      </button>
      <button type="button" aria-pressed={view === 'list'} onclick={() => changeView('list')}>
        <svg aria-hidden="true" viewBox="0 0 20 20" width="17" height="17"
          ><path d="M3 4h14M3 10h14M3 16h14" /></svg
        >{t('Liste')}
      </button>
    </div>
  </div>
  <div class="results-heading">
    <h2>{query ? t('Suchergebnisse') : t('catalogue.courses')}</h2>
    <span aria-live="polite"
      >{filtered.length}
      {t(filtered.length === 1 ? 'catalogue.course' : 'catalogue.courseCount')}</span
    >
  </div>
  {#if visible.length}
    <div class:cards={view === 'cards'} class:list={view === 'list'} class="lecture-results">
      {#each visible as lecture}
        <a class="lecture-item" href="/lectures/{lecture.id}">
          <h3>{lecture.name}</h3>
          <span class="protocol-count"
            >{lecture.protocol_count}
            {protocolCountLabel(data.preferences.language, lecture.protocol_count)}</span
          >
          <span
            class="access-state"
            class:has-access={lecture.expires_at && new Date(lecture.expires_at) > new Date()}
          >
            {#if lecture.expires_at && new Date(lecture.expires_at) > new Date()}
              <svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16"
                ><path d="m3 10 4 4 10-10" /></svg
              >{t('Freigeschaltet')}
            {:else if lecture.archived}{t('Archiviert')}
            {:else}{t('Nicht freigeschaltet')}{/if}
          </span>
        </a>
      {/each}
    </div>
  {:else}
    <div class="catalogue-empty">
      <h3>{t('Keine Veranstaltungen gefunden')}</h3>
      {#if onlyWithProtocols}<button
          class="secondary"
          onclick={() => {
            onlyWithProtocols = false;
            searchNow();
          }}>{t('Auch ohne Protokolle anzeigen')}</button
        >{:else}<button
          class="secondary"
          onclick={() => {
            query = '';
            searchNow();
          }}>{t('Suche zurücksetzen')}</button
        >{/if}
    </div>
  {/if}
  <Pagination
    page={displayPage}
    total={filtered.length}
    pageSize={30}
    onPageChange={(next) => {
      requestedPage = next;
      searchNow(false);
    }}
  />
</section>

<style>
  .catalogue-heading {
    margin-bottom: 34px;
  }
  .catalogue-search {
    max-width: 850px;
    margin-bottom: 24px;
  }
  .catalogue-search label {
    margin-bottom: 10px;
  }
  .search-field {
    position: relative;
  }
  .search-field > svg {
    position: absolute;
    left: 16px;
    top: 18px;
    stroke: var(--muted);
    fill: none;
    stroke-width: 1.7;
  }
  .search-field input {
    margin: 0;
    height: 56px;
    padding-left: 48px;
    font-size: 17px;
    background: var(--surface);
  }
  .catalogue-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    margin-bottom: 42px;
  }
  .protocol-filter {
    display: flex;
    align-items: center;
    margin: 0;
    font-size: 14px;
    font-weight: 400;
  }
  .protocol-filter input {
    flex: none;
  }
  .view-toggle {
    display: flex;
    gap: 2px;
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 3px;
    background: var(--surface);
  }
  .view-toggle button {
    background: transparent;
    color: var(--muted);
    border: 0;
    padding: 8px 12px;
    font-size: 13px;
    border-radius: 3px;
  }
  .view-toggle button[aria-pressed='true'] {
    background: var(--subtle);
    color: var(--accent);
  }
  .view-toggle svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
  }
  .results-heading {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 20px;
    margin-bottom: 18px;
  }
  .results-heading h2 {
    font-size: 21px;
    margin: 0;
  }
  .results-heading > span {
    font-size: 13px;
    color: var(--muted);
  }
  .lecture-item {
    color: var(--ink);
  }
  .lecture-item:hover {
    text-decoration: none;
    border-color: var(--accent);
  }
  .lecture-item:hover h3 {
    text-decoration: underline;
    text-underline-offset: 4px;
  }
  .lecture-item h3 {
    font-size: 20px;
    font-weight: 550;
    line-height: 1.4;
    letter-spacing: -0.015em;
    margin: 0;
  }
  .protocol-count {
    font-size: 14px;
    color: var(--muted);
  }
  .access-state {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    color: var(--muted);
  }
  .access-state svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
  }
  .access-state.has-access {
    color: var(--accent);
    font-weight: 500;
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 20px;
  }
  .cards .lecture-item {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    min-height: 200px;
    padding: 25px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 8px;
  }
  .cards h3 {
    margin-bottom: 24px;
  }
  .cards .protocol-count {
    margin-top: auto;
  }
  .cards .access-state {
    margin-top: 12px;
  }
  .list {
    border-top: 2px solid var(--ink);
  }
  .list .lecture-item {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 140px 160px;
    align-items: center;
    gap: 24px;
    padding: 23px 0;
    border-bottom: 1px solid var(--line);
  }
  .list h3 {
    font-size: 17px;
  }
  .catalogue-empty {
    border-top: 1px solid var(--line);
    padding: 32px 0;
  }
  @media (max-width: 1000px) {
    .cards {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (max-width: 640px) {
    .catalogue-toolbar {
      align-items: flex-start;
      flex-direction: column;
      gap: 20px;
      margin-bottom: 32px;
    }
    .cards {
      grid-template-columns: 1fr;
      gap: 14px;
    }
    .cards .lecture-item {
      min-height: 170px;
      padding: 22px;
    }
    .list .lecture-item {
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px 15px;
    }
    .list h3 {
      grid-column: 1/-1;
    }
    .list .access-state {
      justify-self: end;
    }
    .results-heading h2 {
      font-size: 19px;
    }
    .protocol-filter {
      font-size: 13px;
    }
  }
</style>
