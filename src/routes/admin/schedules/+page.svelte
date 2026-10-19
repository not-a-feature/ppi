<script lang="ts">
  import { t } from '$lib/i18n';
  import { page } from '$app/state';
  import { namedAction } from '$lib/form-actions';

  import Feedback from '$lib/components/Feedback.svelte';

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
        ><input type="checkbox" name="enabled" checked={data.jobs.schedule.enabled} />{t(
          language,
          'Zeitplan aktivieren'
        )}</label
      ><label
        >{t(language, 'Cron-Zeitplan')}<input
          name="cron"
          required
          value={data.jobs.schedule.cron}
        /><small>{t(language, 'Beispiel: 0 0 1 1,7 * (1. Januar und 1. Juli).')}</small></label
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
