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

// Helper: Decode SnapSave / SnapInsta obfuscated responses
function decodeSnapApp(renderCode) {
  try {
    const cleanCode = renderCode.replace(/eval\s*\(/, 'return (');
    const fn = new Function(cleanCode);
    return fn();
  } catch (e) {
    return null;
  }
}

// Method 1: Instagram Web GraphQL / App API
async function fetchViaInstagramApi(shortcode) {
  try {
    const apiUrl = `https://www.instagram.com/api/v1/media/shortcode/${shortcode}`;
    const res = await axios.get(apiUrl, {
      headers: DEFAULT_HEADERS,
      timeout: 8000,
      validateStatus: (status) => status < 400
    });

    if (!res.data || !res.data.items || res.data.items.length === 0) {
      return null;
    }

    const item = res.data.items[0];
    const caption = item.caption ? item.caption.text : "";
    const media = [];

    // Check for Carousel (Album / Multiple items)
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
      return {
        status: true,
        source: "instagram_api",
        caption: caption,
        media: media
      };
    }
    return null;
  } catch (err) {
    return null;
  }
}

// Method 2: SnapSave Scraper with auto-unpacking
async function fetchViaSnapSave(url) {
  try {
    const form = new URLSearchParams();
    form.append("url", url);

    const res = await axios.post("https://snapsave.app/action.php?lang=en", form.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": DEFAULT_HEADERS["User-Agent"],
        "Referer": "https://snapsave.app/",
        "Origin": "https://snapsave.app"
      },
      timeout: 9000
    });

    if (!res.data) return null;

    let html = res.data;
    if (html.includes("eval(")) {
      const decoded = decodeSnapApp(html);
      if (decoded) html = decoded;
    }

    const $ = cheerio.load(html);
    const media = [];

    // Parse download items (works for both single and carousel)
    $("div.download-items, div.media-box, tbody tr").each((i, el) => {
      const downloadBtn = $(el).find('a.btn-download, a.download-bottom, a[href*="download"]');
      let href = downloadBtn.attr("href");
      const thumb = $(el).find("img").attr("src") || "";

      if (href) {
        if (!href.startsWith("http")) {
          href = "https://snapsave.app" + href;
        }
        const isVideo = href.includes(".mp4") || href.includes("video") || downloadBtn.text().toLowerCase().includes("video");
        media.push({
          type: isVideo ? "video" : "image",
          url: href,
          thumbnail: thumb
        });
      }
    });

    // Fallback if cards not matched
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
      return {
        status: true,
        source: "snapsave",
        caption: "",
        media: media
      };
    }
    return null;
  } catch (err) {
    return null;
  }
}

// Method 3: SaveIG / InDown Scraper
async function fetchViaSaveIG(url) {
  try {
    const res = await axios.post("https://saveig.app/api/ajaxSearch", new URLSearchParams({
      q: url,
      t: "media",
      lang: "en"
    }).toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": DEFAULT_HEADERS["User-Agent"],
        "Referer": "https://saveig.app/en",
        "Origin": "https://saveig.app"
      },
      timeout: 9000
    });

    if (!res.data || !res.data.data) return null;

    const $ = cheerio.load(res.data.data);
    const media = [];

    $("div.download-items, div.media-box, .download-item").each((i, el) => {
      const downloadBtn = $(el).find('a.btn-download, a.download-bottom, a[href*="download"]');
      let href = downloadBtn.attr("href");
      const thumb = $(el).find("img").attr("src") || "";

      if (href) {
        if (!href.startsWith("http")) href = "https://saveig.app" + href;
        const isVideo = href.includes(".mp4") || href.includes("video") || downloadBtn.text().toLowerCase().includes("video");
        media.push({
          type: isVideo ? "video" : "image",
          url: href,
          thumbnail: thumb
        });
      }
    });

    if (media.length === 0) {
      $('a.download-bottom, a[href*="download"]').each((i, el) => {
        let href = $(el).attr("href");
        if (href) {
          if (!href.startsWith("http")) href = "https://saveig.app" + href;
          media.push({
            type: href.includes(".mp4") || $(el).text().toLowerCase().includes("video") ? "video" : "image",
            url: href
          });
        }
      });
    }

    if (media.length > 0) {
      return {
        status: true,
        source: "saveig",
        caption: "",
        media: media
      };
    }
    return null;
  } catch (err) {
    return null;
  }
}

// Method 4: Embed Page HTML Scraper (Fallback)
async function fetchViaEmbed(shortcode) {
  try {
    const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
    const res = await axios.get(embedUrl, {
      headers: {
        "User-Agent": DEFAULT_HEADERS["User-Agent"],
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      timeout: 8000
    });

    const html = res.data || "";
    const $ = cheerio.load(html);
    const media = [];

    // Look for video tag
    const videoSrc = $("video.EmbeddedMediaVideo, video").attr("src");
    if (videoSrc) {
      media.push({
        type: "video",
        url: videoSrc.replace(/&amp;/g, "&")
      });
    }

    // Look for image tag
    const imgSrc = $("img.EmbeddedMediaImage").attr("src");
    if (imgSrc && media.length === 0) {
      media.push({
        type: "image",
        url: imgSrc.replace(/&amp;/g, "&")
      });
    }

    // Look for regex video_url or display_url in scripts
    if (media.length === 0) {
      const videoMatch = html.match(/"video_url":"([^"]+)"/);
      if (videoMatch) {
        media.push({
          type: "video",
          url: videoMatch[1].replace(/\\u0026/g, "&").replace(/\\\//g, "/")
        });
      }

      const displayMatch = html.match(/"display_url":"([^"]+)"/);
      if (displayMatch && media.length === 0) {
        media.push({
          type: "image",
          url: displayMatch[1].replace(/\\u0026/g, "&").replace(/\\\//g, "/")
        });
      }
    }

    if (media.length > 0) {
      return {
        status: true,
        source: "embed",
        caption: "",
        media: media
      };
    }
    return null;
  } catch (err) {
    return null;
  }
}

// Main Vercel Serverless Function Handler
module.exports = async function (req, res) {
  // Set CORS headers
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
        message: "Invalid Instagram URL format. Please provide a valid post or reel link."
      });
    }

    const cleanUrl = `https://www.instagram.com/p/${shortcode}/`;

    // Strategy Execution Chain:
    // 1. Direct Instagram API (Fastest & Native multi-media / high quality)
    let result = await fetchViaInstagramApi(shortcode);

    // 2. SnapSave (Handles Reels, Videos, Photos, Carousels)
    if (!result || !result.media || result.media.length === 0) {
      result = await fetchViaSnapSave(cleanUrl);
    }

    // 3. SaveIG Scraper
    if (!result || !result.media || result.media.length === 0) {
      result = await fetchViaSaveIG(cleanUrl);
    }

    // 4. Embed Page Parsing Fallback
    if (!result || !result.media || result.media.length === 0) {
      result = await fetchViaEmbed(shortcode);
    }

    // 5. Final check
    if (result && result.media && result.media.length > 0) {
      // Remove duplicate URLs if any
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
      message: "Could not fetch media. Post might be private, deleted, or region-restricted."
    });

  } catch (error) {
    console.error("IG Handler Error:", error);
    return res.status(500).json({
      status: false,
      message: "Internal server error while processing media."
    });
  }
};
