<script lang="ts">
  import { t, dateText } from '$lib/i18n';
  import { page } from '$app/state';
  import { namedAction } from '$lib/form-actions';
  import Status from '$lib/components/Status.svelte';
  import Feedback from '$lib/components/Feedback.svelte';
  import LocalList from '$lib/components/LocalList.svelte';
  let { data, form } = $props();
  let language = $derived(page.data.preferences?.language ?? 'de');
</script>

<div class="page-head"><h1>{t(language, 'Tokenanfragen')}</h1></div>
<Feedback {form} />
<LocalList
  entries={data.entries}
  query={data.q}
  initialPage={data.page}
  initialFilters={{ scope: data.scope }}
  matches={(row, filters) => filters.scope === 'all' || row.status === 'pending'}
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
            <h2>{entry.email.split('@')[0]}</h2>
            <Status value={entry.status} />
          </div>
          <p>{entry.explanation}</p>
          <p class="hint">{dateText(language, entry.created_at, true)}</p>
          {#if entry.status === 'pending'}<form
              method="POST"
              action={namedAction(page.url, 'resolve')}
              class="inline-form"
            >
              <input type="hidden" name="id" value={entry.id} /><label
                >{t(language, 'Tokens (0 = ablehnen)')}<input
                  name="amount"
                  type="number"
                  min="0"
                  max="10000"
                  step="1"
                  required
                /></label
              ><label
                >{t(language, 'Begründung')}<input name="reason" required maxlength="2000" /></label
              ><button>{t(language, 'Entscheidung speichern')}</button>
            </form>{/if}
        </article>{:else}<div class="empty">{t(language, 'Keine Tokenanfragen.')}</div>{/each}
    </div>
  {/snippet}
</LocalList>
