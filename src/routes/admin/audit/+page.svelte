<script lang="ts">
  import { t, dateText } from '$lib/i18n';
  import { page } from '$app/state';

  import LocalList from '$lib/components/LocalList.svelte';
  let { data } = $props();
  let language = $derived(page.data.preferences?.language ?? 'de');
  let expandedLogEntries = $state<string[]>([]);
  function exportLogs(rows: Record<string, any>[]) {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' })
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'ppi-log.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
</script>

<LocalList entries={data.entries} query={data.q} initialPage={data.page}>
  {#snippet header(rows)}<div class="page-head">
      <h1>Log</h1>
      <button class="secondary" onclick={() => exportLogs(rows)}>Export (JSON)</button>
    </div>{/snippet}
  {#snippet children(rows, start)}
    <section class="card table-scroll">
      <table>
        <thead
          ><tr
            ><th>{t(language, 'Zeitpunkt')}</th><th>{t(language, 'Aktion')}</th><th
              >{t(language, 'Konto / Ziel')}</th
            ><th>{t(language, 'Details')}</th></tr
          ></thead
        ><tbody
          >{#each rows as entry}<tr
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
                    ? t(language, 'Ausblenden')
                    : t(language, 'Anzeigen')}</button
                ></td
              ></tr
            >
            <tr
              class="log-detail"
              hidden={!expandedLogEntries.includes(entry.id)}
              id={`log-detail-${entry.id}`}
              ><td colspan="4"
                ><pre aria-label={t(language, 'Details zum Logeintrag')}>{JSON.stringify(
                    entry.detail,
                    null,
                    2
                  )}</pre></td
              ></tr
            >
          {:else}<tr><td colspan="4">{t(language, 'Keine Einträge.')}</td></tr>{/each}</tbody
        >
      </table>
    </section>
  {/snippet}
</LocalList>

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
