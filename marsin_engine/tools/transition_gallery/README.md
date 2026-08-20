# Deck transition gallery

This tool builds the permanent, offline transition comparison at
`docs/pattern_gallery/transitions/`.

Every row uses one fixed full-rig sequence so styles stay comparable:

- A: the exact saved `baby_boy` Keel Breath entry in blue;
- the selected Deck transition;
- B: the exact saved `baby_girl` Keel Breath entry in pink.

The incoming B pattern is zero-seeded and parked until the transition starts,
matching the production Deck phase policy. The tool uses the real Titanic
model, the real Marsin WASM blend VM, and the playlist
gallery's shared top/front/TE-sign renderer. It starts no engine, binds no port,
and writes scratch captures only under `~/tmp/transition_gallery/`.

From `marsin_engine/`:

```bash
node tools/transition_gallery/generate.mjs
```

The default media is four seconds long: one-second A hold, two-second
transition, and one-second B hold. MP4 is the seekable review surface; GIF is
the downloadable loop. The generator also rebuilds the combined master
`docs/pattern_gallery/index.html` after every successful run.

The gallery mirrors the current Deck executor exactly: a smoothstep fader feeds
the selected `trans_*` script on every in-flight frame, including the true
six-lane `trans_crossfade`. There is no universal tail cut. At completion the
gallery compares the final transition frame with B's own 40 fps motion
baseline, while the endpoint oracle requires byte-exact B.

Use the strict audit gate when a non-zero exit is required while repairing the
executor:

```bash
node tools/transition_gallery/generate.mjs --strict-audit
```

The strict command still writes the evidence, then exits `2` when any completion
jump exceeds B's own motion baseline by at least two RMS bytes. Unknown transition files, missing endpoint entries,
compile failures, unsafe output paths, malformed captures, and encode failures
all stop generation loudly.
