<script lang="ts">
  import { text, t, dateText } from '$lib/i18n';
  import { page } from '$app/state';
  import Status from '$lib/components/Status.svelte';

  import Pagination from '$lib/components/Pagination.svelte';
  let { data } = $props();
  let language = $derived(page.data.preferences?.language ?? 'de');
</script>

<div class="page-head"><h1>{t(language, 'Einreichungen prüfen')}</h1></div>

<form method="GET" class="search" style="margin-bottom:1.5rem">
  <label for="q"
    >{text(language, 'Suchen', 'Search')}<input
      id="q"
      name="q"
      type="search"
      maxlength="200"
      value={data.q}
    /></label
  ><label
    >{text(language, 'Anzeigen', 'Show')}<select name="scope"
      ><option value="pending" selected={data.scope === 'pending'}
        >{text(language, 'Ausstehend', 'Pending')}</option
      ><option value="all" selected={data.scope === 'all'}>{text(language, 'Alle', 'All')}</option
      ></select
    ></label
  ><button class="secondary">{text(language, 'Suchen', 'Search')}</button>
</form>
<section class="card">
  {#each data.entries as entry}<div class="list-row">
      <div>
        <h3><a href="/admin/review/{entry.id}">{entry.original_name}</a></h3>
        <p class="hint">
          {dateText(language, entry.created_at, true)}
          {t(language, ', Version')}
          {entry.revision_number}
        </p>
      </div>
      <div class="stack" style="gap:.4rem">
        <Status value={entry.review_state} /><Status value={entry.safety_status} />
        {#if entry.files_deleted_at}<span class="badge"
            >{text(language, 'Dateien gelöscht', 'Files deleted')}</span
          >{/if}
      </div>
    </div>{:else}<p class="muted">{t(language, 'Keine passenden Einreichungen.')}</p>{/each}
</section>

<Pagination page={data.page} total={data.total} pageSize={data.pageSize} />
