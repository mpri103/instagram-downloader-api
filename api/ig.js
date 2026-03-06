const axios = require("axios")

module.exports = async function(req,res){

try{

const {url} = req.query

if(!url){
return res.json({
status:false,
message:"Missing URL"
})
}

// use embed endpoint
const embedUrl = url + "embed/captioned/"

const response = await axios.get(embedUrl,{
headers:{
"User-Agent":"Mozilla/5.0"
}
})

const html = response.data

let media=[]

// find all images
const imgs=[...html.matchAll(/src="(https:\/\/[^"]+\.jpg[^"]*)"/g)]

imgs.forEach(i=>{
media.push({
type:"image",
url:i[1]
})
})

// remove duplicates
media = media.filter(
(v,i,a)=>a.findIndex(t=>t.url===v.url)===i
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

}catch(e){

res.json({
status:false,
message:"Server error"
})

}

}
