export function normalizeKenyanPhone(input) {
  const digits = String(input ?? '').replace(/\D/g, '');
  if (digits.length === 9 && /^[17]/.test(digits)) return `+254${digits}`;
  if (digits.length === 10 && /^0[17]/.test(digits)) return `+254${digits.slice(1)}`;
  if (digits.length === 12 && /^254[17]/.test(digits)) return `+${digits}`;
  return null;
}

export function normalizeNationalId(input) {
  const value = String(input ?? '').trim();
  if (!/^\d{7,8}$/.test(value)) return null;
  return { value, masked: `${value.slice(0, 2)}${'*'.repeat(Math.max(2, value.length - 5))}${value.slice(-3)}` };
}
