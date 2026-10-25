<script lang="ts">
  import { t, dateText } from '#lib/i18n.js';
  import { page } from '$app/state';
  import { namedAction } from '#lib/form-actions.js';
  import Status from '#lib/components/Status.svelte';
  import Feedback from '#lib/components/Feedback.svelte';
  import LocalList from '#lib/components/LocalList.svelte';
  let { data, form } = $props();
  let language = $derived(page.data.preferences?.language ?? 'de');
</script>

<div class="page-head"><h1>{t(language, 'Konten verwalten')}</h1></div>
<Feedback {form} />
<LocalList
  entries={data.entries}
  query={data.q}
  initialPage={data.page}
  initialFilters={data.filters}
  matches={(user, filters) =>
    (!filters.status || user.status === filters.status) &&
    (!filters.role || user.is_admin === (filters.role === 'admin'))}
>
  {#snippet filters(values)}
    <label
      >{t(language, 'Rolle')}<select name="role" value={values.role}>
        <option value="">{t(language, 'Alle')}</option>
        <option value="admin">{t(language, 'Administrator')}</option>
        <option value="student">{t(language, 'Studierende')}</option>
      </select></label
    >
    <label
      >{t(language, 'Status')}<select name="status" value={values.status}>
        <option value="">{t(language, 'Alle')}</option>
        <option value="active">{t(language, 'Aktiv')}</option>
        <option value="suspended">{t(language, 'Gesperrt')}</option>
        <option value="unverified">{t(language, 'E-Mail unbestätigt')}</option>
        <option value="deletion_pending">{t(language, 'Löschung beantragt')}</option>
      </select></label
    >
  {/snippet}
  {#snippet children(rows, start)}
    <div class="stack">
      {#each rows as user}<article class="card account-card">
          <div class="split account-header">
            <div>
              <h2>{user.email.split('@')[0]}</h2>
              <div class="actions">
                <Status value={user.status} />{#if user.is_admin}<span class="badge good"
                    >{t(language, 'Administrator')}</span
                  >{/if}<span class="badge">{user.balance} {t(language, 'Tokens')}</span>
              </div>
              <p class="hint account-login">
                {t(language, 'Letzte Anmeldung')}: {user.last_login_at
                  ? dateText(language, user.last_login_at, true)
                  : t(language, 'Noch nie')}
              </p>
            </div>
            <a class="button secondary" href={`/admin/users/${user.id}`}
              >{t(language, 'Beiträge und Zugänge')}</a
            >
          </div>
          {#if user.note_version}
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
          {/if}
          {#if user.email_verified && ['active', 'suspended'].includes(user.status)}
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
                    {user.email.split('@')[0]}
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
                    ><input type="checkbox" required />{t(
                      language,
                      'Statusänderung bestätigen'
                    )}</label
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
                  >{t(language, 'Begründung')}<input
                    name="reason"
                    required
                    maxlength="2000"
                  /></label
                ><button class="secondary">{t(language, 'Anpassung buchen')}</button>
              </form>
            </details>
          {/if}
        </article>{:else}<div class="empty">{t(language, 'Keine Konten gefunden.')}</div>{/each}
    </div>
  {/snippet}
</LocalList>

<style>
  .account-header {
    padding-bottom: 24px;
  }
  .account-login {
    margin: 16px 0 0;
  }
  .account-card > details {
    padding: 20px 0;
  }
  .account-card > details:last-child {
    padding-bottom: 0;
  }
</style>
