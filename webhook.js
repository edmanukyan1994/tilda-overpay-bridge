function setCORS(res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
}
export default async function handler(req, res){
  setCORS(res);
  if(req.method==='OPTIONS') return res.status(200).end();
  // Приняли — подтвердили. Логику валидации можно добавить позже.
  return res.status(200).json({ ok:true });
}
