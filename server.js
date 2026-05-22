const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY;
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET;

const AGENTS_DB      = '214a12376ab3802d86a0c166920a50c3';
const PRESTAS_DB     = '328a12376ab380f2926dd048912c453b';
const POINTAGES_DB   = 'b0b4acfd6dac4d06a41d66c658675d8c';
const SUPERVISEURS_DB = '223a12376ab3808cb7e7e7bb428cf2be';

function notionRequest(method, endpoint, body) {
  return new Promise(function(resolve, reject) {
    var data = body ? Buffer.from(JSON.stringify(body)) : null;
    var options = {
      hostname:'api.notion.com',port:443,path:'/v1/'+endpoint,method:method,
      headers:{'Authorization':'Bearer '+NOTION_TOKEN,'Notion-Version':'2022-06-28','Content-Type':'application/json'}
    };
    if (data) options.headers['Content-Length'] = data.length;
    var req = https.request(options, function(res) {
      var d=''; res.on('data',function(c){d+=c;}); res.on('end',function(){try{resolve(JSON.parse(d));}catch(e){reject(e);}});
    });
    req.on('error',reject);
    if (data) req.write(data);
    req.end();
  });
}

function formatId(id) {
  if (!id) return null;
  var clean = id.replace(/-/g,'');
  if (clean.length===32) return clean.slice(0,8)+'-'+clean.slice(8,12)+'-'+clean.slice(12,16)+'-'+clean.slice(16,20)+'-'+clean.slice(20);
  return id;
}

function uploadToCloudinary(base64Data) {
  return new Promise(function(resolve, reject) {
    var timestamp=Math.round(Date.now()/1000),folder='jet-guards-signatures';
    var signature=crypto.createHash('sha1').update('folder='+folder+'&timestamp='+timestamp+CLOUDINARY_API_SECRET).digest('hex');
    var boundary='----FB'+Math.random().toString(36).slice(2);
    var imageData=base64Data.replace(/^data:image\/\w+;base64,/,'');
    var body='--'+boundary+'\r\nContent-Disposition: form-data; name="file"\r\n\r\ndata:image/png;base64,'+imageData+'\r\n'+
      '--'+boundary+'\r\nContent-Disposition: form-data; name="api_key"\r\n\r\n'+CLOUDINARY_API_KEY+'\r\n'+
      '--'+boundary+'\r\nContent-Disposition: form-data; name="timestamp"\r\n\r\n'+timestamp+'\r\n'+
      '--'+boundary+'\r\nContent-Disposition: form-data; name="signature"\r\n\r\n'+signature+'\r\n'+
      '--'+boundary+'\r\nContent-Disposition: form-data; name="folder"\r\n\r\n'+folder+'\r\n'+
      '--'+boundary+'--\r\n';
    var bodyBuf=Buffer.from(body);
    var req=https.request({hostname:'api.cloudinary.com',port:443,path:'/v1_1/'+CLOUDINARY_CLOUD_NAME+'/image/upload',method:'POST',headers:{'Content-Type':'multipart/form-data; boundary='+boundary,'Content-Length':bodyBuf.length}},function(res){
      var d='';res.on('data',function(c){d+=c;});res.on('end',function(){try{var r=JSON.parse(d);if(r.secure_url)resolve(r.secure_url);else reject(new Error(d));}catch(e){reject(e);}});
    });
    req.on('error',reject);req.write(bodyBuf);req.end();
  });
}

// ── Calcul distance GPS ─────────────────────────────────────────────────────
function distMetres(lat1,lng1,lat2,lng2){var R=6371000,dLat=(lat2-lat1)*Math.PI/180,dLng=(lng2-lng1)*Math.PI/180,a=Math.sin(dLat/2)*Math.sin(dLat/2)+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)*Math.sin(dLng/2);return Math.round(R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a)));}

// ── Parse GPS string ─────────────────────────────────────────────────────────
function parseGPS(str){if(!str||str==='Non disponible')return null;var m=str.match(/([-\d.]+),\s*([-\d.]+)/);if(!m)return null;return{lat:parseFloat(m[1]),lng:parseFloat(m[2])};}

