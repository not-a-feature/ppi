<script lang="ts">
  import { t, dateText, queueLabel } from '$lib/i18n';
  import { page } from '$app/state';
  import Status from '$lib/components/Status.svelte';
  let language = $derived(page.data.preferences?.language ?? 'de');
  let { data } = $props();
  let lastSeen = $derived(data.jobs.worker.lastSeen ? new Date(data.jobs.worker.lastSeen) : null);
  let online = $derived(lastSeen && Date.now() - lastSeen.getTime() < 120000);
  let actions = $derived([
    { label: 'Prüfbereit', count: data.reviewTotal, href: '/admin/review?scope=ready' },
    { label: 'Offene Meldungen', count: data.overview.openReports, href: '/admin/reports' },
    { label: 'Tokenanfragen', count: data.overview.pendingTokens, href: '/admin/credits' },
    {
      label: 'Vorlesungen freigeben',
      count: data.overview.pendingLectures,
      href: '/admin/catalogue?status=pending'
    }
  ] as const);
</script>

<div class="page-head">
  <div><h1>{t(language, 'Übersicht')}</h1></div>
  <a class="button" href="/admin/review">{t(language, 'Zur Prüfwarteschlange')}</a>
</div>
<div class="overview-actions">
  {#each actions as action}
    <a class="card action-card" href={action.href}>
      <span class="eyebrow">{t(language, action.label)}</span>
      <span class="metric">{action.count}</span>
    </a>
  {/each}
</div>
<div class="grid overview-details">
  <section class="card">
    <div class="split">
      <h2>{t(language, 'Verarbeitung')}</h2>
      <span class="badge" class:good={online} class:bad={!online}>
        {online ? t(language, 'Worker aktiv') : t(language, 'Kein aktuelles Worker-Signal')}
      </span>
    </div>
    <p class="hint">
      {lastSeen
        ? `${t(language, 'Letztes Signal:')} ${dateText(language, lastSeen, true)}`
        : t(language, 'Noch kein Worker-Signal empfangen.')}
    </p>
    <dl class="overview-counts">
      <div>
        <dt>{t(language, 'Wartend')}</dt>
        <dd><a href="/admin/jobs?state=created">{data.jobs.queued}</a></dd>
      </div>
      <div>
        <dt>{t(language, 'Laufend')}</dt>
        <dd><a href="/admin/jobs?state=active">{data.jobs.running}</a></dd>
      </div>
      <div>
        <dt>{t(language, 'Wiederholungen ausstehend')}</dt>
        <dd><a href="/admin/jobs?state=retry">{data.jobs.retrying}</a></dd>
      </div>
      <div>
        <dt>{t(language, 'Fehlgeschlagen · letzte 24 Stunden')}</dt>
        <dd class:failure={data.jobs.failedRecent > 0}>
          <a href="/admin/jobs?state=failed">{data.jobs.failedRecent}</a>
        </dd>
      </div>
      <div>
        <dt>{t(language, 'Fehlgeschlagen · älter als 24 Stunden')}</dt>
        <dd><a href="/admin/jobs?state=failed">{data.jobs.failedOlder}</a></dd>
      </div>
    </dl>
    {#if data.jobs.pausedQueues.length}
      <p class="notice warning">
        {t(language, 'Pausiert')}: {data.jobs.pausedQueues
          .map((name) => queueLabel(language, name))
          .join(', ')}
      </p>
    {/if}
    {#if data.jobs.nextCleanup}
      <p class="hint">
        {t(language, 'Nächste automatische Bereinigung:')}
        {dateText(language, data.jobs.nextCleanup, true)}
      </p>
    {/if}
  </section>
  <section class="card">
    <h2>{t(language, 'Letzte 7 Tage')}</h2>
    <dl class="overview-counts">
      <div>
        <dt>{t(language, 'Neue Einreichungen')}</dt>
        <dd>{data.overview.uploadsWeek}</dd>
      </div>
      <div>
        <dt>{t(language, 'Aktivierte Konten')}</dt>
        <dd>{data.overview.activationsWeek}</dd>
      </div>
    </dl>
    <hr class="divider" />
    <h3>{t(language, 'Aktueller Stand')}</h3>
    <dl class="overview-counts">
      <div>
        <dt>{t(language, 'Einreichungen in Verarbeitung')}</dt>
        <dd>{data.overview.processing}</dd>
      </div>
      <div>
        <dt>{t(language, 'Warten auf Verbesserung')}</dt>
        <dd>{data.overview.changesRequested}</dd>
      </div>
    </dl>
  </section>
</div>
<section class="card">
  <h2>{t(language, 'Als Nächstes prüfen')}</h2>
  {#each data.reviews as item}<div class="list-row">
      <div class="review-entry-label">
        <h3>
          <a
            class="review-entry-title"
            href="/admin/review/{item.id}"
            title={item.lecture_names.join(', ')}
            >{item.upload_number ? `${item.upload_number}. ` : ''}{item.lecture_names.join(', ')}</a
          >
        </h3>
        <p class="hint">
          {t(language, 'Version')}
          {item.revision_number}, {dateText(language, item.created_at)}
        </p>
      </div>
      <div class="review-entry-status"><Status value={item.review_state} /></div>
    </div>{:else}<p class="muted">{t(language, 'Keine prüfbereiten Einreichungen.')}</p>{/each}
</section>

<style>
  .overview-actions {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 210px), 1fr));
    gap: 20px;
    margin-bottom: 24px;
  }
  .action-card {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .action-card:hover {
    border-color: var(--accent);
  }
  .overview-details {
    margin-bottom: 24px;
    align-items: start;
  }
  .overview-counts {
    margin: 20px 0;
  }
  .overview-counts > div {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 20px;
    padding: 10px 0;
    border-bottom: 1px solid var(--line);
  }
  dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }
  .failure a {
    color: var(--bad-ink);
  }
</style>
