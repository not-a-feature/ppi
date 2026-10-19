<script lang="ts">
  import { enhance } from '$app/forms';
  import { page } from '$app/state';
  import { untrack } from 'svelte';
  import { namedAction } from '$lib/form-actions';
  import { t, type Language } from '$lib/i18n';

  type Archive = {
    id: string;
    status: 'queued' | 'ready' | 'failed' | 'invalidated';
    expires_at: string | Date;
  };
  let { initialArchive, language }: { initialArchive: Archive | null; language: Language } =
    $props();
  let archive = $state<Archive | null>(untrack(() => initialArchive));
  let submitting = $state(false);
  let pollError = $state(false);
  let archiveKey = $derived(
    archive ? `${archive.id}:${archive.status}:${new Date(archive.expires_at).getTime()}` : ''
  );

  $effect(() => {
    archive = initialArchive;
    pollError = false;
  });

  $effect(() => {
    if (!archiveKey || pollError) return;
    const current = untrack(() => archive!);
    if (current.status !== 'queued' && current.status !== 'ready') return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let inFlight = false;
    let delay = 1500;
    const expiresAt = new Date(current.expires_at).getTime();

    function schedule() {
      clearTimeout(timer);
      if (controller.signal.aborted) return;
      if (Date.now() >= expiresAt) {
        archive = { ...current, status: 'invalidated' };
      } else if (current.status === 'queued') {
        timer = setTimeout(refresh, delay);
      } else {
        timer = setTimeout(schedule, Math.min(expiresAt - Date.now(), 2_147_483_647));
      }
    }

    async function refresh() {
      if (controller.signal.aborted || inFlight) return;
      if (document.visibilityState !== 'visible') {
        schedule();
        return;
      }
      inFlight = true;
      try {
        const response = await fetch(`/archives/${current.id}/status`, {
          signal: controller.signal
        });
        if (!response.ok) throw new Error('Archive status unavailable');
        archive = await response.json();
        delay = Math.min(delay * 1.5, 10000);
      } catch {
        if (!controller.signal.aborted) pollError = true;
      } finally {
        inFlight = false;
        schedule();
      }
    }

    function resume() {
      if (document.visibilityState === 'visible') void refresh();
    }
    schedule();
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('pageshow', resume);
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('pageshow', resume);
    };
  });
</script>

{#if submitting || (archive?.status === 'queued' && !pollError)}
  <div class="preparing" role="status" aria-live="polite">
    <span class="spinner" aria-hidden="true"></span>
    {t(language, 'Vorbereiten…')}
  </div>
  <noscript
    ><a href={page.url.pathname} data-sveltekit-reload>{t(language, 'Aktualisieren')}</a></noscript
  >
{:else if archive?.status === 'ready' && !pollError}
  <a class="button" href="/archives/{archive.id}/download" download>Download</a>
{:else}
  {#if pollError}<p role="alert">
      {t(language, 'Status konnte nicht geladen werden. Bitte erneut versuchen.')}
    </p>
  {:else if archive?.status === 'failed'}<p role="alert">
      {t(language, 'Download konnte nicht vorbereitet werden. Bitte erneut versuchen.')}
    </p>{/if}
  <form
    method="POST"
    action={namedAction(page.url, 'archive')}
    use:enhance={() => {
      submitting = true;
      return async ({ update }) => {
        try {
          await update();
        } finally {
          submitting = false;
        }
      };
    }}
  >
    <button>Download</button>
  </form>
{/if}

<style>
  .button,
  button {
    width: 100%;
    font-size: 0.87rem;
    padding: 0.75rem 0.8rem;
  }
  .preparing {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.65rem;
    padding: 0.75rem 0;
    font-size: 0.87rem;
  }
  .spinner {
    width: 1rem;
    height: 1rem;
    border: 2px solid var(--line);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  p {
    font-size: 0.8rem;
    line-height: 1.5;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation: none;
    }
  }
</style>
