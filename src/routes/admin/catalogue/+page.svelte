<script lang="ts">
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import { t, protocolCountLabel } from '$lib/i18n';
  import { page } from '$app/state';
  import { namedAction } from '$lib/form-actions';
  import Feedback from '$lib/components/Feedback.svelte';
  import Pagination from '$lib/components/Pagination.svelte';
  import SearchForm from '$lib/components/SearchForm.svelte';
  let { data, form } = $props();
  let language = $derived(page.data.preferences?.language ?? 'de');
  let editingId = $state<string | null>(null);
  const preserveEditor: SubmitFunction =
    () =>
    async ({ update }) => {
      await update({ reset: false });
    };
</script>

<div class="page-head"><h1>{t(language, 'Katalog pflegen')}</h1></div>
<Feedback {form} />
{#if data.reviewHref}
  <div class="notice">
    <p>
      {data.reviewReady
        ? t(language, 'Alle Veranstaltungen sind freigegeben.')
        : t(language, 'Veranstaltungen dieser Einreichung prüfen.')}
    </p>
    <a href={data.reviewHref}>{t(language, 'Zurück zur Einreichung')}</a>
    · <a href="/admin/catalogue">{t(language, 'Alle Veranstaltungen')}</a>
  </div>
{:else}
  <SearchForm query={data.q}>
    <label for="status">
      {t(language, 'Freigabestatus')}
      <select id="status" name="status" value={data.approvalStatus}>
        <option value="all">{t(language, 'Alle')}</option>
        <option value="pending">{t(language, 'Wartet auf Prüfung')}</option>
        <option value="approved">{t(language, 'Freigegeben')}</option>
        <option value="rejected">{t(language, 'Abgelehnt')}</option>
      </select>
    </label>
  </SearchForm>
{/if}

<section class="card create-lecture">
  <h2>{t(language, 'Veranstaltung anlegen')}</h2>
  <form
    method="POST"
    action={namedAction(page.url, 'lecture')}
    use:enhance
    class="new-lecture-form"
  >
    <label>{t(language, 'Name')}<input name="name" required maxlength="200" /></label>
    <label>
      {t(language, 'Prüfende Person (optional)')}
      <input name="examinerName" maxlength="200" />
    </label>
    <label class="aliases">
      {t(language, 'Aliasse (optional, ein Eintrag pro Zeile)')}
      <textarea name="aliases" maxlength="4000" rows="2"></textarea>
    </label>
    <button>{t(language, 'Anlegen')}</button>
  </form>
</section>

<section class="card">
  <h2>{t(language, 'Veranstaltungen')}</h2>
  {#each data.entries as entry (entry.id)}
    <article class="lecture-entry" aria-labelledby="lecture-name-{entry.id}">
      <div class="lecture-heading">
        <div>
          <h3 id="lecture-name-{entry.id}"><a href="/lectures/{entry.id}">{entry.name}</a></h3>
          <p class="hint lecture-status">
            {#if !data.reviewHref}
              <span
                >{entry.protocol_count} {protocolCountLabel(language, entry.protocol_count)}</span
              >
            {/if}
            <span>{entry.archived ? t(language, 'Archiviert') : t(language, 'Aktiv')}</span>
            <span>
              {entry.approval_status === 'pending'
                ? t(language, 'Vorschlag wartet auf Prüfung')
                : entry.approval_status === 'rejected'
                  ? t(language, 'Vorschlag abgelehnt')
                  : t(language, 'Freigegeben')}
            </span>
          </p>
          {#if entry.aliases.length}<p class="hint lecture-aliases">
              {entry.aliases.join(', ')}
            </p>{/if}
        </div>
        <button
          type="button"
          class="secondary edit-lecture"
          aria-expanded={editingId === entry.id}
          aria-controls="lecture-editor-{entry.id}"
          onclick={() => (editingId = editingId === entry.id ? null : entry.id)}
          >{editingId === entry.id ? t(language, 'Schließen') : t(language, 'Bearbeiten')}</button
        >
      </div>

      {#if editingId === entry.id}
        <div id="lecture-editor-{entry.id}" class="lecture-editor">
          <form
            method="POST"
            action={namedAction(page.url, 'editLecture')}
            use:enhance={preserveEditor}
            class="stack"
          >
            <input type="hidden" name="id" value={entry.id} />
            <input type="hidden" name="version" value={entry.version} />
            <label
              >{t(language, 'Name')}<input
                name="name"
                value={entry.name}
                required
                maxlength="200"
              /></label
            >
            <label>
              {t(language, 'Aliasse, ein Eintrag pro Zeile')}
              <textarea name="aliases" maxlength="4000" rows="2" value={entry.aliases.join('\n')}
              ></textarea>
            </label>
            <button class="secondary">{t(language, 'Speichern')}</button>
          </form>

          <section class="lecture-examiners">
            <h4>{t(language, 'Prüfende Personen')}</h4>
            <div class="stack">
              {#each data.lectureExaminers[entry.id] as examiner (examiner.id)}
                <form
                  method="POST"
                  action={namedAction(page.url, 'renameExaminer')}
                  use:enhance={preserveEditor}
                  class="inline-form examiner-form"
                >
                  <input type="hidden" name="lectureId" value={entry.id} />
                  <input type="hidden" name="examinerId" value={examiner.id} />
                  <label
                    >{t(language, 'Name')}<input
                      name="name"
                      value={examiner.name}
                      required
                      maxlength="200"
                    /></label
                  >
                  <button class="secondary">{t(language, 'Speichern')}</button>
                  <button
                    class="secondary remove-examiner"
                    formaction={namedAction(page.url, 'removeExaminer')}
                    formnovalidate
                    aria-label={t(language, 'Zuordnung entfernen')}
                    title={t(language, 'Zuordnung entfernen')}>×</button
                  >
                </form>
              {:else}
                <p class="hint">
                  {t(language, 'Noch keine prüfenden Personen zugeordnet.')}
                </p>
              {/each}
              <form
                method="POST"
                action={namedAction(page.url, 'addExaminer')}
                use:enhance={preserveEditor}
                class="inline-form examiner-form"
              >
                <input type="hidden" name="lectureId" value={entry.id} />
                <label
                  >{t(language, 'Prüfende Person hinzufügen')}<input
                    name="name"
                    required
                    maxlength="200"
                  /></label
                >
                <button class="secondary">{t(language, 'Hinzufügen')}</button>
              </form>
            </div>
          </section>

          <form
            method="POST"
            action={namedAction(page.url, 'archive')}
            use:enhance={preserveEditor}
            class="archive-lecture"
          >
            <input type="hidden" name="id" value={entry.id} />
            <input type="hidden" name="version" value={entry.version} />
            <input type="hidden" name="archived" value={String(!entry.archived)} />
            <button class="secondary"
              >{entry.archived ? t(language, 'Reaktivieren') : t(language, 'Archivieren')}</button
            >
          </form>
        </div>
      {/if}
      {#if entry.approval_status !== 'approved'}
        <form
          method="POST"
          action={namedAction(page.url, 'decideLecture')}
          use:enhance={preserveEditor}
          class="inline-form lecture-approval"
        >
          <input type="hidden" name="id" value={entry.id} />
          <input type="hidden" name="version" value={entry.version} />
          <button name="outcome" value="approved">{t(language, 'Vorschlag freigeben')}</button>
          {#if entry.approval_status === 'pending'}
            <button name="outcome" value="rejected" class="secondary"
              >{t(language, 'Vorschlag ablehnen')}</button
            >
          {/if}
        </form>
      {/if}
    </article>
  {:else}
    <p class="muted">{t(language, 'Noch keine Veranstaltungen.')}</p>
  {/each}
</section>

{#if !data.reviewHref}<Pagination
    page={data.page}
    total={data.total}
    pageSize={data.pageSize}
  />{/if}

<style>
  .create-lecture {
    margin-bottom: 32px;
  }
  .new-lecture-form {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 18px 22px;
    align-items: end;
  }
  .new-lecture-form .aliases {
    grid-column: 1 / -1;
  }
  .new-lecture-form button {
    justify-self: start;
  }
  .lecture-entry {
    padding: 24px 0;
    border-top: 1px solid var(--line);
  }
  .lecture-entry:last-child {
    padding-bottom: 0;
  }
  .lecture-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 20px;
  }
  .lecture-heading h3 {
    margin: 0 0 10px;
  }
  .lecture-status {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    margin: 0;
  }
  .lecture-aliases {
    margin: 8px 0 0;
  }
  .edit-lecture {
    flex-shrink: 0;
  }
  .lecture-editor {
    display: grid;
    gap: 24px;
    padding-top: 24px;
  }
  .lecture-editor form > button {
    justify-self: start;
  }
  .lecture-examiners {
    border-top: 1px solid var(--line);
    padding-top: 24px;
  }
  .lecture-examiners h4 {
    margin: 0 0 18px;
    font-size: 16px;
  }
  .examiner-form {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 112px 44px;
    align-items: end;
  }
  .examiner-form button {
    width: 100%;
    min-height: 46px;
  }
  .examiner-form label {
    min-width: 0;
  }
  .remove-examiner {
    width: 44px;
    padding: 8px;
    font-size: 24px;
    line-height: 1;
    grid-column: 3;
  }
  .archive-lecture {
    padding-top: 24px;
    border-top: 1px solid var(--line);
  }
  .lecture-approval {
    margin-top: 20px;
  }
  @media (max-width: 600px) {
    .new-lecture-form {
      grid-template-columns: 1fr;
    }
    .lecture-heading {
      gap: 12px;
    }
    .examiner-form {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 96px 44px;
    }
  }
</style>
