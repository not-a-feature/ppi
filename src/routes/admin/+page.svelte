<script lang="ts">
  import { t, dateText } from '$lib/i18n';
  import { page } from '$app/state';
  import Status from '$lib/components/Status.svelte';
  let language = $derived(page.data.preferences?.language ?? 'de');
  let { data } = $props();
  let lastSeen = $derived(data.jobs.worker.lastSeen ? new Date(data.jobs.worker.lastSeen) : null);
  let online = $derived(lastSeen && Date.now() - lastSeen.getTime() < 120000);
</script>

<div class="page-head">
  <div><h1>{t(language, 'Übersicht')}</h1></div>
  <a class="button" href="/admin/review">{t(language, 'Zur Prüfwarteschlange')}</a>
</div>
<div class="grid" style="margin-bottom:2rem">
  <section class="card">
    <p class="eyebrow">{t(language, 'Offene Prüfung')}</p>
    <div class="metric">{data.reviewTotal}</div>
    <a href="/admin/review">{t(language, 'Beiträge ansehen')}</a>
  </section>
  <section class="card">
    <p class="eyebrow">{t(language, 'Verarbeitung')}</p>
    <div class="metric">{data.jobs.total}</div>
    <a href="/admin/jobs?state=failed">{t(language, 'Fehlgeschlagene Aufgaben')}</a>
  </section>
  <section class="card">
    <h2>{online ? t(language, 'Verbunden') : t(language, 'Nicht verfügbar')}</h2>
    <p class="hint">
      {lastSeen
        ? `${t(language, 'Letztes Signal:')} ${dateText(language, lastSeen, true)}`
        : t(language, 'Noch kein Worker-Signal empfangen.')}
    </p>
    <a href="/admin/jobs">{t(language, 'Verarbeitung verwalten')}</a>
  </section>
</div>
<section class="card">
  <h2>{t(language, 'Als Nächstes prüfen')}</h2>
  {#each data.reviews as item, index}<div class="list-row">
      <div class="review-entry-label">
        <h3>
          <a
            class="review-entry-title"
            href="/admin/review/{item.id}"
            title={item.lecture_names.join(', ')}>{index + 1}. {item.lecture_names.join(', ')}</a
          >
        </h3>
        <p class="hint">
          {t(language, 'Version')}
          {item.revision_number}, {dateText(language, item.created_at)}
        </p>
      </div>
      <div class="review-entry-status"><Status value={item.review_state} /></div>
    </div>{:else}<p class="muted">{t(language, 'Keine offenen Einreichungen.')}</p>{/each}
</section>
