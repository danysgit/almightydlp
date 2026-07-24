import re

from yt_dlp.extractor.common import InfoExtractor
from yt_dlp.utils import determine_ext


class EroThotsIE(InfoExtractor):
    IE_NAME = "erothots"
    _VALID_URL = r"https?://(?:www\.)?erothots\.co/video/(?P<id>[a-z0-9]+)/(?P<display_id>[^/?#]+)"

    _TESTS = [{
        "url": "https://erothots.co/video/vgrqoafhb/latina-hot-wifee/",
        "info_dict": {
            "id": "vgrqoafhb",
            "ext": "mp4",
            "title": "Latina hot wifee",
            "display_id": "latina-hot-wifee",
            "thumbnail": r"re:^https?://.+\.(?:webp|jpe?g|png)",
        },
        "params": {"skip_download": True},
    }]

    def _real_extract(self, url):
        video_id = self._match_id(url)
        display_id = self._match_valid_url(url).group("display_id")
        webpage = self._download_webpage(url, video_id)

        player = self._search_regex(
            r'(?is)<video\b(?=[^>]*\bclass=["\'][^"\']*\bv-player\b)[^>]*>(.+?)</video>',
            webpage,
            "video player",
        )
        video_url = self._html_search_regex(
            r'(?is)<source\b[^>]*\bsrc=["\']([^"\']+)',
            player,
            "video URL",
        )

        title = self._html_search_meta(
            ("og:title", "twitter:title"),
            webpage,
            default=display_id.replace("-", " "),
        )
        title = re.sub(r"\s*-\s*EroThots\s*$", "", title, flags=re.IGNORECASE)
        thumbnail = self._html_search_meta(
            ("og:image", "twitter:image"),
            webpage,
            default=None,
        )

        return {
            "id": video_id,
            "display_id": display_id,
            "title": title,
            "url": video_url,
            "ext": determine_ext(video_url, "mp4"),
            "thumbnail": thumbnail,
            "http_headers": {"Referer": url},
        }
