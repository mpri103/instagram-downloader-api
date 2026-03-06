const axios = require("axios")
const cheerio = require("cheerio")

module.exports = async function (req, res) {

  try {

    const { url } = req.query

    if (!url) {
      return res.status(400).json({
        status: false,
        message: "Missing URL"
      })
    }

    const response = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
      }
    })

    const html = response.data
    const $ = cheerio.load(html)

    let media = []

    // extract JSON data
    const jsonMatch = html.match(/window\._sharedData = (.*?);<\/script>/)

    if (jsonMatch) {

      const data = JSON.parse(jsonMatch[1])
      const mediaData =
        data.entry_data.PostPage[0].graphql.shortcode_media

      // SINGLE VIDEO
      if (mediaData.video_url) {
        media.push({
          type: "video",
          url: mediaData.video_url
        })
      }

      // SINGLE IMAGE
      if (mediaData.display_url) {
        media.push({
          type: "image",
          url: mediaData.display_url
        })
      }

      // CAROUSEL
      if (mediaData.edge_sidecar_to_children) {

        mediaData.edge_sidecar_to_children.edges.forEach(item => {

          const node = item.node

          if (node.is_video) {

            media.push({
              type: "video",
              url: node.video_url
            })

          } else {

            media.push({
              type: "image",
              url: node.display_url
            })

          }

        })

      }

    }

    // fallback method
    const video = $('meta[property="og:video"]').attr("content")
    const image = $('meta[property="og:image"]').attr("content")

    if (media.length === 0) {

      if (video) {
        media.push({
          type: "video",
          url: video
        })
      }

      if (image) {
        media.push({
          type: "image",
          url: image
        })
      }

    }

    if (media.length === 0) {

      return res.json({
        status: false,
        message: "Media not found"
      })

    }

    res.json({
      status: true,
      media: media
    })

  } catch (error) {

    res.status(500).json({
      status: false,
      message: "Server error",
      error: error.message
    })

  }

}
