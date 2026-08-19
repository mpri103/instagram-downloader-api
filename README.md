# 📸 Instagram Media Downloader API (Vercel Serverless)

A high-performance, resilient Instagram Media Downloader API built with Node.js and designed for seamless serverless deployment on **Vercel**. 

It can extract **Reels (HD .mp4 video)**, **Carousels / Albums (All photos & videos)**, **Single High-Res Photos**, and **IGTV** content directly from public Instagram links.

---

## ✨ Features

- 🎥 **Full Video & Reels:** Downloads high-definition `.mp4` video streams.
- 🖼️ **Carousel Posts / Albums:** Extracts all slides (up to 10+ photos and videos in one response).
- 📸 **High-Resolution Photos:** Direct original CDN photo links.
- ⚡ **Multi-Tier Scraper Pipeline:**
  1. **Tier 1:** Official Instagram Mobile App API with Authenticated Session Cookie support.
  2. **Tier 2:** SnapSave Scraper Engine (Auto-deobfuscation).
  3. **Tier 3:** Embed HTML Tag Parser.
  4. **Tier 4 (Guaranteed Safety Fallback):** Instagram oEmbed Metadata Engine.
- 🛡️ **Zero Rate-Limit Crashes:** Graceful fallbacks ensure your bot or frontend never receives an unhandled crash.
- 🌐 **Full CORS Support:** Ready for web apps, Telegram bots, Discord bots, and mobile apps.

---

## 📡 API Endpoint & Usage

### Endpoint:
```http
GET /api/ig?url={INSTAGRAM_URL}
```

### Supported URL Formats:
- `https://www.instagram.com/reel/C8m8pZqv_6_/`
- `https://www.instagram.com/p/C_abc123xyz/`
- `https://www.instagram.com/reels/C8m8pZqv_6_/`
- `https://www.instagram.com/tv/C8m8pZqv_6_/`
- `https://www.instagram.com/share/p/C_abc123/`
- Mobile share links with tracking query parameters (`?igsh=...`)

---

### Example Request:
```bash
curl -X GET "https://your-vercel-domain.vercel.app/api/ig?url=https://www.instagram.com/reel/C8m8pZqv_6_/"
```

### Example JSON Response (Single Video / Reel):
```json
{
  "status": true,
  "shortcode": "C8m8pZqv_6_",
  "source": "instagram_mobile_authenticated",
  "caption": "Amazing sunset view! 🌅",
  "media_count": 1,
  "media": [
    {
      "type": "video",
      "url": "https://instagram.fdel1-1.fna.fbcdn.net/v/t50.2886-16/...",
      "thumbnail": "https://instagram.fdel1-1.fna.fbcdn.net/v/t51.2885-15/..."
    }
  ]
}
```

### Example JSON Response (Carousel / Multi-Media Album):
```json
{
  "status": true,
  "shortcode": "C8m8pZqv_6_",
  "source": "instagram_mobile_authenticated",
  "caption": "Trip dump 📸✨",
  "media_count": 3,
  "media": [
    {
      "type": "image",
      "url": "https://instagram.fdel1-1.fna.fbcdn.net/v/t51.2885-15/image1.jpg"
    },
    {
      "type": "video",
      "url": "https://instagram.fdel1-1.fna.fbcdn.net/v/t50.2886-16/video2.mp4",
      "thumbnail": "https://instagram.fdel1-1.fna.fbcdn.net/v/t51.2885-15/thumb2.jpg"
    },
    {
      "type": "image",
      "url": "https://instagram.fdel1-1.fna.fbcdn.net/v/t51.2885-15/image3.jpg"
    }
  ]
}
```

---

## 🔧 Environment Variables

Set these in your **Vercel Dashboard > Project > Settings > Environment Variables**:

| Variable Name | Required? | Description | Example |
| :--- | :---: | :--- | :--- |
| `IG_SESSION_ID` | **Recommended** | Instagram `sessionid` cookie from any dummy/secondary account to unlock 100% full Reels & Carousels. | `43415903614%3AN1rQi6c...` |
| `IG_COOKIE` | Optional | Full cookie string (alternative to `IG_SESSION_ID`). | `sessionid=...; ds_user_id=...` |
| `RAPID_API_KEY` | Optional | RapidAPI key if using external proxy fallback. | `a1b2c3d4e5f6...` |

