/**
 * Vercel Serverless Function - Instagram Media & Full Profile Downloader API
 * Endpoint: /api/ig?url={INSTAGRAM_URL_OR_USERNAME}
 */

const DEFAULT_HEADERS = {
  "User-Agent": "Instagram 278.0.0.19.115 Android (33/13; 480dpi; 1080x2400; Xiaomi; M2012K11AC; alioth; qcom; en_US; 461141443)",
  "X-IG-App-ID": "1217981644879628",
  "Accept": "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Dest": "empty",
};

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

function getShortcode(url) {
  if (!url) return null;
  const match = url.match(/(?:instagram\.com\/(?:p|reel|reels|tv|share\/p|share\/reel|share)\/([A-Za-z0-9_-]+))/i)
    || url.match(/(?:instagram\.com\/(?:share)\/([A-Za-z0-9_-]+))/i)
    || url.match(/\/([A-Za-z0-9_-]{10,12})(?:\/|\?|$)/);
  return match ? match[1] : null;
}

function getUsernameFromQuery(query) {
  if (!query) return null;
  const trimmed = query.trim();

  if (getShortcode(trimmed)) return null;

  const urlMatch = trimmed.match(/(?:instagram\.com\/)([A-Za-z0-9_.]+)/i);
  if (urlMatch && !['p', 'reel', 'reels', 'tv', 'stories', 'explore', 'direct'].includes(urlMatch[1].toLowerCase())) {
    return urlMatch[1];
  }

  if (trimmed.startsWith('@')) {
    return trimmed.substring(1).replace(/[^A-Za-z0-9_.]/g, '');
  }

  if (!trimmed.includes('/') && !trimmed.includes(' ') && trimmed.length <= 30 && /^[A-Za-z0-9_.]+$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

function getUserIdFromSession(session) {
  if (!session) return "";
  const decoded = decodeURIComponent(session);
  const parts = decoded.split(":");
  return parts[0] || "";
}

async function fetchProfileData(username, sessionCookie) {
  try {
    const session = sessionCookie?.trim() || "";
    const userId = getUserIdFromSession(session);

    const searchUrl = `https://www.instagram.com/web/search/topsearch/?query=${encodeURIComponent(username)}`;
    const searchRes = await fetch(searchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "X-IG-App-ID": "936619743392459",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": "https://www.instagram.com/",
        "Cookie": `sessionid=${session}; ds_user_id=${userId};`
      }
    });

    if (!searchRes.ok) return null;

    const searchData = await searchRes.json().catch(() => null);
    if (!searchData || !searchData.users || searchData.users.length === 0) return null;

    let userObj = searchData.users.find(u => u.user.username.toLowerCase() === username.toLowerCase())?.user;
    if (!userObj) userObj = searchData.users[0].user;

    const rawPic = userObj.profile_pic_url || "";
    const hdPic = rawPic.replace(/s150x150/g, "s1080x1080");

    // Step 2: Fetch Maximum Recent Feed Posts / Reels via user feed pagination
    let mediaItems = [];
    try {
      let maxId = "";
      const maxPages = 3; // Fetches up to 36-40+ posts per profile

      for (let page = 0; page < maxPages; page++) {
        const feedUrl = `https://i.instagram.com/api/v1/feed/user/${userObj.pk}/${maxId ? `?max_id=${maxId}` : ''}`;
        const feedRes = await fetch(feedUrl, {
          headers: {
            ...DEFAULT_HEADERS,
            "Cookie": `sessionid=${session}; ds_user_id=${userId};`
          }
        });

        if (!feedRes.ok) break;

        const feedData = await feedRes.json().catch(() => null);
        if (!feedData || !Array.isArray(feedData.items) || feedData.items.length === 0) break;

        for (const item of feedData.items) {
          const isVideo = item.media_type === 2 || !!item.video_versions;
          const isCarousel = item.media_type === 8 || !!item.carousel_media;
          let videoUrl = item.video_versions?.[0]?.url;
          let thumbUrl = item.image_versions2?.candidates?.[0]?.url;

          if (isCarousel && item.carousel_media?.length > 0) {
            const first = item.carousel_media[0];
            if (first.video_versions) videoUrl = first.video_versions[0].url;
            thumbUrl = first.image_versions2?.candidates?.[0]?.url || thumbUrl;
          }

          mediaItems.push({
            id: item.id,
            code: item.code,
            type: isVideo ? "video" : (isCarousel ? "carousel" : "image"),
            url: videoUrl || thumbUrl,
            thumbnail: thumbUrl,
            caption: item.caption?.text || "",
            like_count: item.like_count || 0,
            comment_count: item.comment_count || 0
          });
        }

        maxId = feedData.next_max_id;
        if (!maxId || !feedData.more_available) break;
      }
    } catch (e) {
      console.warn("Feed fetch error:", e);
    }

    return {
      status: true,
      type: "profile",
      user: {
        pk: userObj.pk,
        username: userObj.username,
        full_name: userObj.full_name || userObj.username,
        is_private: !!userObj.is_private,
        is_verified: !!userObj.is_verified,
        follower_count: userObj.search_social_context || "",
        profile_pic: rawPic,
        profile_pic_hd: hdPic
      },
      media_count: mediaItems.length,
      media: mediaItems
    };

  } catch (err) {
    console.error("Profile Scraper Error:", err);
    return null;
  }
}

