const axios = require("axios")
const cheerio = require("cheerio")

module.exports = async function (req, res) {

  try {

    const { url } = req.query

    if (!url) {
      return res.json({
        status:false,
        message:"Missing URL"
      })
    }

    // convert instagram -> ddinstagram
    const newUrl = url.replace(
      "instagram.com",
      "ddinstagram.com"
    )

    const response = await axios.get(newUrl,{
      headers:{
        "User-Agent":"Mozilla/5.0"
      }
    })

    const html = response.data
    const $ = cheerio.load(html)

    const video =
      $("meta[property='og:video']").attr("content")

    const image =
      $("meta[property='og:image']").attr("content")

    let media=[]

    if(video){
      media.push({
        type:"video",
        url:video
      })
    }

    if(image){
      media.push({
        type:"image",
        url:image
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
