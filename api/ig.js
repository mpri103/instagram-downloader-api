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
        "User-Agent":"Mozilla/5.0"
      }
    })

    const html = response.data

    let media=[]

    // find video urls
    const videos =
      [...html.matchAll(/"video_url":"([^"]+)"/g)]

    videos.forEach(v=>{
      media.push({
        type:"video",
        url:v[1].replace(/\\u0026/g,"&")
      })
    })

    // find images
    const images =
      [...html.matchAll(/"display_url":"([^"]+)"/g)]

    images.forEach(i=>{
      media.push({
        type:"image",
        url:i[1].replace(/\\u0026/g,"&")
      })
    })

    // remove duplicates
    media = media.filter(
      (v,i,a)=>
        a.findIndex(t=>t.url===v.url)===i
    )

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
