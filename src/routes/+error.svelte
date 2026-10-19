<script lang="ts">
  import { feedbackText } from '$lib/i18n';
  import { t } from '$lib/i18n';
  import { page } from '$app/state';
  let language = $derived(page.data.preferences?.language ?? 'de');
</script>

<div class="auth card">
  <h1>{t(language, 'Diese Seite ist nicht verfügbar.')}</h1>
  <p class="muted">{page.error?.message ? feedbackText(language, page.error.message) : ''}</p>
  <a href="/lectures" class="button">{t(language, 'Zum Katalog')}</a>
</div>
