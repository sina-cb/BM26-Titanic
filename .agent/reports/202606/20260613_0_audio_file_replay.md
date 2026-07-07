# 20260613_0 — Audio file-replay capture source

- **Branch:** `dev/claude/audio_file_replay`
- **Parent branch:** `claude/laughing-lamport-tb6cc9`
- **Worktree:** `/home/user/BM26-Titanic-worktrees/audio_file_replay`
- **Slot:** 0 (port base 31000 — not used; no servers booted)

## Scope

Add a file-replay capture source to the engine audio pipeline so a local
audio FILE can stream through the EXACT same capture → analyzer → CPC path
as a live mic. Unblocks deterministic end-to-end audio tests, desk tuning
with no speakers, and docs/30 structure-detector dataset validation.

Design (as specified):

1. **Decision inside `audio_capture.js`.** A `device` of the form
   `file:<path>` makes `buildFfmpegArgs` produce file-input argv:
   `-stream_loop -1` (before `-i`, default-on so a short clip loops
   forever) `-re -i <path> -ac N -ar R -f s16le -`. No device-format flag
   (`avfoundation`/`dshow`/`pulse`/`alsa`) — ffmpeg auto-detects the
   container. `resolveDevice`/`resolveInputFormat`/platform logic is
   bypassed in file mode; live capture is byte-for-byte unchanged for a
   normal device. Empty `file:` path throws typed `audio_file_missing_path`
   (P0: fail loudly, no mic fallback).
2. **CLI flag `--audio_file <path>`** in `engine_cli_flags.js` (parses like
   `--mic`; throws `cli_missing_value` if value absent; NOT an exit flag).
   In `engine.js` boot-config region, when `flags.audioFile` is set it
   forces `engineConfig.audio.enabled = true` and
   `capture.device = 'file:' + path` BEFORE AudioCapture is constructed.
3. **`config.yaml`** `audio.capture.loop: true` added (comment notes it
   only applies to `file:` sources).
4. **`loop` threaded** capture config → AudioCapture constructor opt →
   `buildArgs`. Default true.
5. **docs/25 §3.6** documents the `file:` source, `--audio_file`, and `loop`.

## Files changed (`git diff --name-status HEAD~1 HEAD`)

```
M  docs/25_marsin_audio_analysis.md
M  marsin_engine/config.yaml
M  marsin_engine/engine.js
M  marsin_engine/lib/audio_capture.js
M  marsin_engine/lib/engine_cli_flags.js
A  marsin_engine/tests/audio_capture_file.test.js
M  marsin_engine/tests/engine_cli_flags.test.js
```

Note: `marsin_engine/lib/audio_capture.js` and `lib/engine_cli_flags.js`
and `config.yaml` already carried portions of the file-replay
implementation when this worktree was opened (prior parent-branch work).
This task completed the remaining wiring: the `engine.js` `--audio_file`
boot handling, the `loop` threading into the AudioCapture constructor call
in `engine.js`, the new dedicated test file, the `engine_cli_flags.test.js`
coverage + `audioFile` field fix, and the docs/25 §3.6 subsection.

## Tests run + results

Required set:
```
node --test tests/audio_capture.test.js tests/audio_capture_platform.test.js \
            tests/audio_capture_file.test.js tests/engine_cli_flags.test.js
# tests 42  # pass 42  # fail 0
```

`node --check engine.js` → OK.

New `audio_capture_file.test.js` asserts: `-stream_loop -1 -re -i /x.wav
... -f s16le -` for `loop:true`; default (loop omitted) still loops;
`loop:false` omits `-stream_loop`; no device-format flag in file mode;
channels/sampleRate honoured; empty `file:` path throws
`audio_file_missing_path`; live-capture argv unchanged (`-f avfoundation
-i :0`, no `-stream_loop`/`-re`).

`engine_cli_flags.test.js`: `--audio_file /x.wav` parses; not an exit
flag; missing value throws `cli_missing_value`; `audioFile:null` added to
the all-false deepEqual.

## Known gaps

- **Pre-existing failure (NOT mine):** `tests/audio_config.test.js` →
  "AUDIO_LIVE_FIELDS is the contract surface" fails (1/17) on this branch
  even with all my changes stashed. It lives in `audio_config.js`, owned by
  another agent — I did not touch it. Flagged, not fixed.
- `--audio_file` forces audio on by mutating `engineConfig.audio` (the
  config.yaml merge base) in the boot region, per the spec's location
  constraint. A per-scene `states/<scene>/audio_state.yaml` that pins
  `capture.device` or `enabled:false` would merge OVER it (merge order:
  config.yaml < audio_state.yaml). In practice capture is machine-local and
  scenes rarely pin a device, so the intended use cases (tests, desk
  tuning) work. If a scene does pin capture, applying the override to the
  post-merge `audioState.config` (~line 1191) would be more robust — but
  that's just outside the spec's authorized 758-885 edit window and near a
  region another agent owns, so it was left as documented.
- No live ffmpeg smoke (no clip / no audio hardware in CI); the framing
  path is exercised with injected spawn, the argv builder with pure-function
  asserts.

## Operator action requested

- Merge `dev/claude/audio_file_replay` into the parent branch (instigator
  merges; I did not push or open a PR).
- Optional: quick real-ffmpeg smoke with a clip:
  `node marsin_engine/engine.js --model test_bench --pattern 01_cylon_sweep
  --audio_file /path/to/clip.wav` and confirm the audioStatus meters move.

https://claude.ai/code/session_01LRHgAUJM8SVpyGxMpjMJTr
