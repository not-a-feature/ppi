<script lang="ts">
  import { t } from '$lib/i18n';
  import { page } from '$app/state';
  import { namedAction } from '$lib/form-actions';

  import Feedback from '$lib/components/Feedback.svelte';

  let { data, form } = $props();
  let language = $derived(page.data.preferences?.language ?? 'de');

  let policyFields = $derived([
    ['activation', t(language, 'Startguthaben')],
    ['base_reward', t(language, 'Standardbelohnung')],
    ['excellent_reward', t(language, 'Ausgezeichnetes Protokoll (gesamt)')],
    ['lecture_cost', t(language, 'Veranstaltungszugang')],
    ['access_weeks', t(language, 'Zugangsdauer (Wochen)')],
    ['periodic_grant', t(language, 'Regelmäßige Gutschrift')]
  ]);
</script>

<div class="page-head"><h1>{t(language, 'Tokenregeln')}</h1></div>
<Feedback {form} />
<section class="card narrow">
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
