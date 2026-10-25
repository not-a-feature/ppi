<script lang="ts">
  import { page } from '$app/state';
  import { dateText, t } from '#lib/i18n.js';
  import Status from '#lib/components/Status.svelte';
  let { data } = $props();
  let language = $derived(page.data.preferences.language);
</script>

<a href="/admin/users">{t(language, 'Konten verwalten')}</a>
<div class="page-head">
  <div>
    <h1>{data.user.email.split('@')[0]}</h1>
    <div class="actions">
      <Status value={data.user.status} />
      {#if data.user.is_admin}<span class="badge good">{t(language, 'Administrator')}</span>{/if}
      <span class="badge">{data.user.balance} {t(language, 'Tokens')}</span>
    </div>
  </div>
</div>
<dl class="grid account-dates">
  <div>
    <dt>{t(language, 'Registriert')}</dt>
    <dd>{dateText(language, data.user.registered_at, true)}</dd>
  </div>
  <div>
    <dt>{t(language, 'Letzte Anmeldung')}</dt>
    <dd>
      {data.user.last_login_at
        ? dateText(language, data.user.last_login_at, true)
        : t(language, 'Noch nie')}
    </dd>
  </div>
</dl>
<section class="card">
  <h2>{t(language, 'Eingereichte Protokolle')} ({data.submissions.length})</h2>
  <div class="table-scroll">
    <table>
      <thead
        ><tr
          ><th>{t(language, 'Protokoll')}</th><th>{t(language, 'Datum')}</th><th
            >{t(language, 'Status')}</th
          ></tr
        ></thead
      >
      <tbody
        >{#each data.submissions as submission}<tr>
            <td
              ><a href={`/admin/review/${submission.id}`}
                >{submission.upload_number
                  ? `${submission.upload_number} · `
                  : ''}{submission.lecture_names.join(', ')}</a
              ></td
            >
            <td>{dateText(language, submission.created_at)}</td><td
              ><Status value={submission.review_state} /><Status
                value={submission.visibility}
              /></td
            >
          </tr>{:else}<tr><td colspan="3">{t(language, 'Keine Protokolle vorhanden.')}</td></tr
          >{/each}</tbody
      >
    </table>
  </div>
</section>
<section class="card access-card">
  <h2>{t(language, 'Veranstaltungszugänge')} ({data.access.length})</h2>
  <div class="table-scroll">
    <table>
      <thead
        ><tr
          ><th>{t(language, 'Vorlesung')}</th><th>{t(language, 'Gültig bis')}</th><th
            >{t(language, 'Status')}</th
          ></tr
        ></thead
      >
      <tbody
        >{#each data.access as access}<tr
            ><td><a href={`/lectures/${access.lecture_id}`}>{access.name}</a></td>
            <td>{dateText(language, access.expires_at, true)}</td><td
              >{t(language, access.active ? 'Aktiv' : 'Abgelaufen')}</td
            >
          </tr>{:else}<tr><td colspan="3">{t(language, 'Keine Zugänge vorhanden.')}</td></tr
          >{/each}</tbody
      >
    </table>
  </div>
</section>

<style>
  .table-scroll {
    overflow-x: auto;
  }
  .account-dates {
    margin-bottom: 24px;
  }
  .account-dates dd {
    margin: 8px 0 0;
  }
  .access-card {
    margin-top: 24px;
  }
</style>
