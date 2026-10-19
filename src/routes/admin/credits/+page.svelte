<script lang="ts">
  import { text, t, dateText } from '$lib/i18n';
  import { page } from '$app/state';
  import { namedAction } from '$lib/form-actions';
  import Status from '$lib/components/Status.svelte';
  import Feedback from '$lib/components/Feedback.svelte';
  import Pagination from '$lib/components/Pagination.svelte';
  let { data, form } = $props();
  let language = $derived(page.data.preferences?.language ?? 'de');
</script>

<div class="page-head"><h1>{t(language, 'Tokenanfragen')}</h1></div>
<Feedback {form} />
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
<div class="stack">
  {#each data.entries as entry}<article class="card">
      <div class="split">
        <h2>{entry.email}</h2>
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

<Pagination page={data.page} total={data.total} pageSize={data.pageSize} />