async function fetchViaMobileApi(mediaId, sessionCookie) {
  try {
    const url = `https://i.instagram.com/api/v1/media/${mediaId}/info/`;
    const userId = getUserIdFromSession(sessionCookie);

    const headers = { ...DEFAULT_HEADERS };
    if (sessionCookie) {
      const cleanSession = sessionCookie.trim();
      headers["Cookie"] = `sessionid=${cleanSession}; ds_user_id=${userId};`;
    }

    const res = await fetch(url, { method: "GET", headers });
    if (!res.ok) return null;

    const data = await res.json().catch(() => null);
    if (!data || !data.items || data.items.length === 0) return null;

    const item = data.items[0];
    const caption = item.caption ? item.caption.text : "";
    const media = [];

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
    } else if (item.video_versions && item.video_versions.length > 0) {
      media.push({
        type: "video",
        url: item.video_versions[0].url,
        thumbnail: item.image_versions2?.candidates?.[0]?.url || ""
      });
    } else if (item.image_versions2?.candidates?.length > 0) {
      media.push({
        type: "image",
        url: item.image_versions2.candidates[0].url
      });
    }

    if (media.length > 0) {
      return {
        status: true,
        type: "media",
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

async function fetchViaSnapSave(url) {
  try {
    const form = new URLSearchParams();
    form.append("url", url);

    const res = await fetch("https://snapsave.app/action.php?lang=en", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Referer": "https://snapsave.app/"
      },
      body: form.toString()
    });

    if (!res.ok) return null;

    let html = await res.text();
    if (html.includes("eval(")) {
      try {
        const modified = html.replace(/\beval\s*\(/g, "return (");
        const fn = new Function(modified);
        const inner = fn();
        if (inner && typeof inner === "string") html = inner;
      } catch (e) {}
    }

    const media = [];
    const linkRegex = /href=["'](https?:\/\/[^"']+)["'][^>]*class=["'][^"']*(?:btn-download|download-bottom)[^"']*["']/gi;
    let match;

    while ((match = linkRegex.exec(html)) !== null) {
      const href = match[1];
      const isVideo = href.includes(".mp4") || href.includes("video");
      media.push({
        type: isVideo ? "video" : "image",
        url: href
      });
    }

    if (media.length > 0) {
      return { status: true, type: "media", source: "snapsave", caption: "", media };
    }
    return null;
  } catch (err) {
    return null;
  }
}

async function fetchViaEmbed(shortcode) {
  try {
    const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
    const res = await fetch(embedUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
      }
    });

    if (!res.ok) return null;

    const html = await res.text();
    const media = [];

    const videoMatch = html.match(/"video_url":"([^"]+)"/);
    if (videoMatch) {
      media.push({
        type: "video",
        url: videoMatch[1].replace(/\\u0026/g, "&").replace(/\\\//g, "/")
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
      return { status: true, type: "media", source: "embed", caption: "", media };
    }
    return null;
  } catch (err) {
    return null;
  }
}

async function fetchViaOEmbed(shortcode) {
  try {
    const oembedUrl = `https://www.instagram.com/api/v1/oembed/?url=https://www.instagram.com/p/${shortcode}`;
    const res = await fetch(oembedUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)"
      }
    });

    if (!res.ok) return null;

    const data = await res.json().catch(() => null);
    if (data && data.thumbnail_url) {
      return {
        status: true,
        type: "media",
        source: "oembed",
        caption: data.title || "",
        media: [{ type: "image", url: data.thumbnail_url }]
      };
    }
    return null;
  } catch (err) {
    return null;
  }
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  try {
    let targetQuery = req.query.url;
    if (!targetQuery && req.body && req.body.url) {
      targetQuery = req.body.url;
    }

    if (!targetQuery) {
      return res.status(400).json({
        status: false,
        message: "Missing Instagram URL or Username parameter (?url=...)"
      });
    }

    const sessionCookie = process.env.IG_COOKIE || process.env.IG_SESSION_ID || "43415903614%3AN1rQi6cXXQU3p8%3A7%3AAYgwoxoODBF2C1etY4mwfT8QALinHj1Y8y36XhSJ8g";

    // 1. PROFILE HANDLER
    const username = getUsernameFromQuery(targetQuery);
    if (username) {
      const profileResult = await fetchProfileData(username, sessionCookie);
      if (profileResult && profileResult.user) {
        return res.status(200).json(profileResult);
      }
    }

    // 2. MEDIA HANDLER
    const shortcode = getShortcode(targetQuery);
    if (!shortcode) {
      return res.status(400).json({
        status: false,
        message: "Invalid Instagram link or username. Please check and try again."
      });
    }

    const mediaId = shortcodeToId(shortcode);
    const cleanUrl = `https://www.instagram.com/p/${shortcode}/`;

    let result = await fetchViaMobileApi(mediaId, sessionCookie);

    if (!result || !result.media || result.media.length === 0) {
      result = await fetchViaSnapSave(cleanUrl);
    }

    if (!result || !result.media || result.media.length === 0) {
      result = await fetchViaEmbed(shortcode);
    }

    if (!result || !result.media || result.media.length === 0) {
      result = await fetchViaOEmbed(shortcode);
    }

    if (result && result.media && result.media.length > 0) {
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
        type: "media",
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
    console.error("Vercel IG Handler Error:", error);
    return res.status(500).json({
      status: false,
      message: "Internal server error while processing request."
    });
  }
};
