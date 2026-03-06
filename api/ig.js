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

    const response = await axios.get(url,{
      headers:{
        "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
      }
    })

    const html = response.data

    // VIDEO MATCH
    const videoMatch =
      html.match(/"video_url":"([^"]+)"/)

    // IMAGE MATCH
    const imageMatch =
      html.match(/"display_url":"([^"]+)"/)

    let media=[]

    if(videoMatch){

      const videoUrl =
        videoMatch[1].replace(/\\u0026/g,"&")

      media.push({
        type:"video",
        url:videoUrl
      })

    }

    if(imageMatch){

      const imageUrl =
        imageMatch[1].replace(/\\u0026/g,"&")

      media.push({
        type:"image",
        url:imageUrl
      })

    }

    if(media.length===0){

      return res.json({
        status:false,
        message:"Media not found"
      })

    }

    res.json({
      status:true,
      media:media
    })

  } catch(e){

    res.json({
      status:false,
      message:"Server error"
    })

  }

}
