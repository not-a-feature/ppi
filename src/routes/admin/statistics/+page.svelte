<script lang="ts">
  import { page } from '$app/state';
  import { untrack } from 'svelte';
  import { afterNavigate, goto } from '$app/navigation';
  import { t } from '#lib/i18n.js';
  let { data } = $props();
  let period = $state<'30d' | '6m' | '1y' | 'max'>(
    untrack(() => data.range as '30d' | '6m' | '1y' | 'max')
  );
  let statistics = $derived(data.periods[period]);
  function changePeriod(value: typeof period) {
    period = value;
    const url = new URL(page.url.href);
    url.searchParams.set('range', value);
    void goto(url, { shallow: true, replace: true, state: page.state });
  }
  afterNavigate(({ type, to }) => {
    if (to && (type === 'link' || type === 'popstate'))
      period = (to.url.searchParams.get('range') ?? '30d') as typeof period;
  });
  let language = $derived(page.data.preferences.language);
  const metrics = [
    { key: 'logins', color: 'var(--teal)', label: 'Erfasste Anmeldungen' },
    { key: 'events', color: '#c98428', label: 'Ereignisse' },
    { key: 'submissions', color: '#7978d2', label: 'Neue Einreichungen' },
    { key: 'decisions', color: '#cf6b7b', label: 'Prüfentscheidungen' }
  ] as const;
  const populationMetrics = [
    {
      key: 'cumulativeRegisteredUsers',
      color: 'var(--teal)',
      label: 'Registrierte Konten'
    },
    {
      key: 'cumulativeSubmittedProtocols',
      color: '#c98428',
      label: 'Eingereichte Protokolle'
    }
  ] as const;
  let populationSeries = $derived(
    populationMetrics.map((metric) => {
      const values = statistics.series.map((point) => point[metric.key]);
      const minimum = Math.min(...values),
        maximum = Math.max(...values);
      const padding = Math.max(1, (maximum - minimum) * 0.05);
      return {
        ...metric,
        minimum: Math.max(0, Math.floor(minimum - padding)),
        maximum: Math.ceil(maximum + padding)
      };
    })
  );
  let selected = $state<string[]>(['logins', 'events']);
  const ranges = [
    { value: '30d', label: '30d' },
    { value: '6m', label: '6m' },
    { value: '1y', label: '1 Jahr' },
    { value: 'max', label: 'Max' }
  ] as const;
  let visible = $derived(metrics.filter((metric) => selected.includes(metric.key)));
  let maximum = $derived(
    Math.max(1, ...statistics.series.flatMap((point) => visible.map((metric) => point[metric.key])))
  );
  let granularity = $derived(
    statistics.granularity === 'year'
      ? t(language, 'Jährlich')
      : statistics.granularity === 'month'
        ? t(language, 'Monatlich')
        : t(language, 'Täglich')
  );
  function x(index: number) {
    return 50 + (index / Math.max(1, statistics.series.length - 1)) * 850;
  }
  function y(value: number) {
    return 255 - (value / maximum) * 210;
  }
  function populationY(value: number, scale: { minimum: number; maximum: number }) {
    return 255 - ((value - scale.minimum) / (scale.maximum - scale.minimum)) * 210;
  }
  function tick(day: string) {
    return statistics.granularity === 'year'
      ? day.slice(0, 4)
      : statistics.granularity === 'month'
        ? day.slice(0, 7)
        : day.slice(5);
  }
</script>

