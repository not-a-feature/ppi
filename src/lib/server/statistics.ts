import { transaction } from './db.js';
import { currentActor, DomainError, type Actor } from './domain/shared.js';

export async function getAdminStatistics(actor: Actor, range = '30d') {
  if (!['30d', '6m', '1y', 'max'].includes(range))
    throw new DomainError(400, 'invalid_range', 'Choose a valid statistics period.');
  return transaction(async (client) => {
    await currentActor(client, actor, true);
    const bounds = (
      await client.query<{
        start_date: string;
        end_date: string;
        granularity: 'day' | 'month' | 'year';
      }>(
        `WITH bounds AS (SELECT CASE $1
        WHEN '30d' THEN (now() AT TIME ZONE 'Europe/Berlin')::date-29
        WHEN '6m' THEN ((now() AT TIME ZONE 'Europe/Berlin')::date-interval '6 months'+interval '1 day')::date
        WHEN '1y' THEN ((now() AT TIME ZONE 'Europe/Berlin')::date-interval '1 year'+interval '1 day')::date
        ELSE coalesce((SELECT (min(created_at) AT TIME ZONE 'Europe/Berlin')::date FROM audit_event),(now() AT TIME ZONE 'Europe/Berlin')::date) END AS start_date,
        (now() AT TIME ZONE 'Europe/Berlin')::date AS end_date)
       SELECT to_char(start_date,'YYYY-MM-DD') AS start_date,to_char(end_date,'YYYY-MM-DD') AS end_date,
         CASE WHEN $1='max' AND start_date<end_date-interval '20 years' THEN 'year'
              WHEN $1='max' AND start_date<end_date-interval '1 year' THEN 'month' ELSE 'day' END AS granularity FROM bounds`,
        [range]
      )
    ).rows[0];
    const series = await client.query<{
      day: string;
      logins: number;
      events: number;
      submissions: number;
      decisions: number;
    }>(
      `WITH periods AS (
        SELECT generate_series(date_trunc($3,$1::timestamp),date_trunc($3,$2::timestamp),
          CASE $3 WHEN 'year' THEN interval '1 year' WHEN 'month' THEN interval '1 month' ELSE interval '1 day' END)::date AS day
       ), events AS (
         SELECT date_trunc($3,created_at AT TIME ZONE 'Europe/Berlin')::date AS day,count(*)::integer AS events,
           count(*) FILTER(WHERE action='auth.login')::integer AS logins,
           count(*) FILTER(WHERE action='submission.created')::integer AS submissions,
           count(*) FILTER(WHERE action='submission.reviewed')::integer AS decisions
         FROM audit_event WHERE created_at>=($1::timestamp AT TIME ZONE 'Europe/Berlin')
           AND created_at<(($2::date+1)::timestamp AT TIME ZONE 'Europe/Berlin') GROUP BY 1
       ) SELECT to_char(periods.day,'YYYY-MM-DD') AS day,coalesce(events.logins,0) AS logins,coalesce(events.events,0) AS events,
         coalesce(events.submissions,0) AS submissions,coalesce(events.decisions,0) AS decisions
         FROM periods LEFT JOIN events USING(day) ORDER BY periods.day`,
      [bounds.start_date, bounds.end_date, bounds.granularity]
    );
    const totals = series.rows.reduce(
      (sum, point) => ({
        logins: sum.logins + point.logins,
        events: sum.events + point.events,
        submissions: sum.submissions + point.submissions,
        decisions: sum.decisions + point.decisions
      }),
      { logins: 0, events: 0, submissions: 0, decisions: 0 }
    );
    return {
      series: series.rows,
      totals,
      range,
      granularity: bounds.granularity,
      startDate: bounds.start_date,
      endDate: bounds.end_date,
      timezone: 'Europe/Berlin'
    };
  });
}
