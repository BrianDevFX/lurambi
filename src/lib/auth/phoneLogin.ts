import { normaliseKenyanPhone } from '../normalisation/phone';

export function phoneToPseudoEmail(phone: string): string {
  const result = normaliseKenyanPhone(phone);
  if (!result.isValid || !result.phone_e164) throw new Error('Enter a valid Kenyan mobile number.');
  return `${result.phone_e164.slice(1)}@lurambi.invalid`;
}

export function loginIdentifierToEmail(identifier: string): string {
  const value = identifier.trim();
  if (value.includes('@')) return value.toLowerCase();
  return phoneToPseudoEmail(value);
}
