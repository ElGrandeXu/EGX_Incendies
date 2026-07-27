const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {spawn} = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const LOCAL_APP = path.join(ROOT, "app");
const APP = fs.existsSync(path.join(LOCAL_APP, "index.html")) ? LOCAL_APP : ROOT;
const CHROME = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser"
].filter(Boolean).find(candidate=>fs.existsSync(candidate));
const ORIGIN = {lat:44.8378, lon:-0.5792};
const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), "egx-incendies-m2-"));
const results = [];
const consoleProblems = [];
const measurements = {};
const LEAFLET_ASSETS = {
  "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css":{
    type:"text/css; charset=utf-8",
    sha256:"p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
  },
  "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js":{
    type:"application/javascript; charset=utf-8",
    sha256:"20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo="
  }
};
const GOOGLE_FONTS_URL = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,400,0..1,0";
let browserAssets=null;

function assert(name, condition, detail = ""){
  results.push({name, ok:Boolean(condition), detail});
  if(!condition) throw new Error(`${name}${detail ? `: ${detail}` : ""}`);
}

async function loadBrowserAssets(){
  const assets={};
  for(const [url,metadata] of Object.entries(LEAFLET_ASSETS)){
    const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
    if(!response.ok) throw new Error(`Dépendance de test indisponible (${response.status}) : ${url}`);
    const body=Buffer.from(await response.arrayBuffer());
    const digest=crypto.createHash("sha256").update(body).digest("base64");
    if(digest!==metadata.sha256) throw new Error(`Intégrité Leaflet invalide : ${url}`);
    assets[url]={...metadata,body};
  }
  const fontStyles=await fetch(GOOGLE_FONTS_URL,{
    headers:{"User-Agent":"Mozilla/5.0 Chrome/126.0.0.0 Safari/537.36"},
    signal:AbortSignal.timeout(30000)
  });
  if(!fontStyles.ok) throw new Error(`Feuille Google Fonts indisponible (${fontStyles.status})`);
  const fontCss=Buffer.from(await fontStyles.arrayBuffer());
  assets[GOOGLE_FONTS_URL]={
    type:"text/css; charset=utf-8",
    body:fontCss
  };
  const fontUrls=[
    ...new Set(
      [...fontCss.toString("utf8").matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)]
        .map(match=>match[1])
    )
  ];
  await Promise.all(fontUrls.map(async url=>{
    const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
    if(!response.ok) throw new Error(`Police de test indisponible (${response.status}) : ${url}`);
    assets[url]={
      type:response.headers.get("content-type")||"font/ttf",
      body:Buffer.from(await response.arrayBuffer())
    };
  }));
  return assets;
}

function point(eastKm, northKm = 0){
  return {
    lat:ORIGIN.lat+northKm/111,
    lon:ORIGIN.lon+eastKm/(111*Math.cos(ORIGIN.lat*Math.PI/180))
  };
}

function destination(start,degrees,distanceKm){
  const rad=value=>value*Math.PI/180;
  const angular=distanceKm/6371;
  const bearing=rad(degrees);
  const lat1=rad(start.lat);
  const lon1=rad(start.lon);
  const lat2=Math.asin(
    Math.sin(lat1)*Math.cos(angular)+
    Math.cos(lat1)*Math.sin(angular)*Math.cos(bearing)
  );
  const lon2=lon1+Math.atan2(
    Math.sin(bearing)*Math.sin(angular)*Math.cos(lat1),
    Math.cos(angular)-Math.sin(lat1)*Math.sin(lat2)
  );
  return {lat:lat2*180/Math.PI,lon:((lon2*180/Math.PI+540)%360)-180};
}

function osm(id, name, place, position, type = "node", frenchName = null){
  const element={type,id,tags:{name,place}};
  if(frenchName) element.tags["name:fr"]=frenchName;
  if(type==="node"){
    element.lat=position.lat;
    element.lon=position.lon;
  }else{
    element.center={lat:position.lat,lon:position.lon};
  }
  return element;
}

function scenario(overrides = {}){
  return {
    location:{name:"Bordeaux",...point(10)},
    radius:250,
    mode:"points+hulls",
    theme:"light",
    viewport:{width:390,height:844,deviceScaleFactor:1,mobile:true},
    fireGroups:[ORIGIN],
    detectionsPerGroup:2,
    isolated:false,
    speeds:[10,10,10,10],
    directions:[270,270,270,270],
    missingHours:[],
    weatherDelayMs:0,
    weatherBatchError:false,
    weatherErrorCenters:[],
    firms:{mode:"success"},
    nominatim:{mode:"success"},
    overpass:{mode:"success",elements:[]},
    ...overrides
  };
}

