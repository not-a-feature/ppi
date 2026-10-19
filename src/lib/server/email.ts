function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function safeAuthUrl(value: string, appOrigin: URL): string | null {
  if (appOrigin.protocol !== 'https:' || !value.startsWith(`${appOrigin.origin}/`)) return null;
  const url = new URL(value);
  if (url.origin !== appOrigin.origin || url.username || url.password || url.hash) return null;
  const validVerification =
    url.pathname === '/api/auth/verify-email' && url.searchParams.has('token');
  const validPasswordReset = /^\/api\/auth\/reset-password\/[\w-]+$/.test(url.pathname);
  return validVerification || validPasswordReset ? url.href : null;
}

export function renderEmailHtml(subject: string, body: string, appOriginValue: string): string {
  const appOrigin = new URL(appOriginValue);
  const paragraphs = body
    .trim()
    .split(/\r?\n\s*\r?\n/)
    .filter(Boolean)
    .map((paragraph) => {
      const lines = paragraph.split(/\r?\n/);
      if (lines.length === 2) {
        const href = safeAuthUrl(lines[1], appOrigin);
        if (href) {
          const label = lines[0].replace(/[:：]\s*$/, '');
          return `<p style="margin:24px 0;text-align:center"><a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 20px;background:#000080;color:#fff;text-decoration:none;border-radius:4px;font-weight:600">${escapeHtml(label)}</a></p>`;
        }
      }
      return `<p style="margin:0 0 18px;line-height:1.6;color:#24243a">${lines.map(escapeHtml).join('<br>')}</p>`;
    })
    .join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f5f5fa;font-family:Arial,Helvetica,sans-serif;color:#24243a">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f5fa"><tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fff;border:1px solid #e1e1eb;border-radius:6px;overflow:hidden">
      <tr><td style="padding:18px 28px;background:#000080;color:#fff;font-size:20px;font-weight:700;letter-spacing:.02em">PPI</td></tr>
      <tr><td style="padding:28px">
        <h1 style="margin:0 0 24px;font-size:20px;line-height:1.35;color:#161627">${escapeHtml(subject)}</h1>
        ${paragraphs}
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}
