# Third-party notices

DriveStream's own license (LICENSE) does not cover the parts below; each keeps its own terms.

## Fonts

- **Bebas Neue** by Dharma Type: SIL Open Font License 1.1. License text: [`branding/OFL-BebasNeue.txt`](branding/OFL-BebasNeue.txt).
  Included as `public/fonts/BebasNeue-Regular.ttf`, `app/assets/fonts/BebasNeue-Regular.ttf` and `branding/BebasNeue-Regular.ttf`.
- **Thmanyah Sans** (Arabic) by Thmanyah: free to use, but its license does not allow redistributing the font files,
  so they are **not** in this repository. Download them yourself from Thmanyah (see README → "Fonts").

## npm packages

Server and app dependencies (Express, google-auth-library, qrcode, Expo, React Native for TV, and their
dependencies) are installed from npm and are under their own licenses (mostly MIT, Apache-2.0, BSD).
`npx license-checker --summary` in the root and in `app/` lists them.

## Tools you install separately

ffmpeg (LGPL/GPL), Tizen Studio (Samsung), and the Android SDK are not part of this repository.

## Data services

Title data and images come from [TMDB](https://www.themoviedb.org/). This product uses the TMDB API but is
not endorsed or certified by TMDB. Google Drive is a trademark of Google LLC; DriveStream is not affiliated
with or endorsed by Google.
