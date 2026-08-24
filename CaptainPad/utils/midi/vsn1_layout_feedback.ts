// VSN1 runtime layout feedback — pure MIDI byte builder.
//
// The legacy layout path flashes Lua through a USB-serial port owned by the
// engine computer. A VSN1 plugged directly into an iPad is instead a CoreMIDI
// endpoint, so CaptainPad sends the active page's names, colors, behaviors, and
// mode labels as ordinary 3-byte CC messages. The checked-in VSN1 Lua receiver
// applies the complete transaction only when it receives the commit message.

const STATUS_CC = 0xb0;
export const VSN1_LAYOUT_NAME_CH = 13;
export const VSN1_LAYOUT_COLOR_CH = 14;
export const VSN1_LAYOUT_MODE_CH = 15;

export const VSN1_LAYOUT_NAME_LEN = 10;
export const VSN1_LAYOUT_MODE_LEN = 3;
export const VSN1_LAYOUT_MAX_MODES = 5;
export const VSN1_LAYOUT_SLOTS_PER_PAGE = 8;

export const VSN1_LAYOUT_COLOR_BASE_CC = 0;
export const VSN1_LAYOUT_BEHAVIOR_BASE_CC = 24;
export const VSN1_LAYOUT_COMMIT_CC = 127;
export const VSN1_LAYOUT_MODE_COUNT_BASE_CC = 120;
/** Device → host acknowledgment emitted after the commit is applied. */
export const VSN1_LAYOUT_ACK_CC = 44;

const EMPTY_NAME = '-';
const EMPTY_COLOR: readonly [number, number, number] = [30, 30, 30];
const FALLBACK_COLORS: readonly (readonly [number, number, number])[] = [
  [255, 40, 40],
  [255, 140, 0],
  [255, 220, 0],
  [60, 220, 60],
  [0, 200, 200],
  [60, 120, 255],
  [160, 60, 255],
  [255, 60, 200],
];

export interface Vsn1LayoutFeedbackSlot {
  slot: number;
  effectId?: string;
  label?: string;
  color?: readonly [number, number, number] | null;
  behavior?: string;
  modeValues?: readonly (string | number | boolean)[];
}

export interface Vsn1LayoutProjection {
  signature: string;
  revision: number;
  messages: number[][];
}

function cc(channel: number, controller: number, value: number): number[] {
  return [
    STATUS_CC | (channel & 0x0f),
    Math.max(0, Math.min(127, Math.trunc(controller))),
    Math.max(0, Math.min(127, Math.trunc(value))),
  ];
}

function cleanAscii(value: unknown, length: number, fallback = ''): string {
  const cleaned = String(value ?? '')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/["\\]/g, '')
    .slice(0, length);
  return (cleaned || fallback).slice(0, length).padEnd(length, ' ');
}

function colorByte(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(127, Math.round(value / 2)));
}

/** Exact RGB the Grid receives for a slot, including its page-relative fallback
 * palette and MIDI's 7-bit quantization. CaptainPad uses this same helper while
 * VSN1 is connected so the touch surface and hardware have one color language. */
export function vsn1LayoutRgb(
  slotNumber: number,
  color: readonly [number, number, number] | null | undefined,
  populated = true,
): readonly [number, number, number] {
  const index = Math.max(0, Math.trunc(slotNumber) - 1) % VSN1_LAYOUT_SLOTS_PER_PAGE;
  const source = populated ? (color ?? FALLBACK_COLORS[index]) : EMPTY_COLOR;
  return source.map((value) => colorByte(value) * 2) as [number, number, number];
}

function revisionByte(signature: string): number {
  let hash = 0;
  for (let i = 0; i < signature.length; i += 1) {
    hash = ((hash * 31) + signature.charCodeAt(i)) & 0x7f;
  }
  return hash;
}

/** Build one atomic active-page layout update. Runtime value/active/mode-index
 * feedback remains in `vsn1_feedback.ts`; this stream changes only when layout
 * identity or presentation changes. */
