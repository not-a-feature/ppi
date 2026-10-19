<script lang="ts">
  import { text, t, dateText } from '$lib/i18n';
  import { page } from '$app/state';

  import Pagination from '$lib/components/Pagination.svelte';
  let { data } = $props();
  let language = $derived(page.data.preferences?.language ?? 'de');
  let expandedLogEntries = $state<string[]>([]);
</script>

<div class="page-head">
  <h1>Log</h1>
  <a
    class="button secondary"
    href={`/admin/audit/export?q=${encodeURIComponent(data.q)}&page=${data.page}`}
    download>Export (JSON)</a
  >
</div>

<form method="GET" class="search" style="margin-bottom:1.5rem">
  <label for="q"
    >{text(language, 'Suchen', 'Search')}<input
      id="q"
      name="q"
      type="search"
      maxlength="200"
      value={data.q}
    /></label
  ><button class="secondary">{text(language, 'Suchen', 'Search')}</button>
</form>
<section class="card table-scroll">
  <table>
    <thead
      ><tr
        ><th>{t(language, 'Zeitpunkt')}</th><th>{t(language, 'Aktion')}</th><th
          >{t(language, 'Konto / Ziel')}</th
        ><th>{t(language, 'Details')}</th></tr
      ></thead
    ><tbody
      >{#each data.entries as entry}<tr
          ><td>{dateText(language, entry.created_at, true)}</td><td>{entry.action}</td><td
            class="mono">{entry.actor_id ?? 'System'}<br />{entry.entity_id}</td
          ><td
            ><button
              type="button"
              class="secondary log-toggle"
              aria-expanded={expandedLogEntries.includes(entry.id)}
              aria-controls={`log-detail-${entry.id}`}
              onclick={() =>
                (expandedLogEntries = expandedLogEntries.includes(entry.id)
                  ? expandedLogEntries.filter((id) => id !== entry.id)
                  : [...expandedLogEntries, entry.id])}
              >{expandedLogEntries.includes(entry.id)
                ? text(language, 'Ausblenden', 'Hide')
                : t(language, 'Anzeigen')}</button
            ></td
          ></tr
        >
        <tr
          class="log-detail"
          hidden={!expandedLogEntries.includes(entry.id)}
          id={`log-detail-${entry.id}`}
          ><td colspan="4"
            ><pre
              aria-label={text(
                language,
                'Details zum Logeintrag',
                'Log entry details'
              )}>{JSON.stringify(entry.detail, null, 2)}</pre></td
          ></tr
        >
      {:else}<tr><td colspan="4">{t(language, 'Keine Einträge.')}</td></tr>{/each}</tbody
    >
  </table>
</section>
<Pagination page={data.page} total={data.total} pageSize={data.pageSize} />

<style>
  .log-toggle {
    padding: 0.4rem 0.7rem;
    font-size: 0.85rem;
  }
  .log-detail td {
    background: var(--canvas);
    padding: 1.2rem;
  }
  .log-detail pre {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-size: 0.85rem;
  }
</style>
