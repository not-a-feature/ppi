<script lang="ts">
  import { page } from '$app/state';
  import { feedbackText } from '#lib/i18n.js';
  let { form }: { form?: { error?: string; message?: string; success?: boolean } | null } =
    $props();
  let language = $derived(page.data.preferences?.language ?? 'de');
</script>

{#if form?.error}<div role="alert" class="notice error">
    {feedbackText(language, form.error)}
  </div>{/if}
{#if form?.message}<div role="status" class="notice">
    {feedbackText(language, form.message)}
  </div>{/if}
