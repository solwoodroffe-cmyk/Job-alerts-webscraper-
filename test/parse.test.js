const test = require('node:test');
const assert = require('node:assert');
const P = require('./load');

const cfg = {
  include: ['intern', 'internship', 'graduate', 'research assistant', 'economist', 'analyst', 'fellowship'].map(P.wordRe_),
  exclude: ['senior', 'head of', 'director', 'manager', 'privacy', 'cookie'].map(P.wordRe_)
};

const filler = '<p>' + 'Some general text about the organisation and what it does. '.repeat(8) + '</p>';
const page = (body) => `<html><head><script>var x = "Applications are now open";</script></head>
  <body><nav><a>Home</a><a>Graduates</a></nav><main><h1>Graduate Programme</h1>${filler}${body}</main>
  <footer>Privacy policy &copy; 2026</footer></body></html>`;
const state = (body) => P.detectState_(P.htmlToLines_(page(body), false));

test('closed page with "register your interest" reads as closed', () => {
  const s = state('<p>Applications for 2027 have closed. <a>Register your interest</a> to hear when we reopen.</p>');
  assert.strictEqual(s.state, 'closed');
});

test('explicit "now open" wording is a strong open signal', () => {
  const s = state('<p>Applications for the 2027 programme are now open.</p><a>Apply now</a>');
  assert.strictEqual(s.state, 'open');
  assert.strictEqual(s.strongOpen, true);
  assert.match(s.line, /now open/);
});

test('a dated closing deadline counts as open', () => {
  assert.strictEqual(state('<p>Applications close on 12 March 2027 at 10:00.</p>').strongOpen, true);
  assert.strictEqual(state('<p>Apply by October 26 to be considered.</p>').strongOpen, true);
});

test('text inside <script> and <nav> is ignored', () => {
  assert.strictEqual(state('<p>Find out about life at the firm.</p>').state, 'unclear');
});

test('a generic "apply now" button alone is only a weak open', () => {
  const s = state('<a>Apply now</a>');
  assert.strictEqual(s.state, 'open');
  assert.strictEqual(s.strongOpen, false);
});

test('keyword matching uses whole words and respects exclusions', () => {
  const lines = P.htmlToLines_(`<ul>
    <li><a>Research Assistant – Energy</a></li><li><a>Senior Economist</a></li>
    <li><a>International Development Officer</a></li><li><a>Policy Intern (Summer 2027)</a></li>
    <li><a>Head of Research</a></li><li><a>Graduate Analyst &amp; Modeller</a></li><li>Cookie policy</li></ul>`, true);
  assert.deepStrictEqual([...lines.filter((l) => P.titleMatches_(l, cfg))],
    ['Research Assistant – Energy', 'Policy Intern (Summer 2027)', 'Graduate Analyst & Modeller']);
});

test('HTML entities are decoded', () => {
  assert.strictEqual(P.decode_('Policy &amp; Research &ndash; London&#39;s &#x2019;best&#8217;'), "Policy & Research - London's ’best’");
});

test('feed names map to the right public job APIs', () => {
  assert.strictEqual(P.feedUrl_('greenhouse:anthropic'), 'https://boards-api.greenhouse.io/v1/boards/anthropic/jobs');
  assert.strictEqual(P.feedUrl_('lever:acme'), 'https://api.lever.co/v0/postings/acme?mode=json');
  assert.strictEqual(P.feedUrl_('ashby:acme'), 'https://api.ashbyhq.com/posting-api/job-board/acme');
  assert.strictEqual(P.feedUrl_('workable:fuseenergy'), 'https://apply.workable.com/api/v1/widget/accounts/fuseenergy');
  assert.throws(() => P.feedUrl_('monster:acme'));
  assert.throws(() => P.feedUrl_('greenhouse:'));
});

test('feed responses are normalised to {id, title, url, loc}', () => {
  const gh = P.parseFeed_('greenhouse:x', JSON.stringify({ jobs: [{ id: 7, title: 'Policy Fellow', absolute_url: 'u', location: { name: 'London' } }] }));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(gh)), [{ id: '7', title: 'Policy Fellow', url: 'u', loc: 'London' }]);
  const wk = P.parseFeed_('workable:x', JSON.stringify({ jobs: [{ shortcode: 'A1', title: 'Junior Analyst', url: 'u', city: 'London' }] }));
  assert.strictEqual(wk[0].loc, 'London');
  const lv = P.parseFeed_('lever:x', JSON.stringify([{ id: 'z', text: 'Economist', hostedUrl: 'h', categories: { location: 'Oxford' } }]));
  assert.strictEqual(lv[0].title, 'Economist');
});

test('footer noise is not treated as application wording', () => {
  assert.ok(P.NOISE.test('Last updated 4 October 2026'));
  assert.ok(P.RELEVANT.test('The 2027 intake opens in January.'));
});
