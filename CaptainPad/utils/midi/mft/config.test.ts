import { describe, it, expect } from 'vitest';
import {
  buildEncoderConfigFrames,
  buildConnectConfig,
  buildGlobalConfigFrame,
} from './config';
import { Encoders, EncoderSettings, ColorValues } from './constants';

describe('buildEncoderConfigFrames', () => {
  it('emits a single BULK_XFER frame (golden, byte-for-byte) for encoder 0', () => {
    // Settings: detent(addr10)=0, movement_type(addr11)=2, encoder_midi_type(addr18)=2.
    // config_data = [10,0, 11,2, 18,2] (6 bytes, canonical address order).
    // tag = encoder(0)+1 = 1; totalParts = ceil(6/24) = 1; size = 6.
    const frames = buildEncoderConfigFrames(0, {
      detent: 0,
      movement_type: 2,
      encoder_midi_type: 2,
    });
    expect(frames).toEqual([
      [
        0xf0, // sysex start
        0x00, 0x01, 0x79, // DJTT mfr id
        0x04, // BULK_XFER
        0x00, // fixed 0x00
        1, // tag = encoder+1
        1, // part (1-based)
        1, // totalParts
        6, // size (payload bytes)
        10, 0, 11, 2, 18, 2, // payload: address/value pairs
        0xf7, // sysex end
      ],
    ]);
  });

  it('orders settings by canonical address, not object-insertion order', () => {
    // Provide out of order; expect address order 10, 19 (active_color).
    const frames = buildEncoderConfigFrames(2, {
      active_color: 80,
      detent: 1,
    });
    // tag = 3, config_data = [10,1, 19,80], size 4.
    expect(frames).toEqual([
      [0xf0, 0x00, 0x01, 0x79, 0x04, 0x00, 3, 1, 1, 4, 10, 1, 19, 80, 0xf7],
    ]);
  });

  it('chunks into multiple 24-byte parts when the payload exceeds PART_SIZE_BYTES', () => {
    // All 15 settings → 30 bytes → 2 parts (24 + 6).
    const full = {
      detent: 0,
      movement_type: 2,
      switch_action_type: 0,
      switch_midi_channel: 1,
      switch_midi_number: 0,
      switch_midi_type: 0,
      encoder_midi_channel: 1,
      encoder_midi_number: 0,
      encoder_midi_type: 2,
      active_color: 100,
      inactive_color: 1,
      detent_color: 63,
      indicator_display_type: 2,
      is_super_knob: 0,
      encoder_shift_midi_channel: 0,
    };
    const frames = buildEncoderConfigFrames(0, full);
    expect(frames).toHaveLength(2);
    // Part 1: part=1, totalParts=2, size=24, 24 payload bytes.
    expect(frames[0].slice(0, 9)).toEqual([0xf0, 0x00, 0x01, 0x79, 0x04, 0x00, 1, 1, 2]);
    expect(frames[0][9]).toBe(24); // size
    expect(frames[0]).toHaveLength(10 + 24 + 1); // header(10) + payload(24) + end(1)
    // Part 2: part=2, totalParts=2, size=6.
    expect(frames[1].slice(0, 9)).toEqual([0xf0, 0x00, 0x01, 0x79, 0x04, 0x00, 1, 2, 2]);
    expect(frames[1][9]).toBe(6); // size
    expect(frames[1]).toHaveLength(10 + 6 + 1);
    // Every frame is a well-formed sysex.
    for (const f of frames) {
      expect(f[0]).toBe(0xf0);
      expect(f[f.length - 1]).toBe(0xf7);
    }
  });

  it('returns [] for an empty settings map', () => {
    expect(buildEncoderConfigFrames(0, {})).toEqual([]);
  });

  it('throws on an out-of-range encoder index', () => {
    expect(() => buildEncoderConfigFrames(64, { detent: 0 })).toThrow(RangeError);
    expect(() => buildEncoderConfigFrames(-1, { detent: 0 })).toThrow(RangeError);
  });
});

