# IBM Plex Mono webfonts

> IBM Plex Mono is a fallback only. Figures use Geist Mono (`geist-mono/`,
> first in `--font-mono` in `typography.css`), and the browser downloads the
> Plex Mono subsets only for glyphs Geist Mono lacks. Interface text uses Hanken
> Grotesk (`hanken/`).
>
> IBM Plex Sans was removed on 2026-11-10. It had been unused since Hanken
> Grotesk replaced it on 2026-09-30.

These are unchanged WOFF2 files from the Google Fonts stylesheet HypoExplorer
used, retrieved on 2026-09-14 UTC. Hosting them here removes the external Google
Fonts stylesheet and font-origin dependency while retaining the typeface,
requested weights, `font-display: swap`, and Unicode ranges.

- IBM Plex Mono: normal 400 and 500; Google Fonts delivery version v20.
- The five subsets in the original response are kept: Latin, Latin Extended,
  Cyrillic, Cyrillic Extended and Vietnamese.
- No font binary was modified or resubsetted.

Use `/fonts/ibm-plex.css`. It contains 10 font-face rules referring to 10 local
WOFF2 files. All other declarations match the source CSS. The browser downloads
only the weights and character subsets it uses.

The font payload is 98,984 bytes; CSS is 3,572 bytes. The two Latin files total
29,596 bytes. These are uncompressed file sizes, not a measured page transfer
budget.

## Source and license

Original CSS request (it also requested IBM Plex Sans, whose files were later
removed):

<https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap>

`font-manifest.json` records the retrieval time, request user agent, original
font URLs, local filenames, byte sizes, weights, subsets and SHA-256 hashes.

Copyright 2017 IBM Corp., with Reserved Font Name "Plex". The fonts are distributed
under the SIL Open Font License 1.1. [OFL.txt](OFL.txt) contains the complete
copyright notice and license. It matches the official notice:

- [Google Fonts: IBM Plex Mono license](https://github.com/google/fonts/blob/main/ofl/ibmplexmono/OFL.txt)
- [IBM Plex upstream license](https://github.com/IBM/plex/blob/master/LICENSE.txt)

Keep the notice and license with redistributed font assets. The local filenames
describe the existing delivery version, weights and subset; the font software's
names and bytes are unchanged. When refreshing the assets, verify the source
licenses, retain the requested coverage, update the manifest, and use new asset
filenames if the bytes change.
