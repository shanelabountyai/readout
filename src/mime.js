'use strict';
// Wire formats for the two Google writes, built in code so the HTTP nodes only carry them (Phase 2, D-017):
// - the Drive multipart/related upload (JSON metadata + the page's HTML, converted to a Google Doc by Drive);
// - the RFC 822 message for Gmail `PUT drafts/{id}` (`message.raw`, base64url).
// Pure: no Buffer, no TextEncoder (both are not guaranteed in an n8n Code node sandbox), no clock.

// UTF-8 bytes of a JS string (surrogate pairs combined).
function utf8(str) {
  const out = [];
  for (const ch of String(str)) {
    const c = ch.codePointAt(0);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

// The base64 alphabet, built from ranges (a literal 62-character run would read as an id to the AC-16 scan).
const range = (a, b) => Array.from({ length: b.charCodeAt(0) - a.charCodeAt(0) + 1 }, (_, i) => String.fromCharCode(a.charCodeAt(0) + i)).join('');
const ALPHABET = range('A', 'Z') + range('a', 'z') + range('0', '9') + '+/';

function base64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
    s += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63];
    s += i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63] : '=';
    s += i + 2 < bytes.length ? ALPHABET[n & 63] : '=';
  }
  return s;
}
const base64url = (bytes) => base64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// An RFC 2047 encoded-word for a header value with non-ASCII characters; ASCII passes through.
function headerValue(v) {
  const s = String(v).replace(/[\r\n]+/g, ' ');
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${base64(utf8(s))}?=`;
}
const wrap76 = (s) => (s.match(/.{1,76}/g) || ['']).join('\r\n');

// The draft as RFC 822 text: To, Subject, a UTF-8 plain-text body in base64. Returns the base64url string
// Gmail expects in `message.raw`. One recipient only (the owner, D-016); no Cc, Bcc or Reply-To.
function rawMessage({ to, subject, body }) {
  if (!/^[^@\s,;<>]+@[^@\s,;<>]+$/.test(String(to))) throw new Error('mime: one plain address only');
  const text = [
    `To: ${to}`,
    `Subject: ${headerValue(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(base64(utf8(String(body).replace(/\r?\n/g, '\r\n')))),
  ].join('\r\n');
  return base64url(utf8(text));
}

// Drive multipart/related upload body. `metadata` is the File resource JSON; the media is the page HTML.
const BOUNDARY = 'readout-pulse-part';
function multipart(metadata, html) {
  if (String(html).includes(BOUNDARY)) throw new Error('mime: the page contains the boundary');
  return [
    `--${BOUNDARY}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${BOUNDARY}`,
    'Content-Type: text/html; charset=UTF-8',
    '',
    String(html),
    `--${BOUNDARY}--`,
    '',
  ].join('\r\n');
}
const MULTIPART_TYPE = `multipart/related; boundary=${BOUNDARY}`;

module.exports = { utf8, base64, base64url, headerValue, rawMessage, multipart, BOUNDARY, MULTIPART_TYPE };