---

## 🔑 Session ID Priority (Env Variable vs Hardcoded)

### 🥇 Priority Order:
1. **1st Priority (Highest):** `process.env.IG_COOKIE` (Vercel Environment Variable)
2. **2nd Priority:** `process.env.IG_SESSION_ID` (Vercel Environment Variable)
3. **3rd Priority (Fallback):** Hardcoded string in `api/ig.js`

> **Note:** Agar aap Vercel me Environment Variable `IG_SESSION_ID` set karte hain, to **Vercel wala variable pehle use hoga**. Agar Vercel me variable empty ya missing ho, tabhi code hardcoded value use karega.

---

## 📝 Hardcoded Session ID Change Kaise Karein?

Agar aap Environment Variable use na karke direct file me Session ID change karna chahte hain:

* **File:** `api/ig.js`
* **Line Number:** **Line 308**
* **Code:**
```javascript
// Line 308 in api/ig.js
const sessionCookie = process.env.IG_COOKIE || process.env.IG_SESSION_ID || "PASTE_YOUR_NEW_SESSION_ID_HERE";
```

---

## 🍪 Instagram `sessionid` Kaise Nikalein? (Step-by-Step Guide)

Instagram se `sessionid` nikalne ke 2 sabse aasan tarike hain:

### 💻 Method 1: PC / Laptop (Chrome, Edge, Brave, Firefox)
1. Apne computer me browser kholein aur [Instagram.com](https://www.instagram.com) par login karein *(Preferable: Dummy/Secondary account use karein)*.
2. Instagram open hone ke baad keyboard par **`F12`** ya **`Ctrl + Shift + I`** *(Mac par: `Cmd + Option + I`)* dabayein.
3. Top navigation menu me **`Application`** tab par click karein *(Agar na dikhe to `>>` icon par click karein. Firefox me ise **`Storage`** kehte hain)*.
4. Left sidebar me **`Cookies`** par click karke **`https://www.instagram.com`** ko select karein.
5. Cookies ki list me **`sessionid`** naam dhoondhein.
6. `sessionid` ke saamne wali **Value** par double-click karke use **Copy** kar lein *(Example: `43415903614%3AN1rQi6...`)*.
7. ⚠️ **Important:** Browser tab/window ko sidha **Close** kar dein, par Instagram me **"Log Out" button par kabhi click na karein**.

---

### 📱 Method 2: Extension se (Sabse Simple - 1 Click Tarika)
1. Chrome Web Store se **[Cookie-Editor](https://chromewebstore.google.com/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm)** extension install karein *(Android par Kiwi Browser me bhi ye extension chalta hai)*.
2. [Instagram.com](https://www.instagram.com) par login karein.
3. Browser toolbar me **Cookie-Editor** extension icon par click karein.
4. Search bar me **`sessionid`** likhein.
5. Uski **Value** copy kar lein!

---

### 🔒 Best Safety Practices:
* **Dummy Account Use Karein:** Apna personal Instagram account use na karke ek naya free fake/dummy account use karein taaki main account 100% safe rahe.
* **Do NOT Log Out:** Log Out karne se Instagram session turant invalidate kar deta hai. Bas tab close karein.
* **Validity:** Ek baar nikali gayi `sessionid` 3 se 12 mahine tak active rehti hai.

---

## 🚀 Deployment to Vercel

### Method 1: Using Vercel CLI (Recommended)
```bash
# 1. Navigate to vercel-api directory
cd vercel-api

# 2. Install dependencies
npm install

# 3. Deploy to production
vercel --prod
```

### Method 2: Using GitHub
1. Is folder ke content ko GitHub repository me push karein.
2. [Vercel Dashboard](https://vercel.com) me **Add New Project** > GitHub repo select karein.
3. **Environment Variables** me `IG_SESSION_ID` add karein.
4. **Deploy** button click karein!

---

## 📄 License
MIT License. For educational and personal integration purposes.