var server = http.createServer(function(req, res) {
  var parsed=url.parse(req.url),pathname=parsed.pathname;
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}

  // ── POST /api/superviseur/login ──────────────────────────────────────────
  if(req.method==='POST'&&pathname==='/api/superviseur/login'){
    var body='';req.on('data',function(c){body+=c;});req.on('end',function(){
      var d;try{d=JSON.parse(body);}catch(e){res.writeHead(400);res.end('Bad request');return;}
      notionRequest('POST','databases/'+SUPERVISEURS_DB+'/query',{page_size:50}).then(function(result){
        var found=null;
        (result.results||[]).forEach(function(p){
          var code=p.properties["Code d'accès Pointage"]&&p.properties["Code d'accès Pointage"].rich_text&&p.properties["Code d'accès Pointage"].rich_text[0]?p.properties["Code d'accès Pointage"].rich_text[0].plain_text:'';
          var nom=p.properties['Nom']&&p.properties['Nom'].title&&p.properties['Nom'].title[0]?p.properties['Nom'].title[0].plain_text:'';
          var actif=p.properties['Actif']&&p.properties['Actif'].checkbox;
          if(code&&code===d.code&&actif!==false)found=nom;
        });
        res.writeHead(200,{'Content-Type':'application/json'});
        res.end(JSON.stringify(found?{success:true,nom:found}:{success:false}));
      }).catch(function(){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({success:false}));});
    });
    return;
  }

  // ── GET /api/agents ─────────────────────────────────────────────────────
  if(req.method==='GET'&&pathname==='/api/agents'){
    var params=new URLSearchParams(parsed.query||''),siteId=params.get('site'),today=new Date().toISOString().split('T')[0];
    if(siteId){
      Promise.all([notionRequest('GET','pages/'+siteId,null),notionRequest('POST','databases/'+PRESTAS_DB+'/query',{filter:{and:[{property:'🏟️ Sites des missions',relation:{contains:siteId}},{property:'Période de prestation',date:{on_or_before:new Date().toISOString()}},{property:'Période de prestation',date:{on_or_after:today+'T00:00:00.000Z'}}]},page_size:20})]).then(function(results){
        var sp=results[0].properties||{};
        var siteGps=(sp['GPS Latitude']&&sp['GPS Latitude'].number&&sp['GPS Longitude']&&sp['GPS Longitude'].number)?{lat:sp['GPS Latitude'].number,lng:sp['GPS Longitude'].number,rayon:sp['Rayon autorisé (m)']&&sp['Rayon autorisé (m)'].number||500}:null;
        var prestas=(results[1].results||[]).filter(function(p){var d=p.properties['Période de prestation']&&p.properties['Période de prestation'].date;if(!d||!d.start)return false;var s=d.start.split('T')[0],e=d.end?d.end.split('T')[0]:s;return s<=today&&today<=e;});
        if(!prestas.length){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({agents:[],siteGps:siteGps,message:'Aucune prestation active'}));return;}
        var agentMap={};prestas.forEach(function(pr){var rel=pr.properties['Agents']&&pr.properties['Agents'].relation?pr.properties['Agents'].relation:[];var nom=pr.properties['Nom']&&pr.properties['Nom'].title&&pr.properties['Nom'].title[0]?pr.properties['Nom'].title[0].plain_text:'';rel.forEach(function(a){agentMap[a.id]={prestationId:pr.id,prestationNom:nom};});});
        var ids=Object.keys(agentMap);if(!ids.length){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({agents:[],siteGps:siteGps}));return;}
        var batches=[],i;for(i=0;i<ids.length;i+=10)batches.push(ids.slice(i,i+10));
        var all=[],done=0;
        batches.forEach(function(batch){Promise.all(batch.map(function(id){return notionRequest('GET','pages/'+id,null);})).then(function(pages){pages.forEach(function(p){if(!p||!p.properties)return;var nom=p.properties['Nom']&&p.properties['Nom'].title&&p.properties['Nom'].title[0]?p.properties['Nom'].title[0].plain_text:'';if(!nom)return;var pr=agentMap[p.id]||{};all.push({id:p.id,nom:nom,prestationId:pr.prestationId,prestationNom:pr.prestationNom});});done++;if(done===batches.length){all.sort(function(a,b){return a.nom.localeCompare(b.nom);});res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({agents:all,siteGps:siteGps}));}}).catch(function(){done++;if(done===batches.length){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({agents:all,siteGps:siteGps}));}});});
      }).catch(function(e){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message,agents:[]}));});
    } else {
      var all=[];function fetchPage(cur){var body={page_size:100};if(cur)body.start_cursor=cur;notionRequest('POST','databases/'+AGENTS_DB+'/query',body).then(function(result){(result.results||[]).forEach(function(p){var nom=p.properties['Nom']&&p.properties['Nom'].title&&p.properties['Nom'].title[0]?p.properties['Nom'].title[0].plain_text:'';if(nom)all.push({id:p.id,nom:nom});});if(result.has_more&&result.next_cursor){fetchPage(result.next_cursor);}else{all.sort(function(a,b){return a.nom.localeCompare(b.nom);});res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({agents:all,siteGps:null}));}}).catch(function(e){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message,agents:[]}));});}
      fetchPage(null);
    }
    return;
  }

  // ── GET /api/check ───────────────────────────────────────────────────────
  if(req.method==='GET'&&pathname==='/api/check'){
    var p2=new URLSearchParams(parsed.query||''),agentId=p2.get('agentId'),type=p2.get('type'),today2=new Date().toISOString().split('T')[0],typeLabel=type==='debut'?'Début de service':'Fin de service';
    notionRequest('POST','databases/'+POINTAGES_DB+'/query',{filter:{and:[{property:'Agent',relation:{contains:agentId}},{property:'Horodatage',date:{on_or_after:today2+'T00:00:00.000Z'}},{property:'Type',select:{equals:typeLabel}}]},page_size:1}).then(function(result){var found=result.results&&result.results.length>0;var heure=found?new Date(result.results[0].properties['Horodatage'].date.start).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}):null;res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({alreadyPointed:found,heure:heure}));}).catch(function(){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({alreadyPointed:false}));});
    return;
  }

  // ── GET /api/superviseur/prestas ─────────────────────────────────────────
  if(req.method==='GET'&&pathname==='/api/superviseur/prestas'){
    var p3=new URLSearchParams(parsed.query||''),date3=p3.get('date')||new Date().toISOString().split('T')[0];
    notionRequest('POST','databases/'+PRESTAS_DB+'/query',{filter:{and:[{property:'Période de prestation',date:{on_or_before:date3+'T23:59:59.000Z'}},{property:'Période de prestation',date:{on_or_after:date3+'T00:00:00.000Z'}}]},page_size:50}).then(function(result){
      var prestas=(result.results||[]).map(function(p){var props=p.properties;var nom=props['Nom']&&props['Nom'].title&&props['Nom'].title[0]?props['Nom'].title[0].plain_text:'';var sitesRel=props['🏟️ Sites des missions']&&props['🏟️ Sites des missions'].relation?props['🏟️ Sites des missions'].relation:[];var agentsRel=props['Agents']&&props['Agents'].relation?props['Agents'].relation:[];return{id:p.id,nom:nom,siteId:sitesRel[0]?sitesRel[0].id:null,site:'',agents:agentsRel.map(function(a){return{id:a.id,nom:''};})};}).filter(function(p){return p.nom;});
      var siteIds=[...new Set(prestas.map(function(p){return p.siteId;}).filter(Boolean))];
      var agentIds=[...new Set(prestas.flatMap(function(p){return p.agents.map(function(a){return a.id;})}))].slice(0,100);
      Promise.all([Promise.all(siteIds.map(function(id){return notionRequest('GET','pages/'+id,null);})),Promise.all(agentIds.map(function(id){return notionRequest('GET','pages/'+id,null);}))]).then(function(enriched){
        var siteMap={},agentMap={};
        enriched[0].forEach(function(s){if(s&&s.id)siteMap[s.id]=s.properties&&s.properties['Nom']&&s.properties['Nom'].title&&s.properties['Nom'].title[0]?s.properties['Nom'].title[0].plain_text:'';});
        enriched[1].forEach(function(a){if(a&&a.id)agentMap[a.id]=a.properties&&a.properties['Nom']&&a.properties['Nom'].title&&a.properties['Nom'].title[0]?a.properties['Nom'].title[0].plain_text:'';});
        prestas.forEach(function(p){p.site=siteMap[p.siteId]||'Site inconnu';p.agents=p.agents.map(function(a){return{id:a.id,nom:agentMap[a.id]||a.id};});});
        res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({prestas:prestas}));
      }).catch(function(){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({prestas:prestas}));});
    }).catch(function(e){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message,prestas:[]}));});
    return;
  }

  // ── GET /api/superviseur/pointages ───────────────────────────────────────
  if(req.method==='GET'&&pathname==='/api/superviseur/pointages'){
    var p4=new URLSearchParams(parsed.query||''),date4=p4.get('date'),dateStart=p4.get('dateStart'),dateEnd=p4.get('dateEnd');
    var afterDate=date4?date4+'T00:00:00.000Z':dateStart?dateStart+'T00:00:00.000Z':new Date().toISOString().split('T')[0]+'T00:00:00.000Z';
    var beforeDate=dateEnd?dateEnd+'T23:59:59.000Z':null;
    var filter=beforeDate?{and:[{property:'Horodatage',date:{on_or_after:afterDate}},{property:'Horodatage',date:{on_or_before:beforeDate}}]}:{property:'Horodatage',date:{on_or_after:afterDate}};
    notionRequest('POST','databases/'+POINTAGES_DB+'/query',{filter:filter,page_size:200}).then(function(result){
      // Pour chaque pointage, récupère les infos du site pour calculer la distance
      var pointages=(result.results||[]).map(function(p){var props=p.properties;var agentRel=props['Agent']&&props['Agent'].relation?props['Agent'].relation:[];var prestaRel=props['Prestation']&&props['Prestation'].relation?props['Prestation'].relation:[];var siteRel=props['Site']&&props['Site'].relation?props['Site'].relation:[];var nomTitle=props['Nom']&&props['Nom'].title&&props['Nom'].title[0]?props['Nom'].title[0].plain_text:'';var parts=nomTitle.split(' — ');var gpsStr=props['GPS']&&props['GPS'].rich_text&&props['GPS'].rich_text[0]?props['GPS'].rich_text[0].plain_text:'';return{id:p.id,agentId:agentRel[0]?agentRel[0].id:null,agentNom:parts[1]||'',prestationId:prestaRel[0]?prestaRel[0].id:null,siteId:siteRel[0]?siteRel[0].id:null,type:props['Type']&&props['Type'].select?props['Type'].select.name:'',horodatage:props['Horodatage']&&props['Horodatage'].date?props['Horodatage'].date.start:'',gps:gpsStr,horsSite:false,distance:null,siteName:''};});
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({pointages:pointages}));
    }).catch(function(e){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message,pointages:[]}));});
    return;
  }

  // ── GET /api/superviseur/upcoming ────────────────────────────────────────
  if(req.method==='GET'&&pathname==='/api/superviseur/upcoming'){
    var now=new Date(),days=[];
    for(var i=1;i<=15;i++){var d=new Date(now.getTime()+i*24*60*60*1000);days.push({date:d.toISOString().split('T')[0],label:d.toLocaleDateString('fr-FR',{weekday:'long',day:'2-digit',month:'long'}),jours:i,prestas:[]});}
    var startDate=days[0].date,endDate=days[days.length-1].date;
    notionRequest('POST','databases/'+PRESTAS_DB+'/query',{filter:{and:[{property:'Période de prestation',date:{on_or_after:startDate+'T00:00:00.000Z'}},{property:'Période de prestation',date:{on_or_before:endDate+'T23:59:59.000Z'}}]},page_size:100}).then(function(result){
      var siteIds=[...new Set((result.results||[]).map(function(p){var r=p.properties['🏟️ Sites des missions']&&p.properties['🏟️ Sites des missions'].relation;return r&&r[0]?r[0].id:null;}).filter(Boolean))];
      var agentIdsAll=[...new Set((result.results||[]).flatMap(function(p){var r=p.properties['Agents']&&p.properties['Agents'].relation;return r?r.map(function(a){return a.id;}):[]}))].slice(0,100);
      Promise.all([
        Promise.all(siteIds.map(function(id){return notionRequest('GET','pages/'+id,null);})),
        Promise.all(agentIdsAll.map(function(id){return notionRequest('GET','pages/'+id,null);}))
      ]).then(function(enriched){
        var siteMap={},agentMap={};
        enriched[0].forEach(function(s){if(s&&s.id)siteMap[s.id]=s.properties&&s.properties['Nom']&&s.properties['Nom'].title&&s.properties['Nom'].title[0]?s.properties['Nom'].title[0].plain_text:'';});
        enriched[1].forEach(function(a){if(a&&a.id)agentMap[a.id]=a.properties&&a.properties['Nom']&&a.properties['Nom'].title&&a.properties['Nom'].title[0]?a.properties['Nom'].title[0].plain_text:'';});
        (result.results||[]).forEach(function(p){
          var nom=p.properties['Nom']&&p.properties['Nom'].title&&p.properties['Nom'].title[0]?p.properties['Nom'].title[0].plain_text:'';
          var dateP=p.properties['Période de prestation']&&p.properties['Période de prestation'].date;if(!dateP||!dateP.start)return;
          var startP=dateP.start.split('T')[0],endP=dateP.end?dateP.end.split('T')[0]:startP;
          var siteRel=p.properties['🏟️ Sites des missions']&&p.properties['🏟️ Sites des missions'].relation;
          var siteId=siteRel&&siteRel[0]?siteRel[0].id:null;
          var agentsRel=p.properties['Agents']&&p.properties['Agents'].relation?p.properties['Agents'].relation:[];
          var agents=agentsRel.map(function(a){return{id:a.id,nom:agentMap[a.id]||a.id};});
          days.forEach(function(day){if(day.date>=startP&&day.date<=endP){day.prestas.push({id:p.id,nom:nom,site:siteMap[siteId]||'Site inconnu',siteId:siteId,agentCount:agents.length,agents:agents,jours:day.jours});}});
        });
        res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({days:days.filter(function(d){return d.prestas.length>0;})}));
      }).catch(function(){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({days:[]}));});
    }).catch(function(e){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message,days:[]}));});
    return;
  }

  // ── POST /api/pointage ───────────────────────────────────────────────────
  if(req.method==='POST'&&pathname==='/api/pointage'){
    var body='';req.on('data',function(c){body+=c;});req.on('end',function(){
      var d;try{d=JSON.parse(body);}catch(e){res.writeHead(400);res.end('Bad request');return;}
      var now=new Date(d.horodatage||new Date());
      function createPage(sigUrl){
        var heureFmt=now.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Paris'});
        var props={'Nom':{title:[{text:{content:d.nom}}]},'Type':{select:{name:d.type}},'Horodatage':{date:{start:now.toISOString()}},'Agent':{relation:[{id:formatId(d.agentId)}]},'GPS':{rich_text:[{text:{content:d.gps||'Non disponible'}}]},'Statut vacation':{select:{name:d.type==='Début de service'?'En poste':'Terminé'}}};
        if(d.type==='Début de service')props['Heure début']={rich_text:[{text:{content:heureFmt}}]};
        if(d.type==='Fin de service')props['Heure fin']={rich_text:[{text:{content:heureFmt}}]};
        var page={parent:{database_id:POINTAGES_DB},properties:props};
        if(d.prestationId)page.properties['Prestation']={relation:[{id:formatId(d.prestationId)}]};
        if(d.siteId)page.properties['Site']={relation:[{id:formatId(d.siteId)}]};
        if(sigUrl)page.properties['Signature']={files:[{name:'signature.png',type:'external',external:{url:sigUrl}}]};
        notionRequest('POST','pages',page).then(function(result){
          if(result.object==='error'){console.error('Notion error:',result.message);res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({success:false,error:result.message}));}
          else{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({success:true}));}
        }).catch(function(e){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({success:false,error:e.message}));});
      }
      if(d.signature&&CLOUDINARY_CLOUD_NAME){uploadToCloudinary(d.signature).then(function(u){createPage(u);}).catch(function(e){console.error('Cloudinary:',e.message);createPage(null);});}
      else{createPage(null);}
    });
    return;
  }

  // ── Fichiers statiques ───────────────────────────────────────────────────
  var filePath=pathname==='/'?'/index.html':pathname==='/superviseur'?'/superviseur.html':pathname;
  filePath=path.join(__dirname,filePath);
  var ext=path.extname(filePath);
  var mime={'.html':'text/html','.css':'text/css','.js':'application/javascript','.json':'application/json'};
  fs.readFile(filePath,function(err,content){if(err){res.writeHead(404);res.end('Not found');return;}res.writeHead(200,{'Content-Type':mime[ext]||'text/plain'});res.end(content);});
});

server.listen(PORT,function(){console.log('Jet Guards demarre sur le port '+PORT);});
