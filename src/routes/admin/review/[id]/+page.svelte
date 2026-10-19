<script lang="ts">
  import { termLabel } from '$lib/terms';
  import { t, feedbackText, dateText } from '$lib/i18n';
  import { untrack } from 'svelte';
  import { page } from '$app/state';
  import { namedAction } from '$lib/form-actions';
  import Status from '$lib/components/Status.svelte';
  import Feedback from '$lib/components/Feedback.svelte';
  import DocumentPreview from '$lib/components/DocumentPreview.svelte';
  import AutomaticChecks from '$lib/components/AutomaticChecks.svelte';
  let language = $derived(page.data.preferences?.language ?? 'de');
  let { data, form } = $props();
  let lectureTitle = $derived(
    data.lectures
      .filter((lecture) => data.revision.lecture_ids.includes(lecture.id))
      .map((lecture) => lecture.name)
      .join(', ')
  );
  let acceptanceAvailable = $derived(
    data.revision.safety_status === 'clean' &&
      data.lectures.every(
        (lecture) =>
          !data.revision.lecture_ids.includes(lecture.id) || lecture.approval_status === 'approved'
      )
  );
  function initialOutcome() {
    const draft = form?.values?.outcome;
    if (draft === 'changes_requested' || draft === 'rejected') return draft;
    if (draft === 'accepted') return acceptanceAvailable ? draft : '';
    return acceptanceAvailable && data.revision.decisions.length === 0 ? 'accepted' : '';
  }
  let outcome = $state(untrack(initialOutcome));
  let validOutcome = $derived(
    outcome === 'changes_requested' ||
      outcome === 'rejected' ||
      (outcome === 'accepted' && acceptanceAvailable)
  );
  let reward = $state(
    untrack(
      () =>
        (validOutcome ? form?.values?.reward : undefined) ??
        (outcome === 'accepted' &&
        data.revision.revision_number === 1 &&
        !data.submission.rewardAllocation
          ? 'base'
          : 'none')
    )
  );
  let internalNote = $state(untrack(() => form?.values?.internalNote ?? ''));
  let previousOutcome = $state(untrack(() => outcome));
  let rewardDisabled = $derived(
    data.revision.revision_number > 1 ||
      !!data.submission.rewardAllocation ||
      outcome === 'changes_requested' ||
      !validOutcome
  );
  $effect(() => {
    if (outcome !== previousOutcome) {
      reward =
        outcome === 'accepted' &&
        data.revision.revision_number === 1 &&
        !data.submission.rewardAllocation
          ? 'base'
          : 'none';
      previousOutcome = outcome;
    }
  });
  let preview = $derived(reward === 'excellent' ? data.excellentPreview : data.basePreview);
  let additional = $derived(reward === 'none' ? 0 : preview.totalIssued);
  let unapprovedLectures = $derived(
    data.lectures.filter(
      (lecture) =>
        data.revision.lecture_ids.includes(lecture.id) && lecture.approval_status !== 'approved'
    )
  );
  function standardFeedback(value: string, locale: 'de' | 'en') {
    if (!value) return '';
    if (value === 'accepted')
      return t(
        locale,
        'Vielen Dank für deinen Beitrag. Dein Protokoll wurde geprüft und veröffentlicht.'
      );
    if (value === 'rejected')
      return t(
        locale,
        'Dein Protokoll kann in dieser Form nicht veröffentlicht werden. Bitte beachte die Rückmeldung der Redaktion.'
      );
    return t(
      locale,
      'Bitte überarbeite dein Protokoll anhand der Hinweise und reiche eine verbesserte Version ein.'
    );
  }
  let publicFeedback = $state(
    untrack(
      () =>
        (form?.values?.outcome === outcome ? form.values.publicFeedback : undefined) ??
        standardFeedback(outcome, language)
    )
  );
  let previousDefault = $state<string | undefined>(
    untrack(() => (form?.values?.outcome === outcome ? undefined : publicFeedback))
  );
  $effect(() => {
    const next = standardFeedback(outcome, language);
    if (publicFeedback === previousDefault) publicFeedback = next;
    previousDefault = next;
  });
  let previousSubmissionId = $state(untrack(() => data.submission.id));
  let previousValues = $state.raw(untrack(() => form?.values));
  $effect(() => {
    if (previousSubmissionId !== data.submission.id || previousValues !== form?.values) {
      previousSubmissionId = data.submission.id;
      previousValues = form?.values;
      untrack(() => {
        outcome = initialOutcome();
        previousOutcome = outcome;
        reward =
          (validOutcome ? form?.values?.reward : undefined) ??
          (outcome === 'accepted' &&
          data.revision.revision_number === 1 &&
          !data.submission.rewardAllocation
            ? 'base'
            : 'none');
        publicFeedback =
          (form?.values?.outcome === outcome ? form.values.publicFeedback : undefined) ??
          standardFeedback(outcome, language);
        previousDefault = form?.values?.outcome === outcome ? undefined : publicFeedback;
        internalNote = form?.values?.internalNote ?? '';
      });
    }
  });
