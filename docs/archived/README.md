# docs/archived — superseded design docs

Design docs that have been **superseded** (folded into / replaced by a current
doc, or whose design has shipped and is now described elsewhere) live here. They
are kept for history and provenance — the current source of truth is in `docs/`.

**Convention (2026-06-18):** we no longer tag work-in-progress docs with a
`[todo]` prefix in the filename. Instead:

- A doc whose design is **superseded** moves here, under `docs/archived/`, with a
  `> **⚠ SUPERSEDED — folded into <current doc>**` banner kept at the top.
- Active/current design docs stay in `docs/` with a plain `NN_name.md` name.

## Contents

| File | Superseded by |
|---|---|
| `25_marsin_audio_analysis.md` | `docs/37_marsin_audio_framework.md` |
| `29_node_based_audio_post_processing.md` | `docs/37_marsin_audio_framework.md` (chain framework still implemented) |
| `30_audio_structure_detector.md` | `docs/37_marsin_audio_framework.md` (detector implemented) |

(`30_audio_structure_detector.md` was `30_[todo]_audio_structure_detector.md`
before the `[todo]` convention was retired.)
