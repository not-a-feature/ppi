<script lang="ts">
  import { t, dateText } from '$lib/i18n';
  import { page } from '$app/state';
  import Status from '$lib/components/Status.svelte';

  import SearchForm from '$lib/components/SearchForm.svelte';
  import Pagination from '$lib/components/Pagination.svelte';
  let { data } = $props();
  let language = $derived(page.data.preferences?.language ?? 'de');
</script>

<div class="page-head"><h1>{t(language, 'Einreichungen prüfen')}</h1></div>

<SearchForm query={data.q}>
  <label
    >{t(language, 'Anzeigen')}<select name="scope"
      ><option value="pending" selected={data.scope === 'pending'}
        >{t(language, 'Ausstehend')}</option
      ><option value="all" selected={data.scope === 'all'}>{t(language, 'Alle')}</option></select
    ></label
  >
</SearchForm>
<section class="card">
  {#each data.entries as entry, index}<div class="list-row">
      <div class="review-entry-label">
        <h3>
          <a
            class="review-entry-title"
            href="/admin/review/{entry.id}"
            title={entry.lecture_names.join(', ')}
            >{(data.page - 1) * data.pageSize + index + 1}. {entry.lecture_names.join(', ')}</a
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

<Pagination page={data.page} total={data.total} pageSize={data.pageSize} />
