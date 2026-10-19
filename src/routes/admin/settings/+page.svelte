<script lang="ts">
  import { t } from '$lib/i18n';
  import { page } from '$app/state';
  import { namedAction } from '$lib/form-actions';
  import { adminAlertEvents, type AdminAlertType } from '$lib/admin-alerts';

  import Feedback from '$lib/components/Feedback.svelte';

  let { data, form } = $props();
  let language = $derived(page.data.preferences?.language ?? 'de');
  const alertTypes = Object.entries(adminAlertEvents) as [
    AdminAlertType,
    (typeof adminAlertEvents)[AdminAlertType]
  ][];

  let policyFields = $derived([
    ['activation', t(language, 'Startguthaben')],
    ['base_reward', t(language, 'Standardbelohnung')],
    ['excellent_reward', t(language, 'Ausgezeichnetes Protokoll (gesamt)')],
    ['lecture_cost', t(language, 'Veranstaltungszugang')],
    ['access_weeks', t(language, 'Zugangsdauer (Wochen)')],
    ['periodic_grant', t(language, 'Regelmäßige Gutschrift')]
  ]);
</script>

<div class="page-head"><h1>{t(language, 'Einstellungen')}</h1></div>
<Feedback {form} />
<section class="card narrow alert-settings">
  <h2>{t(language, 'E-Mail-Benachrichtigungen')}</h2>
  {#each data.recipients as recipient (recipient.id)}
    <div class="recipient">
      <form
        method="POST"
        action={namedAction(page.url, 'recipient')}
        id={`recipient-${recipient.id}`}
      >
        <input type="hidden" name="id" value={recipient.id} />
        <label
          >{t(language, 'E-Mail-Adresse')}<input
            type="email"
            name="email"
            value={recipient.email}
            maxlength="254"
            required
          /></label
        >
        <div class="alert-options">
          {#each alertTypes as [type, label]}
            <label
              ><input type="checkbox" name={type} checked={recipient[type]} />{t(
                language,
                label
              )}</label
            >
          {/each}
        </div>
      </form>
      <div class="actions">
        <button form={`recipient-${recipient.id}`}>{t(language, 'Speichern')}</button>
        <form method="POST" action={namedAction(page.url, 'removeRecipient')}>
          <input type="hidden" name="id" value={recipient.id} />
          <button
            class="secondary"
            aria-label={`${t(language, 'Empfänger entfernen')}: ${recipient.email}`}
            title={t(language, 'Empfänger entfernen')}>×</button
          >
        </form>
      </div>
    </div>
  {/each}
  <form method="POST" action={namedAction(page.url, 'recipient')} class="new-recipient">
    <label
      >{t(language, 'Neue E-Mail-Adresse')}<input
        type="email"
        name="email"
        maxlength="254"
        required
      /></label
    >
    <div class="alert-options">
      {#each alertTypes as [type, label]}
        <label><input type="checkbox" name={type} checked />{t(language, label)}</label>
      {/each}
    </div>
    <button>{t(language, 'Hinzufügen')}</button>
  </form>
  <p class="hint">
    {t(
      language,
      'Jobfehler werden nach allen Wiederholungen gemeldet. Gleiche Anwendungsfehler werden für 15 Minuten zusammengefasst.'
    )}
  </p>
</section>
<section class="card narrow">
  <h2>{t(language, 'Tokenregeln')}</h2>
  <form method="POST" action={namedAction(page.url, 'settings')}>
    <p class="hint">
      {t(language, 'Aktuelle Regelversion:')}
      {data.policy.version}{t(
        language,
        '. Beträge sind ganze Tokens. 0 deaktiviert eine Belohnung oder Gutschrift.'
      )}
    </p>
    <div class="grid">
      {#each policyFields as [key, label]}<label
          >{label}<input
            name={key}
            type="number"
            min={key === 'access_weeks' ? 1 : 0}
            max={key === 'access_weeks' ? 104 : 10000}
            step="1"
            value={data.policy[key]}
            required
          /></label
        >{/each}
    </div>
    <label
      >{t(language, 'Verteilung der Beitragsbelohnung')}<select name="sharing"
        ><option value="equal_ceil" selected={data.policy.sharing === 'equal_ceil'}
          >{t(language, 'Gleiche Anteile, aufrunden')}</option
        ><option value="uploader_only" selected={data.policy.sharing === 'uploader_only'}
          >{t(language, 'Nur einreichendes Konto')}</option
        ></select
      ></label
    >
    <p class="notice">
      {t(
        language,
        'Bei gleichen Anteilen wird pro Person aufgerundet. Die tatsächlich ausgegebene Gesamtsumme kann dadurch die nominale Belohnung übersteigen.'
      )}
    </p>
    <label
      ><input type="checkbox" required />{t(
        language,
        'Änderung der künftigen Tokenregeln bestätigen'
      )}</label
    ><button>{t(language, 'Neue Regelversion speichern')}</button>
  </form>
</section>

<style>
  .alert-settings {
    margin-bottom: 2rem;
  }
  .recipient {
    border-bottom: 1px solid var(--line);
    padding-bottom: 1.5rem;
    margin-bottom: 1.5rem;
  }
  .alert-options {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.75rem 1.25rem;
    margin: 1rem 0;
  }
  .alert-options label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .actions form {
    margin: 0;
  }
  .hint {
    margin-top: 1.5rem;
  }
  @media (max-width: 36rem) {
    .alert-options {
      grid-template-columns: 1fr;
    }
  }
</style>
