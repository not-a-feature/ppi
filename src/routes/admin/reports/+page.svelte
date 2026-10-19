<script lang="ts">
  import { categoryLabel, t, dateText } from '$lib/i18n';
  import { page } from '$app/state';
  import { namedAction } from '$lib/form-actions';
  import Status from '$lib/components/Status.svelte';
  import Feedback from '$lib/components/Feedback.svelte';
  import LocalList from '$lib/components/LocalList.svelte';
  let { data, form } = $props();
  let language = $derived(page.data.preferences?.language ?? 'de');
</script>

<div class="page-head"><h1>{t(language, 'Inhaltsmeldungen')}</h1></div>
<Feedback {form} />
<LocalList
  entries={data.entries}
  query={data.q}
  initialPage={data.page}
  initialFilters={{ scope: data.scope }}
  matches={(row, filters) => filters.scope === 'all' || row.status === 'open'}
>
  {#snippet filters(filters)}
    <label
      >{t(language, 'Anzeigen')}<select name="scope"
        ><option value="pending" selected={filters.scope === 'pending'}
          >{t(language, 'Ausstehend')}</option
        ><option value="all" selected={filters.scope === 'all'}>{t(language, 'Alle')}</option
        ></select
      ></label
    >
  {/snippet}
  {#snippet children(rows, start)}
    <div class="stack">
      {#each rows as entry}<article class="card">
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
  {/snippet}
</LocalList>
