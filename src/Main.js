/**
 * Main.js — menu, triggers, settings and the daily check.
 * See README.md for setup.
 */

const SKIP_TABS = ['Settings', 'How it works', '_state', '_queue'];
const STATE_TAB = '_state';
const QUEUE_TAB = '_queue';
const MAX_HASHES = 1500;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const DAY = 24 * 3600 * 1000;

/* ---------------- Menu and triggers ---------------- */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Job alerts')
    .addItem('Install daily schedule', 'install')
    .addItem('Run checks now', 'runChecks')
    .addItem('Send a test digest now', 'sendDigestNow')
    .addItem('Remove schedule', 'uninstall')
    .addToUi();
}

function install() {
  uninstall();
  ScriptApp.newTrigger('dailyJob').timeBased().everyDays(1).atHour(8).create();
  runChecks(); // baseline
  ss_().toast('Installed. Pages are checked every morning; a digest is emailed at most every ' +
    settings_().digestDays + ' days.', 'Job alerts', 15);
}

function uninstall() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
}

function dailyJob() {
  runChecks();
  maybeSendDigest_(false);
}

function sendDigestNow() {
  maybeSendDigest_(true);
  ss_().toast('Digest sent to ' + settings_().email, 'Job alerts', 8);
}

/* ---------------- Settings ---------------- */

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function settings_() {
  const sh = ss_().getSheetByName('Settings');
  const vals = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 2).getValues();
  const m = {};
  vals.forEach(function (r) { if (r[0]) m[String(r[0]).trim()] = r[1]; });
  const list = function (s) {
    return String(s || '').split(',').map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean);
  };
  return {
    email: String(m['Send emails to'] || '').trim() || Session.getEffectiveUser().getEmail(),
    digestDays: Number(m['Email at most every (days)']) || 3,
    windowDays: Number(m['Deadline reminder window (days)']) || 10,
    include: list(m['Job keywords (any)']).map(wordRe_),
    exclude: list(m['Exclude if title contains']).map(wordRe_),
    done: list(m['Statuses to stop tracking']),
    lastSent: m['Last digest sent']
  };
}

function setSetting_(label, value) {
  const sh = ss_().getSheetByName('Settings');
  const vals = sh.getRange(1, 1, sh.getLastRow(), 1).getValues();
  for (let i = 0; i < vals.length; i++) {
    if (String(vals[i][0]).trim() === label) { sh.getRange(i + 1, 2).setValue(value); return; }
  }
}

/* ---------------- Reading the tracker ---------------- */

function collectRows_() {
  const out = [];
  ss_().getSheets().forEach(function (sh) {
    const tab = sh.getName();
    if (SKIP_TABS.indexOf(tab) >= 0) return;
    const lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
    if (lastRow < 2 || lastCol < 2) return;
    const data = sh.getRange(1, 1, lastRow, lastCol).getValues();
    const h = {};
    data[0].forEach(function (v, i) { h[String(v).trim()] = i; });
    if (h['Link'] === undefined || h['Monitor'] === undefined) return;
    const get = function (row, name) { return h[name] === undefined ? '' : row[h[name]]; };
    for (let r = 1; r < data.length; r++) {
      const row = data[r];
      const title = String(get(row, 'Role / Programme') || get(row, 'Board') || '').trim();
      if (!title) continue;
      out.push({
        tab: tab, sheet: sh, rowNum: r + 1, h: h, title: title,
        org: String(get(row, 'Organisation') || '').trim(),
        link: String(get(row, 'Link') || '').trim(),
        monitor: String(get(row, 'Monitor') || '').trim().toLowerCase(),
        feed: String(get(row, 'Feed') || '').trim(),
        status: String(get(row, 'Status') || '').trim().toLowerCase(),
        opens: toDate_(get(row, 'Opens (date)')),
        deadline: toDate_(get(row, 'Deadline (date)'))
      });
    }
  });
  return out;
}

function toDate_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v)) return v;
  if (typeof v === 'string' && v.trim()) { const d = new Date(v); if (!isNaN(d)) return d; }
  return null;
}

function keyOf_(t) { return t.tab + '|' + t.title + '|' + t.org; }

/* ---------------- Checking ---------------- */

