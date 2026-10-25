<script lang="ts">
  import { page } from '$app/state';
  import { t } from '#lib/i18n.js';

  let language = $derived(page.data.preferences.language);
</script>

<svelte:head>
  <title>{t(language, 'Hilfe / FAQ')} · PPI</title>
  <meta name="robots" content="index,follow" />
</svelte:head>

<div class="page-head"><h1>{t(language, 'Hilfe / FAQ')}</h1></div>
<section class="faq-list" aria-label={t(language, 'Häufige Fragen')}>
  <details>
    <summary>{t(language, 'faq.about.question')}</summary>
    <p>{t(language, 'faq.about.answer')}</p>
  </details>
  <details>
    <summary>{t(language, 'faq.account.question')}</summary>
    <p>{t(language, 'faq.account.answer')}</p>
  </details>
  <details>
    <summary>{t(language, 'faq.access.question')}</summary>
    <p>{t(language, 'faq.access.answer')}</p>
  </details>
  <details>
    <summary>{t(language, 'faq.upload.question')}</summary>
    <p>{t(language, 'faq.upload.answer')}</p>
  </details>
  <details>
    <summary>{t(language, 'faq.review.question')}</summary>
    <p>{t(language, 'faq.review.answer')}</p>
  </details>
  <details>
    <summary>{t(language, 'faq.tokens.question')}</summary>
    <p>{t(language, 'faq.tokens.answer')}</p>
  </details>
  <details>
    <summary>{t(language, 'faq.report.question')}</summary>
    <p>{t(language, 'faq.report.answer')}</p>
  </details>
</section>

<style>
  .faq-list {
    max-width: 840px;
  }
  .faq-list details:first-child {
    border-top: 1px solid var(--line);
  }
  .faq-list summary {
    padding: 4px 0;
  }
  .faq-list p {
    max-width: 76ch;
    margin: 14px 0 2px;
    color: var(--muted);
    line-height: 1.65;
  }
</style>
