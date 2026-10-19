<script lang="ts">
  import { t, dateText } from '$lib/i18n';
  import { page } from '$app/state';
  import { namedAction } from '$lib/form-actions';
  import Status from '$lib/components/Status.svelte';
  import Feedback from '$lib/components/Feedback.svelte';
  import SearchForm from '$lib/components/SearchForm.svelte';
  import Pagination from '$lib/components/Pagination.svelte';
  let { data, form } = $props();
  let language = $derived(page.data.preferences?.language ?? 'de');
</script>

<div class="page-head"><h1>{t(language, 'Konten verwalten')}</h1></div>
<Feedback {form} />
<SearchForm query={data.q}></SearchForm>
<div class="stack">
  {#each data.entries as user}<article class="card account-card">
      <div class="split account-header">
        <div>
          <h2>{user.email}</h2>
          <div class="actions">
            <Status value={user.status} />{#if user.is_admin}<span class="badge good"
                >{t(language, 'Administrator')}</span
              >{/if}<span class="badge">{user.balance} {t(language, 'Tokens')}</span>
          </div>
        </div>
      </div>
      <details open={form?.noteDraft?.userId === user.id}>
        <summary
          >{t(language, 'Interne Notiz')}{user.admin_note
            ? t(language, ' · vorhanden')
            : ''}</summary
        >
        <form method="POST" action={namedAction(page.url, 'note')} style="margin-top:1rem">
          <input type="hidden" name="id" value={user.id} /><input
            type="hidden"
            name="version"
            value={user.note_version}
          />
          <label
            >{t(language, 'Nur für Administratoren')}<textarea
              name="note"
              maxlength="4000"
              rows="3"
              value={form?.noteDraft?.userId === user.id
                ? (form?.noteDraft?.value ?? '')
                : user.admin_note}></textarea></label
          >
          {#if user.note_updated_at}<p class="hint">
              {dateText(language, user.note_updated_at, true)}
            </p>{/if}
          <button class="secondary">{t(language, 'Notiz speichern')}</button>
        </form>
      </details>
      <details>
        <summary>{t(language, 'Konto und Rechte verwalten')}</summary>
        <div class="grid" style="margin-top:1rem">
          <form method="POST" action={namedAction(page.url, 'admin')}>
            <input type="hidden" name="id" value={user.id} /><input
              type="hidden"
              name="isAdmin"
              value={String(!user.is_admin)}
            />
            <p class="hint">
              {user.is_admin
                ? t(language, 'Administratorrechte dieses Kontos entfernen.')
                : t(
                    language,
                    'Dieses bestätigte studentische Konto erhält Zugriff auf alle Verwaltungsfunktionen.'
                  )}
            </p>
            <label
              ><input type="checkbox" required />{t(language, 'Änderung für')}
              {user.email}
              {t(language, 'bestätigen')}</label
            ><button class="secondary"
              >{user.is_admin
                ? t(language, 'Adminrechte entfernen')
                : t(language, 'Zum Administrator ernennen')}</button
            >
          </form>
          <form method="POST" action={namedAction(page.url, 'status')}>
            <input type="hidden" name="id" value={user.id} /><input
              type="hidden"
              name="status"
              value={user.status === 'suspended' ? 'active' : 'suspended'}
            />
            <p class="hint">
              {t(
                language,
                'Eine Sperre beendet bestehende Sitzungen und verhindert weitere Zugriffe.'
              )}
            </p>
            <label
              ><input type="checkbox" required />{t(language, 'Statusänderung bestätigen')}</label
            ><button class="secondary"
              >{user.status === 'suspended'
                ? t(language, 'Konto aktivieren')
                : t(language, 'Konto sperren')}</button
            >
          </form>
        </div>
      </details>
      <details>
        <summary>{t(language, 'Tokens korrigieren')}</summary>
        <form
          method="POST"
          action={namedAction(page.url, 'adjust')}
          class="inline-form"
          style="margin-top:1rem"
        >
          <input type="hidden" name="id" value={user.id} /><input
            type="hidden"
            name="requestKey"
            value={`${data.requestKey}:${user.id}`}
          /><label
            >{t(language, 'Betrag (positiv / negativ)')}<input
              name="amount"
              type="number"
              required
              step="1"
            /></label
          ><label
            >{t(language, 'Begründung')}<input name="reason" required maxlength="2000" /></label
          ><button class="secondary">{t(language, 'Anpassung buchen')}</button>
        </form>
      </details>
    </article>{:else}<div class="empty">{t(language, 'Keine Konten gefunden.')}</div>{/each}
</div>

<Pagination page={data.page} total={data.total} pageSize={data.pageSize} />

<style>
  .account-header {
    padding-bottom: 24px;
  }
  .account-card > details {
    padding: 20px 0;
  }
  .account-card > details:last-child {
    padding-bottom: 0;
  }
</style>