<div class="page-head">
  <div>
    <h1>{t(language, 'Statistik')}</h1>
    <p>{statistics.startDate} – {statistics.endDate} · Europe/Berlin</p>
  </div>
  <nav class="inline-form" aria-label={t(language, 'Zeitraum')}>
    {#each ranges as range}<a
        href={`/admin/statistics?range=${range.value}`}
        onclick={(event) => {
          event.preventDefault();
          changePeriod(range.value);
        }}
        class={statistics.range === range.value ? 'button' : 'button secondary'}
        aria-current={statistics.range === range.value ? 'page' : undefined}
        >{t(language, range.label)}</a
      >{/each}
  </nav>
</div>
<div class="grid" style="margin-bottom:1.5rem">
  {#each metrics as metric}<section class="card">
      <p class="eyebrow">{t(language, metric.label)}</p>
      <div class="metric">{statistics.totals[metric.key]}</div>
    </section>{/each}
</div>
<section class="card">
  <h2>{t(language, 'Zeitverlauf')}</h2>
  <fieldset class="series-labels">
    <legend class="sr-only">{t(language, 'Datenreihen anzeigen')}</legend
    >{#each metrics as metric}<label style:--series-color={metric.color}
        ><input type="checkbox" bind:group={selected} value={metric.key} /><span
          class="series-swatch"
        ></span>{t(language, metric.label)}</label
      >{/each}
  </fieldset>
  <div class="chart-scroll">
    <svg viewBox="0 0 930 320" role="img" aria-label={t(language, 'Ereignisse im Zeitverlauf')}>
      <title>{t(language, 'Ereignisse im Zeitverlauf')}</title><desc
        >{t(
          language,
          'Linien zeigen die ausgewählten Datenreihen. Die Werte sind auch als Tabelle verfügbar.'
        )}</desc
      >
      {#each [0, 0.5, 1] as fraction}<line
          x1="50"
          y1={y(maximum * fraction)}
          x2="900"
          y2={y(maximum * fraction)}
          stroke="var(--line)"
        /><text x="40" y={y(maximum * fraction) + 4} text-anchor="end"
          >{Number((maximum * fraction).toFixed(1))}</text
        >{/each}
      {#each statistics.series as point, index}{#if index % Math.max(1, Math.ceil(statistics.series.length / 6)) === 0 || index === statistics.series.length - 1}<text
            x={x(index)}
            y="279"
            text-anchor="middle">{tick(point.day)}</text
          >{/if}{/each}
      {#each visible as metric}<polyline
          points={statistics.series
            .map((point, index) => `${x(index)},${y(point[metric.key])}`)
            .join(' ')}
          fill="none"
          stroke={metric.color}
          stroke-width="2.5"
        />{#each statistics.series as point, index}<circle
            cx={x(index)}
            cy={y(point[metric.key])}
            r="2.6"
            fill={metric.color}
            ><title>{point.day} · {t(language, metric.label)}: {point[metric.key]}</title></circle
          >{/each}{/each}
      <text x="475" y="309" text-anchor="middle">{t(language, 'Datum')} · {granularity}</text>
    </svg>
  </div>
  <details style="margin-top:1rem">
    <summary>{t(language, 'Daten als Tabelle')}</summary>
    <div class="table-scroll">
      <table>
        <thead
          ><tr
            ><th>{t(language, 'Datum')}</th>{#each metrics as metric}<th
                >{t(language, metric.label)}</th
              >{/each}</tr
          ></thead
        ><tbody
          >{#each statistics.series as point}<tr
              ><th scope="row">{statistics.granularity === 'day' ? point.day : tick(point.day)}</th
              >{#each metrics as metric}<td>{point[metric.key]}</td>{/each}</tr
            >{/each}</tbody
        >
      </table>
    </div>
  </details>
</section>
<section class="card population-chart">
  <h2>{t(language, 'Nutzer und Protokolle')}</h2>
  <div class="chart-scroll">
    <svg viewBox="0 0 1000 320" role="img" aria-label={t(language, 'Nutzer und Protokolle')}>
      <title>{t(language, 'Nutzer und Protokolle')}</title>
      <desc>{t(language, 'Kumulativer Bestand zum Ende jedes Zeitraums.')}</desc>
      {#each [0, 0.5, 1] as fraction}
        <line
          x1="50"
          y1={255 - fraction * 210}
          x2="900"
          y2={255 - fraction * 210}
          stroke="var(--line)"
        />
        {#each populationSeries as metric, axis}
          <text
            x={axis === 0 ? 40 : 910}
            y={259 - fraction * 210}
            text-anchor={axis === 0 ? 'end' : 'start'}
            style:fill={metric.color}
          >
            {Number((metric.minimum + (metric.maximum - metric.minimum) * fraction).toFixed(1))}
          </text>
        {/each}
      {/each}
      {#each populationSeries as metric, axis}
        <text
          x={axis === 0 ? 50 : 900}
          y="22"
          text-anchor={axis === 0 ? 'start' : 'end'}
          style:fill={metric.color}
        >
          {t(language, metric.label)}
        </text>
        <line
          x1={axis === 0 ? 50 : 900}
          x2={axis === 0 ? 50 : 900}
          y1="45"
          y2="255"
          stroke={metric.color}
        />
      {/each}
      {#each statistics.series as point, index}
        {#if index % Math.max(1, Math.ceil(statistics.series.length / 6)) === 0 || index === statistics.series.length - 1}
          <text x={x(index)} y="279" text-anchor="middle">{tick(point.day)}</text>
        {/if}
      {/each}
      {#each populationSeries as metric}
        <polyline
          points={statistics.series
            .map((point, index) => `${x(index)},${populationY(point[metric.key], metric)}`)
            .join(' ')}
          fill="none"
          stroke={metric.color}
          stroke-width="2.5"
        />
        {#each statistics.series as point, index}
          <circle
            cx={x(index)}
            cy={populationY(point[metric.key], metric)}
            r="2.6"
            fill={metric.color}
          >
            <title>{point.day} · {t(language, metric.label)}: {point[metric.key]}</title>
          </circle>
        {/each}
      {/each}
      <text x="475" y="309" text-anchor="middle">{t(language, 'Datum')} · {granularity}</text>
    </svg>
  </div>
</section>

<style>
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  .chart-scroll {
    overflow-x: auto;
  }
  .population-chart {
    margin-top: 1.5rem;
  }
  svg {
    display: block;
    width: 100%;
    min-width: 660px;
    height: auto;
  }
  svg text {
    fill: var(--muted);
    font-size: 11px;
    font-family: inherit;
  }
  .series-labels {
    display: flex;
    flex-wrap: wrap;
    gap: 0.8rem 1.5rem;
    border: 0;
    padding: 0;
    margin: 1rem 0;
  }
  .series-labels label {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.85rem;
  }
  .series-labels input {
    margin: 0;
  }
  .series-swatch {
    width: 1.2rem;
    border-top: 3px solid var(--series-color);
  }
</style>
