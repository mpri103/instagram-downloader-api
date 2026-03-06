import axios from "axios"
import cheerio from "cheerio"

export default async function handler(req, res) {

  const url = req.query.url

  if (!url) {
    return res.json({
      status:false,
      message:"Missing URL"
    })
  }

  try {

    const response = await axios.get(url,{
      headers:{
        "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
      }
    })

    const html = response.data
    const $ = cheerio.load(html)

    const video = $('meta[property="og:video"]').attr("content")
    const image = $('meta[property="og:image"]').attr("content")

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

    return res.json({
      status:true,
      media:media
    })

  } catch(e){

    return res.json({
      status:false,
      message:"Could not fetch media"
    })

  }

}