const axios = require("axios")

module.exports = async function(req, res){

  try{

    const { url } = req.query

    if(!url){
      return res.json({
        status:false,
        message:"Missing URL"
      })
    }

    // convert instagram link
    const apiUrl =
      "https://ddinstagram.com" +
      url.split("instagram.com")[1]

    const response = await axios.get(apiUrl,{
      headers:{
        "User-Agent":"Mozilla/5.0"
      }
    })

    // final redirected url
    const finalUrl =
      response.request.res.responseUrl

    res.json({
      status:true,
      media:[
        {
          type:"video",
          url:finalUrl
        }
      ]
    })

  }catch(e){

    res.json({
      status:false,
      message:e.message
    })

  }

}
