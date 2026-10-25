# Cat voice recordings (optional)

Mewwo ships **without** recorded cat sounds, because every file needs a licence that allows redistribution
in a game. Until you add recordings, the game uses a small synthesised voice (`lib/client/audio.ts`) that
follows exactly the same events, cooldowns and volume controls.

To use real recordings:

1. Add licensed files here (short, mono, `.ogg` or `.mp3`, peak around -3 dBFS, no silence at the start).
   Several variants per category sound far more natural than one.
2. List them in `lib/client/voiceAssets.ts`, for example `meow: ['/audio/cat/meow-01.ogg', '/audio/cat/meow-02.ogg']`.
3. Nothing else changes. Playback adds small random pitch and volume variation, and falls back to the
   synthesised voice if a file is missing or fails to decode.

Categories: `meow`, `meow_soft` (quiet, sleepy), `meow_plea` (insistent, asking for food), `chirp`, `trill`,
`chatter` (watching birds), `purr` (a loopable ~3-6 s clip), `hiss` (brief warning).

Suitable sources: recordings you make yourself, or CC0 / explicitly game-licensed libraries. Keep a note of
each file's licence in this folder.
