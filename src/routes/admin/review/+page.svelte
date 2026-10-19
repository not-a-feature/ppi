<script lang="ts">
  import { t, dateText } from '$lib/i18n';
  import { page } from '$app/state';
  import Status from '$lib/components/Status.svelte';

  import LocalList from '$lib/components/LocalList.svelte';
  let { data } = $props();
  let language = $derived(page.data.preferences?.language ?? 'de');
</script>

{#if data.lecture}<a href="/admin/catalogue">{t(language, 'Katalog pflegen')}</a>{/if}
<div class="page-head"><h1>{data.lecture?.name ?? t(language, 'Einreichungen prüfen')}</h1></div>

<LocalList
  entries={data.entries}
  query={data.q}
  initialPage={data.page}
  initialFilters={{ scope: data.scope }}
  matches={(row, filters) =>
    (!data.lecture || row.lecture_ids.includes(data.lecture.id)) &&
    (filters.scope === 'all' ||
      (!row.files_deleted_at &&
        !row.file_deleted_at &&
        (filters.scope === 'ready'
          ? row.review_state === 'awaiting_review' && row.safety_status === 'clean'
          : ['processing', 'awaiting_review', 'changes_requested'].includes(row.review_state))))}
>
  {#snippet filters(filters)}
    <label
      >{t(language, 'Anzeigen')}<select name="scope"
        ><option value="pending" selected={filters.scope === 'pending'}
          >{t(language, 'Ausstehend')}</option
        ><option value="ready" selected={filters.scope === 'ready'}
          >{t(language, 'Prüfbereit')}</option
        ><option value="all" selected={filters.scope === 'all'}>{t(language, 'Alle')}</option
        ></select
      ></label
    >
  {/snippet}
  {#snippet children(rows, start)}
    <section class="card">
      {#each rows as entry}<div class="list-row">
          <div class="review-entry-label">
            <h3>
              <a
                class="review-entry-title"
                href={data.lecture
                  ? `/admin/review/${entry.id}?lecture=${data.lecture.id}`
                  : `/admin/review/${entry.id}`}
                title={entry.lecture_names.join(', ')}
                >{#if entry.upload_number}{entry.upload_number}.
                {/if}{entry.lecture_names.join(', ')}</a
              >
            </h3>
            <p class="hint">
              {dateText(language, entry.created_at, true)}
              {t(language, ', Version')}
              {entry.revision_number}
            </p>
          </div>
          <div class="stack review-entry-status" style="gap:.4rem">
            <Status value={entry.review_state} /><Status value={entry.safety_status} />
            {#if entry.files_deleted_at}<span class="badge">{t(language, 'Dateien gelöscht')}</span
              >{/if}
          </div>
        </div>{:else}<p class="muted">{t(language, 'Keine passenden Einreichungen.')}</p>{/each}
    </section>
  {/snippet}
</LocalList>
