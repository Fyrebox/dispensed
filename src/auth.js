import crypto from 'node:crypto';
import { config } from './config.js';

const COOKIE = 'admin_session';
const TTL_DAYS = 14;

// The session token is an HMAC over an expiry timestamp, keyed by the admin
// password. Changing the password logs everyone out. No user table, no email.
const key = () => crypto.createHash('sha256').update(`triage-admin:${config.admin.pass}`).digest();
const sign = (exp) => crypto.createHmac('sha256', key()).update(String(exp)).digest('base64url');

export function issueToken() {
  const exp = Date.now() + TTL_DAYS * 86_400_000;
  return `${exp}.${sign(exp)}`;
}

export function verifyToken(token) {
  if (!token) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const expected = Buffer.from(sign(exp));
  const given = Buffer.from(sig);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

export function passwordMatches(candidate) {
  const a = Buffer.from(String(candidate || ''));
  const b = Buffer.from(config.admin.pass);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function readCookie(req) {
  const raw = req.headers.cookie || '';
  const m = raw.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
  return m ? decodeURIComponent(m.slice(COOKIE.length + 1)) : null;
}

export function setCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; Path=/admin; HttpOnly; SameSite=Lax; Max-Age=${TTL_DAYS * 86_400}${secure}`);
}

export function clearCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/admin; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/** Express middleware: redirect to the login page unless the session cookie is valid. */
export function requireAdmin(req, res, next) {
  if (verifyToken(readCookie(req))) return next();
  if (req.method !== 'GET') return res.status(401).send('Not signed in');
  res.redirect(`/admin/login?next=${encodeURIComponent(req.originalUrl)}`);
}