describe('buildConnectConfig', () => {
  const frames = buildConnectConfig();

  it('emits two BULK_XFER parts per encoder PLUS the trailing global PUSH_CONF frame', () => {
    // Each encoder has 15 settings → 30 bytes → 2 parts (128 encoder frames),
    // then one global PUSH_CONF commit frame — mirrors pymft Config.send_all()
    // (_send_encoders(force_all=True) then _send_global()). P1-1: the global
    // frame was previously never emitted, so the "force encoders to relative
    // mode" push was a silent no-op with no commit + side-button config.
    expect(frames).toHaveLength(Encoders.DEVICE_KNOB_NUM * 2 + 1);
  });

  it('appends the global PUSH_CONF frame LAST (after every encoder frame)', () => {
    // pymft send_all(): encoders first, global commit last.
    const last = frames[frames.length - 1];
    expect(last[0]).toBe(0xf0);
    expect(last.slice(1, 4)).toEqual([0x00, 0x01, 0x79]); // DJTT mfr id
    expect(last[4]).toBe(0x01); // SysExCommands.PUSH_CONF
    expect(last[last.length - 1]).toBe(0xf7);
    // Every OTHER frame is a BULK_XFER (cmd byte 0x04) — only the last is global.
    for (let i = 0; i < frames.length - 1; i += 1) {
      expect(frames[i][4]).toBe(0x04);
    }
  });

  it('forces relative mode + velocity movement on encoder 0', () => {
    // encoder 0 spans two frames (30 bytes → 24 + 6). Gather the address/value
    // pairs from BOTH parts (payload lives from index 10 to the 0xF7 terminator).
    const pairs = new Map<number, number>();
    for (const frame of [frames[0], frames[1]]) {
      const payload = frame.slice(10, frame.length - 1);
      for (let i = 0; i < payload.length; i += 2) pairs.set(payload[i], payload[i + 1]);
    }
    // encoder_midi_type (addr 18) = MIDITYPE_SENDRELENC.
    expect(pairs.get(18)).toBe(EncoderSettings.MIDITYPE_SENDRELENC);
    // movement_type (addr 11) = MOVEMENTTYPE_VELOCITYSENSITIVE.
    expect(pairs.get(11)).toBe(EncoderSettings.MOVEMENTTYPE_VELOCITYSENSITIVE);
    // Switch push must land on the runtime SWITCH_AND_COLOR channel (raw ch1),
    // where decodeEncoderPush / setColor listen. The sysex `switch_midi_channel`
    // field is 1-BASED (pymft config.py sets encoder_midi_channel=1 for raw ch0,
    // switch_midi_channel=2 for raw ch1), so addr 13 must be 2, NOT 1. Value 1
    // would put the push on the rotary channel (raw ch0) and collide with turns.
    // pymft parity: pymft/src/config.py initialize_defaults →
    //   set("switch_midi_channel", 2). CC-hold (addr 12) is this port's
    //   intentional deviation from pymft's SWACTION_ENCRESETVALUE.
    expect(pairs.get(13)).toBe(2);
    expect(pairs.get(12)).toBe(EncoderSettings.SWACTION_CCHOLD);
    // encoder_midi_channel (addr 16) = 1 (1-based → raw ch0, the rotary channel).
    expect(pairs.get(16)).toBe(1);
    // indicator = blended bar (addr 22); detent off (addr 10 = 0).
    expect(pairs.get(22)).toBe(EncoderSettings.INDICATORTYPE_BLENDEDBAR);
    expect(pairs.get(10)).toBe(0);
  });

  it('tags each encoder frame with encoderIndex+1', () => {
    // Frame 0 → encoder 0 → tag 1; frame 2 → encoder 1 → tag 2.
    expect(frames[0][6]).toBe(1);
    expect(frames[2][6]).toBe(2);
    // Last encoder (63) → tag 64. The very last frame is the global PUSH_CONF,
    // so encoder 63's second part is at length-2 (index of the last BULK_XFER).
    expect(frames[frames.length - 2][6]).toBe(64);
  });

  it('applies per-bank base colours (bank1 pink, bank2 yellow, bank3 red, bank4 blue)', () => {
    // Helper: active_color = addr 19 in an encoder's first frame.
    const activeColorOf = (encoder: number): number => {
      const frame = frames[encoder * 2];
      const payload = frame.slice(10, frame.length - 1);
      for (let i = 0; i < payload.length; i += 2) {
        if (payload[i] === 19) return payload[i + 1];
      }
      throw new Error('active_color not found');
    };
    expect(activeColorOf(0)).toBe(ColorValues.PINK); // bank 1
    expect(activeColorOf(16)).toBe(ColorValues.YELLOW); // bank 2
    expect(activeColorOf(32)).toBe(ColorValues.RED); // bank 3
    expect(activeColorOf(48)).toBe(ColorValues.BLUE); // bank 4
    // inactive is always blue (addr 20).
    const inactiveColorOf = (encoder: number): number => {
      const frame = frames[encoder * 2];
      const payload = frame.slice(10, frame.length - 1);
      for (let i = 0; i < payload.length; i += 2) {
        if (payload[i] === 20) return payload[i + 1];
      }
      throw new Error('inactive_color not found');
    };
    expect(inactiveColorOf(0)).toBe(ColorValues.BLUE);
    expect(inactiveColorOf(48)).toBe(ColorValues.BLUE);
  });
});

