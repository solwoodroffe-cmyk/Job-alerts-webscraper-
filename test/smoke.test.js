// End-to-end run of the whole script against in-memory fakes of Google's services:
// baseline check → page opens, board and feed gain listings → digest email is sent once.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

function fakeSheet(name, rows) {
  const data = rows.map((r) => r.slice());
  const sheet = {
    getName: () => name,
    getLastRow: () => data.length,
    getLastColumn: () => Math.max(0, ...data.map((r) => r.length)),
    hideSheet: () => {},
    deleteRows: (start, n) => data.splice(start - 1, n),
    getRange: (r, c, nr = 1, nc = 1) => ({
      getValues: () => Array.from({ length: nr }, (_, i) =>
        Array.from({ length: nc }, (_, j) => ((data[r - 1 + i] || [])[c - 1 + j] ?? ''))),
      setValues: (vals) => vals.forEach((row, i) => row.forEach((v, j) => {
        while (data.length < r + i) data.push([]);
        data[r - 1 + i][c - 1 + j] = v;
      })),
      setValue: (v) => { while (data.length < r) data.push([]); data[r - 1][c - 1] = v; },
      clearContent: () => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (data[r - 1 + i]) data[r - 1 + i][c - 1 + j] = ''; }
    }),
    _data: data
  };
  return sheet;
}

function setup() {
  const header = ['Role / Programme', 'Organisation', 'Link', 'Status', 'Opens (date)', 'Deadline (date)', 'Monitor', 'Feed', 'Last checked', 'Detected state'];
  const soon = new Date(Date.now() + 4 * 864e5);
  const sheets = [
    fakeSheet('Settings', [
      ['Setting', 'Value'], ['Send emails to', 'me@example.com'], ['Email at most every (days)', 3],
      ['Deadline reminder window (days)', 10], ['Job keywords (any)', 'intern, analyst, economist, fellowship'],
      ['Exclude if title contains', 'senior, director'], ['Statuses to stop tracking', 'Applied, Rejected'], ['Last digest sent', '']]),
    fakeSheet('Opps', [header,
      ['Grad Scheme', 'Org A', 'https://a.test/grad', 'Not started', '', soon, 'Page', '', '', ''],
      ['Jobs page', 'Org B', 'https://b.test/jobs', 'Not started', '', '', 'Board', '', '', ''],
      ['Feed roles', 'Org C', '', 'Not started', '', '', 'Feed', 'greenhouse:orgc', '', ''],
      ['Already applied', 'Org D', 'https://d.test/', 'Applied', '', soon, 'Page', '', '', '']])
  ];
  const ss = {
    getSheets: () => sheets,
    getSheetByName: (n) => sheets.find((s) => s.getName() === n) || null,
    insertSheet: (n) => { const s = fakeSheet(n, []); sheets.push(s); return s; },
    getUrl: () => 'https://docs.google.com/spreadsheets/d/x',
    toast: () => {}
  };
  const filler = '<p>' + 'General text about the organisation. '.repeat(12) + '</p>';
  const web = {
    'https://a.test/grad': `<main>${filler}<p>Applications for 2027 have closed. Register your interest.</p></main>`,
    'https://b.test/jobs': `<main>${filler}<ul><li><a>Policy Intern</a></li><li><a>Senior Economist</a></li></ul></main>`,
    'https://boards-api.greenhouse.io/v1/boards/orgc/jobs': JSON.stringify({ jobs: [{ id: 1, title: 'Energy Analyst', absolute_url: 'https://c.test/1' }] }),
    'https://d.test/': `<main>${filler}</main>`
  };
  const mail = [];
  const res = (url) => ({ getResponseCode: () => (web[url] ? 200 : 404), getContentText: () => web[url] || '' });
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, getUi: () => ({}) },
    UrlFetchApp: { fetchAll: (reqs) => reqs.map((r) => res(r.url)), fetch: (u) => res(u) },
    Utilities: {
      DigestAlgorithm: { MD5: 'md5' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, s) => Array.from(crypto.createHash('md5').update(s, 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b)),
      formatDate: (d) => d.toDateString()
    },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'me@example.com' }), getScriptTimeZone: () => 'Europe/Madrid' },
    MailApp: { sendEmail: (m) => mail.push(m) },
    ScriptApp: { getProjectTriggers: () => [], deleteTrigger: () => {}, newTrigger: () => ({}) }
  };
  vm.createContext(ctx);
  const src = ['Main.js', 'Parse.js', 'Storage.js', 'Digest.js']
    .map((f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8')).join('\n');
  vm.runInContext(src, ctx);
  return { ctx, web, mail, ss };
}

test('baseline, then detects an opening, a board listing and a feed job, and emails once', () => {
  const { ctx, web, mail, ss } = setup();

  vm.runInContext('runChecks()', ctx);
  const q = ss.getSheetByName('_queue');
  assert.ok(!q || q.getLastRow() <= 1, 'baseline run should queue nothing');
  const opps = ss.getSheetByName('Opps')._data;
  assert.strictEqual(opps[1][9], 'closed');

  web['https://a.test/grad'] = web['https://a.test/grad'].replace(
    'Applications for 2027 have closed. Register your interest.', 'Applications for 2027 are now open.');
  web['https://b.test/jobs'] = web['https://b.test/jobs'].replace('</ul>', '<li><a>Research Fellowship 2027</a></li></ul>');
  web['https://boards-api.greenhouse.io/v1/boards/orgc/jobs'] = JSON.stringify({ jobs: [
    { id: 1, title: 'Energy Analyst', absolute_url: 'https://c.test/1' },
    { id: 2, title: 'Junior Economist', absolute_url: 'https://c.test/2' },
    { id: 3, title: 'Senior Economist', absolute_url: 'https://c.test/3' }] });

  vm.runInContext('runChecks()', ctx);
  const types = ss.getSheetByName('_queue')._data.slice(1).map((r) => r[1]).sort();
  assert.deepStrictEqual(types, ['opened', 'posting', 'posting']);

  vm.runInContext('maybeSendDigest_(false)', ctx);
  assert.strictEqual(mail.length, 1);
  assert.match(mail[0].subject, /1 now open/);
  assert.match(mail[0].subject, /1 deadline/);           // Org A's deadline; Org D is Applied, so excluded
  assert.match(mail[0].htmlBody, /Junior Economist/);
  assert.match(mail[0].htmlBody, /Research Fellowship 2027/);
  assert.doesNotMatch(mail[0].htmlBody, /Senior Economist|Org D/);
  assert.strictEqual(ss.getSheetByName('_queue').getLastRow(), 1, 'queue is cleared after sending');

  vm.runInContext('maybeSendDigest_(false)', ctx);
  assert.strictEqual(mail.length, 1, 'no second email within the 3-day window');
});
