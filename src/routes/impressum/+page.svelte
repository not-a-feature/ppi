<script lang="ts">
  import { page } from '$app/state';
  import { t } from '$lib/i18n';

  let language = $derived(page.data.preferences.language);
</script>

<svelte:head>
  <title>{t(language, 'Impressum')} · PPI</title>
</svelte:head>

<div class="page-head"><h1>{t(language, 'Impressum')}</h1></div>
<div class="card">
  <p>
    {t(language, 'imprint.content')}
    <a href="https://www.fsi.uni-tuebingen.de/impressum/">{t(language, 'imprint.link')}</a>.
  </p>
</div>
