<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { afterNavigate, goto, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import Pagination from '$lib/components/Pagination.svelte';
  import { text, protocolCountLabel } from '$lib/i18n';
  let { data } = $props();
  const t = (de: string, en: string) => text(data.preferences.language, de, en);
  let query = $state(untrack(() => data.q));
  let onlyWithProtocols = $state(untrack(() => data.onlyWithProtocols));
  let view = $state<'cards' | 'list'>(untrack(() => data.view));
  let timer: ReturnType<typeof setTimeout> | undefined;
  function catalogueUrl() {
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    if (!onlyWithProtocols) params.set('files', 'all');
    if (view === 'list') params.set('view', 'list');
    return '/lectures' + (params.size ? '?' + params.toString() : '');
  }
  function searchNow() {
    clearTimeout(timer);
    void goto(catalogueUrl(), { replaceState: true, keepFocus: true, noScroll: true });
  }
  function scheduleSearch() {
    clearTimeout(timer);
    timer = setTimeout(searchNow, 250);
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
  });
  onDestroy(() => clearTimeout(timer));
</script>

<div class="catalogue-heading"><h1>{t('Prüfungsprotokolle', 'Exam protocols')}</h1></div>
<section aria-label={t('Veranstaltungskatalog', 'Course catalogue')}>
  <form
    method="GET"
    role="search"
    class="catalogue-search"
    onsubmit={(event) => {
      event.preventDefault();
      searchNow();
    }}
  >
    <label for="search">{t('Veranstaltung suchen', 'Find a course')}</label>
    <div class="search-field">
      <svg aria-hidden="true" viewBox="0 0 24 24" width="21" height="21"
        ><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg
      >
      <input
        id="search"
        name="q"
        type="search"
        placeholder={t('Name der Veranstaltung', 'Course name')}
        bind:value={query}
        oninput={scheduleSearch}
        maxlength="200"
        autocomplete="off"
      />
    </div>
    {#if !onlyWithProtocols}<input type="hidden" name="files" value="all" />{/if}
    {#if view === 'list'}<input type="hidden" name="view" value="list" />{/if}
    <noscript><button>{t('Suchen', 'Search')}</button></noscript>
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
      />{t('Nur mit freigegebenen Protokollen', 'Only with accepted protocols')}</label
    >
    <div class="view-toggle" role="group" aria-label={t('Ansicht', 'View')}>
      <button type="button" aria-pressed={view === 'cards'} onclick={() => changeView('cards')}>
        <svg aria-hidden="true" viewBox="0 0 20 20" width="17" height="17"
          ><rect x="2" y="2" width="6" height="6" /><rect x="12" y="2" width="6" height="6" /><rect
            x="2"
            y="12"
            width="6"
            height="6"
          /><rect x="12" y="12" width="6" height="6" /></svg
        >{t('Karten', 'Cards')}
      </button>
      <button type="button" aria-pressed={view === 'list'} onclick={() => changeView('list')}>
        <svg aria-hidden="true" viewBox="0 0 20 20" width="17" height="17"
          ><path d="M3 4h14M3 10h14M3 16h14" /></svg
        >{t('Liste', 'List')}
      </button>
    </div>
  </div>
  <div class="results-heading">
    <h2>{data.q ? t('Suchergebnisse', 'Search results') : t('Veranstaltungen', 'Courses')}</h2>
    <span aria-live="polite"
      >{data.lecturesPage.total}
      {t(
        data.lecturesPage.total === 1 ? 'Veranstaltung' : 'Veranstaltungen',
        data.lecturesPage.total === 1 ? 'course' : 'courses'
      )}</span
    >
  </div>
  {#if data.lectures.length}
    <div class:cards={view === 'cards'} class:list={view === 'list'} class="lecture-results">
      {#each data.lectures as lecture}
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
              >{t('Freigeschaltet', 'Unlocked')}
            {:else if lecture.archived}{t('Archiviert', 'Archived')}
            {:else}{t('Nicht freigeschaltet', 'Not unlocked')}{/if}
          </span>
        </a>
      {/each}
    </div>
  {:else}
    <div class="catalogue-empty">
      <h3>{t('Keine Veranstaltungen gefunden', 'No courses found')}</h3>
      {#if onlyWithProtocols}<button
          class="secondary"
          onclick={() => {
            onlyWithProtocols = false;
            searchNow();
          }}>{t('Auch ohne Protokolle anzeigen', 'Include courses without protocols')}</button
        >{:else}<button
          class="secondary"
          onclick={() => {
            query = '';
            searchNow();
          }}>{t('Suche zurücksetzen', 'Clear search')}</button
        >{/if}
    </div>
  {/if}
  <Pagination
    page={data.lecturesPage.page}
    total={data.lecturesPage.total}
    pageSize={data.lecturesPage.pageSize}
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