function runChecks() {
  const cfg = settings_();
  const targets = collectRows_().filter(function (t) {
    if (cfg.done.indexOf(t.status) >= 0) return false;
    if (t.monitor === 'feed') return !!t.feed;
    return (t.monitor === 'page' || t.monitor === 'board') && /^https?:\/\//i.test(t.link);
  });
  const state = loadState_();
  const now = new Date();
  const requests = targets.map(function (t) {
    let url;
    try { url = t.monitor === 'feed' ? feedUrl_(t.feed) : t.link; } catch (e) { return null; }
    return { url: url, muteHttpExceptions: true, followRedirects: true,
             headers: { 'User-Agent': UA, 'Accept-Language': 'en-GB,en;q=0.9' } };
  });
  const responses = fetchAllSafe_(requests);
  const findings = [];
  const statusUpdates = [];

  targets.forEach(function (t, i) {
    const key = keyOf_(t);
    const prev = state[key];
    let cur;
    try { cur = analyse_(t, responses[i], cfg); } catch (e) { cur = { error: String(e.message || e).slice(0, 80) }; }

    if (cur.error) {
      const misses = ((prev && prev.misses) || 0) + 1;
      state[key] = Object.assign({}, prev || {}, { misses: misses });
      if (misses === 3) {
        findings.push(finding_('unreadable', t,
          'Could not read this for 3 checks in a row (' + cur.error + '). Check the link, or set Monitor to "Native alert" and use the site\'s own alerts.'));
      }
      statusUpdates.push([t, now, 'unreadable (' + cur.error + ')']);
      return;
    }

    const prevSet = {};
    ((prev && prev.hashes) || []).forEach(function (x) { prevSet[x] = true; });
    const isBaseline = !prev || !prev.hashes;

    if (!isBaseline) {
      if (t.monitor === 'page') {
        if (cur.state === 'open' && prev.state !== 'open' && (cur.strongOpen || prev.state === 'closed')) {
          findings.push(finding_('opened', t, cur.openLine || 'Page now reads as open.'));
        } else {
          const fresh = cur.lines.filter(function (l) { return !prevSet[h8_(l)]; }).slice(0, 3);
          if (fresh.length) findings.push(finding_('changed', t, fresh.join(' … ')));
        }
      } else {
        cur.items.filter(function (it) { return !prevSet[h8_(it.id)]; }).slice(0, 10).forEach(function (it) {
          findings.push(finding_('posting', t, it.title + (it.loc ? ' — ' + it.loc : ''), it.url || t.link));
        });
      }
    }

    // Remember everything seen, so items that briefly disappear are not re-announced.
    const merged = cur.hashes.concat(Object.keys(prevSet).filter(function (x) { return cur.hashes.indexOf(x) < 0; }));
    state[key] = { state: cur.state || '', hashes: merged.slice(0, MAX_HASHES), misses: 0 };
    statusUpdates.push([t, now, t.monitor === 'page' ? (cur.state || 'unclear') : cur.items.length + ' matching listings']);
  });

  saveState_(state);
  appendQueue_(findings);
  writeStatuses_(statusUpdates);
}

function finding_(type, t, detail, url) {
  return [new Date(), type, t.tab, t.title, t.org, url || t.link, detail];
}

function fetchAllSafe_(reqs) {
  const out = reqs.map(function () { return null; });
  const CHUNK = 15;
  for (let i = 0; i < reqs.length; i += CHUNK) {
    const idx = [], batch = [];
    for (let j = i; j < Math.min(i + CHUNK, reqs.length); j++) {
      if (reqs[j]) { idx.push(j); batch.push(reqs[j]); } else { out[j] = { error: 'bad feed name' }; }
    }
    if (!batch.length) continue;
    try {
      UrlFetchApp.fetchAll(batch).forEach(function (r, k) { out[idx[k]] = r; });
    } catch (e) {
      // One bad address can sink a whole batch; fall back to one at a time.
      idx.forEach(function (j, k) {
        try { out[j] = UrlFetchApp.fetch(batch[k].url, batch[k]); }
        catch (e2) { out[j] = { error: String(e2.message || e2).slice(0, 80) }; }
      });
    }
  }
  return out;
}

function analyse_(t, res, cfg) {
  if (!res) return { error: 'no response' };
  if (res.error) return { error: res.error };
  const code = res.getResponseCode();
  if (code >= 400) return { error: 'HTTP ' + code };
  const body = res.getContentText();

  if (t.monitor === 'feed') {
    const items = parseFeed_(t.feed, body).filter(function (j) { return titleMatches_(j.title, cfg); });
    return { items: items, hashes: items.map(function (j) { return h8_(j.id); }) };
  }

  const lines = htmlToLines_(body, t.monitor === 'board');
  const textLen = lines.join(' ').length;
  if (textLen < 300) return { error: 'page looks empty, probably built with JavaScript' };

  if (t.monitor === 'board') {
    const seen = {};
    const items = lines.filter(function (l) {
      if (l.length < 8 || l.length > 160 || seen[l]) return false;
      seen[l] = true;
      return titleMatches_(l, cfg);
    }).map(function (l) { return { id: l, title: l }; });
    return { items: items, hashes: items.map(function (x) { return h8_(x.id); }) };
  }

  const det = detectState_(lines);
  const rel = lines.filter(function (l) {
    return l.length >= 25 && l.length <= 400 && RELEVANT.test(l) && !NOISE.test(l);
  });
  return { state: det.state, strongOpen: det.strongOpen, openLine: det.line, lines: rel, hashes: rel.map(h8_) };
}