function staticServer(){
  return http.createServer((req,res)=>{
    const pathname=new URL(req.url,"http://127.0.0.1").pathname;
    const relative=pathname==="/"?"index.html":pathname.slice(1);
    const target=path.resolve(APP,relative);
    if(!target.startsWith(APP) || !fs.existsSync(target) || !fs.statSync(target).isFile()){
      res.writeHead(404);res.end("Not found");return;
    }
    const types={".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"application/javascript; charset=utf-8"};
    res.writeHead(200,{"Content-Type":types[path.extname(target)]||"application/octet-stream","Cache-Control":"no-store"});
    fs.createReadStream(target).pipe(res);
  });
}

class Cdp {
  constructor(url){
    this.url=url;
    this.id=0;
    this.pending=new Map();
    this.listeners=new Map();
  }
  async open(){
    this.ws=new WebSocket(this.url);
    await new Promise((resolve,reject)=>{
      this.ws.addEventListener("open",resolve,{once:true});
      this.ws.addEventListener("error",reject,{once:true});
    });
    this.ws.addEventListener("message",event=>{
      const message=JSON.parse(event.data);
      if(message.id){
        const pending=this.pending.get(message.id);
        if(!pending) return;
        this.pending.delete(message.id);
        if(message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      for(const listener of this.listeners.get(message.method)||[]) listener(message.params);
    });
  }
  send(method,params={}){
    const id=++this.id;
    return new Promise((resolve,reject)=>{
      this.pending.set(id,{resolve,reject});
      this.ws.send(JSON.stringify({id,method,params}));
    });
  }
  on(method,listener){
    if(!this.listeners.has(method)) this.listeners.set(method,[]);
    this.listeners.get(method).push(listener);
  }
  close(){this.ws.close()}
}

async function waitForFile(file,timeout=10000){
  const start=Date.now();
  while(Date.now()-start<timeout){
    if(fs.existsSync(file)) return;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error(`Fichier absent : ${file}`);
}

async function waitFor(expression,cdp,timeout=10000){
  const start=Date.now();
  while(Date.now()-start<timeout){
    const result=await evaluate(expression,cdp);
    if(result) return result;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error(`Délai dépassé : ${expression}`);
}

async function evaluate(expression,cdp){
  const response=await cdp.send("Runtime.evaluate",{
    expression,
    awaitPromise:true,
    returnByValue:true
  });
  if(response.exceptionDetails){
    throw new Error(response.exceptionDetails.exception?.description||response.exceptionDetails.text);
  }
  return response.result.value;
}

function initScript(config){
  return `(()=>{
    const scenario=${JSON.stringify(config)};
    localStorage.clear();
    const savedSettings={
      radius:scenario.radius,
      hours:48,
      mode:scenario.mode,
      location:scenario.location
    };
    if(typeof scenario.smokeVisible==="boolean"){
      savedSettings.smokeVisible=scenario.smokeVisible;
    }
    localStorage.setItem("egx_incendies_settings",JSON.stringify(savedSettings));
    localStorage.setItem("egx_incendies_theme",scenario.theme);
    if(!scenario.noKey) localStorage.setItem("egx_incendies_firms_key","TEST_KEY_NOT_REAL");
    window.__egxCounts={
      firms:0,
      firmsAborts:0,
      weather:0,
      weatherActive:0,
      weatherMaxActive:0,
      weatherAborts:0,
      overpass:0,
      overpassAborts:0,
      nominatim:0,
      nominatimTimes:[],
      share:0
    };
    try{
      Object.defineProperty(navigator,"share",{configurable:true,value:async()=>{window.__egxCounts.share++}});
    }catch{}
    const nativeFetch=window.fetch.bind(window);
    const response=(body,status=200,type="application/json")=>
      Promise.resolve(new Response(body,{status,headers:{"Content-Type":type}}));
    const csv=()=>{
      const rows=["latitude,longitude,acq_date,acq_time,confidence,frp"];
      let index=0;
      for(const center of scenario.fireGroups){
        const count=scenario.isolated?1:scenario.detectionsPerGroup;
        for(let pointIndex=0;pointIndex<count;pointIndex++){
          const angle=count===1?0:pointIndex/count*Math.PI*2;
          const deltaLat=count===1?0:Math.sin(angle)*0.006;
          const deltaLon=count===1?0:Math.cos(angle)*0.006;
          const date=new Date(Date.now()-(60+index)*60000);
          rows.push([
            (center.lat+deltaLat).toFixed(5),
            (center.lon+deltaLon).toFixed(5),
            date.toISOString().slice(0,10),
            date.toISOString().slice(11,16).replace(":",""),
            "high",
            String(20+index)
          ].join(","));
          index++;
        }
      }
      return rows.join("\\n");
    };
    const weather=()=>{
      const start=Math.floor(Date.now()/1000);
      const times=Array.from({length:13},(_,i)=>start+i*3600);
      const speeds=Array.from({length:13},(_,i)=>{
        if(scenario.missingHours.includes(i)) return null;
        if(i<3) return scenario.speeds[0];
        if(i<6) return scenario.speeds[1];
        return i<12?scenario.speeds[2]:scenario.speeds[3];
      });
      const directions=Array.from({length:13},(_,i)=>{
        if(scenario.missingHours.includes(i)) return null;
        if(i<3) return scenario.directions[0];
        if(i<6) return scenario.directions[1];
        return i<12?scenario.directions[2]:scenario.directions[3];
      });
      return {
        utc_offset_seconds:0,
        current:{
          time:times[0],
          wind_speed_10m:speeds[0],
          wind_direction_10m:directions[0],
          wind_gusts_10m:(speeds[0]??0)+5
        },
        hourly:{
          time:times,
          wind_speed_10m:speeds,
          wind_direction_10m:directions,
          wind_gusts_10m:speeds.map(value=>value===null?null:value+5)
        }
      };
    };
    const overpassReply=(entry,options)=>{
      if(entry.mode==="network") return Promise.reject(new TypeError("network"));
      if(entry.mode==="timeout"){
        return new Promise((resolve,reject)=>{
          options.signal?.addEventListener("abort",()=>{
            window.__egxCounts.overpassAborts++;
            reject(options.signal.reason||new DOMException("Aborted","AbortError"));
          },{once:true});
        });
      }
      if(entry.mode==="429") return response("{}",429);
      if(entry.mode==="invalid") return response("{invalid");
      const body=JSON.stringify({version:.6,elements:entry.elements||[]});
      if(!entry.delay) return response(body);
      return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>resolve(new Response(body,{status:200,headers:{"Content-Type":"application/json"}})),entry.delay);
        options.signal?.addEventListener("abort",()=>{
          clearTimeout(timer);
          window.__egxCounts.overpassAborts++;
          reject(options.signal.reason||new DOMException("Aborted","AbortError"));
        },{once:true});
      });
    };
    window.fetch=(input,options={})=>{
      const url=String(input?.url||input);
      if(url.includes("firms.modaps.eosdis.nasa.gov")){
        const call=window.__egxCounts.firms++;
        const refreshIndex=Math.floor(call/4);
        const entry=scenario.firms.sequence?.[refreshIndex]||scenario.firms;
        const failedSource=(entry.failSources||[]).some(source=>url.includes(\`/\${source}/\`));
        if(entry.mode==="error" || failedSource){
          return response("indisponible",entry.status||503,"text/plain");
        }
        if(entry.mode==="invalid") return response("format,inattendu",200,"text/csv");
        if(entry.mode==="timeout"){
          return new Promise((resolve,reject)=>{
            options.signal?.addEventListener("abort",()=>{
              window.__egxCounts.firmsAborts++;
              reject(options.signal.reason||new DOMException("Aborted","AbortError"));
            },{once:true});
          });
        }
        if(!entry.delay) return response(csv(),200,"text/csv");
        return new Promise((resolve,reject)=>{
          const timer=setTimeout(()=>resolve(new Response(csv(),{
            status:200,
            headers:{"Content-Type":"text/csv"}
          })),entry.delay);
          options.signal?.addEventListener("abort",()=>{
            clearTimeout(timer);
            window.__egxCounts.firmsAborts++;
            reject(options.signal.reason||new DOMException("Aborted","AbortError"));
          },{once:true});
        });
      }
      if(url.includes("api.open-meteo.com")){
        window.__egxCounts.weather++;
        const weatherUrl=new URL(url);
        const latitudes=weatherUrl.searchParams.get("latitude").split(",").map(Number);
        const longitudes=weatherUrl.searchParams.get("longitude").split(",").map(Number);
        const multiple=latitudes.length>1;
        const targetedError=(scenario.weatherErrorCenters||[]).some(center=>
          latitudes.some((latitude,index)=>
            Math.abs(latitude-center.lat)<.01 &&
            Math.abs(longitudes[index]-center.lon)<.01
          )
        );
        if(scenario.weatherError || targetedError || (multiple&&scenario.weatherBatchError)){
          return response("{}",503);
        }
        const weatherBody=()=>JSON.stringify(
          multiple?latitudes.map(()=>weather()):weather()
        );
        if(!scenario.weatherDelayMs) return response(weatherBody());
        window.__egxCounts.weatherActive++;
        window.__egxCounts.weatherMaxActive=Math.max(
          window.__egxCounts.weatherMaxActive,
          window.__egxCounts.weatherActive
        );
        return new Promise((resolve,reject)=>{
          let settled=false;
          const finish=()=>{
            if(settled) return;
            settled=true;
            window.__egxCounts.weatherActive--;
          };
          const timer=setTimeout(()=>{
            finish();
            resolve(new Response(weatherBody(),{
              status:200,
              headers:{"Content-Type":"application/json"}
            }));
          },scenario.weatherDelayMs);
          options.signal?.addEventListener("abort",()=>{
            clearTimeout(timer);
            finish();
            window.__egxCounts.weatherAborts++;
            reject(options.signal.reason||new DOMException("Aborted","AbortError"));
          },{once:true});
        });
      }
      if(url.includes("/api/interpreter")){
        const count=window.__egxCounts.overpass++;
        const entry=scenario.overpass.sequence?.[count]||scenario.overpass;
        return overpassReply(entry,options);
      }
      if(url.includes("nominatim.openstreetmap.org")){
        const call=window.__egxCounts.nominatim++;
        window.__egxCounts.nominatimTimes.push(Date.now());
        const entry=scenario.nominatim.sequence?.[call]||scenario.nominatim;
        const cityResults=entry.results||[{
          name:"Lyon",
          display_name:"Lyon, France",
          lat:"45.7578",
          lon:"4.8320",
          address:{city:"Lyon"}
        }];
        if(entry.mode==="error") return response("{}",503);
        if(!entry.delay) return response(JSON.stringify(cityResults));
        return new Promise((resolve,reject)=>{
          const timer=setTimeout(()=>resolve(new Response(JSON.stringify(cityResults),{
            status:200,
            headers:{"Content-Type":"application/json"}
          })),entry.delay);
          if(!entry.ignoreAbort){
            options.signal?.addEventListener("abort",()=>{
              clearTimeout(timer);
              reject(options.signal.reason||new DOMException("Aborted","AbortError"));
            },{once:true});
          }
        });
      }
      return nativeFetch(input,options);
    };
  })();`;
}

async function openPage(baseUrl,port,config){
  const target=await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:"PUT"})).json();
  const cdp=new Cdp(target.webSocketDebuggerUrl);
  await cdp.open();
  await Promise.all([
    cdp.send("Page.enable"),
    cdp.send("Runtime.enable"),
    cdp.send("Log.enable"),
    cdp.send("Fetch.enable",{patterns:[
      ...Object.keys(LEAFLET_ASSETS).map(urlPattern=>({urlPattern})),
      {urlPattern:"https://fonts.googleapis.com/*"},
      {urlPattern:"https://fonts.gstatic.com/*"}
    ]})
  ]);
  cdp.on("Fetch.requestPaused",params=>{
    const asset=browserAssets?.[params.request.url] ||
      (params.request.url.startsWith("https://fonts.googleapis.com/")
        ?browserAssets?.[GOOGLE_FONTS_URL]
        :null);
    if(!asset){
      cdp.send("Fetch.continueRequest",{requestId:params.requestId})
        .catch(error=>consoleProblems.push(`Ressource externe : ${error.message}`));
      return;
    }
    cdp.send("Fetch.fulfillRequest",{
      requestId:params.requestId,
      responseCode:200,
      responseHeaders:[
        {name:"Content-Type",value:asset?.type||"text/css; charset=utf-8"},
        {name:"Access-Control-Allow-Origin",value:"*"},
        {name:"Cache-Control",value:"public, max-age=3600"}
      ],
      body:asset.body.toString("base64")
    }).catch(error=>consoleProblems.push(`Ressource contrôlée : ${error.message}`));
  });
  cdp.on("Runtime.exceptionThrown",params=>{
    consoleProblems.push(params.exceptionDetails.exception?.description||params.exceptionDetails.text);
  });
  cdp.on("Log.entryAdded",params=>{
    if(["error","warning"].includes(params.entry.level) && !/favicon|ERR_BLOCKED_BY_CLIENT/.test(params.entry.text)){
      consoleProblems.push(params.entry.text);
    }
  });
  await cdp.send("Emulation.setDeviceMetricsOverride",config.viewport);
  await cdp.send("Page.addScriptToEvaluateOnNewDocument",{source:initScript(config)});
  await cdp.send("Page.navigate",{url:baseUrl});
  await waitFor("document.readyState!=='loading' && Boolean(window.L)",cdp,30000);
  await evaluate("document.fonts.ready.then(()=>true)",cdp);
  return {cdp,target};
}

async function closePage(page,port){
  page.cdp.close();
  await fetch(`http://127.0.0.1:${port}/json/close/${page.target.id}`).catch(()=>{});
}

async function openFirstDetail(cdp){
  await waitFor("document.querySelectorAll('.feed-item').length>0",cdp,10000);
  await evaluate(`(()=>{
    const item=document.querySelector(".feed-item");
    if(item.offsetParent===null) document.getElementById("openDetections").click();
    item.focus();
    item.click();
  })()`,cdp);
  await waitFor("document.getElementById('detailView').classList.contains('open')",cdp);
}

async function localityState(cdp,timeout=10000){
  await waitFor(`!document.getElementById("detailLocalitiesMessage").textContent.includes("Recherche")`,cdp,timeout);
  return evaluate(`({
    watched:document.getElementById("detailWatchedCityStatus").textContent,
    message:document.getElementById("detailLocalitiesMessage").textContent,
    names:[...document.querySelectorAll("#detailLocalityGroups li")].map(node=>node.textContent.trim()),
    headings:[...document.querySelectorAll(".locality-horizon h5")].map(node=>node.textContent.trim()),
    markers:document.querySelectorAll(".locality-map-marker").length,
    labels:[...document.querySelectorAll(".locality-map-marker")].map(node=>node.getAttribute("title")),
    feedItems:document.querySelectorAll(".feed-item").length,
    technicalElements:document.querySelectorAll("#detailDetectionCount,#detailDetections,.detail-detections,.detection-card").length,
    limit:document.getElementById("detailLocalitiesLimit").textContent,
    smoke:document.getElementById("detailSmokeSummary").textContent,
    smokeTitle:document.getElementById("detailSmokeTitle").textContent,
    smokeMeta:document.getElementById("detailSmokeMeta").textContent,
    smokeArrows:document.querySelectorAll("#detailMap .smoke-direction-arrow").length,
    smokeTimeLabels:document.querySelectorAll("#detailMap .smoke-horizon-label").length
  })`,cdp);
}

async function mainSmokeState(cdp){
  return evaluate(`({
    corridors:document.querySelectorAll(".main-smoke-corridor:not(.main-smoke-weak)").length,
    weak:document.querySelectorAll(".main-smoke-weak").length,
    arrows:document.querySelectorAll(".main-smoke-direction-arrow").length,
    arrowSymbols:[...document.querySelectorAll(".main-smoke-direction-arrow")].map(node=>node.textContent.trim()),
    timeLabels:document.querySelectorAll(".main-smoke-horizon-label").length,
    directions:document.querySelectorAll(".main-smoke-direction-line").length,
    toggleChecked:document.getElementById("smokeToggle").checked,
    weather:window.__egxCounts.weather,
    weatherMaxActive:window.__egxCounts.weatherMaxActive,
    weatherAborts:window.__egxCounts.weatherAborts
  })`,cdp);
}

async function run(){
  if(!CHROME){
    throw new Error("Chrome/Chromium introuvable. Définissez CHROME_PATH.");
  }
  browserAssets=await loadBrowserAssets();
  const server=staticServer();
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const baseUrl=`http://127.0.0.1:${server.address().port}/`;
  for(const resource of ["","style.css?v=8","app.js?v=8"]){
    const response=await fetch(`${baseUrl}${resource}`);
    assert(`HTTP 200 ${resource||"/"}`,response.status===200,String(response.status));
  }
  const html=fs.readFileSync(path.join(APP,"index.html"),"utf8");
  const source=fs.readFileSync(path.join(APP,"app.js"),"utf8");
  const ids=[...html.matchAll(/\sid="([^"]+)"/g)].map(match=>match[1]);
  const uniqueIds=new Set(ids);
  const bindings=[...source.matchAll(/\$\("([^"]+)"\)/g)].map(match=>match[1]);
  assert("aucun ID HTML dupliqué",uniqueIds.size===ids.length,String(ids.length-uniqueIds.size));
  assert(
    "aucun binding DOM orphelin",
    bindings.every(id=>uniqueIds.has(id)),
    bindings.filter(id=>!uniqueIds.has(id)).join("|")
  );
  assert(
    "trois clés localStorage historiques inchangées",
    [
      "egx_incendies_firms_key",
      "egx_incendies_settings",
      "egx_incendies_theme"
    ].every(key=>source.includes(`"${key}"`))
  );
  assert("CSP statique présente",html.includes('http-equiv="Content-Security-Policy"'));
  assert(
    "intégrité Leaflet CSS et JavaScript",
    html.includes("sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=") &&
    html.includes("sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=")
  );
  assert(
    "aucune clé FIRMS plausible dans les fichiers publics",
    !/[A-Za-z0-9]{32}/.test(`${html}\n${source}`)
  );
  assert(
    "actualisation automatique 10 min conservée",
    /setInterval\([\s\S]*10\*60\*1000/.test(source)
  );
  assert(
    "libellé automatique retiré de l’en-tête",
    !html.includes("Auto : 10 min") && !html.includes("auto-label")
  );
  assert(
    "repères temporels retirés des trajectoires visibles",
    !source.includes('className:"smoke-horizon-label') &&
      !html.includes("Direction possible des fumées · 12 h") &&
      !html.includes("Analyse aux échéances 3 h, 6 h et 12 h")
  );
  assert(
    "contrôle natif des trajectoires présent sur la carte",
    html.includes('id="smokeToggle"') &&
      html.includes('type="checkbox"') &&
      html.includes("Trajectoires de fumée")
  );
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),"egx-chrome-m2-"));
  const chrome=spawn(CHROME,[
    "--headless=new",
    "--no-sandbox",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--hide-scrollbars",
    "about:blank"
  ],{stdio:"ignore",windowsHide:true});

  try{
    const portFile=path.join(profile,"DevToolsActivePort");
    await waitForFile(portFile);
    const port=Number(fs.readFileSync(portFile,"utf8").split(/\r?\n/)[0]);

    const dense=[];
    dense.push(
      osm(1,"Centre exact","village",point(1)),
      osm(9,"Hameau test","hamlet",point(2)),
      osm(2,"Près de la limite","hamlet",point(20,4)),
      osm(3,"Hors du corridor","town",point(20,8)),
      osm(10,"Ville test","city",point(34)),
      osm(11,"Bourg test","town",point(35)),
      osm(4,"Doublon","town",point(42)),
      osm(5,"Doublon","town",point(42.8),"relation"),
      osm(6,"Très longue localité accentuée — Saint-Étienne-des-Grands-Bois","village",point(82)),
      osm(7,"東京","city",point(78)),
      osm(8,"قرية الاختبار","hamlet",point(95))
    );
    let id=20;
    for(const [start,end] of [[4,28],[34,58],[65,115]]){
      for(let distance=start;distance<=end;distance+=4){
        dense.push(osm(id++,`Lieu ${distance}`,["city","town","village","hamlet"][id%4],point(distance,1+(id%2))));
      }
    }

    let page=await openPage(baseUrl,port,scenario({
      overpass:{mode:"success",elements:dense}
    }));
    assert(
      "actualisation de la carte explicite et plus compacte",
      await evaluate(`(()=>{
        const button=document.getElementById("refreshTop");
        const style=getComputedStyle(button);
        const rect=button.getBoundingClientRect();
        return button.textContent.includes("Actualiser") &&
          button.getAttribute("aria-label")==="Actualiser la carte" &&
          rect.height<=40 &&
          rect.width<104 &&
          style.backgroundColor!=="rgba(0, 0, 0, 0)";
      })()`,page.cdp)
    );
    await openFirstDetail(page.cdp);
    assert(
      "clé NASA existante conservée",
      await evaluate("localStorage.getItem('egx_incendies_firms_key')==='TEST_KEY_NOT_REAL'",page.cdp)
    );
    assert(
      "réglages historiques restaurés",
      await evaluate(`(()=>{
        const saved=JSON.parse(localStorage.getItem("egx_incendies_settings"));
        return saved.radius===250 &&
          saved.hours===48 &&
          saved.mode==="points+hulls" &&
          !Object.hasOwn(saved,"smokeVisible") &&
          document.getElementById("smokeToggle").checked;
      })()`,page.cdp)
    );
    assert(
      "ancienneté de la détection la plus proche visible",
      await evaluate("document.getElementById('nearestAge').textContent.trim().length>1",page.cdp)
    );
    assert(
      "attribution Nominatim visible",
      await evaluate("document.querySelector('.city-source').textContent.includes('OpenStreetMap')",page.cdp)
    );
    let state=await localityState(page.cdp);
    assert("ville surveillée au début du tracé",state.watched.includes("début du tracé"),state.watched);
    assert("liste dense limitée à neuf",state.names.length===9,String(state.names.length));
    assert("trois localités maximum par partie du tracé",state.headings.length===3 && state.names.length===9,state.headings.join("|"));
    assert(
      "détail sans promesse temporelle et avec trois flèches",
      state.smokeArrows===3 &&
        state.smokeTimeLabels===0 &&
        !/(?:3|6|12) h/.test(`${state.smokeTitle} ${state.smokeMeta} ${state.headings.join(" ")}`),
      JSON.stringify(state)
    );
    assert("priorité ville surveillée",state.names[0]==="Bordeaux",state.names.join("|"));
    assert("objet hors corridor exclu",!state.names.includes("Hors du corridor"),state.names.join("|"));
    assert("doublon OSM fusionné",state.names.filter(name=>name==="Doublon").length<=1,state.names.join("|"));
    assert("catégories city town village hamlet",["東京","Bourg test","Centre exact","Hameau test"].every(name=>state.names.includes(name)),state.names.join("|"));
    assert("noms longs accentués et non latins",["Très longue localité accentuée — Saint-Étienne-des-Grands-Bois","東京","قرية الاختبار"].every(name=>state.names.includes(name)),state.names.join("|"));
    assert("marqueurs limités à la liste",state.markers===state.names.length,`${state.markers}/${state.names.length}`);
    assert("noms carte identiques à la liste",state.labels.every(name=>state.names.includes(name)),state.labels.join("|"));
    assert("données FIRMS restent actives",state.feedItems===1,String(state.feedItems));
    assert("liste technique du détail supprimée",state.technicalElements===0,String(state.technicalElements));
    assert("corridor stable",state.smoke.includes("assez stable"),state.smoke);
    assert("attribution OSM visible",await evaluate("document.querySelector('.localities-source').innerText.includes('OpenStreetMap')",page.cdp));

    const mobileShot=path.join(artifacts,"mobile-light.png");
    await new Promise(resolve=>setTimeout(resolve,250));
    const mobileCapture=await page.cdp.send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
    fs.writeFileSync(mobileShot,Buffer.from(mobileCapture.data,"base64"));
    assert("capture mobile 390×844",fs.statSync(mobileShot).size>10000,String(fs.statSync(mobileShot).size));

    await evaluate("document.getElementById('shareAlert').click()",page.cdp);
    assert("partage",await waitFor("window.__egxCounts.share===1",page.cdp));
    assert("itinéraire",await evaluate("document.getElementById('directionsLink').href.includes('google.com/maps/dir')",page.cdp));
    await evaluate("document.getElementById('directionsLink').focus();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true}))",page.cdp);
    assert("piège de focus",await evaluate("document.activeElement===document.getElementById('closeDetail')",page.cdp));
    await evaluate("document.getElementById('closeDetail').click()",page.cdp);
    assert("fermeture par bouton",await waitFor("!document.getElementById('detailView').classList.contains('open')",page.cdp));
    assert("retour du focus",await waitFor("document.activeElement?.classList.contains('feed-item')",page.cdp));
    await openFirstDetail(page.cdp);
    await evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))",page.cdp);
    assert("fermeture avec Échap",await waitFor("!document.getElementById('detailView').classList.contains('open')",page.cdp));
    assert("retour du focus après Échap",await waitFor("document.activeElement?.classList.contains('feed-item')",page.cdp));
    const beforeRefresh=await evaluate("window.__egxCounts.firms",page.cdp);
    await evaluate("document.getElementById('refreshTop').click()",page.cdp);
    await waitFor(`window.__egxCounts.firms>${beforeRefresh}`,page.cdp);
    assert("actualisation FIRMS",true);
    await evaluate("document.querySelector('[data-nav=settings]').click()",page.cdp);
    await evaluate("document.getElementById('cityQuery').value='Lyon';document.getElementById('searchCity').click()",page.cdp);
    await waitFor("!document.getElementById('cityResults').hidden",page.cdp);
    assert("recherche Nominatim préservée",await evaluate("document.getElementById('cityResults').textContent.includes('Lyon')",page.cdp));
    await evaluate("document.getElementById('searchCity').click()",page.cdp);
    assert(
      "recherche Nominatim répétée servie par le cache",
      await evaluate("window.__egxCounts.nominatim===1",page.cdp)
    );
    await closePage(page,port);

    page=await openPage(baseUrl,port,scenario({
      detectionsPerGroup:15,
      viewport:{width:390,height:844,deviceScaleFactor:1,mobile:true}
    }));
    await waitFor("document.querySelectorAll('.main-smoke-direction-arrow').length===3",page.cdp);
    let mainState=await mainSmokeState(page.cdp);
    assert("carte principale avec trois segments",mainState.corridors===3,String(mainState.corridors));
    assert(
      "carte principale sans repère horaire",
      mainState.timeLabels===0,
      String(mainState.timeLabels)
    );
    assert(
      "carte principale avec une flèche par segment",
      mainState.arrows===3 && mainState.arrowSymbols.every(symbol=>symbol==="↑"),
      JSON.stringify(mainState)
    );
    assert(
      "contrôle des trajectoires visible et accessible sur mobile",
      await evaluate(`(()=>{
        const control=document.querySelector(".smoke-layer-control");
        const input=document.getElementById("smokeToggle");
        const rect=control.getBoundingClientRect();
        input.focus();
        return input.type==="checkbox" &&
          input.checked &&
          document.activeElement===input &&
          control.textContent.includes("Trajectoires de fumée") &&
          rect.width>150 &&
          rect.right<=innerWidth-60 &&
          rect.bottom<=document.querySelector(".map-summary").getBoundingClientRect().top;
      })()`,page.cdp)
    );
    const weatherBeforeSmokeToggle=mainState.weather;
    await evaluate("document.getElementById('smokeToggle').click()",page.cdp);
    await waitFor("document.querySelectorAll('.main-smoke-corridor,.main-smoke-direction-arrow,.main-smoke-direction-line').length===0",page.cdp);
    assert(
      "désactivation masque seulement les trajectoires",
      await evaluate(`(()=>{
        const saved=JSON.parse(localStorage.getItem("egx_incendies_settings"));
        return !document.getElementById("smokeToggle").checked &&
          saved.smokeVisible===false &&
          document.querySelectorAll(".feed-item").length===1 &&
          window.__egxCounts.weather===${weatherBeforeSmokeToggle};
      })()`,page.cdp)
    );
    await evaluate("document.getElementById('smokeToggle').click()",page.cdp);
    await waitFor("document.querySelectorAll('.main-smoke-direction-arrow').length===3",page.cdp);
    assert(
      "réactivation restaure les trajectoires sans appel API",
      await evaluate(`(()=>{
        const saved=JSON.parse(localStorage.getItem("egx_incendies_settings"));
        return document.getElementById("smokeToggle").checked &&
          saved.smokeVisible===true &&
          window.__egxCounts.weather===${weatherBeforeSmokeToggle};
      })()`,page.cdp)
    );
    assert("météo groupée au seul foyer significatif",mainState.weather===2,String(mainState.weather));
    assert(
      "corridor sous les points et au-dessus du fond",
      await evaluate(`(()=>{
        const smoke=Number(getComputedStyle(document.querySelector(".leaflet-pane[style*='z-index: 350']")).zIndex);
        const overlay=Number(getComputedStyle(document.querySelector(".leaflet-overlay-pane")).zIndex);
        const tiles=Number(getComputedStyle(document.querySelector(".leaflet-tile-pane")).zIndex);
        return tiles<smoke && smoke<overlay;
      })()`,page.cdp)
    );

    await evaluate(`(()=>{
      const mapRect=document.getElementById("map").getBoundingClientRect();
      const zoom=8;
      const center=${JSON.stringify({lat:point(10).lat,lon:point(10).lon})};
      const group=${JSON.stringify(ORIGIN)};
      const world=256*2**zoom;
      const x=mapRect.left+mapRect.width/2+(group.lon-center.lon)*world/360;
      const y=mapRect.top+mapRect.height/2;
      document.elementFromPoint(x,y)?.dispatchEvent(new MouseEvent("click",{
        bubbles:true,clientX:x,clientY:y
      }));
    })()`,page.cdp);
    assert(
      "clic foyer principal ouvre le détail",
      await waitFor("document.getElementById('detailView').classList.contains('open')",page.cdp)
    );
    await evaluate("document.getElementById('closeDetail').click()",page.cdp);

    for(const selector of [
      ".main-smoke-corridor",
      ".main-smoke-direction-arrow"
    ]){
      await evaluate(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new MouseEvent("click",{bubbles:true}))`,page.cdp);
      assert(
        `clic ${selector} ouvre le détail`,
        await waitFor("document.getElementById('detailView').classList.contains('open')",page.cdp)
      );
      await evaluate("document.getElementById('closeDetail').click()",page.cdp);
    }
    assert(
      "détail réutilise la météo de la carte",
      await evaluate("window.__egxCounts.weather===2",page.cdp)
    );

    for(const mode of ["points","hulls","points+hulls"]){
      await evaluate(`(()=>{
        const select=document.getElementById("displayMode");
        select.value=${JSON.stringify(mode)};
        select.dispatchEvent(new Event("change",{bubbles:true}));
      })()`,page.cdp);
      assert(
        `trajectoire indépendante du mode ${mode}`,
        await evaluate("document.querySelectorAll('.main-smoke-direction-arrow').length===3",page.cdp)
      );
    }

    const weatherBeforeMove=await evaluate("window.__egxCounts.weather",page.cdp);
    await evaluate("document.getElementById('zoomIn').click();document.getElementById('homeBtn').click()",page.cdp);
    await new Promise(resolve=>setTimeout(resolve,700));
    assert(
      "zoom et déplacement sans requête météo",
      await evaluate(`window.__egxCounts.weather===${weatherBeforeMove}`,page.cdp)
    );
    const mainMobileShot=path.join(artifacts,"main-smoke-mobile-light.png");
    const mainMobileCapture=await page.cdp.send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
    fs.writeFileSync(mainMobileShot,Buffer.from(mainMobileCapture.data,"base64"));
    assert("capture trajectoire mobile claire",fs.statSync(mainMobileShot).size>10000,String(fs.statSync(mainMobileShot).size));

    let firmsBefore=await evaluate("window.__egxCounts.firms",page.cdp);
    await evaluate(`(()=>{
      const radius=document.getElementById("radius");
      radius.value="200";
      radius.dispatchEvent(new Event("change",{bubbles:true}));
    })()`,page.cdp);
    await waitFor(`window.__egxCounts.firms>${firmsBefore}`,page.cdp);
    await waitFor("document.querySelectorAll('.main-smoke-direction-arrow').length===3",page.cdp);
    assert("changement de rayon actualise la trajectoire",true);

    firmsBefore=await evaluate("window.__egxCounts.firms",page.cdp);
    await evaluate("document.querySelector('[data-hours=\"24\"]').click()",page.cdp);
    await waitFor(`window.__egxCounts.firms>${firmsBefore}`,page.cdp);
    await waitFor("document.querySelectorAll('.main-smoke-direction-arrow').length===3",page.cdp);
    assert("changement de période actualise la trajectoire",true);

    await evaluate(`(()=>{
      document.querySelector('[data-nav="settings"]').click();
      document.getElementById("cityQuery").value="Lyon";
      document.getElementById("searchCity").click();
    })()`,page.cdp);
    await waitFor("!document.getElementById('cityResults').hidden",page.cdp);
    await evaluate("document.getElementById('applyCity').click()",page.cdp);
    assert(
      "utiliser cette ville ouvre automatiquement la carte",
      await waitFor(`document.body.dataset.view==="map" &&
        document.getElementById("panelOverview").classList.contains("active")`,page.cdp)
    );
    await waitFor("document.querySelectorAll('.feed-item').length===0",page.cdp);
    assert(
      "changement de ville retire les trajectoires invalides",
      await evaluate("document.querySelectorAll('.main-smoke-direction-arrow,.main-smoke-corridor').length===0",page.cdp)
    );
    await closePage(page,port);

    page=await openPage(baseUrl,port,scenario({
      detectionsPerGroup:15,
      speeds:[1,1,1,1]
    }));
    await waitFor("document.querySelectorAll('.main-smoke-weak').length===1",page.cdp);
    mainState=await mainSmokeState(page.cdp);
    assert("vent faible sans fausse direction",mainState.weak===1 && mainState.arrows===0 && mainState.timeLabels===0,JSON.stringify(mainState));
    await closePage(page,port);

    const unavailableGroup={lat:45.22,lon:0.18};
    page=await openPage(baseUrl,port,scenario({
      fireGroups:[ORIGIN,unavailableGroup],
      detectionsPerGroup:15,
      directions:[270,270,180,180],
      weatherErrorCenters:[unavailableGroup]
    }));
    await waitFor("window.__egxCounts.weather===4",page.cdp);
    await waitFor("window.__egxCounts.weatherActive===0",page.cdp);
    mainState=await mainSmokeState(page.cdp);
    assert("succès météo partiel foyer par foyer",mainState.arrows===3 && mainState.corridors===3,JSON.stringify(mainState));
    assert("vent tournant conservé sur la carte principale",mainState.arrows===3,JSON.stringify(mainState));
    await closePage(page,port);

    page=await openPage(baseUrl,port,scenario({
      detectionsPerGroup:15,
      missingHours:[5,6,7,8,9,10,11,12]
    }));
    await waitFor("document.querySelectorAll('.main-smoke-direction-arrow').length===1",page.cdp);
    mainState=await mainSmokeState(page.cdp);
    assert("météo horaire partielle rend le segment disponible",mainState.corridors===1 && mainState.arrows===1 && mainState.timeLabels===0,JSON.stringify(mainState));
    await closePage(page,port);

    const manyGroups=Array.from({length:20},(_,index)=>point(
      -60+(index%5)*30,
      -45+Math.floor(index/5)*30
    ));
    const manyStart=Date.now();
    page=await openPage(baseUrl,port,scenario({
      fireGroups:manyGroups,
      detectionsPerGroup:15,
      theme:"dark",
      viewport:{width:1440,height:1000,deviceScaleFactor:1,mobile:false},
      weatherDelayMs:50
    }));
    await waitFor("window.__egxCounts.weather===2 && window.__egxCounts.weatherActive===0",page.cdp,15000);
    await evaluate("document.getElementById('zoomIn').click()",page.cdp);
    await waitFor("document.querySelectorAll('.main-smoke-corridor:not(.main-smoke-weak)').length===48",page.cdp);
    mainState=await mainSmokeState(page.cdp);
    assert(
      "grand nombre reprend la limite overlays 16 sans surcharger les flèches",
      mainState.corridors===48 && mainState.directions===16 && mainState.arrows>=16 && mainState.arrows<=48,
      JSON.stringify(mainState)
    );
    assert("prévisions des 16 foyers groupées en un appel",mainState.weather===2,String(mainState.weather));
    measurements.largeGroupRenderMs=Date.now()-manyStart;
    measurements.weatherCallsFor16Groups=mainState.weather;
    measurements.maxWeatherConcurrency=mainState.weatherMaxActive;
    assert("grand nombre rendu sans attente FIRMS bloquante",measurements.largeGroupRenderMs<5000,`${measurements.largeGroupRenderMs} ms`);
    const mainDesktopShot=path.join(artifacts,"main-smoke-desktop-dark.png");
    const mainDesktopCapture=await page.cdp.send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
    fs.writeFileSync(mainDesktopShot,Buffer.from(mainDesktopCapture.data,"base64"));
    assert("capture trajectoires desktop sombre",fs.statSync(mainDesktopShot).size>10000,String(fs.statSync(mainDesktopShot).size));
    await closePage(page,port);

    page=await openPage(baseUrl,port,scenario({
      fireGroups:manyGroups,
      detectionsPerGroup:15,
      weatherBatchError:true,
      weatherDelayMs:50
    }));
    await waitFor("window.__egxCounts.weather===18 && window.__egxCounts.weatherActive===0",page.cdp,15000);
    await evaluate("document.getElementById('zoomIn').click()",page.cdp);
    await waitFor("document.querySelectorAll('.main-smoke-corridor:not(.main-smoke-weak)').length===48",page.cdp);
    mainState=await mainSmokeState(page.cdp);
    assert(
      "repli météo individuel après échec groupé",
      mainState.corridors===48 && mainState.directions===16 && mainState.arrows>=16 && mainState.arrows<=48,
      JSON.stringify(mainState)
    );
    assert(
      "concurrence du repli météo limitée à quatre",
      mainState.weatherMaxActive<=4 && mainState.weatherMaxActive>=3,
      String(mainState.weatherMaxActive)
    );
    await closePage(page,port);

    page=await openPage(baseUrl,port,scenario({
      detectionsPerGroup:15,
      weatherDelayMs:700
    }));
    await waitFor("window.__egxCounts.weather===2",page.cdp,10000);
    await evaluate("document.getElementById('refreshTop').click()",page.cdp);
    await waitFor("window.__egxCounts.weatherAborts>=1",page.cdp);
    await waitFor("document.querySelectorAll('.main-smoke-direction-arrow').length===3",page.cdp,15000);
    mainState=await mainSmokeState(page.cdp);
    assert("actualisation annule l’ancienne météo foyer",mainState.weatherAborts>=1,JSON.stringify(mainState));
    await closePage(page,port);

    for(const test of [
      {name:"ville surveillée dans la suite du tracé",location:{name:"Bordeaux",...point(45)},text:"suite du tracé"},
      {name:"ville surveillée vers la fin du tracé",location:{name:"Bordeaux",...point(90)},text:"fin du tracé"},
      {name:"ville surveillée hors corridor",location:{name:"Bordeaux",...point(0,25)},text:"ne semble pas"}
    ]){
      page=await openPage(baseUrl,port,scenario({location:test.location}));
      await openFirstDetail(page.cdp);
      state=await localityState(page.cdp);
      assert(test.name,state.watched.includes(test.text),state.watched);
      await closePage(page,port);
    }

    page=await openPage(baseUrl,port,scenario({
      location:{name:"Bordeaux",...point(0,25)},
      overpass:{mode:"success",elements:[osm(90,"Localité proche de la limite","hamlet",point(20,4))]}
    }));
    assert("aucun appel Overpass détail fermé",await evaluate("window.__egxCounts.overpass===0",page.cdp));
    await openFirstDetail(page.cdp);
    state=await localityState(page.cdp);
    assert("localité proche de la limite du corridor",state.names.includes("Localité proche de la limite"),state.names.join("|"));
    await closePage(page,port);

    page=await openPage(baseUrl,port,scenario({
      isolated:true,
      overpass:{mode:"success",elements:[osm(91,"Localité pour détection isolée","village",point(18))]}
    }));
    await openFirstDetail(page.cdp);
    state=await localityState(page.cdp);
    assert("détection isolée",await evaluate("document.getElementById('detailName').textContent==='Détection isolée'",page.cdp));
    assert("localités pour détection isolée",state.names.includes("Localité pour détection isolée"),state.names.join("|"));
    assert("détection isolée sans carte technique redondante",state.technicalElements===0,String(state.technicalElements));
    assert("aucune trajectoire principale pour détection isolée",await evaluate("document.querySelectorAll('.main-smoke-corridor,.main-smoke-direction-arrow').length===0",page.cdp));
    await closePage(page,port);

    const rotationPoint=destination(
      destination(destination(ORIGIN,90,30),45,Math.sqrt(50)*3),
      0,
      30
    );
    page=await openPage(baseUrl,port,scenario({
      location:{name:"Bordeaux",...point(-20,-20)},
      directions:[270,270,180,180],
      overpass:{mode:"success",elements:[osm(100,"Localité après rotation","village",rotationPoint)]}
    }));
    await openFirstDetail(page.cdp);
    state=await localityState(page.cdp);
    assert("trajectoire avec rotation",state.names.includes("Localité après rotation"),JSON.stringify(state));
    assert("changement important de direction",state.watched.includes("difficile à anticiper"),state.watched);
    await closePage(page,port);

    page=await openPage(baseUrl,port,scenario({
      theme:"dark",
      viewport:{width:1440,height:1000,deviceScaleFactor:1,mobile:false},
      overpass:{mode:"success",elements:[osm(110,"Seule localité rurale","hamlet",point(70))]}
    }));
    await evaluate(`(()=>{
      const tab=document.getElementById("tabOverview");
      tab.focus();
      tab.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true}));
    })()`,page.cdp);
    assert(
      "onglets accessibles avec les flèches du clavier",
      await evaluate(`document.activeElement===document.getElementById("tabSettings") &&
        document.getElementById("tabSettings").getAttribute("aria-selected")==="true"`,page.cdp)
    );
    await evaluate(`document.getElementById("tabSettings").dispatchEvent(
      new KeyboardEvent("keydown",{key:"Home",bubbles:true})
    )`,page.cdp);
    assert(
      "touche Début revient au premier onglet",
      await evaluate("document.activeElement===document.getElementById('tabOverview')",page.cdp)
    );
    await openFirstDetail(page.cdp);
    state=await localityState(page.cdp);
    assert("zone rurale avec une localité",state.names.includes("Seule localité rurale"),state.names.join("|"));
    assert("thème sombre restauré",await evaluate("document.documentElement.dataset.theme==='dark'",page.cdp));
    const desktopShot=path.join(artifacts,"desktop-dark.png");
    await new Promise(resolve=>setTimeout(resolve,250));
    const desktopCapture=await page.cdp.send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
    fs.writeFileSync(desktopShot,Buffer.from(desktopCapture.data,"base64"));
    assert("capture desktop 1440×1000",fs.statSync(desktopShot).size>10000,String(fs.statSync(desktopShot).size));
    await closePage(page,port);

    const responsiveShots={};
    let smallMapShot=null;
    for(const test of [
      {name:"desktop étroit 1024×900",slug:"desktop-1024",width:1024,height:900,desktop:true,theme:"light",detections:40},
      {name:"tablette portrait 768×1024",slug:"tablet-portrait",width:768,height:1024,desktop:false,theme:"dark",detections:4},
      {name:"tablette paysage 1024×768",slug:"tablet-landscape",width:1024,height:768,desktop:true,theme:"light",detections:4},
      {name:"zoom navigateur 200 % (1440×1000)",slug:"browser-zoom-200",width:720,height:500,desktop:false,mobileDevice:false,scale:2,theme:"light",detections:4},
      {name:"mobile 390×844",slug:"mobile-390",width:390,height:844,desktop:false,theme:"light",detections:2},
      {name:"petit mobile 320×568",slug:"mobile-small",width:320,height:568,desktop:false,theme:"dark",detections:3}
    ]){
      page=await openPage(baseUrl,port,scenario({
        theme:test.theme,
        viewport:{
          width:test.width,
          height:test.height,
          deviceScaleFactor:test.scale||1,
          mobile:test.mobileDevice??!test.desktop
        },
        detectionsPerGroup:test.detections,
        overpass:{mode:"success",elements:[]}
      }));
      await waitFor("document.querySelectorAll('.feed-item').length>0",page.cdp);
      const mapGeometry=await evaluate(`(()=>{
        const summary=document.querySelector(".map-summary").getBoundingClientRect();
        return {
          documentHorizontal:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,
          summaryLeft:summary.left,
          summaryRight:summary.right,
          nearestAge:document.getElementById("nearestAge").textContent
        };
      })()`,page.cdp);
      assert(
        `${test.name} carte sans débordement`,
        !mapGeometry.documentHorizontal &&
          mapGeometry.summaryLeft>=-1 &&
          mapGeometry.summaryRight<=test.width+1,
        JSON.stringify(mapGeometry)
      );
      assert(`${test.name} ancienneté textuelle`,mapGeometry.nearestAge.trim().length>1,mapGeometry.nearestAge);
      if(test.slug==="mobile-small"){
        smallMapShot=path.join(artifacts,"map-mobile-small.png");
        const mapCapture=await page.cdp.send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
        fs.writeFileSync(smallMapShot,Buffer.from(mapCapture.data,"base64"));
      }
      await openFirstDetail(page.cdp);
      await localityState(page.cdp);
      const geometry=await evaluate(`(()=>{
        const view=document.getElementById("detailView");
        const content=view.querySelector(".detail-content");
        const actions=view.querySelector(".detail-actions");
        const rect=view.getBoundingClientRect();
        const nested=[...content.querySelectorAll("*")].filter(element=>{
          const style=getComputedStyle(element);
          return /(auto|scroll)/.test(style.overflowY) && element.scrollHeight>element.clientHeight+1;
        });
        content.scrollTop=content.scrollHeight;
        const actionRect=actions.getBoundingClientRect();
        const closeRect=document.getElementById("closeDetail").getBoundingClientRect();
        return {
          width:rect.width,
          height:rect.height,
          left:rect.left,
          top:rect.top,
          singleChild:content.children.length===1,
          technicalElements:document.querySelectorAll("#detailDetectionCount,#detailDetections,.detail-detections,.detection-card").length,
          documentHorizontal:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,
          detailHorizontal:content.scrollWidth>content.clientWidth+1,
          nestedScrollers:nested.length,
          actionsVisible:actionRect.top>=closeRect.bottom-1 && actionRect.bottom<=innerHeight+1,
          closeVisible:closeRect.top>=-1 && closeRect.bottom<=innerHeight+1,
          mapHeight:document.getElementById("detailMap").getBoundingClientRect().height,
          feedText:document.querySelector(".feed-item")?.innerText||""
        };
      })()`,page.cdp);
      assert(`${test.name} sans liste technique`,geometry.technicalElements===0,JSON.stringify(geometry));
      assert(`${test.name} une seule colonne`,geometry.singleChild,JSON.stringify(geometry));
      assert(`${test.name} sans scroll horizontal`,!geometry.documentHorizontal && !geometry.detailHorizontal,JSON.stringify(geometry));
      assert(`${test.name} sans scroll imbriqué`,geometry.nestedScrollers===0,JSON.stringify(geometry));
      assert(`${test.name} actions finales accessibles`,geometry.actionsVisible,JSON.stringify(geometry));
      assert(`${test.name} fermeture accessible`,geometry.closeVisible,JSON.stringify(geometry));
      assert(`${test.name} carte lisible`,geometry.mapHeight>=209.5,JSON.stringify(geometry));
      assert(`${test.name} données nombreuses conservées`,geometry.feedText.includes(`${test.detections} détections`),geometry.feedText);
      if(test.desktop){
        assert(`${test.name} modale centrée`,Math.abs(geometry.left-(test.width-geometry.width)/2)<=1,JSON.stringify(geometry));
        assert(`${test.name} largeur citoyenne`,geometry.width>=520 && geometry.width<=680,JSON.stringify(geometry));
      }else{
        assert(`${test.name} plein écran`,Math.abs(geometry.width-test.width)<=1 && Math.abs(geometry.height-test.height)<=1,JSON.stringify(geometry));
      }
      const shot=path.join(artifacts,`${test.slug}.png`);
      const capture=await page.cdp.send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
      fs.writeFileSync(shot,Buffer.from(capture.data,"base64"));
      assert(`${test.name} capture`,fs.statSync(shot).size>10000,String(fs.statSync(shot).size));
      responsiveShots[test.slug]=shot;
      await closePage(page,port);
    }

    for(const test of [
      {name:"réponse Overpass vide",overpass:{mode:"success",elements:[]},expected:"Aucune localité"},
      {name:"réponse Overpass invalide",overpass:{mode:"invalid"},expected:"indisponibles"},
      {name:"erreur réseau Overpass",overpass:{mode:"network"},expected:"indisponibles"},
      {name:"erreur Overpass 429",overpass:{mode:"429"},expected:"indisponibles"}
    ]){
      page=await openPage(baseUrl,port,scenario({
        location:{name:"Bordeaux",...point(0,25)},
        overpass:test.overpass
      }));
      await openFirstDetail(page.cdp);
      state=await localityState(page.cdp);
      assert(test.name,state.message.includes(test.expected),state.message);
      assert(`${test.name} sans blocage FIRMS`,state.feedItems===1,String(state.feedItems));
      await closePage(page,port);
    }

    page=await openPage(baseUrl,port,scenario({
      location:{name:"Bordeaux",...point(0,25)},
      overpass:{mode:"timeout"}
    }));
    await openFirstDetail(page.cdp);
    state=await localityState(page.cdp,18000);
    assert("timeout Overpass",state.message.includes("indisponibles"),state.message);
    assert("timeout explicit avec annulation réseau",await evaluate("window.__egxCounts.overpassAborts===1",page.cdp));
    await closePage(page,port);

    page=await openPage(baseUrl,port,scenario({
      speeds:[1,1,1,1],
      overpass:{mode:"success",elements:[osm(120,"Ne doit pas être demandée","town",point(10))]}
    }));
    await openFirstDetail(page.cdp);
    state=await localityState(page.cdp);
    assert("vent très faible",state.message.includes("sans trajectoire exploitable"),state.message);
    assert("aucun appel Overpass par vent faible",await evaluate("window.__egxCounts.overpass===0",page.cdp));
    await closePage(page,port);

    page=await openPage(baseUrl,port,scenario({weatherError:true}));
    await openFirstDetail(page.cdp);
    state=await localityState(page.cdp);
    assert("météo indisponible",state.message.includes("sans prévision du vent"),state.message);
    assert("météo indisponible sans appel Overpass",await evaluate("window.__egxCounts.overpass===0",page.cdp));
    assert("météo indisponible sans blocage FIRMS",state.feedItems===1,String(state.feedItems));
    await closePage(page,port);

    page=await openPage(baseUrl,port,scenario({weatherDelayMs:1200}));
    await waitFor("document.querySelectorAll('.feed-item').length===1",page.cdp);
    assert(
      "météo lente ne bloque pas FIRMS",
      await evaluate(`!document.getElementById("refreshTop").disabled &&
        window.__egxCounts.weatherActive>0 &&
        document.getElementById("sourceStatusText").textContent.includes("Mis à jour")`,page.cdp)
    );
    await waitFor("window.__egxCounts.weatherActive===0 && window.__egxCounts.weather===1",page.cdp,5000);
    assert(
      "vent ajouté après la réponse météo lente",
      await evaluate("document.getElementById('windSpeed').textContent!=='—'",page.cdp)
    );
    await closePage(page,port);

    page=await openPage(baseUrl,port,scenario({
      missingHours:[5,6,7,8,9,10,11,12],
      overpass:{mode:"success",elements:[osm(130,"Localité trajectoire partielle","village",point(20))]}
    }));
    await openFirstDetail(page.cdp);
    state=await localityState(page.cdp);
    assert("trajectoire partielle",state.names.includes("Localité trajectoire partielle"),JSON.stringify(state));
    assert("mention prévision partielle",await evaluate("document.getElementById('detailSmokeMeta').textContent.includes('partielle')",page.cdp));
    await closePage(page,port);

    page=await openPage(baseUrl,port,scenario({
      location:{name:"Bordeaux",...point(0,25)},
      speeds:[40,40,40,40],
      overpass:{mode:"success",elements:[osm(135,"Localité trajet long","town",point(200))]}
    }));
    await openFirstDetail(page.cdp);
    state=await localityState(page.cdp);
    assert("limite trajectoire longue visible",state.limit.includes("300 premiers kilomètres"),state.limit);
    assert("géométrie métier non limitée à 120 km",state.names.includes("Localité trajet long"),state.names.join("|"));
    await closePage(page,port);

    page=await openPage(baseUrl,port,scenario({
      location:{name:"Bordeaux",...point(0,25)},
      overpass:{mode:"success",elements:[osm(140,"Localité mise en cache","town",point(15))]}
    }));
    await openFirstDetail(page.cdp);
    await localityState(page.cdp);
    const firstCount=await evaluate("window.__egxCounts.overpass",page.cdp);
    await evaluate("document.getElementById('closeDetail').click();document.querySelector('.feed-item').click()",page.cdp);
    await localityState(page.cdp);
    const secondCount=await evaluate("window.__egxCounts.overpass",page.cdp);
    assert("réouverture utilise le cache mémoire",firstCount===1 && secondCount===1,`${firstCount}/${secondCount}`);
    await closePage(page,port);

    page=await openPage(baseUrl,port,scenario({
      location:{name:"Bordeaux",...point(0,25)},
      fireGroups:[ORIGIN,{lat:45.2,lon:0.2}],
      overpass:{
        mode:"success",
        elements:[osm(150,"Deuxième foyer","village",{lat:45.2,lon:0.32})],
        sequence:[
          {mode:"success",elements:[osm(151,"Réponse obsolète","town",point(10))],delay:1200},
          {mode:"success",elements:[osm(150,"Deuxième foyer","village",{lat:45.2,lon:0.32})]}
        ]
      }
    }));
    await openFirstDetail(page.cdp);
    await waitFor("window.__egxCounts.overpass===1",page.cdp);
    await evaluate("document.querySelectorAll('.feed-item')[1].click()",page.cdp);
    state=await localityState(page.cdp);
    assert("annulation lors d’un changement de foyer",await evaluate("window.__egxCounts.overpassAborts>=1",page.cdp));
    assert("réponse obsolète ignorée",!state.names.includes("Réponse obsolète"),state.names.join("|"));
    await closePage(page,port);

    page=await openPage(baseUrl,port,scenario({
      nominatim:{
        mode:"success",
        sequence:[
          {
            mode:"success",
            delay:1200,
            ignoreAbort:true,
            results:[{name:"Slowville",display_name:"Slowville, France",lat:"46",lon:"2"}]
          },
          {
            mode:"success",
            results:[{name:"Fastville",display_name:"Fastville, France",lat:"47",lon:"3"}]
          }
        ]
      }
    }));
    await waitFor("document.querySelectorAll('.feed-item').length===1",page.cdp);
    await evaluate(`(()=>{
      document.querySelector('[data-nav="settings"]').click();
      const input=document.getElementById("cityQuery");
      input.value="Slowville";
      document.getElementById("searchCity").click();
    })()`,page.cdp);
    await waitFor("window.__egxCounts.nominatim===1",page.cdp);
    await evaluate(`(()=>{
      const input=document.getElementById("cityQuery");
      input.value="Fastville";
      input.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));
    })()`,page.cdp);
    await waitFor("document.getElementById('cityResults').textContent.includes('Fastville')",page.cdp,4000);
    await new Promise(resolve=>setTimeout(resolve,400));
    assert(
      "réponse Nominatim obsolète ignorée",
      await evaluate(`document.getElementById("cityResults").textContent.includes("Fastville") &&
        !document.getElementById("cityResults").textContent.includes("Slowville")`,page.cdp)
    );
    assert(
      "requêtes Nominatim espacées d’au moins une seconde",
      await evaluate(`window.__egxCounts.nominatimTimes.length===2 &&
        window.__egxCounts.nominatimTimes[1]-window.__egxCounts.nominatimTimes[0]>=950`,page.cdp),
      JSON.stringify(await evaluate("window.__egxCounts.nominatimTimes",page.cdp))
    );
    await closePage(page,port);

    page=await openPage(baseUrl,port,scenario({
      firms:{mode:"success",delay:350}
    }));
    assert(
      "chargement FIRMS annoncé sans faux état vide",
      await waitFor(`document.getElementById("sourceStatusText").textContent.includes("Connexion") &&
        document.getElementById("feed").textContent.includes("Chargement") &&
        document.getElementById("refreshTop").textContent.includes("Patientez") &&
        !document.getElementById("feed").textContent.includes("Aucune détection")`,page.cdp)
    );
    await waitFor("document.querySelectorAll('.feed-item').length===1",page.cdp);
    assert(
      "bouton d’actualisation restauré après chargement",
      await evaluate(`document.getElementById("refreshTop").textContent.includes("Actualiser") &&
        document.getElementById("refreshTop").getAttribute("aria-label")==="Actualiser la carte"`,page.cdp)
    );
    await closePage(page,port);

    page=await openPage(baseUrl,port,scenario({
      firms:{mode:"success",failSources:["MODIS_NRT"]}
    }));
    await waitFor("document.querySelectorAll('.feed-item').length===1",page.cdp);
    assert(
      "réponse FIRMS partielle conservée",
      await evaluate(`document.getElementById("headerError").textContent.includes("1 source satellite indisponible") &&
        document.getElementById("count").textContent.includes("détection")`,page.cdp)
    );
    await closePage(page,port);

    page=await openPage(baseUrl,port,scenario({
      firms:{mode:"invalid"}
    }));
    await waitFor("document.getElementById('mapStage').getAttribute('aria-busy')==='false'",page.cdp);
    assert(
      "CSV FIRMS invalide signalé comme indisponible",
      await evaluate(`document.getElementById("feed").textContent.includes("indisponibles") &&
        !document.getElementById("feed").textContent.includes("Aucune détection")`,page.cdp)
    );
    await closePage(page,port);

    page=await openPage(baseUrl,port,scenario({
      firms:{
        mode:"success",
        sequence:[
          {mode:"success"},
          {mode:"error",status:429}
        ]
      }
    }));
    await waitFor("document.querySelectorAll('.feed-item').length===1",page.cdp);
    await evaluate("document.getElementById('refreshTop').click()",page.cdp);
    await waitFor(`window.__egxCounts.firms===8 &&
      document.getElementById("mapStage").getAttribute("aria-busy")==="false"`,page.cdp);
    assert(
      "échec FIRMS total conserve la dernière carte du même périmètre",
      await evaluate(`document.querySelectorAll(".feed-item").length===1 &&
        document.getElementById("sourceStatusText").textContent.includes("Dernières données") &&
        document.getElementById("headerError").textContent.includes("restent affichées")`,page.cdp)
    );
    await closePage(page,port);

    page=await openPage(baseUrl,port,scenario({noKey:true}));
    assert("état sans clé NASA",await waitFor("document.getElementById('keyStatus').textContent.includes('requise')",page.cdp));
    assert("aucun appel FIRMS sans clé",await evaluate("window.__egxCounts.firms===0",page.cdp));
    await closePage(page,port);

    assert("aucune exception JavaScript",consoleProblems.length===0,consoleProblems.join(" | "));
    console.log(JSON.stringify({
      assertions:results.length,
      passed:results.filter(result=>result.ok).length,
      failed:results.filter(result=>!result.ok),
      artifacts:{mobileShot,desktopShot,mainMobileShot,mainDesktopShot,smallMapShot,...responsiveShots},
      measurements,
      consoleProblems
    },null,2));
  }finally{
    chrome.kill();
    server.close();
  }
}

run().catch(error=>{
  console.error(error.stack||error);
  console.error(JSON.stringify({results,consoleProblems,artifacts},null,2));
  process.exitCode=1;
});
