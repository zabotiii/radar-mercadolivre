module.exports=async function(req,res){
  try{
    const q=String(req.query?.q||"").trim();
    if(!q){res.status(400).json({error:"Digite um termo de busca."});return;}

    // A busca pública de anúncios não precisa do access token.
    // Isso evita que o PolicyAgent aplique os scopes da conta conectada
    // a uma consulta que é pública.
    const u=new URL("https://api.mercadolibre.com/sites/MLB/search");
    u.searchParams.set("q",q);
    u.searchParams.set("limit","20");

    const r=await fetch(u);
    const d=await r.json();

    if(!r.ok){
      res.status(r.status).json({error:d.message||"Erro na API pública do Mercado Livre."});
      return;
    }

    const results=(d.results||[]).map(p=>({
      id:p.id,
      title:p.title,
      price:p.price,
      thumbnail:p.thumbnail,
      permalink:p.permalink,
      sold_quantity:p.sold_quantity,
      condition:p.condition
    }));

    res.status(200).json({results});
  }catch(e){
    res.status(500).json({error:e.message});
  }
};