/**
 * Digest.js — builds and sends the summary email.
 */

function maybeSendDigest_(force) {
  const cfg = settings_();
  const now = new Date();
  const last = toDate_(cfg.lastSent);
  if (!force && last && (now - last) < cfg.digestDays * DAY - 2 * 3600 * 1000) return;

  const queue = readQueue_();
  const rows = collectRows_().filter(function (r) { return cfg.done.indexOf(r.status) < 0; });
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const horizon = new Date(today.getTime() + cfg.windowDays * DAY);
  const recent = new Date(today.getTime() - cfg.digestDays * DAY);

  const deadlines = rows.filter(function (r) { return r.deadline && r.deadline >= today && r.deadline <= horizon; })
    .sort(function (a, b) { return a.deadline - b.deadline; });
  const opening = rows.filter(function (r) { return r.opens && r.opens >= recent && r.opens <= horizon; })
    .sort(function (a, b) { return a.opens - b.opens; });

  const byType = function (type) {
    // de-duplicate identical findings
    const seen = {};
    return queue.filter(function (q) {
      const k = q[1] + q[3] + q[4] + q[6];
      if (q[1] !== type || seen[k]) return false;
      seen[k] = true; return true;
    });
  };
  const opened = byType('opened'), postings = byType('posting'), changed = byType('changed'), unreadable = byType('unreadable');

  const total = opened.length + postings.length + changed.length + unreadable.length + deadlines.length + opening.length;
  if (!force && total === 0) return;

  const tz = Session.getScriptTimeZone();
  const fmt = function (d) { return Utilities.formatDate(d, tz, 'EEE d MMM'); };
  const daysLeft = function (d) { return Math.round((d - today) / DAY); };
  const esc = function (s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  const link = function (url, text) { return url ? '<a href="' + esc(url) + '">' + esc(text) + '</a>' : esc(text); };
  const name = function (title, org) { return org ? title + ' — ' + org : title; };

  let html = '<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:680px">';
  const section = function (heading, items) {
    if (!items.length) return;
    html += '<h3 style="color:#1F3864;margin:22px 0 6px">' + heading + '</h3><ul style="padding-left:18px;margin:0">' +
      items.map(function (i) { return '<li style="margin-bottom:8px">' + i + '</li>'; }).join('') + '</ul>';
  };

  section('Now open', opened.map(function (q) {
    return '<b>' + link(q[5], name(q[3], q[4])) + '</b><br><span style="color:#555">' + esc(q[6]) + '</span>';
  }));
  section('Deadlines in the next ' + cfg.windowDays + ' days', deadlines.map(function (r) {
    const n = daysLeft(r.deadline);
    return '<b>' + link(r.link, name(r.title, r.org)) + '</b> — ' + fmt(r.deadline) +
      ' (' + (n === 0 ? 'today' : n === 1 ? 'tomorrow' : n + ' days') + ')' +
      (r.status && r.status !== 'not started' ? ' · status: ' + esc(r.status) : '');
  }));
  section('New listings', postings.map(function (q) {
    return link(q[5], q[6]) + ' <span style="color:#555">(' + esc(q[4] || q[3]) + ')</span>';
  }));
  section('Expected to open around now', opening.map(function (r) {
    return link(r.link, name(r.title, r.org)) + ' — expected ' + fmt(r.opens) + '. Worth a check.';
  }));
  section('Application wording changed', changed.map(function (q) {
    return link(q[5], name(q[3], q[4])) + '<br><span style="color:#555">' + esc(q[6]).slice(0, 400) + '</span>';
  }));
  section('Could not read', unreadable.map(function (q) {
    return link(q[5], name(q[3], q[4])) + '<br><span style="color:#555">' + esc(q[6]) + '</span>';
  }));
  if (total === 0) html += '<p>Nothing new since the last digest. The system is running.</p>';
  html += '<p style="color:#888;font-size:12px;margin-top:26px">From your tracker: <a href="' + ss_().getUrl() +
    '">open the spreadsheet</a>. Set a row\'s Status to Applied or Not applying to stop alerts for it.</p></div>';

  const bits = [];
  if (opened.length) bits.push(opened.length + ' now open');
  if (deadlines.length) bits.push(deadlines.length + ' deadline' + (deadlines.length > 1 ? 's' : ''));
  if (postings.length) bits.push(postings.length + ' new listing' + (postings.length > 1 ? 's' : ''));
  if (opening.length) bits.push(opening.length + ' opening soon');
  const subject = 'Job alerts: ' + (bits.length ? bits.join(', ') : 'nothing new');

  MailApp.sendEmail({ to: cfg.email, subject: subject, htmlBody: html, name: 'Job alerts' });
  clearQueue_();
  setSetting_('Last digest sent', now);
}
