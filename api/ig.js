const axios = require("axios");
const cheerio = require("cheerio");

/**
 * Helper: Convert Instagram shortcode to numeric media ID
 */
function shortcodeToId(shortcode) {
  if (!shortcode) return null;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let id = BigInt(0);
  for (let i = 0; i < shortcode.length; i++) {
    const char = shortcode[i];
    const index = BigInt(alphabet.indexOf(char));
    if (index === -1n) continue;
    id = id * BigInt(64) + index;
  }
  return id.toString();
}

/**
 * Helper: Extract shortcode from any Instagram URL
 */
function getShortcode(url) {
  if (!url) return null;
  const match = url.match(/(?:instagram\.com\/(?:p|reel|reels|tv|share\/p|share\/reel|share)\/([A-Za-z0-9_-]+))/i)
    || url.match(/(?:instagram\.com\/(?:share)\/([A-Za-z0-9_-]+))/i)
    || url.match(/\/([A-Za-z0-9_-]{10,12})(?:\/|\?|$)/);
  return match ? match[1] : null;
}

/**
 * Helper: Extract ds_user_id from sessionid
 */
function getUserIdFromSession(session) {
  if (!session) return "";
  const decoded = decodeURIComponent(session);
  const parts = decoded.split(":");
  return parts[0] || "";
}

/**
 * Method 1: Official Instagram Mobile App API (100% Video, Carousel & HD Photos)
 */
async function fetchViaMobileApi(mediaId, sessionCookie) {
  try {
    const url = `https://i.instagram.com/api/v1/media/${mediaId}/info/`;
    const userId = getUserIdFromSession(sessionCookie);

    const headers = {
      "User-Agent": "Instagram 278.0.0.19.115 Android (33/13; 480dpi; 1080x2400; Xiaomi; M2012K11AC; alioth; qcom; en_US; 461141443)",
      "X-IG-App-ID": "1217981644879628",
      "Accept": "*/*",
      "Accept-Language": "en-US,en;q=0.9",
    };

    if (sessionCookie) {
      const cleanSession = sessionCookie.trim();
      headers["Cookie"] = `sessionid=${cleanSession}; ds_user_id=${userId};`;
    }

    const res = await axios.get(url, {
      headers: headers,
      timeout: 8000,
      validateStatus: (status) => status < 400
    });

    if (!res.data || !res.data.items || res.data.items.length === 0) {
      return null;
    }

    const item = res.data.items[0];
    const caption = item.caption ? item.caption.text : "";
    const media = [];

    // 1. CAROUSEL POST (Multi-photo & multi-video album)
    if (item.carousel_media && Array.isArray(item.carousel_media) && item.carousel_media.length > 0) {
      for (const sub of item.carousel_media) {
        if (sub.video_versions && sub.video_versions.length > 0) {
          media.push({
            type: "video",
            url: sub.video_versions[0].url,
            thumbnail: sub.image_versions2?.candidates?.[0]?.url || ""
          });
        } else if (sub.image_versions2?.candidates?.length > 0) {
          media.push({
            type: "image",
            url: sub.image_versions2.candidates[0].url
          });
        }
      }
    }
    // 2. SINGLE REEL / VIDEO
    else if (item.video_versions && item.video_versions.length > 0) {
      media.push({
        type: "video",
        url: item.video_versions[0].url,
        thumbnail: item.image_versions2?.candidates?.[0]?.url || ""
      });
    }
    // 3. SINGLE PHOTO
    else if (item.image_versions2?.candidates?.length > 0) {
      media.push({
        type: "image",
        url: item.image_versions2.candidates[0].url
      });
    }

    if (media.length > 0) {
      return {
        status: true,
        source: sessionCookie ? "instagram_mobile_authenticated" : "instagram_mobile_api",
        caption: caption,
        media: media
      };
    }

    return null;
  } catch (err) {
    return null;
  }
}

/**
 * Method 2: SnapSave Scraper
 */
async function fetchViaSnapSave(url) {
  try {
    const form = new URLSearchParams();
    form.append("url", url);

    const res = await axios.post("https://snapsave.app/action.php?lang=en", form.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Referer": "https://snapsave.app/"
      },
      timeout: 6000
    });

    if (!res.data) return null;

    let html = res.data;
    if (html.includes("eval(")) {
      try {
        const modified = html.replace(/\beval\s*\(/g, "return (");
        const fn = new Function(modified);
        const inner = fn();
        if (inner && typeof inner === "string") html = inner;
      } catch (e) {}
    }

    const $ = cheerio.load(html);
    const media = [];

    $("div.download-items, div.media-box, tbody tr").each((i, el) => {
      const downloadBtn = $(el).find('a.btn-download, a.download-bottom, a[href*="download"]');
      let href = downloadBtn.attr("href");
      const thumb = $(el).find("img").attr("src") || "";

      if (href) {
        if (!href.startsWith("http")) href = "https://snapsave.app" + href;
        const isVideo = href.includes(".mp4") || href.includes("video") || downloadBtn.text().toLowerCase().includes("video");
        media.push({
          type: isVideo ? "video" : "image",
          url: href,
          thumbnail: thumb
        });
      }
    });

    if (media.length === 0) {
      $('a.download-bottom, a[href*="download"], a.btn-download').each((i, el) => {
        let href = $(el).attr("href");
        if (href) {
          if (!href.startsWith("http")) href = "https://snapsave.app" + href;
          media.push({
            type: href.includes(".mp4") || $(el).text().toLowerCase().includes("video") ? "video" : "image",
            url: href
          });
        }
      });
    }

    if (media.length > 0) {
      return { status: true, source: "snapsave", caption: "", media };
    }
    return null;
  } catch (err) {
    return null;
  }
}

