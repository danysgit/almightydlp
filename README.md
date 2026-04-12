# AllMightyDLP

AllMightyDLP is a self-hosted web frontend for [`yt-dlp`](https://github.com/yt-dlp/yt-dlp). Users paste a supported media URL, inspect the source, and resolve direct media links when the site exposes them.

## What is included

- Responsive mobile-first UI tuned for Safari on iPhone and iPad
- Single-user, security-conscious link resolver flow
- Direct media link extraction for supported single files and playlists
- Copy-ready playlist output for download managers
- Inspect endpoint for basic media metadata before downloading
- Unraid template with WebUI, port, paths, and common variables

## Quick start

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Docker

```bash
docker compose up --build
```

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP listener port |
| `HOST` | `0.0.0.0` | HTTP bind address |
| `APP_TITLE` | `AllMightyDLP` | Branded UI title |
| `BASE_URL` | empty | Optional absolute base URL for generated download links |
| `YTDLP_BINARY` | `yt-dlp` | yt-dlp executable path |
| `ALLOW_PLAYLISTS` | `true` | Enable playlist downloads |
| `DEFAULT_PROFILE` | `video` | Default UI selection |
| `AUTH_USERNAME` | empty | Optional Basic Auth username |
| `AUTH_PASSWORD` | empty | Optional Basic Auth password |
| `PUID` | `99` | Container user id for Unraid permission alignment |
| `PGID` | `100` | Container group id for Unraid permission alignment |
| `UMASK` | `002` | File creation mask inside the container |

## Unraid

An Unraid template is included at `unraid/allmightydlp.xml`. Before publishing it, replace the placeholder GitHub and registry URLs with your real repository and container image.

The template already includes:

- `WebUI` integration for the Docker right-click menu
- port mapping for the app on `3000`
- lightweight AppData path
- advanced variables for playlists, branding, and optional auth

## Notes

- This project intentionally focuses on self-hosted personal use.
- Direct links are not always possible. Some sources expose only expiring, segmented, or split media streams, which would require backend downloading and merging to support reliably.
