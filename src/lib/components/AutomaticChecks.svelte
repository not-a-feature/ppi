<script lang="ts">
  import { page } from '$app/state';
  import { invalidateAll } from '$app/navigation';
  import { untrack } from 'svelte';
  import { namedAction } from '$lib/form-actions';
  import { t, dateText, type Language, type MessageKey } from '$lib/i18n';
  import type { ContentCheckReport } from '$lib/server/content-checks';

  let {
    initialReport,
    submissionId,
    language
  }: { initialReport: ContentCheckReport; submissionId: string; language: Language } = $props();
  let report = $state(untrack(() => initialReport));
  let refreshFailed = $state(false);
  const tr = (key: MessageKey, values?: Record<string, string | number>) =>
    t(language, key, values);
  let pending = $derived(report.state === 'pending' || report.state === 'waiting');
  let pollKey = $derived(`${submissionId}:${pending}`);
  let assessed = $derived(report.state === 'ready');
  let incompleteText = $derived(report.textlessPages > 0);
  let unavailable = $derived(!assessed || incompleteText);

  $effect(() => {
    report = initialReport;
    refreshFailed = false;
  });
  $effect(() => {
    if (!pollKey.endsWith(':true')) return;
    const id = submissionId;
    const waitingForSafety = untrack(() => report.state === 'waiting');
    const initialOcrStatus = untrack(() => report.ocrStatus);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let interval = 1500;
    async function refresh() {
      if (controller.signal.aborted) return;
      if (document.visibilityState !== 'visible') {
        timer = setTimeout(refresh, interval);
        return;
      }
      try {
        const response = await fetch(`/admin/review/${id}/checks`, { signal: controller.signal });
        if (!response.ok) throw new Error('Check status unavailable');
        report = await response.json();
        if (!['pending', 'waiting'].includes(report.state)) {
          if (
            waitingForSafety ||
            (report.ocrStatus !== initialOcrStatus &&
              ['ready', 'partial'].includes(report.ocrStatus ?? ''))
          )
            await invalidateAll();
          return;
        }
        interval = Math.min(10000, interval * 1.5);
        timer = setTimeout(refresh, interval);
      } catch {
        if (!controller.signal.aborted) refreshFailed = true;
      }
    }
    timer = setTimeout(refresh, interval);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  });

  function stateLabel(flag: boolean, available = true) {
    if (!available) return pending ? tr('Ausstehend') : tr('Nicht prüfbar');
    return flag ? tr('Auffällig') : 'OK';
  }

  let rows = $derived([
    {
      label: tr('Identische Datei'),
      flag: report.duplicates.length > 0,
      available: true,
      detail: '',
      matches: report.duplicates
    },
    {
      label: tr('Textähnlichkeit'),
      flag: report.similar.length > 0,
      available:
        assessed &&
        report.wordCount >= report.minSimilarityWords &&
        (report.comparedFiles > 0 || report.similar.length > 0) &&
        (!incompleteText || report.similar.length > 0),
      detail: !assessed
        ? ''
        : report.wordCount < report.minSimilarityWords
          ? tr('Zu wenig Text.')
          : incompleteText
            ? tr('Nur lesbarer Text verglichen.')
            : report.comparedFiles === 0 && !report.similar.length
              ? tr('Keine Vergleichsdateien.')
              : '',
      matches: report.similar
    },
    {
      label: tr('Inhalt'),
      flag: report.wordCount < report.minWords,
      available: !unavailable,
      detail: assessed
        ? `${report.wordCount.toLocaleString(language)} ${tr('Wörter')}${report.pageCount === null ? '' : ` · ${report.pageCount} ${tr(report.pageCount === 1 ? 'document.page' : 'document.pages')}`}`
        : '',
      matches: []
    },
    {
      label: tr('Lesbarkeit'),
      flag: report.wordCount === 0 || incompleteText,
      available: assessed,
      detail: !assessed
        ? ''
        : report.wordCount === 0
          ? tr(report.pageCount === null ? 'Kein lesbarer Text.' : 'Kein Text extrahierbar.')
          : incompleteText
            ? `${report.textlessPages} ${tr('Seite(n) ohne Text.')}`
            : '',
      matches: []
    },
    {
      label: tr('Wiederholungen'),
      flag: report.repeatedFraction > report.repetitionThreshold,
      available: assessed && report.wordCount >= report.minSimilarityWords,
      detail:
        assessed && report.repeatedFraction > report.repetitionThreshold
          ? `${Math.round(report.repeatedFraction * 100)} % ${tr('wiederholte Wortfolgen')}`
          : '',
      matches: []
    },
    {
      label: tr('Prüfungsangaben'),
      flag: report.missingMetadata.length > 0,
      available: true,
      detail: report.missingMetadata.length
        ? tr('Fehlt: ') +
          report.missingMetadata
            .map((key) =>
              key === 'examiner'
                ? tr('Prüfende Person')
                : key === 'date'
                  ? tr('Prüfungsdatum')
                  : tr('Semester')
            )
            .join(', ')
        : '',
      matches: []
    }
  ]);
</script>