describe('buildGlobalConfigFrame (pymft _send_global golden)', () => {
  // PYMFT-CONFIRMED GOLDEN — computed by hand from pymft/src/config.py
  // `Config._send_global()` iterating `pymft/src/device_settings.py`
  // `DeviceSettings._settings` (insertion order preserved), with every
  // constant resolved from `pymft/src/constants.py`:
  //   frame = [0xF0] + MFR_ID + [PUSH_CONF] + [key,value ...] + [0xF7]
  // DeviceSettings pairs (address: value):
  //   0:SYSTEM(3) 1:TRUE(1) 2:CCTOGGLE(1) 3:BANKDOWN(7) 4:CCTOGGLE(1)
  //   5:CCTOGGLE(1) 6:BANKUP(6) 7:CCTOGGLE(1) 8:63 9:127
  //   10:0 11:0 12:0 13:2 14:0 15:0 16:1 17:0 18:MIDITYPE_SENDCC(1)
  //   19:ACTIVE(127) 20:BLUE(1) 21:63 22:INDICATORTYPE_BLENDEDBAR(2) 23:0 24:0
  //   31:127 32:127
  // These bytes are what a bench MFT actually receives from pymft's default
  // config; they carry the side-button BANKUP/BANKDOWN wiring (keys 6 / 3) that
  // docs/34 promises "set in the config push". This frame is byte-for-byte
  // diffable against pymft and does NOT depend on buildGlobalConfigFrame's own
  // output (it is a real external golden, not self-referential).
  const PYMFT_GLOBAL_GOLDEN = [
    0xf0, 0x00, 0x01, 0x79, 0x01,
    0, 3, 1, 1, 2, 1, 3, 7, 4, 1, 5, 1, 6, 6, 7, 1, 8, 63, 9, 127,
    10, 0, 11, 0, 12, 0, 13, 2, 14, 0, 15, 0, 16, 1, 17, 0, 18, 1,
    19, 127, 20, 1, 21, 63, 22, 2, 23, 0, 24, 0, 31, 127, 32, 127,
    0xf7,
  ];

  it('matches pymft _send_global byte-for-byte (60-byte PUSH_CONF frame)', () => {
    expect(buildGlobalConfigFrame()).toEqual(PYMFT_GLOBAL_GOLDEN);
  });

  it('is a well-formed PUSH_CONF sysex frame', () => {
    const f = buildGlobalConfigFrame();
    expect(f[0]).toBe(0xf0);
    expect(f.slice(1, 4)).toEqual([0x00, 0x01, 0x79]);
    expect(f[4]).toBe(0x01); // SysExCommands.PUSH_CONF
    expect(f[f.length - 1]).toBe(0xf7);
    // Header(5) + 27 address/value pairs (54) + terminator(1) = 60 bytes.
    expect(f).toHaveLength(60);
  });

  it('carries the side-button bank-down (key 3) and bank-up (key 6) actions', () => {
    // docs/34_captainpad_midi.md §"Side buttons": "left column = bank up / bank
    // down (hardware action, set in the config push)". pymft's default wiring:
    // Left Button 2 = BANKDOWN (0x07), Right Button 2 = BANKUP (0x06).
    const f = buildGlobalConfigFrame();
    const pairs = new Map<number, number>();
    for (let i = 5; i < f.length - 1; i += 2) pairs.set(f[i], f[i + 1]);
    expect(pairs.get(3)).toBe(0x07); // BANKDOWN
    expect(pairs.get(6)).toBe(0x06); // BANKUP
  });
});
