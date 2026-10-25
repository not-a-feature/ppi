<script lang="ts">
  import { t } from '#lib/i18n.js';
  import { page } from '$app/state';
  import { namedAction } from '#lib/form-actions.js';

  import Feedback from '#lib/components/Feedback.svelte';

  let { data, form } = $props();
  let language = $derived(page.data.preferences?.language ?? 'de');
</script>

<div class="page-head"><h1>{t(language, 'Zeitpläne')}</h1></div>
<Feedback {form} />
{#if data.grantPreview}<div class="notice">
    {t(language, 'Aktuell berechtigt:')}
    <strong>{data.grantPreview.accounts} {t(language, 'Konten')}</strong>
    ; {data.grantPreview.amount}
    {t(language, 'Tokens pro Konto; bis zu')}
    <strong>{data.grantPreview.total} {t(language, 'Tokens gesamt')}</strong>{t(
      language,
      '. Bereits gebuchte Gutschriften dieses Halbjahres werden übersprungen.'
    )}
  </div>{/if}
<div class="two-column">
  <section class="card">
    <h2>{t(language, 'Regelmäßige Tokengutschrift')}</h2>
    <p class="hint">
      {t(
        language,
        'Empfänger sind alle bestätigten studentischen Konten, einschließlich gesperrter Konten und Konten mit Löschantrag. Ein Lauf pro Halbjahr; wiederholtes Ausführen bucht nicht doppelt. Zeitzone: Europe/Berlin.'
      )}
    </p>
    <form method="POST" action={namedAction(page.url, 'schedule')}>
      <label
        ><input type="checkbox" name="enabled" checked={data.schedule.enabled} />{t(
          language,
          'Zeitplan aktivieren'
        )}</label
      ><label
        >{t(language, 'Cron-Zeitplan')}<input
          name="cron"
          required
          value={data.schedule.cron}
        /><small>{t(language, 'Beispiel: 0 0 1 4,10 * (1. April und 1. Oktober).')}</small></label
      ><button>{t(language, 'Zeitplan speichern')}</button>
    </form>
  </section>
  <aside class="card">
    <h2>{t(language, 'Lauf für dieses Halbjahr')}</h2>
    <form method="POST" action={namedAction(page.url, 'grant')}>
      <label
        ><input type="checkbox" required />{t(
          language,
          'Gutschrift für alle berechtigten Konten bestätigen'
        )}</label
      ><button class="secondary">{t(language, 'Jetzt ausführen')}</button>
    </form>
  </aside>
</div>
<section class="card" style="margin-top:1.5rem">
  <h2>{t(language, 'Alte Konten löschen')}</h2>
  <p>
    {t(
      language,
      'Nach zwei Jahren ohne Anmeldung werden Zugangsdaten und Profilangaben entfernt. Ohne Anmeldung zählt das Registrierungsdatum. Protokolle und Buchungen bleiben erhalten; das letzte aktive Adminkonto bleibt geschützt.'
    )}
  </p>
  <form method="POST" action={namedAction(page.url, 'cleanupSchedule')}>
    <label
      ><input type="checkbox" name="enabled" checked={data.cleanupSchedule.enabled} />{t(
        language,
        'Zeitplan aktivieren'
      )}</label
    >
    <label
      >{t(language, 'Häufigkeit')}<select name="cron">
        <option value="0 3 1 * *" selected={data.cleanupSchedule.cron === '0 3 1 * *'}
          >{t(language, 'Monatlich')}</option
        >
        <option value="0 3 1 */3 *" selected={data.cleanupSchedule.cron === '0 3 1 */3 *'}
          >{t(language, 'Alle 3 Monate')}</option
        >
        <option value="0 3 1 */6 *" selected={data.cleanupSchedule.cron === '0 3 1 */6 *'}
          >{t(language, 'Alle 6 Monate')}</option
        >
      </select><small>{t(language, 'Am 1. des Monats um 03:00 Uhr (Europe/Berlin).')}</small></label
    >
    <button>{t(language, 'Zeitplan speichern')}</button>
  </form>
</section>
