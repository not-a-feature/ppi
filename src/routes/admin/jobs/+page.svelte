<script lang="ts">
  import { text, t, dateText, queueLabel, statusLabel } from '$lib/i18n';
  import { page } from '$app/state';
  import { namedAction } from '$lib/form-actions';
  import Status from '$lib/components/Status.svelte';
  import Feedback from '$lib/components/Feedback.svelte';
  import Pagination from '$lib/components/Pagination.svelte';
  let { data, form } = $props();
  let language = $derived(page.data.preferences?.language ?? 'de');
</script>

<div class="page-head"><h1>{t(language, 'Verarbeitung')}</h1></div>
<Feedback {form} />
<form method="GET" class="search" style="margin-bottom:1.5rem">
  <label for="q"
    >{text(language, 'Suchen', 'Search')}<input
      id="q"
      name="q"
      type="search"
      maxlength="200"
      value={data.q}
    /></label
  ><label
    >{t(language, 'Status')}<select name="state"
      ><option value="">{text(language, 'Alle', 'All')}</option
      >{#each ['created', 'retry', 'active', 'completed', 'cancelled', 'failed'] as state}<option
          value={state}
          selected={data.state === state}>{statusLabel(language, state)}</option
        >{/each}</select
    ></label
  ><button class="secondary">{text(language, 'Suchen', 'Search')}</button>
</form>
<section class="card" style="margin-bottom:1.5rem">
  <div class="split">
    <h2>{t(language, 'Worker')}</h2>
    <span
      class="badge"
      class:good={data.jobs.worker.lastSeen &&
        Date.now() - new Date(data.jobs.worker.lastSeen).getTime() < 120000}
      >{data.jobs.worker.lastSeen &&
      Date.now() - new Date(data.jobs.worker.lastSeen).getTime() < 120000
        ? t(language, 'Verbunden')
        : t(language, 'Nicht verfügbar')}</span
    >
  </div>
  <p class="hint">
    {t(language, 'Letztes Signal:')}
    {data.jobs.worker.lastSeen
      ? dateText(language, data.jobs.worker.lastSeen, true)
      : t(language, 'Keines')}
  </p>
  <p class="hint">
    {t(
      language,
      'Pausieren verhindert neue Arbeit. Bereits laufende Aufgaben werden abgeschlossen.'
    )}
  </p>
  {#each data.jobs.queues as queue}<div class="list-row">
      <div>
        <strong>{queueLabel(language, queue.name)}</strong>
        <p class="hint">{queue.paused ? t(language, 'Pausiert') : t(language, 'Aktiv')}</p>
      </div>
      <form method="POST" action={namedAction(page.url, 'queue')}>
        <input type="hidden" name="name" value={queue.name} /><input
          type="hidden"
          name="paused"
          value={String(!queue.paused)}
        /><button class="secondary"
          >{queue.paused ? t(language, 'Fortsetzen') : t(language, 'Pausieren')}</button
        >
      </form>
    </div>{/each}
</section>
<section class="card">
  <h2>{t(language, 'Aufgaben')}</h2>
  <div class="table-scroll">
    <table>
      <thead
        ><tr
          ><th>{t(language, 'Aufgabe')}</th><th>{t(language, 'Status')}</th><th
            >{t(language, 'Erstellt')}</th
          ><th>{t(language, 'Aktion')}</th></tr
        ></thead
      ><tbody
        >{#each data.jobs.jobs as job}<tr
            ><td
              ><a href="/admin/jobs/{job.id}">{queueLabel(language, job.name)}</a>
              <div class="mono">{job.id}</div></td
            ><td><Status value={job.state} /></td><td>{dateText(language, job.createdOn, true)}</td
            ><td
              ><div class="actions">
                {#if ['failed', 'cancelled'].includes(job.state)}<form
                    method="POST"
                    action={namedAction(page.url, 'retry')}
                  >
                    <input type="hidden" name="id" value={job.id} /><button class="secondary"
                      >{t(language, 'Erneut versuchen')}</button
                    >
                  </form>{/if}{#if ['created', 'retry'].includes(job.state)}<form
                    method="POST"
                    action={namedAction(page.url, 'cancel')}
                  >
                    <input type="hidden" name="id" value={job.id} /><button class="secondary"
                      >{t(language, 'Abbrechen')}</button
                    >
                  </form>{/if}
              </div></td
            ></tr
          >{:else}<tr><td colspan="4">{t(language, 'Keine Aufgaben vorhanden.')}</td></tr
          >{/each}</tbody
      >
    </table>
  </div>
</section>

<Pagination page={data.page} total={data.total} pageSize={data.pageSize} />
