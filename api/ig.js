/**
 * Vercel Serverless Function - Instagram Media, Full Profile & On-Demand Infinite Scraper API
 * Endpoint: /api/ig?url={INSTAGRAM_URL_OR_USERNAME}
 * Pagination: /api/ig?action=paginate&user_id={USER_ID}&feed_type=posts|reels&max_id={MAX_ID}
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
  const trimmed = url.trim();

  // 1. Match explicit post / reel / tv / clip / share URLs
  const match = trimmed.match(/(?:instagram\.com\/(?:p|reel|reels|tv|clip|share\/p|share\/reel|share)\/([A-Za-z0-9_-]+))/i);
  if (match && match[1]) {
    return match[1];
  }

  // 2. Direct raw shortcode input (e.g. C8m8pZqv_6_) but NOT a username or URL
  if (!trimmed.includes('/') && !trimmed.includes('?') && !trimmed.includes('&') && !trimmed.startsWith('@')) {
    if (/^[A-Za-z0-9_-]{10,12}$/.test(trimmed) && (trimmed.includes('_') || trimmed.includes('-'))) {
      return trimmed;
    }
  }

  return null;
}

function getUsernameFromQuery(query) {
  if (!query) return null;
  let trimmed = query.trim();

  // If it's explicitly a post/reel/carousel URL, it's NOT a profile
  if (trimmed.match(/instagram\.com\/(?:p|reel|reels|tv|clip|share\/p|share\/reel|share)\//i)) {
    return null;
  }

  // 1. Full Instagram Profile URL (e.g. https://www.instagram.com/cristiano/ or https://instagram.com/techburner?igsh=...)
  const urlMatch = trimmed.match(/(?:https?:\/\/)?(?:www\.)?instagram\.com\/([A-Za-z0-9_.]+)/i);
  if (urlMatch && urlMatch[1]) {
    const candidate = urlMatch[1].replace(/[\/?#].*$/, '').trim();
    const reserved = ['p', 'reel', 'reels', 'tv', 'stories', 'explore', 'direct', 'accounts', 'developer', 'about', 'legal', 'directory'];
    if (!reserved.includes(candidate.toLowerCase()) && candidate.length > 0 && candidate.length <= 30) {
      return candidate;
    }
  }

  // 2. Username with @ (e.g. @cristiano or @techburner)
  if (trimmed.startsWith('@')) {
    const candidate = trimmed.substring(1).replace(/[^A-Za-z0-9_.]/g, '').trim();
    if (candidate.length > 0 && candidate.length <= 30) {
      return candidate;
    }
  }

  // 3. Plain Username (e.g. cristiano, virat.kohli, techburner)
  const cleanPlain = trimmed.replace(/[\/?#].*$/, '').replace(/^@/, '').trim();
  if (!cleanPlain.includes('/') && !cleanPlain.includes(' ') && cleanPlain.length <= 30 && /^[A-Za-z0-9_.]+$/.test(cleanPlain)) {
    const reserved = ['p', 'reel', 'reels', 'tv', 'stories', 'explore', 'direct', 'accounts'];
    if (!reserved.includes(cleanPlain.toLowerCase())) {
      return cleanPlain;
    }
  }

  return null;
}

function mapRawItem(item, defaultType = null) {
  const media = item.media || item;
  const isVideo = media.media_type === 2 || !!media.video_versions || defaultType === "video";
  const isCarousel = media.media_type === 8 || !!media.carousel_media;
  let videoUrl = media.video_versions?.[0]?.url;
  let thumbUrl = media.image_versions2?.candidates?.[0]?.url || media.display_url || media.thumbnail_src;

  let carouselSlides = [];
  if (isCarousel && media.carousel_media?.length > 0) {
    const first = media.carousel_media[0];
    if (first.video_versions) videoUrl = first.video_versions[0].url;
    thumbUrl = first.image_versions2?.candidates?.[0]?.url || thumbUrl;

    carouselSlides = media.carousel_media.map((sub, i) => {
      const subIsVid = sub.media_type === 2 || !!sub.video_versions;
      const subVidUrl = sub.video_versions?.[0]?.url;
      const subImgUrl = sub.image_versions2?.candidates?.[0]?.url 
        || sub.image_versions?.candidates?.[0]?.url 
        || sub.display_url 
        || sub.thumbnail_src 
        || sub.url 
        || "";
      return {
        type: subIsVid ? "video" : "image",
        url: subIsVid ? (subVidUrl || subImgUrl) : subImgUrl,
        thumbnail: subImgUrl || subVidUrl || ""
      };
    });
  }

  return {
    id: media.id,
    code: media.code,
    type: isVideo ? "video" : (isCarousel ? "carousel" : "image"),
    url: videoUrl || thumbUrl,
    thumbnail: thumbUrl,
    caption: media.caption?.text || "",
    like_count: media.like_count || 0,
    comment_count: media.comment_count || 0,
    play_count: media.play_count || media.view_count || 0,
    carousel_media: carouselSlides
  };
}

let sessionRotationIndex = 0;
let cachedSupabaseSession = null;
let cachedSupabasePool = [];
let lastSupabaseFetchTime = 0;
const SUPABASE_CACHE_TTL = 60 * 1000; // 60 seconds

function parseSessionPool(rawPool) {
  if (!rawPool) return [];
  return rawPool.split(/[\n,;]+/).map(s => s.trim()).filter(s => s.length > 5);
}

/**
 * Dynamically fetch latest active session ID & cookie pool from Supabase database
 */
