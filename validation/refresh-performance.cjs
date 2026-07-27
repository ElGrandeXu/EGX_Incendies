const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {spawn} = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const APP = process.env.EGX_APP_DIR
  ? path.resolve(process.env.EGX_APP_DIR)
  : ROOT;
const CHROME = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser"
].filter(Boolean).find(candidate=>fs.existsSync(candidate));
const ITERATIONS = Math.max(3,Number(process.env.EGX_PERF_ITERATIONS)||5);
const DETECTIONS = Math.max(100,Number(process.env.EGX_PERF_DETECTIONS)||2593);
const TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XwKzJwAAAABJRU5ErkJggg==",
  "base64"
);

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

function percentile(values,ratio){
  const sorted=[...values].sort((a,b)=>a-b);
  return sorted[Math.min(sorted.length-1,Math.floor(sorted.length*ratio))]||0;
}

function summarize(values){
  return {
    min:+Math.min(...values).toFixed(2),
    median:+percentile(values,.5).toFixed(2),
    p95:+percentile(values,.95).toFixed(2),
    max:+Math.max(...values).toFixed(2)
  };
}

function staticServer(){
  return http.createServer((req,res)=>{
    const pathname=new URL(req.url,"http://127.0.0.1").pathname;
    const relative=pathname==="/"?"index.html":pathname.slice(1);
    const target=path.resolve(APP,relative);
    if(!target.startsWith(APP) || !fs.existsSync(target) || !fs.statSync(target).isFile()){
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const types={
      ".html":"text/html; charset=utf-8",
      ".css":"text/css; charset=utf-8",
      ".js":"application/javascript; charset=utf-8",
      ".svg":"image/svg+xml",
      ".png":"image/png",
      ".webmanifest":"application/manifest+json"
    };
    const cache=path.extname(target)===".html"?"no-store":"public, max-age=3600";
    res.writeHead(200,{
      "Content-Type":types[path.extname(target)]||"application/octet-stream",
      "Cache-Control":cache
    });
    fs.createReadStream(target).pipe(res);
  });
}

async function waitForFile(file,timeout=10000){
  const start=Date.now();
  while(Date.now()-start<timeout){
    if(fs.existsSync(file)) return;
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  throw new Error(`Fichier absent : ${file}`);
}

async function evaluate(cdp,expression){
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

async function waitFor(cdp,expression,timeout=15000){
  const start=Date.now();
  while(Date.now()-start<timeout){
    const result=await evaluate(cdp,expression);
    if(result) return result;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  throw new Error(`Délai dépassé : ${expression}`);
}

function initScript(){
  return `(()=>{
    const DETECTIONS=${DETECTIONS};
    const nativeSetInterval=window.setInterval.bind(window);
    window.setInterval=(handler,delay,...args)=>{
      if(delay===10*60*1000){
        window.__egxAutoRefresh=()=>handler(...args);
        return 1;
      }
      return nativeSetInterval(handler,delay,...args);
    };
    localStorage.clear();
    localStorage.setItem("egx_incendies_firms_key","TEST_KEY_NOT_REAL");
    localStorage.setItem("egx_incendies_theme","light");
    localStorage.setItem("egx_incendies_settings",JSON.stringify({
      radius:250,
      hours:72,
      mode:"points+hulls",
      smokeVisible:true,
      location:{name:"Bordeaux",lat:44.8378,lon:-0.5792}
    }));
    const telemetry=window.__egxPerf={
      requests:[],
      active:0,
      maxActive:0,
      firms:0,
      weather:0,
      airQuality:0,
      overpass:0,
      nominatim:0,
      longTasks:[],
      maxFrameGap:0,
      frames:0,
      firstFeedbackAt:null,
      firstDataAt:null,
      firstStableAt:null
    };
    let lastFrame=performance.now();
    const frame=now=>{
      telemetry.maxFrameGap=Math.max(telemetry.maxFrameGap,now-lastFrame);
      telemetry.frames++;
      lastFrame=now;
      const stage=document.getElementById("mapStage");
      if(stage?.getAttribute("aria-busy")==="true" && telemetry.firstFeedbackAt===null){
        telemetry.firstFeedbackAt=now;
      }
      if(
        telemetry.firms>=4 &&
        stage?.getAttribute("aria-busy")==="false" &&
        telemetry.firstDataAt===null
      ){
        telemetry.firstDataAt=now;
      }
      if(
        telemetry.firstDataAt!==null &&
        telemetry.active===0 &&
        telemetry.firstStableAt===null
      ){
        telemetry.firstStableAt=now;
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    try{
      new PerformanceObserver(list=>{
        for(const entry of list.getEntries()) telemetry.longTasks.push(entry.duration);
      }).observe({type:"longtask",buffered:true});
    }catch{}
    const encoder=new TextEncoder();
    const response=(body,status=200,type="application/json")=>
      new Response(body,{status,headers:{"Content-Type":type}});
    const delayed=(service,url,body,delay,status=200,type="application/json",signal)=>{
      const request={
        service,
        url:url.replace(/\\/api\\/area\\/csv\\/[^/]+\\//,"/api/area/csv/{key}/"),
        start:performance.now(),
        end:null,
        bytes:encoder.encode(body).byteLength,
        status,
        aborted:false
      };
      telemetry.requests.push(request);
      telemetry.active++;
      telemetry.maxActive=Math.max(telemetry.maxActive,telemetry.active);
      return new Promise((resolve,reject)=>{
        let settled=false;
        const finish=()=>{
          if(settled) return false;
          settled=true;
          telemetry.active--;
          request.end=performance.now();
          return true;
        };
        const timer=setTimeout(()=>{
          if(finish()) resolve(response(body,status,type));
        },delay);
        signal?.addEventListener("abort",()=>{
          clearTimeout(timer);
          if(!finish()) return;
          request.aborted=true;
          reject(signal.reason||new DOMException("Aborted","AbortError"));
        },{once:true});
      });
    };
    const csv=()=>{
      const rows=["latitude,longitude,acq_date,acq_time,confidence,frp"];
      const now=Date.now();
      for(let i=0;i<DETECTIONS;i++){
        const ring=Math.floor(i/180);
        const angle=i%180*Math.PI/90;
        const radius=.003+(ring%10)*.002;
        const date=new Date(now-(30+i%1800)*60000);
        rows.push([
          (44.8378+Math.sin(angle)*radius).toFixed(5),
          (-.5792+Math.cos(angle)*radius).toFixed(5),
          date.toISOString().slice(0,10),
          date.toISOString().slice(11,16).replace(":",""),
          "high",
          String(20+i%80)
        ].join(","));
      }
      return rows.join("\\n");
    };
    const csvBody=csv();
    const weatherBody=locations=>{
      const make=()=>{
        const start=Math.floor(Date.now()/1000);
        const times=Array.from({length:13},(_,i)=>start+i*3600);
        return {
          utc_offset_seconds:0,
          current:{
            time:times[0],
            wind_speed_10m:12,
            wind_direction_10m:270,
            wind_gusts_10m:19
          },
          hourly:{
            time:times,
            wind_speed_10m:times.map(()=>12),
            wind_direction_10m:times.map(()=>270),
            wind_gusts_10m:times.map(()=>19)
          }
        };
      };
      const values=Array.from({length:locations},make);
      return JSON.stringify(locations===1?values[0]:values);
    };
    const airBody=JSON.stringify({current:{
      time:Math.floor(Date.now()/1000),
      european_aqi:34,
      european_aqi_pm2_5:34,
      european_aqi_pm10:22,
      european_aqi_nitrogen_dioxide:18,
      european_aqi_ozone:12,
      european_aqi_sulphur_dioxide:7
    }});
    const nativeFetch=window.fetch.bind(window);
    window.fetch=(input,options={})=>{
      const url=String(input?.url||input);
      if(url.includes("firms.modaps.eosdis.nasa.gov")){
        telemetry.firms++;
        return delayed("firms",url,csvBody,150,200,"text/csv",options.signal);
      }
      if(url.includes("air-quality-api.open-meteo.com")){
        telemetry.airQuality++;
        return delayed("air-quality",url,airBody,350,200,"application/json",options.signal);
      }
      if(url.includes("api.open-meteo.com")){
        telemetry.weather++;
        const parsed=new URL(url);
        const locations=parsed.searchParams.get("latitude")?.split(",").length||1;
        return delayed("weather",url,weatherBody(locations),250,200,"application/json",options.signal);
      }
      if(url.includes("overpass.")){
        telemetry.overpass++;
        return delayed("overpass",url,JSON.stringify({version:.6,elements:[]}),80,200,"application/json",options.signal);
      }
      if(url.includes("nominatim.openstreetmap.org")){
        telemetry.nominatim++;
        return delayed("nominatim",url,"[]",80,200,"application/json",options.signal);
      }
      return nativeFetch(input,options);
    };
  })();`;
}

function profileSummary(profile){
  const nodes=new Map(profile.nodes.map(node=>[node.id,node.callFrame.functionName||"(anonymous)"]));
  const buckets={parsing:0,transformation:0,business:0,render:0,totalSampled:0};
  const parsing=/^(parseCSV|splitCSV)$/;
  const transformation=/^(dedupe)$/;
  const business=/^(buildFireGroups|clusterLatLng|hull|haversine|smokeRisk)$/;
  const render=/^(renderLayers|renderFireGroupOverlays|renderMainSmokeLayers|updateUI)$/;
  (profile.samples||[]).forEach((id,index)=>{
    const ms=(profile.timeDeltas?.[index]||0)/1000;
    const name=nodes.get(id)||"";
    buckets.totalSampled+=ms;
    if(parsing.test(name)) buckets.parsing+=ms;
    else if(transformation.test(name)) buckets.transformation+=ms;
    else if(business.test(name)) buckets.business+=ms;
    else if(render.test(name)) buckets.render+=ms;
  });
  return Object.fromEntries(
    Object.entries(buckets).map(([key,value])=>[key,+value.toFixed(2)])
  );
}

async function createPage(baseUrl,port){
  const target=await (await fetch(
    `http://127.0.0.1:${port}/json/new?about:blank`,
    {method:"PUT"}
  )).json();
  const cdp=new Cdp(target.webSocketDebuggerUrl);
  await cdp.open();
  const resources=new Map();
  const failures=[];
  await Promise.all([
    cdp.send("Page.enable"),
    cdp.send("Runtime.enable"),
    cdp.send("Network.enable"),
    cdp.send("Performance.enable"),
    cdp.send("Profiler.enable"),
    cdp.send("HeapProfiler.enable"),
    cdp.send("Fetch.enable",{patterns:[
      {urlPattern:"https://cdn.jsdelivr.net/*"},
      {urlPattern:"https://fonts.googleapis.com/*"},
      {urlPattern:"https://fonts.gstatic.com/*"},
      {urlPattern:"https://tile.openstreetmap.org/*"}
    ]})
  ]);
  cdp.on("Network.responseReceived",params=>{
    resources.set(params.requestId,{
      url:params.response.url,
      type:params.type,
      fromDiskCache:params.response.fromDiskCache,
      fromPrefetchCache:params.response.fromPrefetchCache,
      encodedDataLength:params.response.encodedDataLength||0
    });
  });
  cdp.on("Network.loadingFinished",params=>{
    const item=resources.get(params.requestId);
    if(item) item.encodedDataLength=params.encodedDataLength||item.encodedDataLength;
  });
  cdp.on("Runtime.exceptionThrown",params=>{
    failures.push(params.exceptionDetails.exception?.description||params.exceptionDetails.text);
  });
  cdp.on("Fetch.requestPaused",params=>{
    const url=params.request.url;
    let body=Buffer.alloc(0);
    let type="text/plain";
    if(url.includes("leaflet.css")){
      body=Buffer.from(fs.readFileSync(path.join(APP,"index.html"),"utf8").includes("leaflet@1.9.4")
        ?"/* benchmark: Leaflet CSS fulfilled separately by browser cache */"
        :"");
      type="text/css";
    }else if(url.includes("leaflet.js")){
      fetch("https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js")
        .then(response=>response.arrayBuffer())
        .then(arrayBuffer=>cdp.send("Fetch.fulfillRequest",{
          requestId:params.requestId,
          responseCode:200,
          responseHeaders:[
            {name:"Content-Type",value:"application/javascript"},
            {name:"Access-Control-Allow-Origin",value:"*"},
            {name:"Cache-Control",value:"public, max-age=3600"}
          ],
          body:Buffer.from(arrayBuffer).toString("base64")
        }))
        .catch(error=>failures.push(error.message));
      return;
    }else if(url.includes("tile.openstreetmap.org")){
      body=TILE;
      type="image/png";
    }else{
      type=url.includes("fonts.googleapis.com")?"text/css":"font/woff2";
    }
    cdp.send("Fetch.fulfillRequest",{
      requestId:params.requestId,
      responseCode:200,
      responseHeaders:[
        {name:"Content-Type",value:type},
        {name:"Access-Control-Allow-Origin",value:"*"},
        {name:"Cache-Control",value:"public, max-age=3600"}
      ],
      body:body.toString("base64")
    }).catch(error=>failures.push(error.message));
  });
  await cdp.send("Emulation.setDeviceMetricsOverride",{
    width:1440,
    height:1000,
    deviceScaleFactor:1,
    mobile:false
  });
  await cdp.send("Page.addScriptToEvaluateOnNewDocument",{source:initScript()});
  await cdp.send("Page.navigate",{url:baseUrl});
  await waitFor(cdp,"document.readyState==='complete' && Boolean(window.L)",30000);
  await waitFor(cdp,"window.__egxPerf.firms>=4 && document.getElementById('mapStage').getAttribute('aria-busy')==='false'",30000);
  await waitFor(cdp,"window.__egxPerf.active===0",30000);
  await waitFor(cdp,"window.__egxPerf.firstStableAt!==null",30000);
  return {cdp,target,resources,failures};
}

async function measureRefresh(cdp,action){
  const before=await evaluate(cdp,"({firms:window.__egxPerf.firms,weather:window.__egxPerf.weather,airQuality:window.__egxPerf.airQuality,requests:window.__egxPerf.requests.length})");
  await cdp.send("Profiler.start");
  const start=await evaluate(cdp,`(()=>{
    window.__egxPerf.maxFrameGap=0;
    window.__egxPerf.longTasks=[];
    const start=performance.now();
    ${action}
    return {
      start,
      feedback:performance.now(),
      busy:document.getElementById("mapStage").getAttribute("aria-busy"),
      disabled:document.getElementById("refreshTop").disabled
    };
  })()`);
  await waitFor(
    cdp,
    `window.__egxPerf.firms>=${before.firms+4} && document.getElementById("mapStage").getAttribute("aria-busy")==="false"`,
    30000
  );
  const dataVisible=await evaluate(cdp,"performance.now()");
  await waitFor(cdp,"window.__egxPerf.active===0",30000);
  await new Promise(resolve=>setTimeout(resolve,50));
  const stable=await evaluate(cdp,`({
    time:performance.now(),
    requests:window.__egxPerf.requests.slice(${before.requests}),
    maxConcurrency:window.__egxPerf.maxActive,
    maxFrameGap:window.__egxPerf.maxFrameGap,
    longTasks:[...window.__egxPerf.longTasks],
    counts:{
      firms:window.__egxPerf.firms-${before.firms},
      weather:window.__egxPerf.weather-${before.weather},
      airQuality:window.__egxPerf.airQuality-${before.airQuality}
    },
    dom:document.getElementsByTagName("*").length,
    interactive:document.querySelectorAll(".leaflet-interactive").length,
    markers:document.querySelectorAll(".leaflet-marker-icon,.leaflet-marker-pane > *").length,
    layers:document.querySelectorAll(".leaflet-layer,.leaflet-interactive,.leaflet-marker-icon").length
  })`);
  const profile=await cdp.send("Profiler.stop");
  const requests=stable.requests.filter(request=>request.end!==null);
  const firms=requests.filter(request=>request.service==="firms");
  const firmsNetworkEnd=Math.max(...firms.map(request=>request.end),start.start);
  const urls=requests.map(request=>request.url);
  const duplicates=urls.length-new Set(urls).size;
  return {
    firstFeedbackMs:+(start.feedback-start.start).toFixed(2),
    firstFeedbackSynchronous:start.busy==="true" && start.disabled,
    dataVisibleMs:+(dataVisible-start.start).toFixed(2),
    stableMs:+(stable.time-start.start).toFixed(2),
    firmsNetworkMs:+(firmsNetworkEnd-start.start).toFixed(2),
    postFirmsLocalMs:+Math.max(0,dataVisible-firmsNetworkEnd).toFixed(2),
    requestCount:requests.length,
    duplicateRequests:duplicates,
    responseBytes:requests.reduce((sum,request)=>sum+request.bytes,0),
    maxConcurrency:stable.maxConcurrency,
    counts:stable.counts,
    cpu:profileSummary(profile.profile),
    maxFrameGapMs:+stable.maxFrameGap.toFixed(2),
    longTaskCount:stable.longTasks.length,
    longTaskMs:+stable.longTasks.reduce((sum,value)=>sum+value,0).toFixed(2),
    dom:stable.dom,
    layers:stable.layers,
    markers:stable.markers,
    interactive:stable.interactive
  };
}

async function heapUsed(cdp){
  await cdp.send("HeapProfiler.collectGarbage");
  const metrics=await cdp.send("Performance.getMetrics");
  const values=Object.fromEntries(metrics.metrics.map(metric=>[metric.name,metric.value]));
  return Math.round(values.JSHeapUsedSize||0);
}

async function run(){
  if(!CHROME) throw new Error("Chrome/Chromium introuvable. Définissez CHROME_PATH.");
  for(const file of ["index.html","app.js","style.css"]){
    if(!fs.existsSync(path.join(APP,file))) throw new Error(`Application incomplète : ${file}`);
  }
  const server=staticServer();
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const baseUrl=`http://127.0.0.1:${server.address().port}/`;
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),"egx-refresh-perf-"));
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
    "about:blank"
  ],{stdio:"ignore",windowsHide:true});
  let page;
  try{
    const portFile=path.join(profile,"DevToolsActivePort");
    await waitForFile(portFile);
    const port=Number(fs.readFileSync(portFile,"utf8").split(/\r?\n/)[0]);
    page=await createPage(baseUrl,port);
    if(page.failures.length) throw new Error(page.failures.join(" | "));

    const initialMetrics=await evaluate(page.cdp,`(()=>{
      const nav=performance.getEntriesByType("navigation")[0];
      return {
        domContentLoadedMs:nav.domContentLoadedEventEnd,
        loadMs:nav.loadEventEnd,
        requestCounts:{
          firms:window.__egxPerf.firms,
          weather:window.__egxPerf.weather,
          airQuality:window.__egxPerf.airQuality
        },
        firstFeedbackMs:window.__egxPerf.firstFeedbackAt,
        dataVisibleMs:window.__egxPerf.firstDataAt,
        stableMs:window.__egxPerf.firstStableAt,
        responseBytes:window.__egxPerf.requests.reduce((sum,request)=>sum+request.bytes,0),
        dom:document.getElementsByTagName("*").length,
        layers:document.querySelectorAll(".leaflet-layer,.leaflet-interactive,.leaflet-marker-icon").length
      };
    })()`);
    const resourceValues=[...page.resources.values()];
    initialMetrics.resourceCount=resourceValues.length;
    initialMetrics.encodedBytes=resourceValues.reduce((sum,item)=>sum+item.encodedDataLength,0);
    initialMetrics.cacheHits=resourceValues.filter(item=>item.fromDiskCache||item.fromPrefetchCache).length;

    page.resources.clear();
    const warmStart=Date.now();
    await page.cdp.send("Page.reload",{ignoreCache:false});
    await waitFor(page.cdp,"document.readyState==='complete' && window.__egxPerf?.firms>=4",30000);
    await waitFor(page.cdp,"window.__egxPerf.active===0",30000);
    const warmLoadMs=Date.now()-warmStart;
    const warmResources=[...page.resources.values()];
    const warm={
      loadMs:warmLoadMs,
      resourceCount:warmResources.length,
      encodedBytes:warmResources.reduce((sum,item)=>sum+item.encodedDataLength,0),
      cacheHits:warmResources.filter(item=>item.fromDiskCache||item.fromPrefetchCache).length
    };

    const manual=[];
    for(let i=0;i<ITERATIONS;i++){
      manual.push(await measureRefresh(
        page.cdp,
        `document.getElementById("refreshTop").click();`
      ));
    }
    const heapBefore=await heapUsed(page.cdp);
    const layersBefore=manual.at(-1).layers;
    for(let i=0;i<10;i++){
      await measureRefresh(page.cdp,`document.getElementById("refreshTop").click();`);
    }
    const heapAfter=await heapUsed(page.cdp);
    const longSessionState=await evaluate(page.cdp,`({
      layers:document.querySelectorAll(".leaflet-layer,.leaflet-interactive,.leaflet-marker-icon").length,
      dom:document.getElementsByTagName("*").length
    })`);

    const rapid=await measureRefresh(page.cdp,`(()=>{
      const radius=document.getElementById("radius");
      for(const value of ["50","150","250"]){
        radius.value=value;
        radius.dispatchEvent(new Event("change",{bubbles:true}));
      }
    })();`);
    const automatic=await measureRefresh(page.cdp,`window.__egxAutoRefresh();`);

    const beforeMapInteractions=await evaluate(page.cdp,"({firms:window.__egxPerf.firms,weather:window.__egxPerf.weather,air:window.__egxPerf.airQuality})");
    await evaluate(page.cdp,`(()=>{
      for(let i=0;i<5;i++){
        document.getElementById("zoomIn").click();
        document.getElementById("zoomOut").click();
        document.getElementById("homeBtn").click();
      }
    })()`);
    await new Promise(resolve=>setTimeout(resolve,1000));
    const afterMapInteractions=await evaluate(page.cdp,"({firms:window.__egxPerf.firms,weather:window.__egxPerf.weather,air:window.__egxPerf.airQuality})");

    const summary={
      appDir:APP,
      detections:DETECTIONS,
      iterations:ITERATIONS,
      initial:initialMetrics,
      warm,
      manual:{
        firstFeedbackMs:summarize(manual.map(value=>value.firstFeedbackMs)),
        dataVisibleMs:summarize(manual.map(value=>value.dataVisibleMs)),
        stableMs:summarize(manual.map(value=>value.stableMs)),
        firmsNetworkMs:summarize(manual.map(value=>value.firmsNetworkMs)),
        postFirmsLocalMs:summarize(manual.map(value=>value.postFirmsLocalMs)),
        responseBytes:manual[0].responseBytes,
        requestCount:manual[0].requestCount,
        duplicateRequests:manual[0].duplicateRequests,
        maxConcurrency:Math.max(...manual.map(value=>value.maxConcurrency)),
        counts:manual[0].counts,
        cpuMedian:{
          parsing:+percentile(manual.map(value=>value.cpu.parsing),.5).toFixed(2),
          transformation:+percentile(manual.map(value=>value.cpu.transformation),.5).toFixed(2),
          business:+percentile(manual.map(value=>value.cpu.business),.5).toFixed(2),
          render:+percentile(manual.map(value=>value.cpu.render),.5).toFixed(2),
          totalSampled:+percentile(manual.map(value=>value.cpu.totalSampled),.5).toFixed(2)
        },
        maxFrameGapMs:summarize(manual.map(value=>value.maxFrameGapMs)),
        longTaskCount:manual.reduce((sum,value)=>sum+value.longTaskCount,0),
        layers:manual[0].layers,
        markers:manual[0].markers,
        interactive:manual[0].interactive,
        dom:manual[0].dom
      },
      rapid,
      automatic,
      mapInteractions:{
        before:beforeMapInteractions,
        after:afterMapInteractions,
        addedRequests:{
          firms:afterMapInteractions.firms-beforeMapInteractions.firms,
          weather:afterMapInteractions.weather-beforeMapInteractions.weather,
          airQuality:afterMapInteractions.air-beforeMapInteractions.air
        }
      },
      longSession:{
        refreshes:10,
        heapBefore,
        heapAfter,
        heapDelta:heapAfter-heapBefore,
        layersBefore,
        layersAfter:longSessionState.layers,
        domAfter:longSessionState.dom
      }
    };
    console.log(JSON.stringify(summary,null,2));
  }finally{
    page?.cdp.close();
    chrome.kill();
    server.close();
  }
}

run().catch(error=>{
  console.error(error.stack||error);
  process.exitCode=1;
});