/**
 * Method 3: Instagram Embed HTML Scraper
 */
async function fetchViaEmbed(shortcode) {
  try {
    const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
    const res = await axios.get(embedUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
      },
      timeout: 5000
    });

    const html = res.data || "";
    const $ = cheerio.load(html);
    const media = [];

    const videoSrc = $("video.EmbeddedMediaVideo, video").attr("src");
    if (videoSrc) {
      media.push({
        type: "video",
        url: videoSrc.replace(/&amp;/g, "&")
      });
    }

    if (media.length === 0) {
      const videoMatch = html.match(/"video_url":"([^"]+)"/);
      if (videoMatch) {
        media.push({
          type: "video",
          url: videoMatch[1].replace(/\\u0026/g, "&").replace(/\\\//g, "/")
        });
      }
    }

    const imgSrc = $("img.EmbeddedMediaImage").attr("src");
    if (imgSrc && media.length === 0) {
      media.push({
        type: "image",
        url: imgSrc.replace(/&amp;/g, "&")
      });
    }

    if (media.length > 0) {
      return { status: true, source: "embed", caption: "", media };
    }
    return null;
  } catch (err) {
    return null;
  }
}

/**
 * Method 4: Instagram oEmbed (Guaranteed Metadata / Thumbnail Fallback)
 */
async function fetchViaOEmbed(shortcode) {
  try {
    const oembedUrl = `https://www.instagram.com/api/v1/oembed/?url=https://www.instagram.com/p/${shortcode}`;
    const res = await axios.get(oembedUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)"
      },
      timeout: 5000
    });

    if (res.data && res.data.thumbnail_url) {
      return {
        status: true,
        source: "oembed",
        caption: res.data.title || "",
        media: [
          {
            type: "image",
            url: res.data.thumbnail_url
          }
        ]
      };
    }
    return null;
  } catch (err) {
    return null;
  }
}

/**
 * Main Vercel Serverless Function Handler
 */
module.exports = async function (req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const url = req.query.url || req.body?.url;

    if (!url) {
      return res.status(400).json({
        status: false,
        message: "Missing Instagram URL parameter (?url=...)"
      });
    }

    const shortcode = getShortcode(url);
    if (!shortcode) {
      return res.status(400).json({
        status: false,
        message: "Invalid Instagram URL format."
      });
    }

    const mediaId = shortcodeToId(shortcode);
    const sessionCookie = process.env.IG_COOKIE || process.env.IG_SESSION_ID || "43415903614%3AN1rQi6cXXQU3p8%3A7%3AAYgwoxoODBF2C1etY4mwfT8QALinHj1Y8y36XhSJ8g";
    const cleanUrl = `https://www.instagram.com/p/${shortcode}/`;

    // 1. Mobile App API (100% Video & Carousel Support)
    let result = await fetchViaMobileApi(mediaId, sessionCookie);

    // 2. SnapSave (Reels / Multi-Post fallback)
    if (!result || !result.media || result.media.length === 0) {
      result = await fetchViaSnapSave(cleanUrl);
    }

    // 3. Embed Scraper
    if (!result || !result.media || result.media.length === 0) {
      result = await fetchViaEmbed(shortcode);
    }

    // 4. Guaranteed oEmbed Fallback (So it never crashes)
    if (!result || !result.media || result.media.length === 0) {
      result = await fetchViaOEmbed(shortcode);
    }

    if (result && result.media && result.media.length > 0) {
      // Deduplicate
      const uniqueMedia = [];
      const seen = new Set();
      for (const m of result.media) {
        if (!seen.has(m.url)) {
          seen.add(m.url);
          uniqueMedia.push(m);
        }
      }

      return res.status(200).json({
        status: true,
        shortcode: shortcode,
        source: result.source,
        caption: result.caption || "",
        media_count: uniqueMedia.length,
        media: uniqueMedia
      });
    }

    return res.status(404).json({
      status: false,
      message: "Could not fetch media. Post might be private or deleted."
    });

  } catch (error) {
    console.error("IG Handler Error:", error);
    return res.status(500).json({
      status: false,
      message: "Internal server error while processing media."
    });
  }
};
