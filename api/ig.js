import axios from "axios"

export default async function handler(req, res){

  const url = req.query.url

  if(!url){
    return res.json({
      status:false,
      message:"Missing URL"
    })
  }

  try{

    // shortcode extract
    const match = url.match(/(reel|p)\/([^/?]+)/)

    if(!match){
      return res.json({
        status:false,
        message:"Invalid Instagram URL"
      })
    }

    const shortcode = match[2]

    const apiUrl =
      `https://www.instagram.com/api/v1/media/${shortcode}/info/`

    const response = await axios.get(apiUrl,{
      headers:{
        "User-Agent":"Mozilla/5.0",
        "X-IG-App-ID":"936619743392459"
      }
    })

    const data = response.data.items[0]

    let media=[]

    // video
    if(data.video_versions){
      media.push({
        type:"video",
        url:data.video_versions[0].url
      })
    }

    // image
    if(data.image_versions2){
      media.push({
        type:"image",
        url:data.image_versions2.candidates[0].url
      })
    }

    // carousel
    if(data.carousel_media){

      data.carousel_media.forEach(item=>{

        if(item.video_versions){
          media.push({
            type:"video",
            url:item.video_versions[0].url
          })
        }

        if(item.image_versions2){
          media.push({
            type:"image",
            url:item.image_versions2.candidates[0].url
          })
        }

      })

    }

    return res.json({
      status:true,
      media:media
    })

  }catch(e){

    return res.json({
      status:false,
      message:"Failed to fetch media"
    })

  }

}