</script>

{#if data.submission.files_deleted_at}<div class="notice warning">
    {t(
      language,
      'Die Protokolldateien wurden gelöscht oder zur Löschung eingereiht. Metadaten, Entscheidungen und Tokenbuchungen bleiben erhalten.'
    )}
  </div>{/if}
{#if !data.submission.files_deleted_at && unapprovedLectures.length}<div class="notice warning">
    {t(
      language,
      'Vor der Veröffentlichung müssen diese Veranstaltungsvorschläge freigegeben werden:'
    )}
    {unapprovedLectures.map((lecture) => lecture.name).join(', ')}.
    <a href="/admin/catalogue?review={encodeURIComponent(data.submission.id)}"
      >{t(language, 'Katalog prüfen')}</a
    >
  </div>{/if}
<div class="page-head">
  <div>
    <p class="eyebrow">
      <a href={data.reviewListHref}>{t(language, 'Prüfwarteschlange')}</a>
      {t(language, '/ Einreichung')}
    </p>
    <h1>{lectureTitle}</h1>
    <p>
      {t(language, 'Version')}
      {data.revision.revision_number}
      {t(language, ', Einreichung')}
      {data.submission.id}
    </p>
  </div>
  <Status value={data.submission.review_state} />
</div>
{#if form?.reviewSaved}
  <div class="notice review-complete">
    <div role="status">
      <strong>{t(language, 'Entscheidung gespeichert.')}</strong>
      {#if !data.nextReview}
        <p>
          {t(language, 'Keine weiteren prüfbereiten Protokolle.')}
        </p>
      {/if}
    </div>
    <div class="actions">
      <a class="button secondary" href={data.reviewListHref}>{t(language, 'Prüfwarteschlange')}</a>
      {#if data.nextReview}
        <a class="button" href="/admin/review/{data.nextReview.id}{data.reviewContext}">
          {t(language, 'Nächstes Protokoll')}
        </a>
      {/if}
    </div>
  </div>
{:else}
  <Feedback {form} />
{/if}
<div class="two-column">
  <div class="stack">
    {#if data.revision.safety_status === 'clean' && !data.submission.files_deleted_at}
      <section class="card document-preview">
        <div class="split">
          <h2>
            {t(language, 'Vorschau')} · {t(language, 'Version')}
            {data.revision.revision_number}
          </h2>
          <div class="actions">
            <a href="/files/{data.revision.id}">{t(language, 'Herunterladen')}</a>
          </div>
        </div>
        {#key `${data.revision.id}:${data.contentChecks?.ocrStatus ?? 'none'}`}
          <DocumentPreview src="/files/{data.revision.id}?preview=1" {language} />
        {/key}
      </section>
    {/if}
    <section class="card">
      <div class="split">
        <h2>{t(language, 'Datei und Prüfergebnis')}</h2>
        {#if data.revision.safety_status !== 'clean'}
          <Status value={data.revision.safety_status} />
        {/if}
      </div>
      {#if data.revision.safety_status !== 'clean' && data.revision.safety_detail}<p class="hint">
          {feedbackText(language, data.revision.safety_detail)}
        </p>{/if}
      {#if data.revision.safety_status !== 'clean' || data.submission.files_deleted_at}<div
          class="notice warning"
        >
          {t(
            language,
            'Die Datei kann erst nach erfolgreicher technischer Prüfung geöffnet und veröffentlicht werden.'
          )}
        </div>{/if}
      <hr class="divider" />
      <dl>
        <dt>{t(language, 'Veranstaltungen')}</dt>
        <dd>
          {data.lectures
            .filter((l) => data.revision.lecture_ids.includes(l.id))
            .map((l) => l.name)
            .join(', ') || t(language, 'Keine Zuordnung')}
        </dd>
        <dt>{t(language, 'Prüfende Person')}</dt>
        <dd>
          {data.revision.examiner_name || t(language, 'Nicht angegeben')}
        </dd>
        <dt>{t(language, 'Semester')}</dt>
        <dd>{termLabel(language, data.revision.term)}</dd>
        <dt>{t(language, 'Prüfungsdatum')}</dt>
        <dd>
          {data.revision.exam_date
            ? dateText(language, data.revision.exam_date)
            : t(language, 'Nicht angegeben')}
        </dd>
      </dl>
      {#if data.revision.remarks}<h3>{t(language, 'Anmerkungen')}</h3>
        <p>{data.revision.remarks}</p>{/if}
    </section>
    <details class="card" open={page.url.hash.startsWith('#revision-')}>
      <summary>{t(language, 'Versionen und Entscheidungen')}</summary>
      {#each data.submission.revisions as revision}<details
          id="revision-{revision.id}"
          open={revision.id === data.revision.id || page.url.hash === `#revision-${revision.id}`}
        >
          <summary
            >{t(language, 'Version')} {revision.revision_number}, {revision.original_name}</summary
          >
          {#if revision.safety_status !== 'clean'}
            <p><Status value={revision.safety_status} /></p>
          {/if}
          {#if revision.safety_status === 'clean' && !data.submission.files_deleted_at}<a
              href="/files/{revision.id}">{t(language, 'Datei herunterladen')}</a
            >{/if}{#each revision.decisions as decision}<hr class="divider" />
            <Status value={decision.outcome} />
            <p>{decision.public_feedback}</p>
            {#if decision.internal_note}<p class="hint">
                <strong>{t(language, 'Interne Notiz:')}</strong>
                {decision.internal_note}
              </p>{/if}{:else}<p class="hint">
              {t(language, 'Noch keine redaktionelle Entscheidung.')}
            </p>{/each}
          {#each revision.reconsiderations as reconsideration}
            <hr class="divider" />
            <h3>{t(language, 'Erneute Prüfung angefragt')}</h3>
            <p>{reconsideration.explanation}</p>
            <p class="hint">
              {reconsideration.status === 'open'
                ? t(language, 'Offen')
                : t(language, 'report.resolved')} · {dateText(language, reconsideration.created_at)}
            </p>
            {#if reconsideration.resolution}<p>{reconsideration.resolution}</p>{/if}
          {/each}
        </details>{/each}
    </details>
    {#if !data.submission.files_deleted_at}
      <details class="card">
        <summary>{t(language, 'Dateiprüfung erneut ausführen')}</summary>
        <div class="split">
          <div>
            <p class="hint">
              {t(
                language,
                'Die Datei wird bis zum Abschluss der neuen Prüfung gesperrt. Die redaktionelle Entscheidung bleibt erhalten.'
              )}
            </p>
          </div>
          <form method="POST" action={namedAction(page.url, 'reprocess')}>
            <label
              >{t(language, 'Dateiversion')}
              <select name="revisionId">
                {#each data.submission.revisions as revision}<option value={revision.id}>
                    {t(language, 'Version')}
                    {revision.revision_number}: {revision.original_name}{revision.id ===
                    data.submission.published_revision_id
                      ? t(language, ' (veröffentlicht)')
                      : ''}
                  </option>{/each}
              </select>
            </label>
            <button class="secondary">{t(language, 'Prüfung neu starten')}</button>
          </form>
        </div>
      </details>
    {/if}
  </div>
  <aside class="stack">
    {#if data.contentChecks}
      {#key data.submission.id}<AutomaticChecks
          initialReport={data.contentChecks}
          submissionId={data.submission.id}
          {language}
        />{/key}
    {/if}
    {#if !data.submission.files_deleted_at}
      <section class="card">
        <h2>{t(language, 'Entscheidung')}</h2>
        <form method="POST" action={namedAction(page.url, 'decide')}>
          <input
            type="hidden"
            name="revisionId"
            value={form?.values?.revisionId ?? data.revision.id}
          /><input
            type="hidden"
            name="version"
            value={form?.values?.version ?? data.submission.version}
          /><input
            type="hidden"
            name="requestKey"
            value={form?.values?.requestKey ?? data.requestKey}
          /><input
            type="hidden"
            name="rewardPolicyVersion"
            value={form?.values?.rewardPolicyVersion ?? preview.policyVersion}
          />{#each form?.values?.rewardRecipientIds ?? preview.recipients.map((recipient) => recipient.id) as recipientId}<input
              type="hidden"
              name="rewardRecipientIds"
              value={recipientId}
            />{/each}
          {#if form?.requiresRefresh}<div class="notice warning">
              {t(
                language,
                'Deine Eingaben wurden erhalten. Lade vor dem Speichern den aktuellen Stand und prüfe die Entscheidung erneut.'
              )}
            </div>{/if}
          <label
            >{t(language, 'Veröffentlichung')}<select name="outcome" bind:value={outcome} required
              ><option value="" disabled>{t(language, 'Entscheidung wählen')}</option><option
                value="accepted"
                disabled={!acceptanceAvailable}
                >{t(language, 'Annehmen und veröffentlichen')}</option
              ><option value="changes_requested">{t(language, 'Überarbeitung erbitten')}</option
              ><option value="rejected">{t(language, 'Ablehnen')}</option></select
            ></label
          ><label
            >{t(language, 'Öffentliche Rückmeldung')}<textarea
              name="publicFeedback"
              bind:value={publicFeedback}
              required
              maxlength="4000"
              placeholder={t(language, 'Diese Rückmeldung erhält das einreichende Konto.')}
            ></textarea></label
          ><label
            >{t(language, 'Interne Notiz')}
            <span class="muted">{t(language, '(optional)')}</span><textarea
              name="internalNote"
              bind:value={internalNote}
              maxlength="4000"></textarea></label
          ><label
            >{t(language, 'Tokenbelohnung')}<select
              name="reward"
              bind:value={reward}
              disabled={rewardDisabled}
              ><option value="none">{t(language, 'Keine Tokens')}</option><option value="base"
                >{t(language, 'Standard:')} {data.basePreview.nominalAmount} nominal</option
              ><option value="excellent"
                >{t(language, 'Ausgezeichnet:')}
                {data.excellentPreview.nominalAmount} nominal</option
              ></select
            ></label
          >{#if rewardDisabled}<input
              type="hidden"
              name="reward"
              value={form?.requiresRefresh ? reward : 'none'}
            />
            {#if !data.submission.rewardAllocation && validOutcome}<p class="hint">
                {data.revision.revision_number > 1
                  ? t(language, 'Verbesserungen erhalten keine weiteren Tokens.')
                  : t(language, 'Bei erbetener Überarbeitung werden keine Tokens vergeben.')}
              </p>{/if}{/if}
          {#if data.submission.rewardAllocation}<div class="notice">
              {t(
                language,
                'Für diese Einreichung wurden bereits Tokens vergeben. Eine erneute Entscheidung erzeugt keine weitere Belohnung.'
              )}
            </div>
            {#each data.submission.rewardRecipients as recipient}<p class="hint">
                {recipient.email.split('@')[0]}: {recipient.amount}
                {t(language, 'Tokens')}
              </p>{/each}{:else if reward !== 'none' && !rewardDisabled}<div class="notice">
              <strong>{t(language, 'Ausgabe:')} {additional} {t(language, 'Tokens gesamt')}</strong
              >{#each preview.recipients as recipient}<p class="hint" style="margin:.4rem 0">
                  {recipient.email.split('@')[0]}: {recipient.amount}
                  {t(language, 'Tokens')}
                </p>{/each}
            </div>{/if}
          <p class="hint">
            {t(
              language,
              'Unbekannte oder nicht berechtigte Mitwirkende werden nicht in die Aufteilung einbezogen. Ablehnen mit Belohnung ist möglich.'
            )}
          </p>
          <label
            ><input type="checkbox" name="confirmed" required />{t(
              language,
              'Veröffentlichungsentscheidung, Empfänger und Tokenvergabe bestätigen'
            )}</label
          ><button disabled={form?.requiresRefresh || !validOutcome}
            >{t(language, 'Entscheidung speichern')}</button
          >
          {#if form?.values}<button
              class="secondary"
              formaction={namedAction(page.url, 'refreshDecision')}
              formnovalidate>{t(language, 'Aktuellen Stand laden und erneut prüfen')}</button
            >{/if}
        </form>
      </section>
    {/if}
    {#if !data.submission.files_deleted_at && data.submission.published_revision_id && data.submission.visibility === 'published'}<section
        class="card"
      >
        <h2>{t(language, 'Veröffentlichung zurückziehen')}</h2>
        <p class="hint">
          {t(
            language,
            'Der Zugriff auf die veröffentlichte Version wird gesperrt. Die Versionsgeschichte bleibt erhalten.'
          )}
        </p>
        <details>
          <summary>{t(language, 'Zurückziehen')}</summary>
          <form method="POST" action={namedAction(page.url, 'withdraw')} style="margin-top:1rem">
            <input type="hidden" name="version" value={data.submission.version} /><input
              type="hidden"
              name="publishedRevisionId"
              value={data.submission.published_revision_id}
            /><label
              >{t(language, 'Begründung')}<textarea name="reason" required maxlength="4000"
              ></textarea></label
            ><label
              ><input type="checkbox" name="confirmed" required />{t(
                language,
                'Zurückziehen bestätigen'
              )}</label
            ><button class="danger">{t(language, 'Veröffentlichung zurückziehen')}</button>
          </form>
        </details>
      </section>{/if}
    {#if !data.submission.files_deleted_at}<section class="card">
        <h2>{t(language, 'Protokolldateien löschen')}</h2>
        <p class="hint">
          {t(
            language,
            'Alle Dateiversionen und betroffene ZIP-Archive werden entfernt. Metadaten, Entscheidungen und Tokenbuchungen bleiben erhalten.'
          )}
        </p>
        <details>
          <summary>{t(language, 'Dateilöschung anfordern')}</summary>
          <form
            method="POST"
            action={namedAction(page.url, 'deleteFiles')}
            class="stack"
            style="margin-top:1rem"
          >
            <input type="hidden" name="version" value={data.submission.version} /><label
              >{t(language, 'Begründung')}<textarea name="reason" required maxlength="2000"
              ></textarea></label
            ><label
              >{t(language, 'Zur Bestätigung DELETE eingeben')}<input
                name="confirmation"
                required
                pattern="DELETE"
                autocomplete="off"
              /></label
            ><label
              ><input type="checkbox" name="confirmed" required />{t(
                language,
                'Dateien dauerhaft löschen; Verlauf behalten'
              )}</label
            ><button class="danger">{t(language, 'Protokolldateien löschen')}</button>
          </form>
        </details>
      </section>{/if}
  </aside>
</div>

<style>
  .review-complete {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 1rem;
  }
  .review-complete p {
    margin: 0.4rem 0 0;
  }
  .review-complete .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }
  .document-preview {
    padding: 0;
    overflow: hidden;
  }
  .document-preview > .split {
    padding: 1rem 1.25rem;
    flex-wrap: wrap;
    gap: 0.75rem;
  }
  .document-preview h2 {
    margin: 0;
  }
  .document-preview .actions {
    font-size: 0.875rem;
  }
</style>
