/**
 * Parse.js — pure functions with no Apps Script dependencies.
 * Covered by the tests in /test, which run in plain Node.
 */

function wordRe_(k) {
  return new RegExp('\\b' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
}

function titleMatches_(s, cfg) {
  if (!s) return false;
  const inc = !cfg.include.length || cfg.include.some(function (re) { return re.test(s); });
  return inc && !cfg.exclude.some(function (re) { return re.test(s); });
}

const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*';
const STRONG_OPEN = [
  /applications? (?:are|is) (?:now )?open/i,
  /now (?:open for|accepting) applications/i,
  /applications? (?:for [^.]{0,80}? )?(?:are|is|have) (?:now )?(?:open|opened)\b/i,
  /applications? open(?:ed)? (?:now|today)/i,
  new RegExp('(?:apply|applications? (?:close|closes|are due|due)) (?:by|on|before) (?:\\w+day,? )?\\d{1,2}(?:st|nd|rd|th)? ' + MONTH, 'i'),
  new RegExp('(?:apply|applications? (?:close|closes|are due|due)) (?:by|on|before) ' + MONTH + ' \\d{1,2}', 'i')
];
const WEAK_OPEN = [
  /\bapply (?:now|here|online|today)\b/i, /start your application/i, /submit your application/i,
  /closing date/i, /deadline for applications/i
];
const CLOSED = [
  /applications? (?:are|is|have|has) (?:now )?closed/i, /applications? closed\b/i,
  /(?:is|are) (?:now |currently )?closed\b/i, /not currently (?:recruiting|accepting|open|hiring)/i,
  /no (?:current |open )?(?:positions|vacancies|openings|opportunities|roles)(?: available| open)?/i,
  /currently no (?:vacancies|positions|opportunities|openings|roles)/i,
  /register (?:your )?interest/i, /expression of interest/i, /will (?:re-?)?open (?:in|on)\b/i,
  /opening soon/i, /\bopens in\b/i, /check back/i, /sign up to (?:be notified|hear|our mailing)/i
];
const RELEVANT = /(appl(?:y|ication)|deadline|closing date|\bopen(?:s|ed|ing)?\b|\bclose[sd]?\b|intake|cohort|recruit|register|\b20(?:26|27|28)\b)/i;
const NOISE = /(last (?:updated|modified)|©|copyright|cookie|all rights reserved)/i;

function detectState_(lines) {
  let strong = null, weak = 0, closed = 0;
  lines.forEach(function (l) {
    if (!strong && STRONG_OPEN.some(function (re) { return re.test(l); })) strong = l;
    if (WEAK_OPEN.some(function (re) { return re.test(l); })) weak++;
    if (CLOSED.some(function (re) { return re.test(l); })) closed++;
  });
  if (strong) return { state: 'open', strongOpen: true, line: strong.slice(0, 250) };
  if (closed > weak) return { state: 'closed', strongOpen: false };
  if (weak > 0) return { state: 'open', strongOpen: false };
  return { state: 'unclear', strongOpen: false };
}

function htmlToLines_(html, splitLinks) {
  let s = String(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|nav|footer|form|iframe|template|select)\b[\s\S]*?<\/\1>/gi, ' ');
  const blockEnd = splitLinks
    ? /<\/?(?:br|p|div|li|ul|ol|h[1-6]|tr|td|th|a|section|article|header|button|dt|dd|table)\b[^>]*>/gi
    : /<\/?(?:br|p|div|li|ul|ol|h[1-6]|tr|td|th|section|article|header|button|dt|dd|table)\b[^>]*>/gi;
  s = s.replace(blockEnd, '\n').replace(/<[^>]+>/g, ' ');
  s = decode_(s);
  const out = [];
  s.split('\n').forEach(function (l) {
    l = l.replace(/\s+/g, ' ').trim();
    if (l && out[out.length - 1] !== l) out.push(l);
  });
  return out;
}

function decode_(s) {
  return s
    .replace(/&#(\d+);/g, function (m, n) { return String.fromCharCode(+n); })
    .replace(/&#x([0-9a-f]+);/gi, function (m, n) { return String.fromCharCode(parseInt(n, 16)); })
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&(?:apos|rsquo|lsquo);/g, "'")
    .replace(/&(?:ldquo|rdquo);/g, '"').replace(/&(?:ndash|mdash);/g, '-')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/* ---------------- Job-system feeds ---------------- */

function feedUrl_(feed) {
  const parts = feed.split(':');
  const type = parts[0].trim().toLowerCase(), id = encodeURIComponent((parts[1] || '').trim());
  if (!id) throw new Error('no id');
  if (type === 'greenhouse') return 'https://boards-api.greenhouse.io/v1/boards/' + id + '/jobs';
  if (type === 'lever') return 'https://api.lever.co/v0/postings/' + id + '?mode=json';
  if (type === 'ashby') return 'https://api.ashbyhq.com/posting-api/job-board/' + id;
  if (type === 'workable') return 'https://apply.workable.com/api/v1/widget/accounts/' + id;
  throw new Error('unknown feed type ' + type);
}

function parseFeed_(feed, body) {
  const type = feed.split(':')[0].trim().toLowerCase();
  const d = JSON.parse(body);
  if (type === 'greenhouse') return (d.jobs || []).map(function (j) {
    return { id: String(j.id), title: j.title, url: j.absolute_url, loc: j.location && j.location.name }; });
  if (type === 'lever') return (d || []).map(function (j) {
    return { id: j.id, title: j.text, url: j.hostedUrl, loc: j.categories && j.categories.location }; });
  if (type === 'ashby') return (d.jobs || []).map(function (j) {
    return { id: j.id || j.jobUrl, title: j.title, url: j.jobUrl, loc: j.location }; });
  if (type === 'workable') return (d.jobs || []).map(function (j) {
    return { id: j.shortcode || j.url, title: j.title, url: j.url || j.shortlink,
             loc: [j.city, j.country].filter(Boolean).join(', ') }; });
  return [];
}
