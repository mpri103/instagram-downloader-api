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
        "User-Agent": "Mozilla/5.0"
      }
    })

    const html = response.data
    let media = []

    // extract JSON data
    const jsonMatch = html.match(/"shortcode_media":({.*?})\,"viewer"/)

    if (jsonMatch) {

      const data = JSON.parse(jsonMatch[1])

      // SINGLE IMAGE
      if (data.display_resources) {

        const fullImage =
          data.display_resources[
            data.display_resources.length - 1
          ].src

        media.push({
          type: "image",
          url: fullImage
        })
      }

      // VIDEO
      if (data.video_url) {

        media.push({
          type: "video",
          url: data.video_url
        })

      }

      // CAROUSEL
      if (data.edge_sidecar_to_children) {

        data.edge_sidecar_to_children.edges.forEach(item => {

          const node = item.node

          if (node.is_video) {

            media.push({
              type: "video",
              url: node.video_url
            })

          } else {

            const fullImage =
              node.display_resources[
                node.display_resources.length - 1
              ].src

            media.push({
              type: "image",
              url: fullImage
            })

          }

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