async function fetchSupabaseConfigurations() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) return null;

  const now = Date.now();
  if (cachedSupabaseSession && (now - lastSupabaseFetchTime) < SUPABASE_CACHE_TTL) {
    return { session: cachedSupabaseSession, pool: cachedSupabasePool };
  }

  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/instagram_DL?select=key,value,status`, {
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`
      }
    });

    if (res.ok) {
      const rows = await res.json();
      for (const row of rows) {
        if (row.key === "active_session_id" && row.value && row.status !== "expired") {
          cachedSupabaseSession = row.value.trim();
        } else if (row.key === "cookie_pool" && row.value) {
          try {
            const parsed = JSON.parse(row.value);
            cachedSupabasePool = Array.isArray(parsed) ? parsed.map(item => (typeof item === 'string' ? item : item.session_id)).filter(Boolean) : [];
          } catch (e) {
            cachedSupabasePool = [];
          }
        }
      }
      lastSupabaseFetchTime = now;
      return { session: cachedSupabaseSession, pool: cachedSupabasePool };
    }
  } catch (err) {
    console.error("Supabase dynamic session fetch error:", err.message);
  }

  return { session: cachedSupabaseSession, pool: cachedSupabasePool };
}

function getSessionPool(dynamicSession = null, dynamicPool = []) {
  let dbSessions = [];

  // 1. Highest Priority: Database Dynamic Pool & Active Session
  if (Array.isArray(dynamicPool) && dynamicPool.length > 0) {
    dynamicPool.forEach(s => {
      if (s && typeof s === "string" && s.trim().length > 5 && !dbSessions.includes(s.trim())) {
        dbSessions.push(s.trim());
      }
    });
  }
  if (dynamicSession && typeof dynamicSession === "string" && dynamicSession.trim().length > 5) {
    if (!dbSessions.includes(dynamicSession.trim())) {
      dbSessions.unshift(dynamicSession.trim());
    }
  }

  // Priority 1: If database has sessions, USE ONLY DATABASE SESSIONS!
  if (dbSessions.length > 0) {
    return dbSessions;
  }

  // 2. Priority 2: Fallback to Server Environment Variables
  let envSessions = [];
  const poolRaw = process.env.IG_SESSION_POOL || process.env.IG_SESSION_IDS || "";
  if (poolRaw) {
    envSessions = parseSessionPool(poolRaw);
  }

  const singleSession = process.env.IG_COOKIE || process.env.IG_SESSION_ID || "";
  if (singleSession && singleSession.trim().length > 5 && !envSessions.includes(singleSession.trim())) {
    envSessions.push(singleSession.trim());
  }

  if (envSessions.length > 0) {
    return envSessions;
  }

  // 3. Last Emergency Fallback
  return ["43415903614%3AN1rQi6cXXQU3p8%3A7%3AAYgwoxoODBF2C1etY4mwfT8QALinHj1Y8y36XhSJ8g"];
}

