# IBM Plex webfonts

> Since 2026-09-30 IBM Plex Mono is a fallback only: figures use Geist Mono
> (`geist-mono/`, first in `--font-mono` in `typography.css`), and the browser
> downloads the Plex Mono subsets only for glyphs Geist Mono lacks. Interface text
> uses Hanken Grotesk (`hanken/`). The Plex files below are unchanged.

These are unchanged WOFF2 files from the Google Fonts stylesheet already used by
HypoExplorer, retrieved on 2026-09-14 UTC. Hosting them here removes the external
Google Fonts stylesheet and font-origin dependency while retaining the existing
typefaces, requested weights, `font-display: swap`, and Unicode ranges.

- IBM Plex Sans: normal 400, 500 and 600; Google Fonts delivery version v23.
- IBM Plex Mono: normal 400 and 500; Google Fonts delivery version v20.
- Sans includes Latin, Latin Extended, Cyrillic, Cyrillic Extended, Greek and
  Vietnamese subsets. Mono retains the five subsets in the original response:
  Latin, Latin Extended, Cyrillic, Cyrillic Extended and Vietnamese.
- The Google Fonts response uses the same Sans binary for all three requested
  weights within a subset. It is stored once and referenced by each original
  weight rule. No font binary was modified or resubsetted.

Use `/fonts/ibm-plex.css`. It contains 28 font-face rules referring to 16 local
WOFF2 files. All other declarations match the source CSS. The browser downloads
only the weights and character subsets it uses.

The complete font payload is 261,400 bytes; CSS is 10,098 bytes. The three Latin
files total 75,308 bytes, of which the Sans file shared by 400/500/600 is 45,712
bytes. These are uncompressed file sizes, not a measured page transfer budget.

## Source and license

Original CSS request:

<https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap>

`font-manifest.json` records the retrieval time, request user agent, original
font URLs, local filenames, byte sizes, weights, subsets and SHA-256 hashes.

Copyright 2017 IBM Corp., with Reserved Font Name "Plex". The fonts are distributed
under the SIL Open Font License 1.1. [OFL.txt](OFL.txt) contains the complete
copyright notice and license. The official Sans and Mono notices were checked
and are identical:

- [Google Fonts: IBM Plex Sans license](https://github.com/google/fonts/blob/main/ofl/ibmplexsans/OFL.txt)
- [Google Fonts: IBM Plex Mono license](https://github.com/google/fonts/blob/main/ofl/ibmplexmono/OFL.txt)
- [IBM Plex upstream license](https://github.com/IBM/plex/blob/master/LICENSE.txt)

Keep the notice and license with redistributed font assets. The local filenames
describe the existing delivery version, weights and subset; the font software's
names and bytes are unchanged. When refreshing the assets, verify the source
licenses, retain the requested coverage, update the manifest, and use new asset
filenames if the bytes change.
