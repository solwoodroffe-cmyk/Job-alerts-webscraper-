/**
 * Storage.js — hidden _state and _queue tabs, and the short hash used to remember what has been seen.
 */

function h8_(s) {
  const norm = String(s).toLowerCase().replace(/\s+/g, ' ').trim();
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, norm, Utilities.Charset.UTF_8);
  return bytes.slice(0, 5).map(function (b) { return ((b + 256) % 256).toString(16).padStart(2, '0'); }).join('');
}

function hiddenSheet_(name, header) {
  let sh = ss_().getSheetByName(name);
  if (!sh) {
    sh = ss_().insertSheet(name);
    sh.getRange(1, 1, 1, header.length).setValues([header]);
    sh.hideSheet();
  }
  return sh;
}

function loadState_() {
  const sh = hiddenSheet_(STATE_TAB, ['key', 'json']);
  const st = {};
  if (sh.getLastRow() < 2) return st;
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) {
    if (r[0]) { try { st[r[0]] = JSON.parse(r[1]); } catch (e) {} }
  });
  return st;
}

function saveState_(st) {
  const sh = hiddenSheet_(STATE_TAB, ['key', 'json']);
  const rows = Object.keys(st).map(function (k) { return [k, JSON.stringify(st[k])]; });
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 2).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, 2).setValues(rows);
}

const QUEUE_HEADER = ['found', 'type', 'tab', 'title', 'organisation', 'link', 'detail'];

function appendQueue_(findings) {
  if (!findings.length) return;
  const sh = hiddenSheet_(QUEUE_TAB, QUEUE_HEADER);
  sh.getRange(sh.getLastRow() + 1, 1, findings.length, QUEUE_HEADER.length).setValues(findings);
}

function readQueue_() {
  const sh = hiddenSheet_(QUEUE_TAB, QUEUE_HEADER);
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, QUEUE_HEADER.length).getValues();
}

function clearQueue_() {
  const sh = hiddenSheet_(QUEUE_TAB, QUEUE_HEADER);
  if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
}

function writeStatuses_(updates) {
  updates.forEach(function (u) {
    const t = u[0];
    if (t.h['Last checked'] !== undefined) t.sheet.getRange(t.rowNum, t.h['Last checked'] + 1).setValue(u[1]);
    if (t.h['Detected state'] !== undefined) t.sheet.getRange(t.rowNum, t.h['Detected state'] + 1).setValue(u[2]);
  });
}
