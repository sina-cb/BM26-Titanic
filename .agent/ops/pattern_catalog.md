# Playlist Gallery

The permanent pattern-review surface is playlist-first. It renders the exact
saved values for a scene playlist through the real offline model compiler, then
publishes synchronized top, front, and feature views as a teammate-shareable
static gallery.

## Tracked layout

| Path | Purpose |
|---|---|
| `docs/pattern_gallery/index.html` | Complete index of every discovered scene playlist. |
| `docs/pattern_gallery/playlists/<scene>/<playlist>/` | One generated playlist gallery. |
| `docs/pattern_gallery/playlists/<scene>/<playlist>/gifs/` | Ten-second, full-width animated previews. |
| `marsin_engine/tools/playlist_gallery/` | Offline generator and GIF encoder. |

GitHub Pages serves the index from:

`https://sina-cb.github.io/BM26-Titanic/docs/pattern_gallery/`

The local interactive audition system in `marsin_engine/tools/gallery/` is a
different tool and remains the right surface for live controls and sound/model
variations. The permanent gallery is the saved-playlist record.

## Generate or refresh a playlist

Run from `marsin_engine/`:

```bash
node tools/playlist_gallery/generate.mjs --scene titanic --playlist ambient
```

Defaults are ten seconds at eight frames per second, using the playlist's exact
saved values and silence so modulators cannot obscure the tune. The generator:

1. loads `simulation/scenes/<scene>/playlists/<playlist>.yaml`;
2. resolves every pattern file and saved slider value, failing on stale names;
3. runs `tools/pattern_audio_harness.mjs` against the matching model;
4. renders synchronized top and front projections plus a declared feature view;
5. writes the GIFs, gallery page, manifest, and refreshed global index.

Titanic's feature view is both TE signs. Other models explicitly label the
dense section selected for their detail view; the tool never pretends a missing
Identity fixture exists.

Useful commands:

```bash
# Rebuild the complete playlist index without rendering clips.
node tools/playlist_gallery/generate.mjs --index-only

# Deliberately exercise pattern-authored audio suggestions.
node tools/playlist_gallery/generate.mjs \
  --scene titanic --playlist party_high --variation sound

# Explicit bulk operation; potentially large.
node tools/playlist_gallery/generate.mjs --all-playlists
```

## Verification

- The generator never boots the engine or binds show ports.
- GIFs are encoded with the repo's bundled offline FFmpeg build and a
  per-gallery optimized palette.
- The gallery discloses the display-only tone curve in its README.
- Open the generated HTML and visually inspect at least one full loop.
- Run `tests/patterns/playlist_gallery_tool.test.mjs` for encoder and durable
  index contract coverage.

Do not hand-edit generated gallery HTML, manifests, or GIFs. Curated visual
goals live in `tools/playlist_gallery/pattern_goals.json`; patterns without a
curated entry receive a plainly generic description until a curator adds one.
