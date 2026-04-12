![AllMightyDLP icon](public/icon.png)

# AllMightyDLP

AllMightyDLP is a self-hosted web app powered by [`yt-dlp`](https://github.com/yt-dlp/yt-dlp). Paste a supported media link, choose what you want to save, and get direct links or download-ready results in a simple mobile-friendly interface.

## What it is for

- turning supported video and audio posts into saveable links
- handling playlists and giving you a copy-ready list of links
- self-hosting on Docker or Unraid with a lightweight setup

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Docker

```bash
docker compose up --build
```

## Unraid

- Unraid image: `ghcr.io/danysgit/allmightydlp:latest`
- Package page: [ghcr.io/danysgit/allmightydlp](https://github.com/danysgit/allmightydlp/pkgs/container/allmightydlp)
- Unraid template: [allmightydlp.xml](https://raw.githubusercontent.com/danysgit/allmightydlp/main/unraid/allmightydlp.xml)

The Unraid template supports:

- editable host port mapping for the web UI
- direct `WebUI` launch from the Docker right-click menu
- persistent `/config` storage for temp files, cookies, and generated secrets
- optional Basic Auth and cookies.txt support

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP listener port |
| `HOST` | `0.0.0.0` | HTTP bind address |
| `APP_TITLE` | `AllMightyDLP` | Visible app name |
| `BASE_URL` | empty | Optional absolute base URL for generated links |
| `APPDATA_DIR` | `/config` in containers, `./data` locally | Persistent app data root |
| `YTDLP_BINARY` | `yt-dlp` | yt-dlp executable path |
| `FFMPEG_BINARY` | `ffmpeg` | ffmpeg path for merged downloads |
| `ALLOW_PLAYLISTS` | `true` | Enable playlist handling |
| `DEFAULT_PROFILE` | `video` | Default UI save mode |
| `AUTH_USERNAME` | empty | Optional Basic Auth username |
| `AUTH_PASSWORD` | empty | Optional Basic Auth password |
| `COOKIE_FILE` | `/config/cookies/cookies.txt` | Optional cookies file path |
| `TEMP_DIR` | `/config/tmp` | Temporary workspace |
| `CLEANUP_AFTER_MINUTES` | `180` | Finished job cleanup window |
| `DOWNLOAD_TOKEN_SECRET` | auto-generated | Optional signing secret override |
| `PUID` | `99` | Container user id |
| `PGID` | `100` | Container group id |
| `UMASK` | `002` | File creation mask |

## Notes

- Some sites do not expose a stable single-file link, so the app may need backend processing before it can hand back a saveable file.
- Some sources, especially protected or rate-limited ones, may require a `cookies.txt` file.
- If the container image or package links change later, this README should be updated to keep the Unraid install links current.
