const axios = require("axios")

module.exports = async function(req,res){

 try{

  const { url } = req.query

  if(!url){
   return res.json({
    status:false,
    message:"Missing URL"
   })
  }

  // extract shortcode
  const match = url.match(/(reel|p)\/([^/?]+)/)

  if(!match){
   return res.json({
    status:false,
    message:"Invalid Instagram URL"
   })
  }

  const shortcode = match[2]

  const apiUrl =
   `https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`

  const response = await axios.get(apiUrl,{
   headers:{
    "User-Agent":"Mozilla/5.0",
    "X-IG-App-ID":"936619743392459"
   }
  })

  const mediaData =
   response.data.graphql.shortcode_media

  let media=[]

  // video
  if(mediaData.video_url){
   media.push({
    type:"video",
    url:mediaData.video_url
   })
  }

  // image
  if(mediaData.display_url){
   media.push({
    type:"image",
    url:mediaData.display_url
   })
  }

  // carousel
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

  res.json({
   status:true,
   media:media
  })

 }catch(e){

  res.json({
   status:false,
   message:"Failed to fetch media"
  })

 }

}
