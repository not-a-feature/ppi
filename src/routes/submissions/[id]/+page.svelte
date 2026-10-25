<script lang="ts">
  import { t, dateText } from '#lib/i18n.js';
  import { page } from '$app/state';
  import Status from '#lib/components/Status.svelte';
  import Feedback from '#lib/components/Feedback.svelte';
  import ProtocolForm from '#lib/components/ProtocolForm.svelte';
  import { termLabel } from '#lib/terms.js';
  let language = $derived(page.data.preferences?.language ?? 'de');
  let { data, form } = $props();
  let publishedRevision = $derived(
    data.submission.visibility === 'published' && !data.submission.files_deleted_at
      ? data.submission.revisions.find(
          (revision: { id: string; revision_number: number; file_deleted_at: Date | null }) =>
            revision.id === data.submission.published_revision_id && !revision.file_deleted_at
        )
      : undefined
  );
</script>

<div class="page-head">
  <div>
    <p class="eyebrow">
      <a href="/submissions">{t(language, 'Meine Beiträge')}</a>
    </p>
    <h1>{t(language, 'Dein Prüfungsprotokoll')}</h1>
  </div>
  <div class="actions">
    <span
      >{t(language, 'Aktuelle Version')}
      {data.submission.revisions[0].revision_number}: <Status
        value={data.submission.review_state}
      /></span
    >
  </div>
</div>
<Feedback {form} />
<div class="narrow">
  <p class="hint">
    {#if publishedRevision}
      {t(language, 'submission.version')}
      {publishedRevision.revision_number}
      {t(language, 'ist veröffentlicht.')}
    {:else}
      {t(language, 'Derzeit keine veröffentlichte Version.')}
    {/if}
  </p>
  <section class="stack">
    {#each data.submission.revisions as revision}<article class="card">
        <div class="split">
          <h2>
            {t(language, 'Version')}
            {revision.revision_number}
            {#if revision.id === publishedRevision?.id}<span class="badge good"
                >{t(language, 'Veröffentlicht')}</span
              >{/if}
          </h2>
          {#if revision.file_deleted_at}<span class="badge">{t(language, 'Datei gelöscht')}</span
            >{:else}<Status value={revision.safety_status} />{/if}
        </div>
        <p>{revision.original_name}</p>
        <dl>
          <dt>{t(language, 'Semester')}</dt>
          <dd>{termLabel(language, revision.term)}</dd>
          <dt>{t(language, 'Prüfungsdatum')}</dt>
          <dd>
            {revision.exam_date
              ? dateText(language, revision.exam_date)
              : t(language, 'Nicht angegeben')}
          </dd>
        </dl>
        {#if revision.remarks}<p class="hint">
            {revision.remarks}
          </p>{/if}{#if !revision.file_deleted_at && revision.safety_status === 'clean'}<a
            class="button secondary"
            href="/files/{revision.id}">{t(language, 'Eigene Datei herunterladen')}</a
          >{:else if !revision.file_deleted_at}<p class="hint">
            {t(language, 'Download nach erfolgreicher Dateiprüfung verfügbar.')}
          </p>{/if}{#each revision.decisions as decision}<hr class="divider" />
          <Status value={decision.outcome} />{#if decision.public_feedback}<p>
              {decision.public_feedback}
            </p>{/if}{/each}
        {#each revision.reconsiderations as reconsideration}
          <hr class="divider" />
          <h3>{t(language, 'Erneute Prüfung')}</h3>
          <p>{reconsideration.explanation}</p>
          <p class="hint">
            {reconsideration.status === 'open'
              ? t(language, 'Offen')
              : t(language, 'report.resolved')}
          </p>
          {#if reconsideration.resolution}<p>{reconsideration.resolution}</p>{/if}
        {/each}
      </article>{/each}
  </section>
</div>
{#if data.canImprove && ['rejected', 'changes_requested'].includes(data.submission.review_state)}<section
    class="card narrow"
    style="margin-top:2rem"
  >
    <h2>{t(language, 'Erneute Prüfung anfragen')}</h2>
    <form method="POST" action="?/reconsider">
      <label
        >{t(language, 'Begründung')}<textarea
          name="explanation"
          minlength="10"
          maxlength="2000"
          required></textarea></label
      ><button class="secondary">{t(language, 'Erneute Prüfung anfragen')}</button>
    </form>
  </section>{/if}
{#if data.canImprove}<details
    id="improvement"
    class="narrow"
    style="margin-top:3rem"
    open={Boolean(form?.values)}
  >
    <summary>{t(language, 'Optional: Verbesserung einreichen')}</summary>
    <ProtocolForm
      lectures={data.lectures}
      examiners={data.examiners}
      requestKey={data.requestKey}
      values={form?.values ?? data.initialValues}
      inheritedTerm={data.initialValues.term}
      improvement
    />
  </details>{/if}