function cleanSessionCookie(rawSession) {
  if (!rawSession || typeof rawSession !== "string") return "";
  let s = rawSession.trim();
  s = s.replace(/^["']|["']$/g, '');
  s = s.replace(/^sessionid=/i, '').trim();
  return s;
}

function getUserIdFromSession(sessionCookie) {
  if (!sessionCookie) return "0";
  const clean = cleanSessionCookie(sessionCookie);
  const parts = clean.split("%3A");
  if (parts.length > 0 && /^\d+$/.test(parts[0])) {
    return parts[0];
  }
  const altParts = clean.split(":");
  if (altParts.length > 0 && /^\d+$/.test(altParts[0])) {
    return altParts[0];
  }
  return "0";
}

function getNextRotatedSession(sessions) {
  if (!sessions || sessions.length === 0) return "";
  if (sessions.length === 1) return cleanSessionCookie(sessions[0]);
  // Randomly pick a session across available pool for distributed load balancing
  const randomIndex = Math.floor(Math.random() * sessions.length);
  return cleanSessionCookie(sessions[randomIndex]);
}

async function fetchUserStories(userId, sessionCookie) {
  try {
    const session = sessionCookie?.trim() || "";
    const cookieUserId = getUserIdFromSession(session);
    const storyUrl = `https://i.instagram.com/api/v1/feed/user/${userId}/story/`;
    const res = await fetch(storyUrl, {
      headers: {
        ...DEFAULT_HEADERS,
        "Cookie": `sessionid=${session}; ds_user_id=${cookieUserId};`
      }
    });
    if (!res.ok) return [];
    const data = await res.json().catch(() => null);
    if (!data || !data.reel || !Array.isArray(data.reel.items)) return [];
    return data.reel.items.map(item => mapRawItem(item));
  } catch (err) {
    return [];
  }
}

async function fetchUserHighlights(userId, sessionCookie) {
  try {
    const session = sessionCookie?.trim() || "";
    const cookieUserId = getUserIdFromSession(session);
    const hlUrl = `https://i.instagram.com/api/v1/highlights/${userId}/highlights_tray/`;
    const res = await fetch(hlUrl, {
      headers: {
        ...DEFAULT_HEADERS,
        "Cookie": `sessionid=${session}; ds_user_id=${cookieUserId};`
      }
    });
    if (!res.ok) return [];
    const data = await res.json().catch(() => null);
    if (!data || !Array.isArray(data.tray)) return [];
    return data.tray.map(t => ({
      id: t.id,
      title: t.title || "Highlight",
      cover_url: t.cover_media?.cropped_image_version?.url || t.cover_media?.image_versions2?.candidates?.[0]?.url || "",
      media_count: t.media_count || (t.items ? t.items.length : 0),
      items: Array.isArray(t.items) ? t.items.map(it => mapRawItem(it)) : []
    }));
  } catch (err) {
    return [];
  }
}

async function fetchProfileData(username, sessionCookie) {
  try {
    const session = cleanSessionCookie(sessionCookie);
    const userId = getUserIdFromSession(session);
    const cleanUser = username.trim().toLowerCase().replace(/^@/, '').replace(/[\/?#].*$/, '');

    let userObj = null;
    let initialFeedItems = [];

    // Method A: Official Instagram Web Profile Info API
    try {
      const webProfileUrl = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(cleanUser)}`;
      const webRes = await fetch(webProfileUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/126.0.0.0",
          "Accept": "*/*",
          "X-IG-App-ID": "936619743392459",
          "X-Requested-With": "XMLHttpRequest",
          "Referer": `https://www.instagram.com/${encodeURIComponent(cleanUser)}/`,
          "Cookie": `sessionid=${session}; ds_user_id=${userId};`
        }
      });

      if (webRes.ok) {
        const webJson = await webRes.json().catch(() => null);
        const u = webJson?.data?.user;
        if (u) {
          userObj = {
            pk: u.id,
            username: u.username,
            full_name: u.full_name || u.username,
            is_private: !!u.is_private,
            is_verified: !!u.is_verified,
            follower_count: u.edge_followed_by?.count ? String(u.edge_followed_by.count) : "",
            profile_pic: u.profile_pic_url || "",
            profile_pic_hd: u.profile_pic_url_hd || u.profile_pic_url || ""
          };

          if (u.edge_owner_to_timeline_media?.edges) {
            for (const edge of u.edge_owner_to_timeline_media.edges) {
              const node = edge.node;
              if (node) {
                const isVid = node.is_video;
                initialFeedItems.push({
                  id: node.id,
                  code: node.shortcode,
                  type: isVid ? "video" : (node.edge_sidecar_to_children ? "carousel" : "image"),
                  url: node.video_url || node.display_url,
                  thumbnail: node.display_url,
                  caption: node.edge_media_to_caption?.edges?.[0]?.node?.text || "",
                  like_count: node.edge_liked_by?.count || 0,
                  comment_count: node.edge_media_to_comment?.count || 0,
                  play_count: node.video_view_count || node.video_play_count || 0,
                  carousel_media: []
                });
              }
            }
          }
        }
      }
    } catch (e) {}

    // Method B: Fallback to topsearch lookup if userObj was not found
    if (!userObj) {
      try {
        const searchUrl = `https://www.instagram.com/web/search/topsearch/?query=${encodeURIComponent(cleanUser)}`;
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

        if (searchRes.ok) {
          const searchData = await searchRes.json().catch(() => null);
          if (searchData && searchData.users && searchData.users.length > 0) {
            let found = searchData.users.find(u => u.user.username.toLowerCase() === cleanUser.toLowerCase())?.user;
            if (!found) found = searchData.users[0].user;

            const rawPic = found.profile_pic_url || "";
            const hdPic = found.hd_profile_pic_url_info?.url || rawPic;

            userObj = {
              pk: found.pk,
              username: found.username,
              full_name: found.full_name || found.username,
              is_private: !!found.is_private,
              is_verified: !!found.is_verified,
              follower_count: found.search_social_context || "",
              profile_pic: rawPic,
              profile_pic_hd: hdPic
            };
          }
        }
      } catch (e) {}
    }

    if (!userObj) return null;

    // Step 2: Fetch Timeline Feed Posts via Mobile App API
    let feedPosts = [...initialFeedItems];
    let postsNextMaxId = null;
    let postsHasMore = false;

    if (feedPosts.length === 0 && !userObj.is_private) {
      try {
        let maxId = "";
        const maxPages = 2;

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
            feedPosts.push(mapRawItem(item));
          }

          maxId = feedData.next_max_id;
          postsNextMaxId = maxId || null;
          postsHasMore = !!feedData.more_available && !!maxId;
          if (!maxId || !feedData.more_available) break;
        }
      } catch (e) {}
    }

    // Step 3: Fetch Initial Batch of Dedicated Clips (Reels Tab)
    let reelsList = [];
    let reelsNextMaxId = null;
    let reelsHasMore = false;

    if (!userObj.is_private) {
      try {
        const clipsUrl = "https://i.instagram.com/api/v1/clips/user/";
        const form = new URLSearchParams();
        form.append("target_user_id", userObj.pk);
        form.append("page_size", "24");

        const clipsRes = await fetch(clipsUrl, {
          method: "POST",
          headers: {
            ...DEFAULT_HEADERS,
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "Cookie": `sessionid=${session}; ds_user_id=${userId};`
          },
          body: form.toString()
        });

        if (clipsRes.ok) {
          const clipsData = await clipsRes.json().catch(() => null);
          if (clipsData && Array.isArray(clipsData.items)) {
            for (const item of clipsData.items) {
              reelsList.push(mapRawItem(item, "video"));
            }
            reelsNextMaxId = clipsData.paging_info?.max_id || clipsData.next_max_id || null;
            reelsHasMore = !!clipsData.paging_info?.more_available;
          }
        }
      } catch (e) {}
    }

    // Step 4: Fetch Active Stories & Highlights (Parallel)
    const [storiesList, highlightsList] = await Promise.all([
      userObj.is_private ? Promise.resolve([]) : fetchUserStories(userObj.pk, session).catch(() => []),
      userObj.is_private ? Promise.resolve([]) : fetchUserHighlights(userObj.pk, session).catch(() => [])
    ]);

    // Ensure all video posts from timeline feed are also included in reelsList
    const existingReelCodes = new Set(reelsList.map(r => r.code));
    for (const p of feedPosts) {
      if (p.type === "video" && p.code && !existingReelCodes.has(p.code)) {
        existingReelCodes.add(p.code);
        reelsList.push(p);
      }
    }

    // Combined unique media list
    const combinedMedia = [];
    const seenCodes = new Set();

    for (const p of [...feedPosts, ...reelsList, ...storiesList]) {
      if (p.code && !seenCodes.has(p.code)) {
        seenCodes.add(p.code);
        combinedMedia.push(p);
      }
    }

    return {
      status: true,
      type: "profile",
      user: userObj,
      posts_count: feedPosts.length,
      reels_count: reelsList.length,
      stories_count: storiesList.length,
      highlights_count: highlightsList.length,
      total_media_count: combinedMedia.length,
      posts_next_max_id: postsNextMaxId,
      posts_has_more: postsHasMore,
      reels_next_max_id: reelsNextMaxId,
      reels_has_more: reelsHasMore,
      posts: feedPosts,
      reels: reelsList,
      stories: storiesList,
      highlights: highlightsList,
      media: combinedMedia
    };

  } catch (err) {
    console.error("Profile Scraper Error:", err);
    return null;
  }
}

