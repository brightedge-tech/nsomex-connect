import { parsePhoneNumberFromString } from 'libphonenumber-js';

const protectedRoutePrefixes = [
  '/admin',
  '/bookings',
  '/messages',
  '/notifications',
  '/provider',
  '/providers',
  '/reviews',
  '/services',
];
const otpCooldownMs = 60_000;
const otpCooldownByPhone = new Map<string, number>();

export function normalizePhoneNumber(value: string) {
  const cleaned = value.trim().replace(/[\s().-]/g, '');
  const international = cleaned.startsWith('00') ? `+${cleaned.slice(2)}` : cleaned;
  const parsed = parsePhoneNumberFromString(international, 'CM');

  return parsed?.isValid() ? parsed.number : null;
}

export function getOtpCooldownSeconds(phone: string) {
  const remainingMs = (otpCooldownByPhone.get(phone) ?? 0) - Date.now();
  return Math.max(0, Math.ceil(remainingMs / 1000));
}

export function markOtpRequest(phone: string) {
  otpCooldownByPhone.set(phone, Date.now() + otpCooldownMs);
  if (otpCooldownByPhone.size > 20) {
    const oldestPhone = otpCooldownByPhone.keys().next().value;
    if (oldestPhone) otpCooldownByPhone.delete(oldestPhone);
  }
}

export function getFirstParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

export function sanitizeReturnTo(value?: string | string[]) {
  const candidate = getFirstParam(value);
  if (!candidate || !candidate.startsWith('/') || candidate.startsWith('//')) return null;

  const path = candidate.split(/[?#]/, 1)[0];
  if (!protectedRoutePrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    return null;
  }

  return candidate;
}

export function appendQueryParams(
  pathname: string,
  params: Record<string, string | string[] | undefined>,
) {
  const query = Object.entries(params).flatMap(([key, value]) => {
    const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
    return values.map((entry) => `${encodeURIComponent(key)}=${encodeURIComponent(entry)}`);
  });
  return query.length ? `${pathname}?${query.join('&')}` : pathname;
}
