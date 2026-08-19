const axios = require("axios");
const cheerio = require("cheerio");

/**
 * Common Browser & App Headers
 */
const DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 289.0.0.25.105",
  "Accept": "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Fetch-Site": "same-origin",
  "X-IG-App-ID": "936619743392459",
  "X-ASBD-ID": "129477",
  "X-IG-WWW-Claim": "0",
  "Origin": "https://www.instagram.com",
  "Referer": "https://www.instagram.com/",
};

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
 * Method 1: Official Instagram App/Web API (Requires Cookie for 100% video & carousel extraction)
 */
async function fetchViaInstagramApi(shortcode, sessionCookie) {
  try {
    const apiUrl = `https://www.instagram.com/api/v1/media/shortcode/${shortcode}`;
    const headers = { ...DEFAULT_HEADERS };

    if (sessionCookie) {
      const cleanCookie = sessionCookie.trim();
      headers["Cookie"] = cleanCookie.includes("sessionid=") ? cleanCookie : `sessionid=${cleanCookie};`;
    }

    const res = await axios.get(apiUrl, {
      headers: headers,
      timeout: 7000,
      validateStatus: (status) => status < 400
    });

    if (!res.data || !res.data.items || res.data.items.length === 0) return null;

    const item = res.data.items[0];
    const caption = item.caption ? item.caption.text : "";
    const media = [];

    // Check for Carousel (Album with multiple photos/videos)
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
    // Single Video / Reel
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
        source: sessionCookie ? "instagram_authenticated" : "instagram_api",
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
 * Method 2: RapidAPI Instagram Downloader (Optional key in env: RAPID_API_KEY)
 */
async function fetchViaRapidApi(url, apiKey) {
  if (!apiKey) return null;
  try {
    const res = await axios.get("https://instagram-downloader-download-instagram-videos-stories1.p.rapidapi.com/get-info", {
      params: { url: url },
      headers: {
        "X-RapidAPI-Key": apiKey,
        "X-RapidAPI-Host": "instagram-downloader-download-instagram-videos-stories1.p.rapidapi.com"
      },
      timeout: 8000
    });

    if (res.data) {
      const data = res.data;
      const media = [];

      if (Array.isArray(data)) {
        for (const m of data) {
          if (m.download_url) {
            media.push({
              type: m.type === "video" || m.download_url.includes(".mp4") ? "video" : "image",
              url: m.download_url,
              thumbnail: m.thumb || ""
            });
          }
        }
      } else if (data.download_url) {
        media.push({
          type: data.type === "video" || data.download_url.includes(".mp4") ? "video" : "image",
          url: data.download_url,
          thumbnail: data.thumb || ""
        });
      }

      if (media.length > 0) {
        return { status: true, source: "rapidapi", caption: data.caption || "", media };
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Method 3: Embed Page Scraper (Fallback for video tags)
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

    const sessionCookie = process.env.IG_COOKIE || process.env.IG_SESSION_ID || "";
    const rapidApiKey = process.env.RAPID_API_KEY || "";

    // 1. Direct Instagram API (Supports Cookie for 100% Video & Carousel)
    let result = await fetchViaInstagramApi(shortcode, sessionCookie);

    // 2. RapidAPI (if configured in env)
    if (!result || !result.media || result.media.length === 0) {
      result = await fetchViaRapidApi(url, rapidApiKey);
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
