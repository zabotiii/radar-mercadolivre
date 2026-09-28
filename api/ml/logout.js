const {cookie}=require('../lib');module.exports=async(req,res)=>{res.setHeader('Set-Cookie',cookie('ml_session','',0));res.json({ok:true})};
