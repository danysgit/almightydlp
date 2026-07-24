import re
import urllib.parse

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
    }, {
        "url": "https://erothots.co/video/msvqavlvhrpyg/alice-white-aka-aliceoncam-alice-white-leaked-onlyfans-video9/",
        "info_dict": {
            "id": "msvqavlvhrpyg",
            "ext": "mp4",
            "title": "Alice White aka Aliceoncam - alice white leaked onlyfans video9",
            "display_id": "alice-white-aka-aliceoncam-alice-white-leaked-onlyfans-video9",
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
        video_url, video_referer = self._resolve_x_video_url(video_url, video_id)

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
            "http_headers": {"Referer": video_referer or url},
        }

    def _resolve_x_video_url(self, video_url, video_id):
        parsed = urllib.parse.urlparse(video_url)
        if parsed.hostname not in {"x-video.tube", "www.x-video.tube"}:
            return video_url, None

        upstream_id = self._search_regex(
            r"/\d+/(\d+)/\1(?:_[^/?#]+)?\.mp4",
            parsed.path,
            "x-video video ID",
            fatal=False,
        )
        if not upstream_id:
            return video_url, None

        embed_url = f"https://x-video.tube/embed/{upstream_id}/"
        embed_page = self._download_webpage(
            embed_url,
            video_id,
            note="Refreshing x-video media URL",
        )
        license_code = self._search_regex(
            r"""license_code\s*:\s*["']([^"']+)""",
            embed_page,
            "x-video license code",
        )
        obfuscated_url = self._search_regex(
            r"""video_url\s*:\s*["']([^"']+)""",
            embed_page,
            "x-video media URL",
        )
        return self._decode_kvs_url(obfuscated_url, license_code), embed_url

    @classmethod
    def _decode_kvs_url(cls, video_url, license_code):
        prefix = "function/0/"
        if not video_url.startswith(prefix):
            return video_url

        parsed = urllib.parse.urlparse(video_url[len(prefix):])
        license_token = cls._kvs_license_token(license_code)
        url_parts = parsed.path.split("/")
        hash_length = 32
        hash_value = url_parts[3][:hash_length]
        indices = list(range(hash_length))

        accumulated = 0
        for source_index in reversed(range(hash_length)):
            accumulated += license_token[source_index]
            destination_index = (source_index + accumulated) % hash_length
            indices[source_index], indices[destination_index] = (
                indices[destination_index],
                indices[source_index],
            )

        url_parts[3] = (
            "".join(hash_value[index] for index in indices)
            + url_parts[3][hash_length:]
        )
        return urllib.parse.urlunparse(parsed._replace(path="/".join(url_parts)))

    @staticmethod
    def _kvs_license_token(license_code):
        normalized_code = license_code.replace("$", "")
        license_values = [int(char) for char in normalized_code]
        modified_code = normalized_code.replace("0", "1")
        center = len(modified_code) // 2
        front_half = int(modified_code[:center + 1])
        back_half = int(modified_code[center:])
        modified_code = str(4 * abs(front_half - back_half))[:center + 1]

        return [
            (license_values[index + offset] + current) % 10
            for index, current in enumerate(map(int, modified_code))
            for offset in range(4)
        ]
