<script lang="ts">
  import { page } from '$app/state';
  import { statusLabel } from '#lib/i18n.js';
  let { value }: { value: string } = $props();
  let language = $derived(page.data.preferences?.language ?? 'de');
</script>

<span
  class:good={['accepted', 'published', 'safe', 'clean', 'succeeded', 'active'].includes(value)}
  class:warn={[
    'pending',
    'awaiting_review',
    'queued',
    'processing',
    'running',
    'changes_requested',
    'unverified'
  ].includes(value)}
  class:bad={['unsafe', 'failed', 'rejected', 'suspended'].includes(value)}
  class="badge">{statusLabel(language, value)}</span
>
