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
    <dt>{t(language, 'Gestartet')}</dt>
    <dd>
      {data.job.startedOn
        ? dateText(language, data.job.startedOn, true)
        : t(language, 'Noch nicht gestartet')}
    </dd>
    <dt>{t(language, 'Abgeschlossen')}</dt>
    <dd>
      {data.job.completedOn
        ? dateText(language, data.job.completedOn, true)
        : t(language, 'Noch nicht abgeschlossen')}
    </dd>
  </dl>
  <h2>{t(language, 'Ergebnis')}</h2>
  <pre class="mono">{JSON.stringify(data.job.output, null, 2) ??
      t(language, 'Noch kein Ergebnis.')}</pre>
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
