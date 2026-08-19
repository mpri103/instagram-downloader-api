const axios = require("axios");
const cheerio = require("cheerio");

// Common browser headers
const DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Fetch-Site": "same-origin",
  "X-IG-App-ID": "936619743392459",
};

// Helper: Extract shortcode from any Instagram URL
function getShortcode(url) {
  if (!url) return null;
  const match = url.match(/(?:instagram\.com\/(?:p|reel|reels|tv|share\/p|share\/reel)\/([A-Za-z0-9_-]+))/i)
    || url.match(/(?:instagram\.com\/(?:share)\/([A-Za-z0-9_-]+))/i)
    || url.match(/\/([A-Za-z0-9_-]{10,12})(?:\/|\?|$)/);
  return match ? match[1] : null;
}

// Helper: Decode SnapSave obfuscated scripts
function decodeSnapApp(renderCode) {
  try {
    const cleanCode = renderCode.replace(/\beval\s*\(/g, "return (");
    const fn = new Function(cleanCode);
    return fn();
  } catch (e) {
    return null;
  }
}

// 1. Direct Instagram API
async function fetchViaInstagramApi(shortcode) {
  try {
    const apiUrl = `https://www.instagram.com/api/v1/media/shortcode/${shortcode}`;
    const res = await axios.get(apiUrl, {
      headers: DEFAULT_HEADERS,
      timeout: 5000,
      validateStatus: (status) => status < 400
    });

    if (!res.data || !res.data.items || res.data.items.length === 0) return null;

    const item = res.data.items[0];
    const caption = item.caption ? item.caption.text : "";
    const media = [];

    // Carousel
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
    // Single Video
    else if (item.video_versions && item.video_versions.length > 0) {
      media.push({
        type: "video",
        url: item.video_versions[0].url,
        thumbnail: item.image_versions2?.candidates?.[0]?.url || ""
      });
    } 
    // Single Image
    else if (item.image_versions2?.candidates?.length > 0) {
      media.push({
        type: "image",
        url: item.image_versions2.candidates[0].url
      });
    }

    if (media.length > 0) {
      return { status: true, source: "instagram_api", caption, media };
    }
    return null;
  } catch (err) {
    return null;
  }
}

// 2. SnapSave Scraper
async function fetchViaSnapSave(url) {
  try {
    const form = new URLSearchParams();
    form.append("url", url);

    const res = await axios.post("https://snapsave.app/action.php?lang=en", form.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": DEFAULT_HEADERS["User-Agent"],
        "Referer": "https://snapsave.app/"
      },
      timeout: 6000
    });

    if (!res.data) return null;

    let html = res.data;
    if (html.includes("eval(")) {
      const decoded = decodeSnapApp(html);
      if (decoded) html = decoded;
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

// 3. Instagram Embed HTML Scraper
async function fetchViaEmbed(shortcode) {
  try {
    const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
    const res = await axios.get(embedUrl, {
      headers: {
        "User-Agent": DEFAULT_HEADERS["User-Agent"]
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

    if (media.length === 0) {
      const displayMatch = html.match(/"display_url":"([^"]+)"/);
      if (displayMatch) {
        media.push({
          type: "image",
          url: displayMatch[1].replace(/\\u0026/g, "&").replace(/\\\//g, "/")
        });
      }
    }

    if (media.length > 0) {
      return { status: true, source: "embed", caption: "", media };
    }
    return null;
  } catch (err) {
    return null;
  }
}

// 4. Instagram oEmbed (Guaranteed Fallback)
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

// Main Handler
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

    const cleanUrl = `https://www.instagram.com/p/${shortcode}/`;

    // 1. Direct Instagram API (Video / Carousel / Photo)
    let result = await fetchViaInstagramApi(shortcode);

    // 2. SnapSave (Reels / Multi-Post)
    if (!result || !result.media || result.media.length === 0) {
      result = await fetchViaSnapSave(cleanUrl);
    }

    // 3. Embed Scraper
    if (!result || !result.media || result.media.length === 0) {
      result = await fetchViaEmbed(shortcode);
    }

    // 4. Guaranteed oEmbed Fallback
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
