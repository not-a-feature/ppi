<script lang="ts">
  import '../app.css';
  import { page } from '$app/state';
  import { afterNavigate } from '$app/navigation';
  import { t } from '#lib/i18n.js';
  let { data, children } = $props();
  let language = $derived(data.preferences.language);
  let menuOpen = $state(false);
  let menuButton: HTMLButtonElement;
  afterNavigate(() => {
    menuOpen = false;
  });
  $effect(() => {
    document.documentElement.lang = language;
    document.documentElement.dataset.theme = data.preferences.theme;
  });
</script>

<svelte:head>
  <title>{t(language, 'PPI · Prüfungsprotokolle')}</title>
  <meta
    name="description"
    content={t(
      language,
      'Prüfungsprotokolle der Fachschaft Informatik Tübingen. Erfahrungen finden und eigene Protokolle teilen.'
    )}
  />
</svelte:head>
<a href="#main" class="skip">{t(language, 'Zum Inhalt')}</a>
<svelte:window
  onkeydown={(event) => {
    if (event.key === 'Escape' && menuOpen) {
      menuOpen = false;
      menuButton.focus();
    }
  }}
/>
<header class="site-header">
  <div class="nav-wrap">
    <a href="/lectures" class="brand" aria-label={t(language, 'PPI – zum Katalog')}>
      <span class="brand-product">
        <img class="ppi-logo" src="/brand/ppi-logo.png" alt="PPI" width="1424" height="512" />
        <span>{t(language, 'Prüfungsprotokolle')}</span>
      </span>
    </a>
    <button
      bind:this={menuButton}
      type="button"
      class="menu-toggle"
      aria-controls="primary-navigation"
      aria-expanded={menuOpen}
      aria-label={t(language, menuOpen ? 'Navigation schließen' : 'Navigation öffnen')}
      onclick={() => {
        menuOpen = !menuOpen;
      }}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        aria-hidden="true"
      >
        <path d={menuOpen ? 'M6 6l12 12M6 18L18 6' : 'M4 6h16M4 12h16M4 18h16'} />
      </svg>
      {t(language, 'Menü')}
    </button>
    <nav
      id="primary-navigation"
      class="primary-nav"
      class:menu-open={menuOpen}
      aria-label={t(language, 'Hauptnavigation')}
    >
      {#if data.actor}
        <a
          aria-current={page.url.pathname.startsWith('/lectures') ? 'page' : undefined}
          href="/lectures">{t(language, 'Katalog')}</a
        >
        <a
          aria-current={page.url.pathname.startsWith('/submissions') ? 'page' : undefined}
          href="/submissions">{t(language, 'navigation.contributions')}</a
        >
        <a
          aria-current={page.url.pathname.startsWith('/account/credits') ? 'page' : undefined}
          href="/account/credits">Tokens</a
        >
        {#if data.actor.isAdmin}<a
            aria-current={page.url.pathname.startsWith('/admin') ? 'page' : undefined}
            href="/admin">{t(language, 'Verwaltung')}</a
          >{/if}
        <a aria-current={page.url.pathname === '/account' ? 'page' : undefined} href="/account"
          >{t(language, 'Konto')}</a
        >
        <a href="/upload" class="nav-upload">{t(language, 'Protokoll hochladen')}</a>
      {:else}
        <a href="/login">{t(language, 'Anmelden')}</a>
        <a class="nav-upload" href="/register">{t(language, 'Konto erstellen')}</a>
      {/if}
    </nav>
  </div>
</header>
<main id="main">{@render children()}</main>
<footer class="site-footer">
  <div class="footer-brand">
    <span class="footer-logo" aria-hidden="true"></span>
    <span>{t(language, 'Fachschaft Informatik Tübingen')}</span>
  </div>
  <nav class="footer-links" aria-label={t(language, 'Footer')}>
    <a href="/impressum">{t(language, 'Impressum')}</a>
    <a href="/faq">{t(language, 'Hilfe / FAQ')}</a>
  </nav>
</footer>

<style>
  .site-header {
    background: var(--brand);
    color: white;
  }
  .nav-wrap {
    max-width: 1280px;
    margin: auto;
    min-height: 108px;
    padding: 22px 40px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 36px;
  }
  .menu-toggle {
    display: none;
    background: transparent;
    border-color: #7676bb;
    color: white;
    min-height: 44px;
    padding: 9px 12px;
  }
  .menu-toggle:hover {
    background: #ffffff12;
    filter: none;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 22px;
    flex: none;
    color: white;
  }
  .brand:hover {
    text-decoration: none;
  }
  .brand-product {
    display: grid;
    gap: 8px;
  }
  .ppi-logo {
    width: 99px;
    height: auto;
    filter: invert(1);
  }
  .brand-product span {
    font-size: 11px;
    line-height: 1;
    color: #ddddf5;
  }
  nav {
    display: flex;
    align-items: center;
    gap: 23px;
    font-size: 14px;
  }
  nav a {
    color: #e5e5ff;
    white-space: nowrap;
    padding: 10px 0;
  }
  nav a:hover {
    color: white;
    text-decoration-thickness: 2px;
    text-underline-offset: 7px;
  }
  nav a[aria-current='page'] {
    color: white;
    text-decoration: underline;
    text-decoration-thickness: 2px;
    text-underline-offset: 7px;
  }
  nav .nav-upload {
    background: white;
    color: #000080;
    border-radius: 5px;
    padding: 11px 16px;
    font-weight: 600;
  }
  nav .nav-upload:hover {
    background: #eeeeff;
    color: #000080;
    text-decoration: none;
  }
  main {
    max-width: 1200px;
    padding: 52px 0 72px;
    margin: auto;
    min-height: calc(100vh - 224px);
  }
  .site-footer {
    max-width: 1200px;
    padding: 25px 0;
    margin: auto;
    border-top: 1px solid var(--line);
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 24px;
    color: var(--muted);
    font-size: 13px;
    line-height: 1.6;
  }
  .footer-brand {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    color: var(--brand);
  }
  .footer-logo {
    display: block;
    width: 120px;
    aspect-ratio: 3 / 1;
    background: currentColor;
    mask: url('/brand/fsi-logo.png') center / contain no-repeat;
    -webkit-mask: url('/brand/fsi-logo.png') center / contain no-repeat;
  }
  :global(:root[data-theme='dark']) .footer-brand {
    color: white;
  }
  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme='light']):not([data-theme='dark'])) .footer-brand {
      color: white;
    }
  }
  .footer-links {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
  }
  .footer-links a {
    color: var(--muted);
    white-space: nowrap;
  }
  .footer-links a:hover,
  .footer-links a:focus-visible {
    color: var(--muted);
  }
  .skip {
    position: absolute;
    top: -100px;
    left: 20px;
    padding: 12px 20px;
    background: var(--surface);
    z-index: 10;
  }
  .skip:focus {
    top: 12px;
  }
  @media (max-width: 1280px) {
    main,
    .site-footer {
      margin-left: 40px;
      margin-right: 40px;
    }
  }
  @media (max-width: 960px) {
    .nav-wrap {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 0 24px;
    }
    .menu-toggle {
      display: inline-flex;
    }
    .primary-nav {
      display: none;
      grid-column: 1 / -1;
      align-items: stretch;
      flex-direction: column;
      gap: 4px;
      margin-top: 20px;
      padding-top: 16px;
      border-top: 1px solid #ffffff40;
    }
    .primary-nav.menu-open {
      display: flex;
    }
    .primary-nav a {
      min-height: 44px;
      padding: 11px 12px;
    }
    .primary-nav .nav-upload {
      margin-top: 8px;
      text-align: center;
    }
  }
  @media (max-width: 640px) {
    .nav-wrap {
      padding: 23px 22px 18px;
      gap: 0 16px;
    }
    .brand-product {
      gap: 5px;
    }
    .ppi-logo {
      width: 85px;
    }
    main {
      margin: 0 22px;
      padding: 32px 0 48px;
    }
    .site-footer {
      margin: 0 22px;
      padding: 22px 0;
      flex-direction: column;
      align-items: flex-start;
      gap: 10px;
      font-size: 12px;
    }
    .footer-links {
      align-items: flex-start;
    }
  }
</style>