export function projectVsn1Layout(
  pageInput: number,
  slots: readonly Vsn1LayoutFeedbackSlot[],
): Vsn1LayoutProjection {
  const page = Math.max(0, Math.min(3, Math.trunc(pageInput)));
  const byId = new Map(slots.map((slot) => [slot.slot, slot]));
  const normalized = [];

  for (let index = 0; index < VSN1_LAYOUT_SLOTS_PER_PAGE; index += 1) {
    const slot = byId.get((page * VSN1_LAYOUT_SLOTS_PER_PAGE) + index + 1);
    const populated = !!slot?.effectId;
    const name = cleanAscii(
      populated ? (slot?.label || slot?.effectId) : EMPTY_NAME,
      VSN1_LAYOUT_NAME_LEN,
      EMPTY_NAME,
    );
    const color = vsn1LayoutRgb(
      slot?.slot ?? ((page * VSN1_LAYOUT_SLOTS_PER_PAGE) + index + 1),
      slot?.color,
      populated,
    ).map((value) => colorByte(value)) as [number, number, number];
    const behavior = populated && slot?.behavior !== 'trigger' ? 1 : 0;
    const modes = populated
      ? (slot?.modeValues ?? [])
        .slice(0, VSN1_LAYOUT_MAX_MODES)
        .map((value) => cleanAscii(value, VSN1_LAYOUT_MODE_LEN, '-'))
      : [];
    normalized.push({ name, color, behavior, modes });
  }

  const signature = JSON.stringify({ page, slots: normalized });
  const messages: number[][] = [];

  for (let slot = 0; slot < normalized.length; slot += 1) {
    const record = normalized[slot];
    for (let offset = 0; offset < VSN1_LAYOUT_NAME_LEN; offset += 1) {
      messages.push(cc(
        VSN1_LAYOUT_NAME_CH,
        (slot * VSN1_LAYOUT_NAME_LEN) + offset,
        record.name.charCodeAt(offset),
      ));
    }
    for (let component = 0; component < 3; component += 1) {
      messages.push(cc(
        VSN1_LAYOUT_COLOR_CH,
        VSN1_LAYOUT_COLOR_BASE_CC + (slot * 3) + component,
        record.color[component],
      ));
    }
    messages.push(cc(
      VSN1_LAYOUT_COLOR_CH,
      VSN1_LAYOUT_BEHAVIOR_BASE_CC + slot,
      record.behavior,
    ));

    // Count first resets the receiver's old mode table before chars arrive.
    messages.push(cc(
      VSN1_LAYOUT_MODE_CH,
      VSN1_LAYOUT_MODE_COUNT_BASE_CC + slot,
      record.modes.length,
    ));
    for (let mode = 0; mode < record.modes.length; mode += 1) {
      for (let offset = 0; offset < VSN1_LAYOUT_MODE_LEN; offset += 1) {
        messages.push(cc(
          VSN1_LAYOUT_MODE_CH,
          (slot * VSN1_LAYOUT_MAX_MODES * VSN1_LAYOUT_MODE_LEN)
            + (mode * VSN1_LAYOUT_MODE_LEN)
            + offset,
          record.modes[mode].charCodeAt(offset),
        ));
      }
    }
  }

  const revision = revisionByte(signature);
  messages.push(cc(
    VSN1_LAYOUT_COLOR_CH,
    VSN1_LAYOUT_COMMIT_CC,
    revision,
  ));

  return { signature, revision, messages };
}

/** True only for the device's acknowledgment of the currently pending layout
 * revision. Channel is intentionally ignored: Grid emits on its current page. */
export function isVsn1LayoutAck(
  status: number,
  controller: number,
  value: number,
  expectedRevision: number | null,
): boolean {
  return expectedRevision !== null
    && (status & 0xf0) === STATUS_CC
    && controller === VSN1_LAYOUT_ACK_CC
    && value === expectedRevision;
}
