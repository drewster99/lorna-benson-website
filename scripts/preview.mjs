import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('dist');
const port=Number(process.env.PORT || 4318);
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.jpeg':'image/jpeg','.xml':'application/xml','.txt':'text/plain'};
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');let file=path.resolve(root,'.'+decodeURIComponent(url.pathname));
  if(!file.startsWith(root+path.sep)&&file!==root){res.writeHead(403);return res.end('Forbidden');}
  let status=200;
  try{if((await fs.stat(file)).isDirectory())file=path.join(file,'index.html');await fs.access(file);}catch{file=path.join(root,'404.html');status=404;}
  const bytes=await fs.readFile(file);res.writeHead(status,{'Content-Type':types[path.extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff'});res.end(bytes);
 }catch{res.writeHead(500);res.end('Preview error');}
});
server.listen(port,'127.0.0.1',()=>console.log(`Lorna preview ready: http://127.0.0.1:${port} (PID ${process.pid})`));
