<script lang="ts">
  import { t, dateText, queueLabel } from '$lib/i18n';
  import { page } from '$app/state';
  import { namedAction } from '$lib/form-actions';
  import Status from '$lib/components/Status.svelte';
  import Feedback from '$lib/components/Feedback.svelte';
  let language = $derived(page.data.preferences?.language ?? 'de');
  let { data, form } = $props();
</script>

<div class="page-head">
  <div>
    <p class="eyebrow">
      <a href="/admin/jobs">{t(language, 'Verarbeitung')}</a>
      {t(language, '/ Aufgabe')}
    </p>
    <h1>{queueLabel(language, data.job.name)}</h1>
    <p class="mono">{data.job.id}</p>
  </div>
  <Status value={data.job.state} />
</div>
<Feedback {form} />
<div class="card narrow">
  <dl>
    <dt>{t(language, 'Erstellt')}</dt>
    <dd>{dateText(language, data.job.createdOn, true)}</dd>
    <dt>{t(language, data.job.retryCount ? 'Letzter Start' : 'Gestartet')}</dt>
    <dd>
      {data.job.startedOn
        ? dateText(language, data.job.startedOn, true)
        : t(language, 'Noch nicht gestartet')}
    </dd>
    <dt>{t(language, data.job.state === 'failed' ? 'Fehlgeschlagen' : 'Abgeschlossen')}</dt>
    <dd>
      {data.job.completedOn
        ? dateText(language, data.job.completedOn, true)
        : t(language, 'Noch nicht abgeschlossen')}
    </dd>
    <dt>{t(language, 'Wiederholungen')}</dt>
    <dd>{data.job.retryCount} / {data.job.retryLimit}</dd>
  </dl>
  {#if data.job.failure}
    <div class="notice error" role="alert">
      <h2>{t(language, 'Fehler')}</h2>
      <p><strong>{t(language, data.job.failure.message)}</strong></p>
      <p>{t(language, data.job.failure.hint)}</p>
      <p class="hint mono">{t(language, 'Fehlercode')}: {data.job.failure.code.toUpperCase()}</p>
      {#if data.job.state === 'retry' && data.job.failure.failedAt}<p class="hint">
          {dateText(language, data.job.failure.failedAt, true)}
        </p>{/if}
    </div>
  {:else}
    <h2>{t(language, 'Ergebnis')}</h2>
    <pre class="mono">{data.job.output == null
        ? t(language, 'Noch kein Ergebnis.')
        : JSON.stringify(data.job.output, null, 2)}</pre>
  {/if}
  <div class="actions">
    {#if ['failed', 'cancelled'].includes(data.job.state)}<form
        method="POST"
        action={namedAction(page.url, 'retry')}
      >
        <button class="secondary">{t(language, 'Erneut versuchen')}</button>
      </form>{/if}{#if ['created', 'retry'].includes(data.job.state)}<form
        method="POST"
        action={namedAction(page.url, 'cancel')}
      >
        <button class="secondary">{t(language, 'Abbrechen')}</button>
      </form>{/if}
  </div>
</div>
