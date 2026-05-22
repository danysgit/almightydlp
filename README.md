![AlmightyDLP icon](public/icon.png)

# AlmightyDLP

AlmightyDLP is a self-hosted web app powered by [`yt-dlp`](https://github.com/yt-dlp/yt-dlp). Paste a supported media link, choose what you want to save, and get direct links or download-ready results in a simple mobile-friendly interface.

Public app: [almightydlp.com](https://almightydlp.com)

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

## iOS Shortcut

AlmightyDLP includes a signed iOS shortcut named `Save with AlmightyDLP`. Install it from the app home screen, then share a supported link to the shortcut from the iOS share sheet. The shortcut calls AlmightyDLP, downloads the prepared iPhone-compatible video, and saves it to Photos. If you run the shortcut manually from the Shortcuts app, it uses a URL from the clipboard.

The bundled shortcut uses `https://almightydlp.com/api/shortcut/download`. If you prefer to use an iCloud Shortcuts share link instead, set `SHORTCUT_INSTALL_URL` to the generated `https://www.icloud.com/shortcuts/...` link and the home screen install button will redirect there.

To regenerate the checked-in shortcut on macOS:

```bash
npm run build:shortcut
```

## Docker

```bash
docker compose up --build
```

## Unraid

- Unraid image: `ghcr.io/danysgit/almightydlp:latest`
- Package page: [ghcr.io/danysgit/almightydlp](https://github.com/danysgit/almightydlp/pkgs/container/almightydlp)
- Unraid user-template: [my-AlmightyDLP.xml](https://raw.githubusercontent.com/danysgit/almightydlp/main/unraid/manual/my-AlmightyDLP.xml)

The Unraid template supports:

- editable host port mapping for the web UI
- direct `WebUI` launch from the Docker right-click menu
- persistent `/config` storage for temp files, cookies, and generated secrets
- optional Basic Auth and cookies.txt support

For manual Unraid installs, use the `my-AlmightyDLP.xml` template above.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP listener port |
| `HOST` | `0.0.0.0` | HTTP bind address |
| `APP_TITLE` | `AlmightyDLP` | Visible app name |
| `BASE_URL` | empty | Optional absolute base URL for generated links |
| `SHORTCUT_INSTALL_URL` | empty | Optional iCloud Shortcuts share URL shown as an install link on the home screen |
| `APPDATA_DIR` | `/config` in containers, `./data` locally | Persistent app data root |
| `YTDLP_BINARY` | `yt-dlp` | yt-dlp executable path |
| `FFMPEG_BINARY` | `ffmpeg` | ffmpeg path for merged downloads |
| `ALLOW_PLAYLISTS` | `true` | Enable playlist handling |
| `ALLOW_PRIVATE_URLS` | `false` | Allow media URLs that resolve to private, loopback, local, or reserved networks |
| `DEFAULT_PROFILE` | `video` | Default UI save mode |
| `AUTH_USERNAME` | empty | Optional Basic Auth username |
| `AUTH_PASSWORD` | empty | Optional Basic Auth password |
| `COOKIE_FILE` | `/config/cookies/cookies.txt` | Optional cookies file path, used only when the file exists |
| `TEMP_DIR` | `/config/tmp` | Temporary workspace |
| `CLEANUP_AFTER_MINUTES` | `180` | Finished job cleanup window |
| `DOWNLOAD_TOKEN_SECRET` | auto-generated | Optional signing secret override |
| `PUID` | `99` | Container user id |
| `PGID` | `100` | Container group id |
| `UMASK` | `002` | File creation mask |

## Notes

- Some sites do not expose a stable single-file link, so the app may need backend processing before it can hand back a saveable file.
- Video downloads are prepared as iPhone Photos-compatible MP4 files. When the best source stream is not natively compatible, AlmightyDLP converts it to H.264 video with AAC audio.
- Some sources, especially protected or rate-limited ones, may require a `cookies.txt` file.
- If `COOKIE_FILE` points to a missing file, AlmightyDLP now ignores it instead of failing the request.
- If the container image or package links change later, this README should be updated to keep the Unraid install links current.
