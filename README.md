# AllMightyDLP

AllMightyDLP is a self-hosted web frontend for [`yt-dlp`](https://github.com/yt-dlp/yt-dlp). Users paste a supported media URL, optionally inspect the source, and receive direct download links when the backend finishes processing.

## What is included

- Responsive mobile-first UI tuned for Safari on iPhone and iPad
- `yt-dlp` + `ffmpeg` packaged into the Docker image
- Download queue with status polling and file links
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

The app stores output in:

- `/app/data`
- `/app/downloads`

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP listener port |
| `HOST` | `0.0.0.0` | HTTP bind address |
| `APP_TITLE` | `AllMightyDLP` | Branded UI title |
| `BASE_URL` | empty | Optional absolute base URL for generated download links |
| `DATA_DIR` | `/app/data` | Persistent app state |
| `DOWNLOAD_DIR` | `/app/downloads` | Completed download storage |
| `TEMP_DIR` | `/tmp/allmightydlp` | Temporary processing workspace |
| `YTDLP_BINARY` | `yt-dlp` | yt-dlp executable path |
| `FFMPEG_BINARY` | `ffmpeg` | ffmpeg executable path |
| `MAX_CONCURRENT_JOBS` | `2` | Parallel download limit |
| `CLEANUP_AFTER_MINUTES` | `120` | Auto-delete age for finished jobs |
| `ALLOW_PLAYLISTS` | `true` | Enable playlist downloads |
| `DEFAULT_PROFILE` | `video` | Default UI selection |
| `AUTH_USERNAME` | empty | Optional Basic Auth username |
| `AUTH_PASSWORD` | empty | Optional Basic Auth password |
| `PUID` | `99` | Reserved for Unraid permission alignment |
| `PGID` | `100` | Reserved for Unraid permission alignment |
| `UMASK` | `002` | Reserved file creation mask |

## Unraid

An Unraid template is included at `unraid/allmightydlp.xml`. Before publishing it, replace the placeholder GitHub and registry URLs with your real repository and container image.

The template already includes:

- `WebUI` integration for the Docker right-click menu
- port mapping for the app on `3000`
- persistent AppData and Downloads paths
- advanced variables for cleanup, concurrency, playlists, branding, and optional auth

## Notes

- This project intentionally focuses on self-hosted personal use.
- Site compatibility depends on current `yt-dlp` support and upstream extractor changes.
