<script lang="ts">
  import { text, t, protocolCountLabel } from '$lib/i18n';
  import { page } from '$app/state';
  import { namedAction } from '$lib/form-actions';
  import Feedback from '$lib/components/Feedback.svelte';
  import Pagination from '$lib/components/Pagination.svelte';
  let { data, form } = $props();
  let language = $derived(page.data.preferences?.language ?? 'de');
</script>

<div class="page-head"><h1>{t(language, 'Katalog pflegen')}</h1></div>
<Feedback {form} />
{#if data.reviewHref}
  <div class="notice">
    <p>
      {data.reviewReady
        ? text(language, 'Alle Veranstaltungen sind freigegeben.', 'All lectures are approved.')
        : text(
            language,
            'Veranstaltungen dieser Einreichung prüfen.',
            'Review the lectures for this submission.'
          )}
    </p>
    <a href={data.reviewHref}>{text(language, 'Zurück zur Einreichung', 'Return to submission')}</a>
    · <a href="/admin/catalogue">{text(language, 'Alle Veranstaltungen', 'All lectures')}</a>
  </div>
{:else}
  <form method="GET" class="search" style="margin-bottom:1.5rem">
    <label for="q"
      >{text(language, 'Suchen', 'Search')}<input
        id="q"
        name="q"
        type="search"
        maxlength="200"
        value={data.q}
      /></label
    ><label for="status"
      >{text(language, 'Freigabestatus', 'Approval status')}<select
        id="status"
        name="status"
        value={data.approvalStatus}
      >
        <option value="all">{text(language, 'Alle', 'All')}</option><option value="pending"
          >{text(language, 'Wartet auf Prüfung', 'Awaiting review')}</option
        >
        <option value="approved">{text(language, 'Freigegeben', 'Approved')}</option><option
          value="rejected">{text(language, 'Abgelehnt', 'Rejected')}</option
        ></select
      ></label
    >
    <button class="secondary">{text(language, 'Suchen', 'Search')}</button>
  </form>
{/if}
<div class="grid" style="margin-bottom:2rem">
  <section class="card">
    <h2>{t(language, 'Veranstaltung anlegen')}</h2>
    <form method="POST" action={namedAction(page.url, 'lecture')} class="inline-form">
      <label>{t(language, 'Name')}<input name="name" required maxlength="200" /></label><button
        >{t(language, 'Anlegen')}</button
      >
    </form>
  </section>
</div>
<section class="card">
  <h2>{t(language, 'Veranstaltungen')}</h2>
  {#each data.entries as entry}<div class="list-row">
      <div>
        <h3><a href="/lectures/{entry.id}">{entry.name}</a></h3>
        <p class="hint">
          {#if !data.reviewHref}{entry.protocol_count}
            {protocolCountLabel(language, entry.protocol_count)};{/if}
          {entry.archived ? t(language, 'Archiviert') : t(language, 'Aktiv')}
        </p>
        <p class="hint">
          {entry.approval_status === 'pending'
            ? text(language, 'Vorschlag wartet auf Prüfung', 'Proposal awaiting review')
            : entry.approval_status === 'rejected'
              ? text(language, 'Vorschlag abgelehnt', 'Proposal rejected')
              : text(language, 'Freigegeben', 'Approved')}{entry.aliases.length
            ? ` · ${entry.aliases.join(', ')}`
            : ''}
        </p>
        <details>
          <summary>{text(language, 'Name und Aliasse bearbeiten', 'Edit name and aliases')}</summary
          >
          <form
            method="POST"
            action={namedAction(page.url, 'editLecture')}
            class="stack"
            style="margin-top:1rem"
          >
            <input type="hidden" name="id" value={entry.id} /><input
              type="hidden"
              name="version"
              value={entry.version}
            /><label
              >{t(language, 'Name')}<input
                name="name"
                value={entry.name}
                required
                maxlength="200"
              /></label
            ><label
              >{text(
                language,
                'Aliasse, ein Eintrag pro Zeile',
                'Aliases, one entry per line'
              )}<textarea name="aliases" maxlength="4000" value={entry.aliases.join('\n')}
              ></textarea></label
            ><button class="secondary"
              >{text(language, 'Änderungen speichern', 'Save changes')}</button
            >
          </form>
        </details>
        <details style="margin-top:.8rem">
          <summary>{t(language, 'Prüfende Personen')}</summary>
          <div class="stack" style="margin-top:1rem">
            {#each data.lectureExaminers[entry.id] as examiner}<div>
                <form
                  method="POST"
                  action={namedAction(page.url, 'renameExaminer')}
                  class="inline-form"
                >
                  <input type="hidden" name="lectureId" value={entry.id} /><input
                    type="hidden"
                    name="examinerId"
                    value={examiner.id}
                  /><label
                    >{t(language, 'Name')}<input
                      name="name"
                      value={examiner.name}
                      required
                      maxlength="200"
                    /></label
                  ><button class="secondary">{text(language, 'Speichern', 'Save')}</button>
                </form>
                <form
                  method="POST"
                  action={namedAction(page.url, 'removeExaminer')}
                  style="margin-top:.4rem"
                >
                  <input type="hidden" name="lectureId" value={entry.id} /><input
                    type="hidden"
                    name="examinerId"
                    value={examiner.id}
                  /><button class="secondary"
                    >{text(language, 'Zuordnung entfernen', 'Remove link')}</button
                  >
                </form>
              </div>{:else}<p class="hint">
                {text(
                  language,
                  'Noch keine prüfenden Personen zugeordnet.',
                  'No examiners linked yet.'
                )}
              </p>{/each}
            <form method="POST" action={namedAction(page.url, 'addExaminer')} class="inline-form">
              <input type="hidden" name="lectureId" value={entry.id} /><label
                >{text(language, 'Prüfende Person hinzufügen', 'Add examiner')}<input
                  name="name"
                  required
                  maxlength="200"
                /></label
              ><button class="secondary">{text(language, 'Hinzufügen', 'Add')}</button>
            </form>
          </div>
        </details>
        {#if entry.approval_status !== 'approved'}<form
            method="POST"
            action={namedAction(page.url, 'decideLecture')}
            class="inline-form"
            style="margin-top:1rem"
          >
            <input type="hidden" name="id" value={entry.id} /><input
              type="hidden"
              name="version"
              value={entry.version}
            /><button name="outcome" value="approved"
              >{text(language, 'Vorschlag freigeben', 'Approve proposal')}</button
            >{#if entry.approval_status === 'pending'}<button
                name="outcome"
                value="rejected"
                class="secondary">{text(language, 'Vorschlag ablehnen', 'Reject proposal')}</button
              >{/if}
          </form>{/if}
      </div>
      <form method="POST" action={namedAction(page.url, 'archive')}>
        <input type="hidden" name="id" value={entry.id} /><input
          type="hidden"
          name="version"
          value={entry.version}
        /><input type="hidden" name="archived" value={String(!entry.archived)} /><button
          class="secondary"
          >{entry.archived ? t(language, 'Reaktivieren') : t(language, 'Archivieren')}</button
        >
      </form>
    </div>{:else}<p class="muted">{t(language, 'Noch keine Veranstaltungen.')}</p>{/each}
</section>

{#if !data.reviewHref}<Pagination
    page={data.page}
    total={data.total}
    pageSize={data.pageSize}
  />{/if}