<section class="card automatic-checks">
  <h2>{tr('Automatische Prüfungen')}</h2>
  {#if refreshFailed}<p class="notice warning" role="alert">
      {tr('Aktualisierung fehlgeschlagen. Seite neu laden.')}
    </p>
  {:else if pending}<p class="analysis-state" role="status">
      <span class="spinner" aria-hidden="true"></span>{report.state === 'waiting'
        ? tr('Dateiprüfung ausstehend…')
        : report.ocrStatus === 'pending'
          ? tr('OCR läuft…')
          : tr('Analyse läuft…')}
    </p>
  {:else if report.state === 'unavailable'}<p class="notice warning">
      {report.reason === 'text_limit' || report.reason === 'page_limit'
        ? tr('Analysegrenze erreicht.')
        : tr('Textanalyse nicht verfügbar. Vorschau prüfen.')}
    </p>
  {:else if report.state === 'failed'}<p class="notice warning">
      {tr('Analyse fehlgeschlagen. Erneut prüfen.')}
    </p>
  {:else if report.state === 'blocked'}<p class="notice warning">
      {tr('Dateiprüfung nicht bestanden.')}
    </p>{/if}
  <div class="check-list">
    {#if report.ocrStatus}
      <div class="check">
        <div class="check-heading">
          <h3>OCR</h3>
          <span
            class="badge"
            class:good={['ready', 'skipped'].includes(report.ocrStatus)}
            class:warn={['partial', 'failed'].includes(report.ocrStatus)}
          >
            {report.ocrStatus === 'skipped'
              ? tr('Nicht nötig')
              : report.ocrStatus === 'ready'
                ? tr('Fertig')
                : report.ocrStatus === 'partial'
                  ? tr('Teilweise')
                  : report.ocrStatus === 'failed'
                    ? tr('Fehlgeschlagen')
                    : tr('Ausstehend')}
          </span>
        </div>
        {#if report.ocrStatus === 'failed'}<p>
            {tr('Original verfügbar. OCR unter Verarbeitung erneut starten.')}
          </p>{/if}
      </div>
    {/if}
    {#each rows as row}
      <div class="check">
        <div class="check-heading">
          <h3>{row.label}</h3>
          <span
            class="badge"
            class:good={row.available && !row.flag}
            class:warn={row.available && row.flag}>{stateLabel(row.flag, row.available)}</span
          >
        </div>
        {#if row.detail}<p>{row.detail}</p>{/if}
        {#if row.matches.length}<ul>
            {#each row.matches as match}
              <li>
                <a href="/admin/review/{match.id}#revision-{match.revisionId}">{match.name}</a>
                <span
                  >{tr('Version')}
                  {match.revision}{match.sameSubmission
                    ? tr(' · gleiche Einreichung')
                    : ''}{'score' in match
                    ? ` · ${Math.round(Number(match.score) * 100)} %`
                    : ''}</span
                >
              </li>
            {/each}
          </ul>{/if}
      </div>
    {/each}
  </div>
  <details class="rules">
    <summary>{tr('Prüfregeln')}</summary>
    <p>
      {tr('checks.rules', {
        minWords: report.minWords,
        similarityPercent: Math.round(report.similarityThreshold * 100),
        minSimilarityWords: report.minSimilarityWords,
        repetitionPercent: Math.round(report.repetitionThreshold * 100)
      })}
    </p>
    <p>
      {tr('Vergleich mit PDF/TXT, auch früheren Versionen. Keine automatischen Entscheidungen.')}
    </p>
  </details>
  {#if report.checkedAt}<p class="checked-at">
      {tr('Geprüft:')}
      {dateText(language, report.checkedAt, true)}
    </p>{/if}
  {#if report.state !== 'waiting' && report.state !== 'blocked' && (!pending || refreshFailed)}
    <form method="POST" action={namedAction(page.url, 'contentCheck')}>
      <button class="secondary recheck">{tr('Erneut prüfen')}</button>
    </form>
  {/if}
</section>

<style>
  h2 {
    font-size: 1.15rem;
  }
  .check {
    padding: 0.65rem 0;
    border-bottom: 1px solid var(--line);
  }
  .check-heading {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.75rem;
  }
  h3 {
    font-size: 0.92rem;
    margin: 0;
  }
  .check p,
  .rules p {
    font-size: 0.82rem;
    color: var(--muted);
    margin: 0.4rem 0 0;
  }
  ul {
    padding-left: 1rem;
    margin: 0.5rem 0 0;
    font-size: 0.8rem;
  }
  li + li {
    margin-top: 0.5rem;
  }
  li a {
    overflow-wrap: anywhere;
  }
  li span {
    display: block;
    color: var(--muted);
    font-size: 0.76rem;
  }
  .rules {
    border: 0;
    padding: 0;
    margin-top: 1rem;
  }
  .rules summary {
    font-size: 0.82rem;
  }
  .checked-at {
    font-size: 0.75rem;
    color: var(--muted);
  }
  .recheck {
    font-size: 0.82rem;
    padding: 0.5rem 0.7rem;
  }
  .analysis-state {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
    color: var(--muted);
  }
  .spinner {
    width: 0.9rem;
    height: 0.9rem;
    border: 2px solid var(--line);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
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
