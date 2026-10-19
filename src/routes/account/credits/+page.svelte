<script lang="ts">
  import { feedbackText } from '$lib/i18n';
  import { t, dateText } from '$lib/i18n';
  import { page } from '$app/state';
  import Feedback from '$lib/components/Feedback.svelte';
  import Pagination from '$lib/components/Pagination.svelte';
  import { namedAction } from '$lib/form-actions';
  let language = $derived(page.data.preferences?.language ?? 'de');
  let { data, form } = $props();
  let kinds: Record<string, string> = $derived({
    activation: t(language, 'Startguthaben'),
    contribution: t(language, 'Beitragsbelohnung'),
    bonus: t(language, 'Zusätzliche Belohnung'),
    purchase: t(language, 'Veranstaltungszugang'),
    periodic_grant: t(language, 'Regelmäßige Gutschrift'),
    manual_adjustment: t(language, 'Manuelle Anpassung'),
    reversal: t(language, 'Korrektur'),
    legacy_opening: t(language, 'Übernommenes Guthaben'),
    token_request: t(language, 'Tokenanfrage')
  });
</script>

<div class="page-head">
  <div><h1>{t(language, 'Tokenkonto')}</h1></div>
  <a class="button" href="/upload">{t(language, 'Protokoll hochladen')}</a>
</div>
<Feedback {form} />
<div class="two-column">
  <div class="stack">
    <section class="card">
      <h2>{t(language, 'Kontobewegungen')}</h2>
      {#if data.dashboard.ledger.length}<div class="table-scroll">
          <table>
            <thead
              ><tr
                ><th>{t(language, 'Datum')}</th><th>{t(language, 'Buchung')}</th><th
                  style="text-align:right">{t(language, 'Tokens')}</th
                ></tr
              ></thead
            ><tbody
              >{#each data.dashboard.ledger as entry (entry.id)}<tr
                  ><td>{dateText(language, entry.created_at)}</td><td
                    >{#if entry.kind === 'purchase'}
                      {entry.lecture_name ?? kinds.purchase}
                    {:else}
                      {kinds[entry.kind] ?? entry.kind}
                      {#if entry.reason && feedbackText(language, entry.reason) !== kinds[entry.kind]}<br
                        /><small
                          >{entry.kind === 'manual_adjustment'
                            ? entry.reason
                            : feedbackText(language, entry.reason)}</small
                        >{/if}
                    {/if}</td
                  ><td
                    class:positive={entry.amount > 0}
                    class:negative={entry.amount < 0}
                    style="text-align:right;font-weight:700"
                    >{entry.amount > 0 ? '+' : ''}{entry.amount}</td
                  ></tr
                >{/each}</tbody
            >
          </table>
        </div>{:else}<p class="muted">{t(language, 'Noch keine Buchungen.')}</p>{/if}
      <Pagination {...data.dashboard.ledgerPagination} />
    </section>
    <section class="card">
      <h2>{t(language, 'Veranstaltungszugänge')}</h2>
      {#each data.dashboard.access as access}<div class="list-row">
          <div>
            <a href="/lectures/{access.lecture_id}">{access.name ?? t(language, 'Veranstaltung')}</a
            >
            <p class="hint">
              {t(language, 'Gültig bis')}
              {dateText(language, access.expires_at, true)}
            </p>
          </div>
          <span class:good={new Date(access.expires_at) > new Date()} class="badge"
            >{new Date(access.expires_at) > new Date()
              ? t(language, 'Aktiv')
              : t(language, 'Abgelaufen')}</span
          >
        </div>{:else}<p class="muted">{t(language, 'Noch keine Veranstaltungszugänge.')}</p>{/each}
    </section>
  </div>
  <aside class="stack">
    <section class="card">
      <p class="eyebrow">{t(language, 'Verfügbares Guthaben')}</p>
      <div class="metric">{data.dashboard.balance}</div>
      <p class="muted">{t(language, 'Tokens')}</p>
    </section>
    <section class="card">
      <h2>{t(language, 'Tokens anfragen')}</h2>
      <form method="POST" action={namedAction(page.url, 'request')}>
        <label for="explanation"
          >{t(language, 'Begründung')}<textarea
            name="explanation"
            id="explanation"
            required
            minlength="10"
            maxlength="2000"></textarea></label
        ><button class="secondary">{t(language, 'Anfrage einreichen')}</button>
      </form>
    </section>
  </aside>
</div>
