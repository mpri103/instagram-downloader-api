const axios = require("axios")

module.exports = async function (req, res) {

  try {

    const { url } = req.query

    if (!url) {
      return res.json({
        status:false,
        message:"Missing URL"
      })
    }

    // extract shortcode
    const match = url.match(/\/(reel|p)\/([^/?]+)/)

    if (!match) {
      return res.json({
        status:false,
        message:"Invalid Instagram URL"
      })
    }

    const shortcode = match[2]

    const apiUrl =
      `https://www.instagram.com/api/v1/oembed/?url=https://www.instagram.com/p/${shortcode}`

    const response = await axios.get(apiUrl,{
      headers:{
        "User-Agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X)"
      }
    })

    const media = []

    // thumbnail (image)
    if (response.data.thumbnail_url) {

      media.push({
        type:"image",
        url:response.data.thumbnail_url
      })

    }

    res.json({
      status:true,
      media:media
    })

  } catch (e) {

    res.json({
      status:false,
      message:"Failed to fetch media"
    })

  }

}
