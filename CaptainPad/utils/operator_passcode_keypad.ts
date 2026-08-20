// operator_passcode_keypad — pure contract for the performance-mode operator
// passcode entry surface. The engine verifies whatever string arrives in
// X-CaptainPad-Passcode; CaptainPad restricts INPUT to uppercase hex digits so
// the system keyboard never appears and no other characters can be typed, pasted,
// or auto-filled.

/** Exactly sixteen character keys: A–F then 0–9, in keypad order. */
export const OPERATOR_PASSCODE_CHARS = [
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '0',
] as const;

export type OperatorPasscodeChar = (typeof OPERATOR_PASSCODE_CHARS)[number];

export const OPERATOR_PASSCODE_KEYPAD_INSTRUCTION =
  'Enter the operator passcode using the keypad.';

const ALLOWED = new Set<string>(OPERATOR_PASSCODE_CHARS);

export function isOperatorPasscodeChar(char: string): boolean {
  return char.length === 1 && ALLOWED.has(char);
}

export function appendOperatorPasscodeChar(current: string, char: string): string {
  if (!isOperatorPasscodeChar(char)) return current;
  return current + char;
}

export function deleteOperatorPasscodeChar(current: string): string {
  if (current.length === 0) return current;
  return current.slice(0, -1);
}

export function clearOperatorPasscode(_current: string): string {
  return '';
}

/** Masked display only — never use for logging or persistence. */
export function maskOperatorPasscode(value: string): string {
  return value.length > 0 ? '•'.repeat(value.length) : '';
}