async function fetchPaginatedFeed(userId, feedType, maxId, sessionCookie) {
  try {
    const session = sessionCookie?.trim() || "";
    const cookieUserId = getUserIdFromSession(session);

    if (feedType === "reels") {
      const clipsUrl = "https://i.instagram.com/api/v1/clips/user/";
      const form = new URLSearchParams();
      form.append("target_user_id", userId);
      form.append("page_size", "12");
      if (maxId) form.append("max_id", maxId);

      const clipsRes = await fetch(clipsUrl, {
        method: "POST",
        headers: {
          ...DEFAULT_HEADERS,
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "Cookie": `sessionid=${session}; ds_user_id=${cookieUserId};`
        },
        body: form.toString()
      });

      if (!clipsRes.ok) return null;
      const clipsData = await clipsRes.json().catch(() => null);
      if (!clipsData || !Array.isArray(clipsData.items)) return null;

      const items = clipsData.items.map(i => mapRawItem(i, "video"));
      return {
        status: true,
        type: "pagination",
        feed_type: "reels",
        items: items,
        next_max_id: clipsData.paging_info?.max_id || clipsData.next_max_id || null,
        has_more: !!clipsData.paging_info?.more_available
      };
    } else {
      const feedUrl = `https://i.instagram.com/api/v1/feed/user/${userId}/?max_id=${maxId || ''}`;
      const feedRes = await fetch(feedUrl, {
        headers: {
          ...DEFAULT_HEADERS,
          "Cookie": `sessionid=${session}; ds_user_id=${cookieUserId};`
        }
      });

      if (!feedRes.ok) return null;
      const feedData = await feedRes.json().catch(() => null);
      if (!feedData || !Array.isArray(feedData.items)) return null;

      const items = feedData.items.map(i => mapRawItem(i));
      return {
        status: true,
        type: "pagination",
        feed_type: "posts",
        items: items,
        next_max_id: feedData.next_max_id || null,
        has_more: !!feedData.more_available && !!feedData.next_max_id
      };
    }
  } catch (err) {
    console.error("Pagination error:", err);
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

function logToDatabase(logData) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;

  if (!supabaseUrl || !supabaseKey) return;

  try {
    const payload = {
      event_type: logData.event_type || "success",
      url_or_query: (logData.url_or_query || "").substring(0, 500),
      media_type: logData.media_type || "media",
      status_code: logData.status_code || 200,
      error_message: logData.error_message || "",
      session_used: logData.session_used ? (logData.session_used.substring(0, 15) + "...") : "",
      ip_address: logData.ip_address || "",
      latency_ms: logData.latency_ms || 0,
      created_at: new Date().toISOString()
    };

    fetch(`${supabaseUrl}/rest/v1/instagram_logs`, {
      method: "POST",
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }).catch(() => {});
  } catch (e) {}
}

module.exports = async (req, res) => {
  const startTime = Date.now();
  const clientIp = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "";

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  try {
    const action = req.query.action || (req.body && req.body.action);
    const dynamicConfig = await fetchSupabaseConfigurations();
    const sessionPool = getSessionPool(dynamicConfig?.session, dynamicConfig?.pool);
    const sessionCookie = getNextRotatedSession(sessionPool);

    // 0. IMAGE & MEDIA PROXY HANDLER (Fixes Hotlinking / CDN CORS)
    if (action === "proxy") {
      const imageUrl = req.query.url || (req.body && req.body.url);
      if (!imageUrl) {
        return res.status(400).send("Missing url parameter");
      }

      try {
        const imgRes = await fetch(imageUrl, {
          headers: {
            "User-Agent": "Instagram 278.0.0.19.115 Android (33/13; 480dpi; 1080x2400; Xiaomi; M2012K11AC; alioth; qcom; en_US; 461141443)",
            "X-IG-App-ID": "1217981644879628",
            "Accept": "image/*,*/*;q=0.8"
          }
        });

        if (!imgRes.ok) {
          return res.status(imgRes.status).send("Failed to fetch image from CDN");
        }

        const contentType = imgRes.headers.get("content-type") || "image/jpeg";
        const buffer = Buffer.from(await imgRes.arrayBuffer());

        res.setHeader("Content-Type", contentType);
        res.setHeader("Cache-Control", "public, max-age=86400");
        res.setHeader("Access-Control-Allow-Origin", "*");
        return res.status(200).send(buffer);
      } catch (e) {
        return res.status(500).send("Proxy error");
      }
    }

    // 0.5. ON-DEMAND DYNAMIC PAGINATION HANDLER
    if (action === "paginate") {
      const targetUserId = req.query.user_id || (req.body && req.body.user_id);
      const feedType = req.query.feed_type || (req.body && req.body.feed_type) || "posts";
      const maxId = req.query.max_id || (req.body && req.body.max_id) || "";

      if (!targetUserId) {
        return res.status(400).json({ status: false, message: "Missing user_id for pagination" });
      }

      const paginatedResult = await fetchPaginatedFeed(targetUserId, feedType, maxId, sessionCookie);
      if (paginatedResult) {
        logToDatabase({
          event_type: "success",
          media_type: "paginate",
          url_or_query: `User ID: ${targetUserId} (${feedType})`,
          status_code: 200,
          session_used: sessionCookie,
          ip_address: clientIp,
          latency_ms: Date.now() - startTime
        });
        return res.status(200).json(paginatedResult);
      }

      logToDatabase({
        event_type: "error",
        media_type: "paginate",
        url_or_query: `User ID: ${targetUserId} (${feedType})`,
        status_code: 404,
        error_message: "No more items available or rate limited.",
        session_used: sessionCookie,
        ip_address: clientIp,
        latency_ms: Date.now() - startTime
      });
      return res.status(404).json({ status: false, message: "No more items available or rate limited." });
    }

    // 0.6. DEDICATED ACTIVE STORIES HANDLER
    if (action === "stories") {
      const targetUserId = req.query.user_id || (req.body && req.body.user_id);
      if (!targetUserId) {
        return res.status(400).json({ status: false, message: "Missing user_id parameter for stories" });
      }

      const stories = await fetchUserStories(targetUserId, sessionCookie);
      logToDatabase({
        event_type: "success",
        media_type: "stories",
        url_or_query: `User ID: ${targetUserId}`,
        status_code: 200,
        session_used: sessionCookie,
        ip_address: clientIp,
        latency_ms: Date.now() - startTime
      });
      return res.status(200).json({ status: true, type: "stories", user_id: targetUserId, items: stories });
    }

    const targetQuery = req.query.url || (req.body && req.body.url);

    if (!targetQuery) {
      logToDatabase({
        event_type: "error",
        media_type: "unknown",
        url_or_query: "Empty Query",
        status_code: 400,
        error_message: "Missing Instagram URL or Username parameter",
        ip_address: clientIp,
        latency_ms: Date.now() - startTime
      });
      return res.status(400).json({
        status: false,
        message: "Missing Instagram URL or Username parameter (?url=...)"
      });
    }

    // 1. PROFILE INITIAL SEARCH HANDLER (With Multi-Session Failover)
    const username = getUsernameFromQuery(targetQuery);
    if (username) {
      for (const currentSession of [sessionCookie, ...sessionPool.filter(s => s !== sessionCookie)]) {
        const profileResult = await fetchProfileData(username, currentSession);
        if (profileResult && profileResult.user) {
          logToDatabase({
            event_type: "success",
            media_type: "profile",
            url_or_query: targetQuery,
            status_code: 200,
            session_used: currentSession,
            ip_address: clientIp,
            latency_ms: Date.now() - startTime
          });
          return res.status(200).json(profileResult);
        }
      }
    }

    // 2. MEDIA HANDLER (With Multi-Session Failover)
    const shortcode = getShortcode(targetQuery);
    if (!shortcode) {
      logToDatabase({
        event_type: "error",
        media_type: "invalid_url",
        url_or_query: targetQuery,
        status_code: 400,
        error_message: "Invalid Instagram link or username format",
        session_used: sessionCookie,
        ip_address: clientIp,
        latency_ms: Date.now() - startTime
      });
      return res.status(400).json({
        status: false,
        message: "Invalid Instagram link or username. Please check and try again."
      });
    }

    const mediaId = shortcodeToId(shortcode);
    const cleanUrl = `https://www.instagram.com/p/${shortcode}/`;

    let result = null;
    for (const currentSession of [sessionCookie, ...sessionPool.filter(s => s !== sessionCookie)]) {
      result = await fetchViaMobileApi(mediaId, currentSession);
      if (result && result.media && result.media.length > 0) break;
    }

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

      logToDatabase({
        event_type: "success",
        media_type: uniqueMedia[0]?.type || "media",
        url_or_query: targetQuery,
        status_code: 200,
        session_used: sessionCookie,
        ip_address: clientIp,
        latency_ms: Date.now() - startTime
      });

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

    logToDatabase({
      event_type: "error",
      media_type: "media",
      url_or_query: targetQuery,
      status_code: 404,
      error_message: "Could not fetch media. Post might be private or session expired.",
      session_used: sessionCookie,
      ip_address: clientIp,
      latency_ms: Date.now() - startTime
    });

    return res.status(404).json({
      status: false,
      message: "Could not fetch media. Post might be private or deleted."
    });

  } catch (error) {
    console.error("Vercel IG Handler Error:", error);
    logToDatabase({
      event_type: "error",
      media_type: "system_error",
      url_or_query: "Internal Error",
      status_code: 500,
      error_message: error.message || "Internal server error",
      ip_address: clientIp,
      latency_ms: Date.now() - startTime
    });
    return res.status(500).json({
      status: false,
      message: "Internal server error while processing request."
    });
  }
};
