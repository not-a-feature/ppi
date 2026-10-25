<script lang="ts">
  import { t, dateText } from '#lib/i18n.js';
  import { page } from '$app/state';
  import Status from '#lib/components/Status.svelte';
  import Pagination from '#lib/components/Pagination.svelte';
  let language = $derived(page.data.preferences?.language ?? 'de');
  let { data } = $props();
</script>

<div class="page-head">
  <div><h1>{t(language, 'Meine Beiträge')}</h1></div>
  <a class="button" href="/upload">{t(language, 'Protokoll hochladen')}</a>
</div>
{#if data.submissions.length}<div class="card">
    {#each data.submissions as submission}<div class="list-row">
        <div>
          <h3>
            <a href="/submissions/{submission.id}"
              >{submission.original_name ?? t(language, 'Prüfungsprotokoll')}</a
            >
          </h3>
          <p class="muted">
            {t(language, 'Eingereicht am')}
            {dateText(language, submission.created_at)}
          </p>
        </div>
        <div class="submission-status">
          <p>
            {t(language, 'Aktuelle Version')}
            {submission.revision_number}: <Status value={submission.review_state} />
          </p>
          {#if submission.visibility === 'published' && submission.published_revision_id && submission.published_revision_number != null}
            <p class="hint">
              {t(language, 'submission.version')}
              {submission.published_revision_number}
              {t(language, 'ist veröffentlicht.')}
            </p>
          {:else}
            <p class="hint">
              {t(language, 'Derzeit keine veröffentlichte Version.')}
            </p>
          {/if}
        </div>
      </div>{/each}
  </div>{:else}<div class="empty">
    <h2>{t(language, 'Noch keine Beiträge')}</h2>
    <a href="/upload" class="button">{t(language, 'Protokoll hochladen')}</a>
  </div>{/if}
<Pagination {...data.pagination} />

<style>
  .submission-status p {
    margin: 0;
  }
  .submission-status .hint {
    margin-top: 0.4rem;
  }
</style>
