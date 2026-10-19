<script lang="ts">
  import { t } from '$lib/i18n';
  import { page } from '$app/state';
  import ProtocolForm from '$lib/components/ProtocolForm.svelte';
  import Feedback from '$lib/components/Feedback.svelte';
  let language = $derived(page.data.preferences?.language ?? 'de');
  let { data, form } = $props();
</script>

<div class="page-head">
  <div><h1>{t(language, 'Protokoll hochladen')}</h1></div>
  <a href="/submissions">{t(language, 'Meine Beiträge')}</a>
</div>
<div class="narrow">
  <Feedback {form} />{#if form?.error}<p class="hint">
      {t(language, 'Die Angaben bleiben erhalten. Bitte die Datei erneut auswählen.')}
    </p>{/if}<ProtocolForm {...data} values={form?.values} />
</div>
