<script lang="ts">
  import '../app.css';
  import { page } from '$app/state';
  import { t } from '$lib/i18n';
  let { data, children } = $props();
  let language = $derived(data.preferences.language);
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
  <link rel="icon" type="image/png" href="/brand/ppi-logo.png" />
</svelte:head>
<a href="#main" class="skip">{t(language, 'Zum Inhalt')}</a>
<header class="site-header">
  <div class="nav-wrap">
    <a href="/lectures" class="brand" aria-label={t(language, 'PPI – zum Katalog')}>
      <span class="brand-product">
        <img class="ppi-logo" src="/brand/ppi-logo.png" alt="PPI" width="1424" height="512" />
        <span>{t(language, 'Prüfungsprotokolle')}</span>
      </span>
    </a>
    <nav aria-label={t(language, 'Hauptnavigation')}>
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
  <span>{t(language, 'Fachschaft Informatik Tübingen')}</span>
  <a href="/impressum">{t(language, 'Impressum')}</a>
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
    align-items: baseline;
    gap: 24px;
    color: var(--muted);
    font-size: 13px;
    line-height: 1.6;
  }
  .site-footer span {
    text-align: left;
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
  @media (max-width: 1080px) {
    .nav-wrap {
      align-items: flex-start;
      flex-direction: column;
      gap: 20px;
    }
    nav {
      width: 100%;
      gap: 24px;
      flex-wrap: wrap;
    }
    nav .nav-upload {
      margin-left: auto;
    }
  }
  @media (max-width: 640px) {
    .nav-wrap {
      padding: 23px 22px 18px;
      gap: 20px;
    }
    .brand-product {
      gap: 5px;
    }
    .ppi-logo {
      width: 85px;
    }
    nav {
      gap: 7px 20px;
      font-size: 13px;
    }
    nav a {
      padding: 7px 0;
    }
    nav .nav-upload {
      margin-left: 0;
      padding: 8px 12px;
    }
    main {
      margin: 0 22px;
      padding: 32px 0 48px;
    }
    .site-footer {
      margin: 0 22px;
      padding: 22px 0;
      flex-direction: column;
      gap: 10px;
      font-size: 12px;
    }
    .site-footer span {
      text-align: left;
    }
  }
</style>
