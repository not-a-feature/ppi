<script lang="ts">
  import { categoryLabel, t, dateText } from '$lib/i18n';
  import { page } from '$app/state';
  import { namedAction } from '$lib/form-actions';
  import Status from '$lib/components/Status.svelte';
  import Feedback from '$lib/components/Feedback.svelte';
  import SearchForm from '$lib/components/SearchForm.svelte';
  import Pagination from '$lib/components/Pagination.svelte';
  let { data, form } = $props();
  let language = $derived(page.data.preferences?.language ?? 'de');
</script>

<div class="page-head"><h1>{t(language, 'Inhaltsmeldungen')}</h1></div>
<Feedback {form} />
<SearchForm query={data.q}>
  <label
    >{t(language, 'Anzeigen')}<select name="scope"
      ><option value="pending" selected={data.scope === 'pending'}
        >{t(language, 'Ausstehend')}</option
      ><option value="all" selected={data.scope === 'all'}>{t(language, 'Alle')}</option></select
    ></label
  >
</SearchForm>
<div class="stack">
  {#each data.entries as entry}<article class="card">
      <div class="split">
        <h2>{entry.lecture_name || entry.original_name || t(language, 'Gemeldeter Inhalt')}</h2>
        <Status value={entry.status} />
      </div>
      <p><strong>{categoryLabel(language, entry.category)}</strong></p>
      <p>{entry.explanation}</p>
      {#if entry.submission_id}<a href="/admin/review/{entry.submission_id}"
          >{t(language, 'Einreichung prüfen')}</a
        >{:else if entry.lecture_id}<a href="/lectures/{entry.lecture_id}"
          >{t(language, 'Veranstaltung ansehen')}</a
        >{/if}
      <p class="hint">{dateText(language, entry.created_at, true)}</p>
      {#if entry.status === 'open'}<form method="POST" action={namedAction(page.url, 'report')}>
          <input type="hidden" name="id" value={entry.id} /><label
            >{t(language, 'Ergebnis der Prüfung')}<textarea
              name="resolution"
              required
              maxlength="2000"></textarea></label
          ><button class="secondary">{t(language, 'Meldung abschließen')}</button>
        </form>{:else}<p>{entry.resolution}</p>{/if}
    </article>{:else}<div class="empty">{t(language, 'Keine Inhaltsmeldungen.')}</div>{/each}
</div>

<Pagination page={data.page} total={data.total} pageSize={data.pageSize} />
