import {
  type Actor,
  currentActor,
  latestPolicy,
  requireCondition,
  audit,
  requireId,
  credit,
  notify,
  receipt,
  bounded
} from './shared.js';
import { transaction } from '../db.js';
import { type PoolClient } from 'pg';

export async function getSettings(actor: Actor) {
  return transaction(async (client) => {
    await currentActor(client, actor);
    return latestPolicy(client);
  });
}

export type PolicyInput = {
  activation: number;
  base_reward: number;
  excellent_reward: number;
  sharing: 'equal_ceil' | 'uploader_only';
  lecture_cost: number;
  access_weeks: number;
  periodic_grant: number;
};

export async function updateSettings(actor: Actor, input: PolicyInput) {
  for (const amount of [
    input.activation,
    input.base_reward,
    input.excellent_reward,
    input.lecture_cost,
    input.periodic_grant
  ])
    requireCondition(
      Number.isSafeInteger(amount) && amount >= 0 && amount <= 10000,
      400,
      'invalid_policy',
      'Token amounts must be integers between 0 and 10,000.'
    );
  requireCondition(
    Number.isInteger(input.access_weeks) &&
      input.access_weeks >= 1 &&
      input.access_weeks <= 104 &&
      input.excellent_reward >= input.base_reward &&
      ['equal_ceil', 'uploader_only'].includes(input.sharing),
    400,
    'invalid_policy',
    'Invalid reward or duration policy.'
  );
  return transaction(async (client) => {
    await currentActor(client, actor, true);
    const result = (
      await client.query(
        `INSERT INTO policy(activation,base_reward,excellent_reward,sharing,lecture_cost,access_weeks,periodic_grant)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [
          input.activation,
          input.base_reward,
          input.excellent_reward,
          input.sharing,
          input.lecture_cost,
          input.access_weeks,
          input.periodic_grant
        ]
      )
    ).rows[0];
    await audit(client, actor.id, 'policy.updated', String(result.version), input);
    return result;
  });
}

async function eligibleRecipients(
  client: PoolClient,
  uploaderId: string,
  revisionId: string,
  sharing: string
) {
  return (
    await client.query(
      `SELECT DISTINCT u.id,u.email FROM "user" u
    WHERE u."emailVerified" AND u.email ~ '^zx[a-z]{3}[0-9]{2}@student[.]uni-tuebingen[.]de$'
    AND (u.id=$1 OR ($3='equal_ceil' AND split_part(u.email,'@',1) IN (SELECT zx FROM contributor_claim WHERE revision_id=$2))) ORDER BY u.id`,
      [uploaderId, revisionId, sharing]
    )
  ).rows;
}

export async function getRewardPreview(
  actor: Actor,
  revisionId: string,
  reward: 'base' | 'excellent' = 'base'
) {
  requireId(revisionId);
  requireCondition(
    ['base', 'excellent'].includes(reward),
    400,
    'invalid_reward',
    'Invalid reward selection.'
  );
  return transaction(async (client) => {
    await currentActor(client, actor, true);
    const revision = (
      await client.query(
        'SELECT r.*,s.uploader_id FROM submission_revision r JOIN submission s ON s.id=r.submission_id WHERE r.id=$1',
        [revisionId]
      )
    ).rows[0];
    requireCondition(revision, 404, 'not_found', 'Revision not found.');
    const policy = await latestPolicy(client),
      users = await eligibleRecipients(client, revision.uploader_id, revision.id, policy.sharing);
    const alreadyAwarded = Boolean(
      (
        await client.query('SELECT submission_id FROM reward_allocation WHERE submission_id=$1', [
          revision.submission_id
        ])
      ).rowCount
    );
    const nominalAmount = reward === 'excellent' ? policy.excellent_reward : policy.base_reward;
    const improvement = revision.revision_number > 1;
    const perRecipient =
      alreadyAwarded || improvement || users.length === 0
        ? 0
        : Math.ceil(nominalAmount / users.length);
    return {
      policyVersion: policy.version,
      recipientIds: users.map((user) => user.id),
      recipients: users.map((user) => ({ ...user, amount: perRecipient })),
      nominalAmount,
      perRecipient,
      totalIssued: perRecipient * users.length,
      alreadyAwarded,
      improvement
    };
  });
}

export async function rewardSubmission(
  client: PoolClient,
  actor: Actor,
  submission: Record<string, any>,
  revision: Record<string, any>,
  reward: 'base' | 'excellent',
  expectedPolicyVersion?: number,
  expectedRecipients?: string[]
) {
  requireCondition(
    revision.revision_number === 1,
    409,
    'improvement_unrewarded',
    'Improvements do not receive additional rewards.'
  );
  const policy = await latestPolicy(client);
  requireCondition(
    expectedPolicyVersion === undefined || expectedPolicyVersion === policy.version,
    409,
    'stale_reward_policy',
    'Reward settings changed. Reload the reward preview.'
  );
  const nominal = reward === 'excellent' ? policy.excellent_reward : policy.base_reward;
  const inserted = await client.query(
    `INSERT INTO reward_allocation(submission_id,revision_id,policy_version,nominal_amount,sharing,approved_by)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(submission_id) DO NOTHING RETURNING submission_id`,
    [submission.id, revision.id, policy.version, nominal, policy.sharing, actor.id]
  );
  if (!inserted.rowCount) return;
  const users = await eligibleRecipients(
    client,
    submission.uploader_id,
    revision.id,
    policy.sharing
  );
  requireCondition(
    users.some((user) => user.id === submission.uploader_id),
    409,
    'uploader_ineligible',
    'The uploader must have a registered verified account to receive a reward.'
  );
  requireCondition(
    expectedRecipients === undefined ||
      JSON.stringify([...new Set(expectedRecipients)].sort()) ===
        JSON.stringify(users.map((user) => user.id).sort()),
    409,
    'stale_recipients',
    'Eligible collaborators changed. Reload the reward preview.'
  );
  const amount = policy.sharing === 'uploader_only' ? nominal : Math.ceil(nominal / users.length);
  for (const user of users) {
    await credit(
      client,
      user.id,
      amount,
      'contribution',
      `contribution:${submission.id}:${user.id}`,
      policy.version,
      actor.id,
      reward === 'excellent' ? 'Excellent protocol' : 'Protocol contribution'
    );
    await client.query(
      'INSERT INTO reward_recipient(submission_id,user_id,amount) VALUES($1,$2,$3)',
      [submission.id, user.id, amount]
    );
    await notify(
      client,
      user.id,
      `reward:${submission.id}:${user.id}`,
      'Protocol reward',
      `${amount} tokens were awarded for a protocol contribution.`
    );
  }
}

export async function purchaseLectureAccess(
  actor: Actor,
  lectureId: string,
  requestKey: string
): Promise<{ expiresAt: Date | string; charged: number }> {
  requireId(lectureId);
  return transaction(async (client) => {
    await currentActor(client, actor);
    return receipt(client, actor, 'purchase', requestKey, { lectureId }, async () => {
      const lecture = (
        await client.query(
          "SELECT id,name FROM lecture WHERE id=$1 AND NOT archived AND approval_status='approved' FOR SHARE",
          [lectureId]
        )
      ).rows[0];
      requireCondition(lecture, 404, 'not_found', 'Lecture unavailable.');
      await client.query('SELECT user_id FROM credit_account WHERE user_id=$1 FOR UPDATE', [
        actor.id
      ]);
      const existing = (
        await client.query(
          'SELECT expires_at FROM lecture_access WHERE user_id=$1 AND lecture_id=$2 AND expires_at>now()',
          [actor.id, lectureId]
        )
      ).rows;
      if (existing.length) return { expiresAt: existing[0].expires_at, charged: 0 };
      const policy = await latestPolicy(client);
      await credit(
        client,
        actor.id,
        -policy.lecture_cost,
        'purchase',
        `purchase:${actor.id}:${requestKey}`,
        policy.version,
        actor.id,
        lecture.name
      );
      const access = (
        await client.query(
          `INSERT INTO lecture_access(user_id,lecture_id,starts_at,expires_at,policy_version)
        VALUES($1,$2,now(),((now() AT TIME ZONE 'Europe/Berlin')+make_interval(weeks=>$3)) AT TIME ZONE 'Europe/Berlin',$4)
        ON CONFLICT(user_id,lecture_id) DO UPDATE SET starts_at=EXCLUDED.starts_at,expires_at=EXCLUDED.expires_at,policy_version=EXCLUDED.policy_version RETURNING expires_at`,
          [actor.id, lectureId, policy.access_weeks, policy.version]
        )
      ).rows[0];
      await audit(client, actor.id, 'lecture.purchased', lectureId, {
        cost: policy.lecture_cost,
        policyVersion: policy.version
      });
      return { expiresAt: access.expires_at, charged: policy.lecture_cost };
    });
  });
}

export async function requestTokens(actor: Actor, explanation: string, requestKey: string) {
  explanation = bounded(explanation, 2000);
  return transaction(async (client) => {
    await currentActor(client, actor);
    return receipt(client, actor, 'token_request', requestKey, { explanation }, async () => {
      const request = (
        await client.query(
          'INSERT INTO token_request(user_id,explanation) VALUES($1,$2) RETURNING id',
          [actor.id, explanation]
        )
      ).rows[0];
      await audit(client, actor.id, 'tokens.requested', request.id);
      return request;
    });
  });
}

export async function resolveTokenRequest(
  actor: Actor,
  id: string,
  input: { amount: number; reason: string }
) {
  requireId(id);
  bounded(input.reason, 2000);
  requireCondition(
    Number.isSafeInteger(input.amount) && input.amount >= 0 && input.amount <= 10000,
    400,
    'invalid_amount',
    'Use an integer amount between 0 and 10,000.'
  );
  return transaction(async (client) => {
    await currentActor(client, actor, true);
    const request = (await client.query('SELECT * FROM token_request WHERE id=$1 FOR UPDATE', [id]))
      .rows[0];
    requireCondition(request, 404, 'not_found', 'Token request not found.');
    requireCondition(
      request.status === 'pending',
      409,
      'request_resolved',
      'This token request has already been resolved.'
    );
    const policy = await latestPolicy(client);
    await credit(
      client,
      request.user_id,
      input.amount,
      'manual_adjustment',
      `token_request:${id}`,
      policy.version,
      actor.id,
      input.reason
    );
    await client.query(
      'UPDATE token_request SET status=$2,amount=$3,resolved_by=$4,reason=$5 WHERE id=$1',
      [id, input.amount > 0 ? 'granted' : 'denied', input.amount, actor.id, input.reason]
    );
    await audit(client, actor.id, 'tokens.resolved', id, input);
    await notify(
      client,
      request.user_id,
      `token_request:${id}`,
      'Token request resolved',
      input.reason
    );
  });
}

export async function adjustCredits(
  actor: Actor,
  userId: string,
  amount: number,
  reason: string,
  requestKey: string
) {
  bounded(reason, 2000);
  requireCondition(
    Number.isSafeInteger(amount) && amount !== 0 && Math.abs(amount) <= 10000,
    400,
    'invalid_amount',
    'Use a nonzero integer amount between -10,000 and 10,000.'
  );
  return transaction(async (client) => {
    await currentActor(client, actor, true);
    return receipt(
      client,
      actor,
      'adjustment',
      requestKey,
      { userId, amount, reason },
      async () => {
        requireCondition(
          (await client.query('SELECT user_id FROM ppi_user WHERE user_id=$1', [userId])).rowCount,
          404,
          'not_found',
          'User not found.'
        );
        const policy = await latestPolicy(client);
        await credit(
          client,
          userId,
          amount,
          'manual_adjustment',
          `manual:${actor.id}:${requestKey}`,
          policy.version,
          actor.id,
          reason
        );
        await audit(client, actor.id, 'tokens.adjusted', userId, { amount, reason });
        return { userId, amount };
      }
    );
  });
}

export async function getPeriodicGrantPreview(actor: Actor) {
  return transaction(async (client) => {
    await currentActor(client, actor, true);
    const policy = await latestPolicy(client);
    const accounts = (
      await client.query(`SELECT count(*)::integer accounts FROM "user" u
        WHERE u."emailVerified" AND u.email ~ '^zx[a-z]{3}[0-9]{2}@student[.]uni-tuebingen[.]de$'`)
    ).rows[0].accounts as number;
    return {
      accounts,
      amount: policy.periodic_grant as number,
      total: accounts * policy.periodic_grant
    };
  });
}

async function initialiseGrant(client: PoolClient, period: string) {
  const policy = await latestPolicy(client);
  const run = await client.query(
    'INSERT INTO grant_run(period,policy_version,amount) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING period',
    [period, policy.version, policy.periodic_grant]
  );
  if (run.rowCount)
    await client.query(
      `INSERT INTO grant_recipient(period,user_id) SELECT $1,u.id FROM "user" u
    WHERE u."emailVerified" AND u.email ~ '^zx[a-z]{3}[0-9]{2}@student[.]uni-tuebingen[.]de$'`,
      [period]
    );
}

export async function processPeriodicGrant(period: string, batchSize = 250) {
  bounded(period, 100);
  requireCondition(
    Number.isInteger(batchSize) && batchSize >= 1 && batchSize <= 1000,
    400,
    'invalid_batch',
    'Batch size must be between 1 and 1000.'
  );
  return transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`grant:${period}`]);
    await initialiseGrant(client, period);
    const run = (await client.query('SELECT * FROM grant_run WHERE period=$1 FOR UPDATE', [period]))
      .rows[0];
    const users = (
      await client.query(
        'SELECT user_id FROM grant_recipient WHERE period=$1 AND processed_at IS NULL ORDER BY user_id LIMIT $2 FOR UPDATE',
        [period, batchSize]
      )
    ).rows;
    for (const user of users) {
      await credit(
        client,
        user.user_id,
        run.amount,
        'periodic_grant',
        `grant:${period}:${user.user_id}`,
        run.policy_version,
        null,
        `Periodic grant ${period}`
      );
      await client.query(
        'UPDATE grant_recipient SET processed_at=now() WHERE period=$1 AND user_id=$2',
        [period, user.user_id]
      );
    }
    const remaining = (
      await client.query(
        'SELECT count(*)::integer n FROM grant_recipient WHERE period=$1 AND processed_at IS NULL',
        [period]
      )
    ).rows[0].n;
    return { period, processed: users.length, remaining, amount: run.amount };
  });
}
