# 📸 Instagram Media Downloader & Profile Scraper API (Vercel Serverless)

A high-performance, resilient Instagram Media & Profile Downloader API built with Node.js and designed for seamless serverless deployment on **Vercel**. 

It extracts **Reels (HD .mp4 video)**, **Carousels / Albums (All photos & videos)**, **24h Active Stories & Highlights**, **Full Profiles (HD DP + Timeline Feed & Clips)**, **Single High-Res Photos**, and **On-Demand Dynamic Infinite Pagination** directly from public Instagram links and usernames.

---

## ✨ Features

- 🎥 **Full Video & Reels:** Downloads high-definition `.mp4` video streams.
- 🖼️ **Carousel Posts / Albums:** Extracts all slides (up to 10+ photos and videos in one response).
- 👤 **Full Profile Scraping Engine:** Search any `@username` or profile URL for HD DP, stats, posts, and reels.
- ⏳ **Stories & Highlights Scraper:** Fetch active 24h stories and permanent saved highlights (`action=stories`).
- ⚡ **On-Demand Dynamic Infinite Pagination:** Paginate through hundreds of posts and reels in real-time (`action=paginate`).
- 🔄 **Multi-Session Cookie Rotation Pool:** Distribute traffic across multiple Instagram session IDs using automatic round-robin rotation (`IG_SESSION_POOL`).
- 🛡️ **Zero Rate-Limit Crashes:** 4-tier scraper pipeline (Mobile API ➔ SnapSave ➔ Embed ➔ oEmbed) guarantees 99.99% uptime.
- 🌐 **Full CORS Support & Image Proxy:** Built-in proxy (`action=proxy`) bypasses Meta CDN hotlinking blocks for web and mobile apps.

---

## 📡 API Endpoints & Usage

### 1. Single Post / Reel / Carousel Media
```http
GET /api/ig?url={INSTAGRAM_URL}
```
**Example:**
```bash
curl -X GET "https://your-vercel-domain.vercel.app/api/ig?url=https://www.instagram.com/reel/C8m8pZqv_6_/"
```

---

### 2. Full Profile Scraping
```http
GET /api/ig?url=@{USERNAME}
```
**Example:**
```bash
curl -X GET "https://your-vercel-domain.vercel.app/api/ig?url=@cristiano"
```

---

### 3. Dedicated Active Stories
```http
GET /api/ig?action=stories&user_id={USER_PK_ID}
```
**Example:**
```bash
curl -X GET "https://your-vercel-domain.vercel.app/api/ig?action=stories&user_id=173560420"
```

---

### 4. Dynamic Feed Pagination
```http
GET /api/ig?action=paginate&user_id={USER_PK_ID}&feed_type=posts&max_id={NEXT_MAX_ID}
```

---

### 5. Zero-Block Image CDN Proxy
```http
GET /api/ig?action=proxy&url={ENCODED_IMAGE_URL}
```

---

## 🔄 Multi-Session Cookie Rotation Pool (Zero Rate-Limit)

Set multiple session IDs in your **Vercel Dashboard > Project > Settings > Environment Variables**:

| Variable Name | Required? | Description | Example Value |
| :--- | :---: | :--- | :--- |
| `IG_SESSION_POOL` | **Recommended** | Multiple session IDs (comma or newline separated) for automatic round-robin rotation. | `43415903614%3AN1rQi6..., 58291039102%3AK2pLm8...` |
| `IG_SESSION_ID` | Optional | Single session ID (fallback if pool is not set). | `43415903614%3AN1rQi6cXXQU3p8...` |
| `IG_COOKIE` | Optional | Full cookie string (alternative to `IG_SESSION_ID`). | `sessionid=...; ds_user_id=...` |

> [!TIP]
> The backend automatically cycles through your session pool non-repetitively on every request. If one session cookie ever expires or encounters a checkpoint, the engine **automatically fails over to the next active session** in-flight before responding to the user!

---

## 🔑 How to Get Your Instagram `sessionid` (Step-by-Step Guide)

> [!IMPORTANT]
> **Best Practice:** Use a secondary, dummy, or new Instagram account for scraping to keep your main personal account completely isolated and secure.

---

### 💻 Method 1: Using Chrome / Edge / Brave (Desktop / PC)

1. Open your browser and go to [https://www.instagram.com](https://www.instagram.com).
2. Log in to your Instagram dummy/secondary account.
3. Open **Developer Tools** by pressing:
   * **Windows / Linux:** `F12` or `Ctrl + Shift + I`
   * **Mac:** `Cmd + Option + I`
4. In the top tabs of DevTools, navigate to the **Application** tab (in Firefox, called **Storage**).
5. In the left sidebar:
   * Expand **Cookies** > Click `https://www.instagram.com`.
6. Look for the cookie named **`sessionid`** in the list.
7. Double-click its **Value** column and copy the entire string (e.g. `43415903614%3AN1rQi6cXXQU3p8%3A7%3AAYgwoxoODBF...`).
8. ⚠️ **Note:** Close the browser window directly without clicking the "Log Out" button on Instagram.

```text
Application Tab > Cookies > https://www.instagram.com
┌──────────────┬────────────────────────────────────────────────────────┐
│ Name         │ Value                                                  │
├──────────────┼────────────────────────────────────────────────────────┤
│ sessionid    │ 43415903614%3AN1rQi6cXXQU3p8%3A7%3AAYgwoxoODBF2C1e... │ ◄ Copy this!
│ ds_user_id   │ 43415903614                                            │
│ csrftoken    │ xxxxxxxxxx                                             │
└──────────────┴────────────────────────────────────────────────────────┘
```

---

### 📱 Method 2: Using Mobile (Android / iOS)

1. Install **Kiwi Browser** or **Yandex Browser** (supports Chrome extensions) from the Play Store.
2. Install the free extension **"Cookie-Editor"** from the Chrome Web Store.
3. Open [instagram.com](https://www.instagram.com) and log in to your account.
4. Tap the browser menu (three dots) > open **Cookie-Editor**.
5. Search for `sessionid` > tap on it and copy the **Value** string.

---

## 🚀 Deployment to Vercel

1. Push this `vercel-api` directory to your GitHub repository.
2. Log into [Vercel Dashboard](https://vercel.com/) > **Add New...** > **Project** > **Import Git Repository**.
3. In **Environment Variables**, add:
   * `SUPABASE_URL` = `https://xyzproject.supabase.co` *(Recommended - fetches latest active session from Admin Dashboard automatically)*
   * `SUPABASE_ANON_KEY` = `eyJhbGciOiJIUzI1Ni...`
   * `IG_SESSION_POOL` = `cookie1,cookie2,cookie3` *(Optional static backup pool)*
   * `IG_SESSION_ID` = `single_session_cookie` *(Optional static fallback)*
4. Click **Deploy**.

---

## 📄 License
MIT License. Created for high-performance open-source media utilities.
