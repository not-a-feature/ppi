<script lang="ts">
  import Pagination from '$lib/components/Pagination.svelte';
  import Feedback from '$lib/components/Feedback.svelte';
  import ArchiveDownload from '$lib/components/ArchiveDownload.svelte';
  import { enhance } from '$app/forms';
  import { page } from '$app/state';
  import { namedAction } from '$lib/form-actions';
  import { t as translate, type MessageKey } from '$lib/i18n';
  import { termLabel } from '$lib/terms';
  let { data, form } = $props();
  const t = (key: MessageKey, values?: Record<string, string | number>) =>
    translate(data.preferences.language, key, values);
  const date = (value: string | Date) =>
    new Date(value).toLocaleDateString(data.preferences.language === 'de' ? 'de-DE' : 'en-GB');
  let active = $derived(data.lecture.expires_at && new Date(data.lecture.expires_at) > new Date());
  let purchasing = $state(false);
</script>

<a class="back-link" href="/lectures">{t('catalogue.all')}</a>
<div class="lecture-heading">
  <h1>{data.lecture.name}</h1>
  <div class="lecture-summary">
    <p>
      {data.lecture.protocolsPage.total}
      {t(
        data.lecture.protocolsPage.total === 1
          ? 'veröffentlichtes Prüfungsprotokoll'
          : 'veröffentlichte Prüfungsprotokolle'
      )}
    </p>
    {#if data.lecture.archived}<span>{t('Archivierte Veranstaltung')}</span>{/if}
  </div>
</div>
<Feedback {form} />

<div class="lecture-layout">
  <section class="protocols-section" aria-label={t('Prüfungsprotokolle')}>
    {#each data.lecture.protocols as protocol}
      <article class="protocol-entry">
        <div class="protocol-title">
          <h3>
            {#if protocol.upload_number}{protocol.upload_number}.
            {/if}
            {protocol.examiner || t('Prüfende Person nicht angegeben')}
          </h3>
        </div>
        <dl>
          <div>
            <dt>{t('Semester')}</dt>
            <dd>{termLabel(data.preferences.language, protocol.term)}</dd>
          </div>
          <div>
            <dt>{t('Prüfungsdatum')}</dt>
            <dd>
              {protocol.exam_date ? date(protocol.exam_date) : t('Nicht angegeben')}
            </dd>
          </div>
          {#if protocol.lectures.length > 1}<div class="lecture-assignments">
              <dt>{t('catalogue.courses')}</dt>
              <dd>{protocol.lectures.join(', ')}</dd>
            </div>{/if}
        </dl>
        {#if protocol.has_access}<a
            class="button secondary download-button"
            href="/files/{protocol.revision_id}">{t('Protokoll herunterladen')}</a
          >{/if}
      </article>
    {:else}
      <div class="no-protocols">
        <h3>{t('Noch keine Protokolle')}</h3>
        <a class="button secondary" href="/upload">{t('Protokoll hochladen')}</a>
      </div>
    {/each}

    <Pagination
      page={data.lecture.protocolsPage.page}
      total={data.lecture.protocolsPage.total}
      pageSize={data.lecture.protocolsPage.pageSize}
    />
  </section>

  <aside class="access-column" aria-labelledby="access-heading">
    <section id="course-access" class="access-panel">
      <h2 id="access-heading">{t('Dein Zugang')}</h2>
      {#if active}
        <p class="access-active">{t('Freigeschaltet')}</p>
        <p class="access-expiry">
          {t('Gültig bis')}
          {date(data.lecture.expires_at!)}.
        </p>
        {#if data.lecture.protocolsPage.total}<div class="archive-option">
            {#key data.lecture.id}
              <ArchiveDownload initialArchive={data.archive} language={data.preferences.language} />
            {/key}
          </div>{/if}
      {:else}
        <p class="access-price">
          <strong>{data.lecture.policy.lecture_cost}</strong>
          {t(data.lecture.policy.lecture_cost === 1 ? 'tokenCount.one' : 'tokenCount.many')}
        </p>
        <p class="access-copy">
          {t('Zugang zu allen veröffentlichten Protokollen dieser Veranstaltung für')}
          {data.lecture.policy.access_weeks}
          {t('Wochen.')}
        </p>
        {#if !data.lecture.archived}<form
            method="POST"
            action={namedAction(page.url, 'purchase')}
            use:enhance={() => {
              purchasing = true;
              return async ({ update }) => {
                try {
                  await update();
                } finally {
                  purchasing = false;
                }
              };
            }}
          >
            <input type="hidden" name="requestKey" value={data.requestKey} /><button
              disabled={purchasing}
              >{purchasing ? t('Freischalten…') : t('Zugang freischalten')}</button
            >
          </form>{:else}<p class="archive-note">
            {t('Für archivierte Veranstaltungen kann kein neuer Zugang erworben werden.')}
          </p>{/if}
      {/if}
    </section>
    <details class="report-panel">
      <summary>{t('Fehler oder problematischen Inhalt melden')}</summary>
      <form method="POST" action={namedAction(page.url, 'report')}>
        <input type="hidden" name="requestKey" value={'report:' + data.requestKey} />
        <label
          >{t('Betroffener Eintrag')}<select name="submissionId"
            ><option value="">{t('Veranstaltung allgemein')}</option
            >{#each data.lecture.protocols as protocol}<option value={protocol.id}
                >{protocol.examiner || t('Prüfungsprotokoll')} ({termLabel(
                  data.preferences.language,
                  protocol.term
                )})</option
              >{/each}</select
          ></label
        >
        <label
          >{t('Art des Problems')}<select name="category"
            ><option value="metadata">{t('Fehlerhafte Angaben')}</option><option
              value="inappropriate">{t('Unangemessener Inhalt')}</option
            ><option value="unavailable">{t('Datei nicht verfügbar')}</option><option value="other"
              >{t('Sonstiges')}</option
            ></select
          ></label
        >
        <label
          >{t('Beschreibung')}<textarea name="explanation" required minlength="10" maxlength="2000"
          ></textarea></label
        >
        <button class="secondary">{t('Meldung einreichen')}</button>
      </form>
    </details>
  </aside>
</div>

<style>
  .back-link {
    display: inline-block;
    font-size: 0.88rem;
    margin-bottom: 1.3rem;
    text-underline-offset: 0.2em;
  }
  .lecture-heading {
    margin-bottom: 2.7rem;
    max-width: 60rem;
  }
  .lecture-heading h1 {
    font-size: clamp(2rem, 4vw, 3.1rem);
    font-weight: 650;
    letter-spacing: -0.04em;
    line-height: 1.18;
    margin: 0 0 0.9rem;
    max-width: 30ch;
    overflow-wrap: anywhere;
  }
  .lecture-summary {
    display: flex;
    align-items: baseline;
    gap: 1.5rem;
    flex-wrap: wrap;
  }
  .lecture-summary p {
    margin: 0;
    color: var(--muted);
    font-size: 0.98rem;
  }
  .lecture-summary > span {
    font-size: 0.8rem;
    color: var(--muted);
  }
  .lecture-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 285px;
    gap: 3.8rem;
    align-items: start;
  }
  .protocol-entry {
    padding: 1.6rem 0 1.8rem;
    border-bottom: 1px solid var(--line);
  }
  .protocol-title {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
  }
  .protocol-title h3 {
    font-size: 1.14rem;
    font-weight: 600;
    line-height: 1.45;
    margin: 0;
    letter-spacing: -0.015em;
  }
  .protocol-entry dl {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.8rem 2rem;
    margin: 1.2rem 0 1.4rem;
  }
  .protocol-entry dl > div {
    display: block;
  }
  .protocol-entry dt {
    font-size: 0.76rem;
    color: var(--muted);
    margin-bottom: 0.25rem;
  }
  .protocol-entry dd {
    font-size: 0.91rem;
    margin: 0;
    line-height: 1.5;
  }
  .protocol-entry .lecture-assignments {
    grid-column: 1/-1;
  }
  .download-button {
    font-size: 0.84rem;
    padding: 0.63rem 0.85rem;
  }
  .access-panel {
    background: var(--surface);
    border-top: 3px solid var(--accent);
    padding: 1.4rem 1.5rem 1.5rem;
  }
  .access-panel h2 {
    font-size: 1.1rem;
    font-weight: 600;
    letter-spacing: -0.015em;
    margin: 0 0 1.15rem;
  }
  .access-price {
    font-size: 0.98rem;
    margin: 0 0 0.8rem;
  }
  .access-price strong {
    font-size: 2.3rem;
    font-weight: 600;
    letter-spacing: -0.04em;
    margin-right: 0.2rem;
    line-height: 1;
  }
  .access-copy {
    font-size: 0.89rem;
    line-height: 1.65;
    color: var(--muted);
    margin: 0 0 1.2rem;
  }
  .access-panel button {
    font-size: 0.87rem;
    line-height: 1.4;
    width: 100%;
    padding: 0.75rem 0.8rem;
  }
  .access-active {
    font-size: 0.98rem;
    font-weight: 600;
    color: var(--accent);
    margin: 0 0 0.6rem;
  }
  .access-expiry {
    font-size: 0.8rem;
    color: var(--muted);
    margin: 0;
  }
  .archive-option {
    border-top: 1px solid var(--line);
    margin-top: 1.3rem;
    padding-top: 1.3rem;
  }
  .archive-note {
    font-size: 0.84rem;
    line-height: 1.6;
    color: var(--muted);
    border-left: 2px solid var(--line);
    padding-left: 0.8rem;
  }
  .report-panel {
    border: 0;
    margin-top: 1.3rem;
    padding: 0;
  }
  .report-panel summary {
    display: inline-block;
    font-size: 0.84rem;
    color: var(--accent);
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 5px;
    padding: 0.63rem 0.85rem;
    text-align: center;
    list-style: none;
    font-weight: 500;
    line-height: 1.4;
  }
  .report-panel summary::-webkit-details-marker {
    display: none;
  }
  .report-panel summary:hover {
    background: var(--subtle);
  }
  .report-panel form {
    max-width: 34rem;
    margin-top: 1.3rem;
  }
  .report-panel label {
    font-size: 0.85rem;
  }
  .report-panel button {
    font-size: 0.85rem;
  }
  .no-protocols {
    padding: 2rem 0 2.5rem;
    border-bottom: 1px solid var(--line);
  }
  .no-protocols h3 {
    font-size: 1.2rem;
    font-weight: 600;
    letter-spacing: -0.02em;
  }
  .no-protocols .button {
    font-size: 0.87rem;
  }
  @media (max-width: 1000px) {
    .lecture-layout {
      grid-template-columns: minmax(0, 1fr) 250px;
      gap: 2.3rem;
    }
    .access-panel {
      padding: 1.3rem 1.1rem;
    }
  }
  @media (max-width: 760px) {
    .lecture-heading {
      margin-bottom: 2rem;
    }
    .lecture-layout {
      display: flex;
      flex-direction: column;
      gap: 2.6rem;
    }
    .protocols-section {
      width: 100%;
    }
    .access-column {
      width: 100%;
      max-width: 34rem;
    }
    .access-panel {
      padding: 1.3rem 1.2rem;
    }
    .protocol-entry {
      padding: 1.4rem 0 1.5rem;
    }
    .protocol-entry dl {
      column-gap: 1.2rem;
    }
    .lecture-summary {
      gap: 0.5rem 1rem;
    }
    .lecture-summary p {
      font-size: 0.88rem;
    }
    .protocol-title h3 {
      font-size: 1.06rem;
    }
    .access-panel button {
      width: auto;
    }
  }
</style>
