import axios from "axios"

export default async function handler(req, res) {

  const url = req.query.url

  if (!url) {
    return res.status(400).json({
      status:false,
      message:"Missing Instagram URL"
    })
  }

  try {

    const response = await axios.get(url,{
      headers:{
        "User-Agent":"Mozilla/5.0"
      }
    })

    const html = response.data

    const jsonMatch = html.match(/window\._sharedData = (.*?);<\/script>/)

    if(!jsonMatch){
      return res.json({
        status:false,
        message:"Media not found"
      })
    }

    const data = JSON.parse(jsonMatch[1])

    const mediaData =
      data.entry_data.PostPage[0].graphql.shortcode_media

    let media=[]

    // VIDEO (reels)
    if(mediaData.video_url){
      media.push({
        type:"video",
        url:mediaData.video_url
      })
    }

    // IMAGE
    if(mediaData.display_url){
      media.push({
        type:"image",
        url:mediaData.display_url
      })
    }

    // CAROUSEL
    if(mediaData.edge_sidecar_to_children){

      mediaData.edge_sidecar_to_children.edges.forEach(item=>{

        const node = item.node

        if(node.is_video){

          media.push({
            type:"video",
            url:node.video_url
          })

        }else{

          media.push({
            type:"image",
            url:node.display_url
          })

        }

      })

    }

    return res.json({
      status:true,
      media:media
    })

  } catch(err){

    return res.json({
      status:false,
      message:"Failed to fetch media"
    })

  }

}