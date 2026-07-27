(() => {
  "use strict";

  const DEFAULT_LOCATION = {name:"Bordeaux", lat:44.8378, lon:-0.5792};
  const STORAGE_KEY = "egx_incendies_firms_key";
  const SETTINGS_KEY = "egx_incendies_settings";
  const THEME_KEY = "egx_incendies_theme";
  const SOURCES = ["VIIRS_SNPP_NRT","VIIRS_NOAA20_NRT","VIIRS_NOAA21_NRT","MODIS_NRT"];
  const FORECAST_HOURS = [0,3,6,12];
  const MIN_DIRECTIONAL_WIND_KMH = 3;
  const FIRMS_TIMEOUT_MS = 20000;
  const WEATHER_TIMEOUT_MS = 12000;
  const AIR_QUALITY_TIMEOUT_MS = 12000;
  const NOMINATIM_TIMEOUT_MS = 10000;
  const NOMINATIM_MIN_INTERVAL_MS = 1000;
  const CITY_SEARCH_CACHE_MAX = 20;
  const MAIN_SMOKE_MAX_GROUPS = 16;
  const MAIN_SMOKE_CONCURRENCY = 3;
  const SMOKE_FORECAST_CACHE_TTL_MS = 10*60*1000;
  const OVERPASS_ENDPOINT = "https://overpass.kumi.systems/api/interpreter";
  const OVERPASS_TIMEOUT_MS = 15000;
  const OVERPASS_QUERY_TIMEOUT_SECONDS = 12;
  const OVERPASS_QUERY_MAXSIZE_BYTES = 64*1024*1024;
  const OVERPASS_MAX_RESPONSE_BYTES = 8*1024*1024;
  const OVERPASS_ROUTE_LIMIT_KM = 300;
  const OVERPASS_MARGIN_KM = 2;
  const LOCALITY_TYPES = new Set(["city","town","village","hamlet"]);
  const LOCALITY_CACHE_VERSION = 1;
  const LOCALITY_HORIZONS = [
    {key:"0-3",maxHours:3,label:"Début du tracé"},
    {key:"3-6",maxHours:6,label:"Suite du tracé"},
    {key:"6-12",maxHours:12,label:"Fin du tracé"}
  ];
  const VALID_RADII = new Set([50,100,150,200,250]);
  const VALID_HOURS = new Set([24,48,72]);
  const VALID_MODES = new Set(["points+hulls","points","hulls"]);
  const localityCache = new Map();
  const smokeForecastCache = new Map();
  const citySearchCache = new Map();

  const $ = id => document.getElementById(id);
  const state = {
    mapKey: localStorage.getItem(STORAGE_KEY) || "",
    points: [],
    fireGroups: [],
    wind: null,
    windLoading: false,
    windError: false,
    windAttemptedAt: null,
    airQuality: null,
    airQualityLoading: false,
    airQualityError: false,
    airQualityAttemptedAt: null,
    lastFetch: null,
    dataStatus: "idle",
    dataScope: null,
    loading: false,
    abortController: null,
    settings: {
      radius:100,
      hours:72,
      mode:"points+hulls",
      smokeVisible:true,
      location:{...DEFAULT_LOCATION}
    }
  };

  try{
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    state.settings = {...state.settings, ...saved};
    if(!saved.location || !Number.isFinite(+saved.location.lat) || !Number.isFinite(+saved.location.lon)){
      state.settings.location = {...DEFAULT_LOCATION};
    }else{
      state.settings.location = {
        name:String(saved.location.name || "Ville sélectionnée"),
        lat:+saved.location.lat,
        lon:+saved.location.lon
      };
    }
    const radius=Number(saved.radius);
    const hours=Number(saved.hours);
    state.settings.radius=VALID_RADII.has(radius)?radius:100;
    state.settings.hours=VALID_HOURS.has(hours)?hours:72;
    state.settings.mode=VALID_MODES.has(saved.mode)?saved.mode:"points+hulls";
    state.settings.smokeVisible=saved.smokeVisible!==false;
  }catch{}

  const currentLocation = () => state.settings.location;
  let detailMap = null;
  let detailMarker = null;
  let detailWindLayer = null;
  let detailLocalityLayer = null;
  let detailWindController = null;
  let detailWindRequestId = 0;
  let currentDetailGroup = null;
  let detailPreviousFocus = null;
  let toastTimer = null;
  let activeView = "map";
  let refreshRequestId = 0;
  let citySearchController = null;
  let citySearchRequestId = 0;
  let nextNominatimRequestAt = 0;
  let mainSmokeController = null;
  let mainSmokeRequestId = 0;
  let keyValidationController = null;
  let keyValidationRequestId = 0;
  let onboardingPreviousFocus = null;
  const mainSmokeForecasts = new Map();

  function applyTheme(theme){
    const selected=theme==="dark"?"dark":"light";
    document.documentElement.dataset.theme=selected;
    document.querySelector('meta[name="theme-color"]').content=selected==="dark"?"#111315":"#f8f9fb";
    const icon=$("themeToggle")?.querySelector(".material-symbols-outlined");
    if(icon) icon.textContent=selected==="dark"?"light_mode":"dark_mode";
    localStorage.setItem(THEME_KEY,selected);
    setTimeout(()=>{
      map?.invalidateSize({pan:false});
      detailMap?.invalidateSize({pan:false});
    },0);
  }

  function setSourceStatus(text){
    const target=$("sourceStatusText");
    if(target) target.textContent=text;
    else $("sourceStatus").textContent=text;
  }

  applyTheme(localStorage.getItem(THEME_KEY)||"light");

  const map = L.map("map", {
    center:[currentLocation().lat,currentLocation().lon],
    zoom:8,
    minZoom:5,
    maxZoom:14,
    zoomControl:false,
    attributionControl:true,
    preferCanvas:true,
    inertia:true,
    inertiaDeceleration:2800,
    inertiaMaxSpeed:1800,
    zoomAnimation:true,
    fadeAnimation:true,
    markerZoomAnimation:false,
    touchZoom:true,
    doubleClickZoom:true,
    scrollWheelZoom:true
  });

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom:19,
    updateWhenIdle:true,
    updateWhenZooming:false,
    keepBuffer:2,
    detectRetina:false,
    attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
  }).addTo(map);

  const renderer = L.canvas({padding:.35,tolerance:6});
  map.createPane("smokeCorridorPane");
  map.getPane("smokeCorridorPane").style.zIndex="350";
  map.createPane("smokeMarkerPane");
  map.getPane("smokeMarkerPane").style.zIndex="360";
  const smokeRenderer = L.svg({pane:"smokeCorridorPane",padding:.35});
  const mainSmokeLayer = L.layerGroup().addTo(map);
  const pointLayer = L.layerGroup().addTo(map);
  const hullLayer = L.layerGroup().addTo(map);
  const fireGroupLayer = L.layerGroup().addTo(map);

  const cityLayer = L.layerGroup().addTo(map);

  function renderCityMarker(){
    cityLayer.clearLayers();
    const location=currentLocation();
    L.circleMarker([location.lat,location.lon],{
      renderer,radius:5,color:"#111",weight:2,fillColor:"#fff",fillOpacity:1,interactive:false
    }).bindTooltip(escapeHtml(location.name),{
      permanent:true,direction:"top",offset:[0,-8],className:"city-label"
    }).addTo(cityLayer);
    $("headerCity").textContent=location.name;
    document.title=`EGX Incendies — ${location.name}`;
  }

  function saveSettings(){
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  }

  function colorForAge(h){
    if(h<3) return "#c81e1e";
    if(h<12) return "#f97316";
    if(h<24) return "#eab308";
    return "#3b82f6";
  }

  function statusColor(level){
    const dark=document.documentElement.dataset.theme==="dark";
    const normalized=String(level||"").toLowerCase();
    if(normalized==="aucun signal") return dark?"#7bc5d2":"#2a6f7a";
    if(normalized==="faible") return dark?"#74d99f":"#16784a";
    if(normalized==="modéré") return dark?"#f3c969":"#946000";
    if(normalized==="élevé" || normalized==="très élevé") return dark?"#ff817a":"#b42318";
    return dark?"#b7bbc0":"#62676b";
  }

  function airQualityColor(category){
    const dark=document.documentElement.dataset.theme==="dark";
    const colors={
      "Bonne":dark?"#74d99f":"#16784a",
      "Correcte":dark?"#8fc0ff":"#2663a8",
      "Modérée":dark?"#f3c969":"#946000",
      "Mauvaise":dark?"#ffae72":"#a84300",
      "Très mauvaise":dark?"#ff817a":"#b42318",
      "Extrêmement mauvaise":dark?"#f5a2ca":"#8f1d58"
    };
    return colors[category]||(dark?"#b7bbc0":"#62676b");
  }

  function airQualityLevel(category){
    return [
      "Bonne",
      "Correcte",
      "Modérée",
      "Mauvaise",
      "Très mauvaise",
      "Extrêmement mauvaise"
    ].indexOf(category)+1;
  }

  function rad(d){return d*Math.PI/180}
  function haversine(a,b){
    const R=6371,dLat=rad(b.lat-a.lat),dLon=rad(b.lon-a.lon);
    const x=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2;
    return 2*R*Math.asin(Math.sqrt(x));
  }

  function bearing(from,to){
    const lat1=rad(from.lat),lat2=rad(to.lat),dLon=rad(to.lon-from.lon);
    const y=Math.sin(dLon)*Math.cos(lat2);
    const x=Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(dLon);
    return (Math.atan2(y,x)*180/Math.PI+360)%360;
  }

  function angleDiff(a,b){
    return Math.abs(((a-b+540)%360)-180);
  }

  function smokeRisk(){
    const location=currentLocation();
    if(!state.points.length){
      if(state.dataStatus==="ready" && state.lastFetch){
        return {
          level:"Aucun signal",
          color:"#2a6f7a",
          explanation:"Aucune détection thermique récente à analyser dans la zone choisie. Cela ne garantit pas l’absence d’incendie ou de fumée."
        };
      }
      return {
        level:"Indisponible",
        color:"#b8aea4",
        explanation:state.dataStatus==="stale"
          ?"La dernière actualisation a échoué : aucun risque actuel ne peut être estimé."
          :state.dataStatus==="error"
            ?"Les détections sont indisponibles pour le moment."
            :state.loading
              ?"Chargement des détections en cours."
              :"Les détections n’ont pas encore été chargées."
      };
    }

    if(!state.wind){
      return {
        level:"Indisponible",
        color:"#b8aea4",
        explanation:state.windLoading
          ?"Mise à jour du vent en cours."
          :"Vent indisponible : le trajet potentiel des fumées ne peut pas être estimé."
      };
    }

    if(state.wind.speed<MIN_DIRECTIONAL_WIND_KMH){
      return {
        level:"Indisponible",
        color:"#b8aea4",
        explanation:"Le vent est très faible : sa direction ne permet pas d'estimer un trajet fiable des fumées."
      };
    }

    const recent=state.points.filter(p=>(Date.now()-p.time)<=24*36e5);
    if(!recent.length){
      return {
        level:"Faible",
        color:"#74d99f",
        explanation:"Aucune détection de moins de 24 heures dans la zone observée."
      };
    }

    const nearest=Math.min(...recent.map(p=>haversine(location,p)));
    if(nearest<=5){
      return {
        level:"Très élevé",
        color:"#ff493b",
        explanation:`Des détections récentes se trouvent à environ ${Math.max(0,Math.round(nearest))} km de la ville. La proximité immédiate domine l'estimation, quelle que soit la direction du vent.`
      };
    }

    // Open-Meteo gives the meteorological direction the wind comes FROM.
    // Smoke therefore travels approximately toward direction + 180°.
    const smokeTravel=(state.wind.direction+180)%360;
    let score=0;
    let alignedCount=0;
    let closestAligned=Infinity;

    for(const p of recent){
      const distance=haversine(p,location);
      if(distance>150) continue;

      const towardCity=bearing(p,location);
      const diff=angleDiff(smokeTravel,towardCity);
      if(diff>75) continue;

      const alignment=Math.max(0,Math.cos(rad(diff)));
      const ageHours=(Date.now()-p.time)/36e5;
      const freshness=Math.max(0.15,1-ageHours/30);
      const proximity=Math.max(0.08,1-distance/170);
      const frp=Number.isFinite(p.frp) ? Math.min(2,0.65+p.frp/80) : 0.75;

      score+=alignment*freshness*proximity*frp;
      alignedCount++;
      closestAligned=Math.min(closestAligned,distance);
    }

    if(!alignedCount || score<0.8){
      return {
        level:"Faible",
        color:"#74d99f",
        explanation:"Le vent actuel ne dirige pas nettement les fumées des détections récentes vers la ville."
      };
    }

    const direction=compassDirection(state.wind.direction);
    if(score>=8 || closestAligned<=20){
      return {
        level:"Élevé",
        color:"#ff493b",
        explanation:`Le vent venant du ${direction.toLowerCase()} peut transporter des fumées depuis ${alignedCount} détection${alignedCount>1?"s":""} récente${alignedCount>1?"s":""}. La plus proche dans cet axe est à environ ${Math.round(closestAligned)} km.`
      };
    }

    return {
      level:"Modéré",
      color:"#ffc14d",
      explanation:`Certaines détections récentes se trouvent dans l'axe du vent. La plus proche est à environ ${Math.round(closestAligned)} km ; la situation mérite d'être surveillée.`
    };
  }

  function splitCSV(line){
    const out=[];let cur="",q=false;
    for(let i=0;i<line.length;i++){
      const ch=line[i];
      if(ch==='"'){
        if(q&&line[i+1]==='"'){cur+='"';i++}else q=!q;
      }else if(ch===","&&!q){out.push(cur);cur=""}
      else cur+=ch;
    }
    out.push(cur);return out;
  }

  function parseCSV(text,sensor){
    const clean=text.trim();
    if(!clean || clean.startsWith("<")) return [];
    const lines=clean.split(/\r?\n/);
    const headers=splitCSV(lines[0]).map(x=>x.trim().toLowerCase());
    const required=["latitude","longitude","acq_date","acq_time"];
    if(required.some(name=>!headers.includes(name))){
      throw new Error(`${sensor}: format CSV invalide`);
    }
    if(lines.length<2) return [];
    const idx=n=>headers.indexOf(n);
    const out=[];
    for(let i=1;i<lines.length;i++){
      const c=splitCSV(lines[i]);
      const lat=+c[idx("latitude")],lon=+c[idx("longitude")];
      const date=c[idx("acq_date")],raw=String(c[idx("acq_time")]||"").padStart(4,"0");
      if(!Number.isFinite(lat)||!Number.isFinite(lon)||!date) continue;
      const time=Date.parse(`${date}T${raw.slice(0,2)}:${raw.slice(2)}:00Z`);
      if(!Number.isFinite(time)) continue;
      out.push({
        lat,lon,time,sensor,
        confidence:c[idx("confidence")]||"",
        frp:Number.isFinite(+c[idx("frp")]) ? +c[idx("frp")] : null
      });
    }
    return out;
  }

  function dedupe(points){
    const seen=new Set();
    return points.filter(p=>{
      const key=`${p.lat.toFixed(4)}|${p.lon.toFixed(4)}|${Math.round(p.time/60000)}`;
      if(seen.has(key)) return false;
      seen.add(key);return true;
    });
  }

  function bbox(radius,location=currentLocation()){
    const dLat=radius/111;
    const dLon=radius/(111*Math.cos(rad(location.lat)));
    return [location.lon-dLon,location.lat-dLat,location.lon+dLon,location.lat+dLat].join(",");
  }

  async function fetchSource(source,signal,request){
    const days=Math.max(1,Math.ceil(request.hours/24));
    const area=bbox(request.radius,request.location);
    const url=`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(request.mapKey)}/${source}/${area}/${days}`;
    const res=await fetchWithTimeout(
      url,
      {cache:"no-store"},
      signal,
      FIRMS_TIMEOUT_MS,
      `Délai FIRMS dépassé pour ${source}`
    );
    if(!res.ok) throw new Error(`${source}: erreur ${res.status}`);
    const text=await res.text();
    if(text.trim().startsWith("<")) throw new Error(`${source}: réponse invalide`);
    return parseCSV(text,source.replaceAll("_"," "));
  }

  function compassDirection(degrees){
    const labels=["N","NE","E","SE","S","SO","O","NO"];
    return labels[Math.round(((degrees%360)+360)%360/45)%8];
  }

  function directionName(degrees){
    const labels=["nord","nord-est","est","sud-est","sud","sud-ouest","ouest","nord-ouest"];
    return labels[Math.round(((degrees%360)+360)%360/45)%8];
  }

  function directionWithArticle(degrees){
    const direction=directionName(degrees);
    return direction==="est" || direction==="ouest"
      ?`l’${direction}`
      :`le ${direction}`;
  }

  function finiteNumber(value){
    if(value===null || value===undefined || value==="") return null;
    const number=Number(value);
    return Number.isFinite(number)?number:null;
  }

  function airQualityCategory(value){
    if(value<=20) return "Bonne";
    if(value<=40) return "Correcte";
    if(value<=60) return "Modérée";
    if(value<=80) return "Mauvaise";
    if(value<=100) return "Très mauvaise";
    return "Extrêmement mauvaise";
  }

  function parseAirQuality(data){
    const current=data?.current;
    const value=finiteNumber(current?.european_aqi);
    if(!current || value===null || value<0) throw new Error("indice EAQI absent ou invalide");
    const components=[
      ["PM2,5","european_aqi_pm2_5"],
      ["PM10","european_aqi_pm10"],
      ["NO₂","european_aqi_nitrogen_dioxide"],
      ["O₃","european_aqi_ozone"],
      ["SO₂","european_aqi_sulphur_dioxide"]
    ].map(([label,key])=>({label,value:finiteNumber(current[key])}))
      .filter(component=>component.value!==null && component.value>=0);
    if(!components.length) throw new Error("indices de polluants absents");
    const worst=Math.max(...components.map(component=>component.value));
    const determining=worst===0
      ?[]
      :components.filter(component=>component.value===worst).map(component=>component.label);
    return {
      value,
      category:airQualityCategory(value),
      determining,
      retrievedAt:Date.now()
    };
  }

  function buildAirQualityUrl(location){
    const url=new URL("https://air-quality-api.open-meteo.com/v1/air-quality");
    url.searchParams.set("latitude",location.lat);
    url.searchParams.set("longitude",location.lon);
    url.searchParams.set(
      "current",
      "european_aqi,european_aqi_pm2_5,european_aqi_pm10,european_aqi_nitrogen_dioxide,european_aqi_ozone,european_aqi_sulphur_dioxide"
    );
    url.searchParams.set("domains","auto");
    url.searchParams.set("timezone","auto");
    url.searchParams.set("timeformat","unixtime");
    return url;
  }

  async function fetchAirQuality(location,signal){
    const res=await fetchWithTimeout(
      buildAirQualityUrl(location).toString(),
      {cache:"no-store"},
      signal,
      AIR_QUALITY_TIMEOUT_MS,
      "Délai qualité de l’air dépassé"
    );
    if(!res.ok) throw new Error(`qualité de l’air ${res.status}`);
    return parseAirQuality(await res.json());
  }

  function parseWindForecast(data){
    const current=data?.current||{};
    let currentWind=null;
    const currentSpeed=finiteNumber(current.wind_speed_10m);
    const currentDirection=finiteNumber(current.wind_direction_10m);
    if(currentSpeed!==null && currentDirection!==null){
      const currentGusts=finiteNumber(current.wind_gusts_10m);
      const currentTime=finiteNumber(current.time);
      currentWind={
        speed:currentSpeed,
        direction:currentDirection,
        gusts:currentGusts,
        time:currentTime!==null?currentTime*1000:null
      };
    }

    const hourly=data?.hourly||{};
    const times=Array.isArray(hourly.time)?hourly.time:[];
    const speeds=Array.isArray(hourly.wind_speed_10m)?hourly.wind_speed_10m:[];
    const directions=Array.isArray(hourly.wind_direction_10m)?hourly.wind_direction_10m:[];
    const gusts=Array.isArray(hourly.wind_gusts_10m)?hourly.wind_gusts_10m:[];
    const rows=times.map((rawTime,index)=>{
      const time=finiteNumber(rawTime);
      if(time===null) return null;
      return {
        time:time*1000,
        speed:finiteNumber(speeds[index]),
        direction:finiteNumber(directions[index]),
        gusts:finiteNumber(gusts[index])
      };
    }).filter(Boolean);

    const now=Date.now();
    const horizons=FORECAST_HOURS.map(hours=>{
      const target=now+hours*36e5;
      const closest=rows.reduce((best,row)=>{
        const gap=Math.abs(row.time-target);
        return !best || gap<best.gap?{row,gap}:best;
      },null);
      if(!closest || closest.gap>90*60*1000){
        return {hours,time:null,speed:null,direction:null,gusts:null};
      }
      return {hours,...closest.row};
    });

    if(!currentWind){
      const nowForecast=horizons[0];
      if(nowForecast?.speed!==null && nowForecast?.direction!==null){
        currentWind={
          speed:nowForecast.speed,
          direction:nowForecast.direction,
          gusts:nowForecast.gusts,
          time:nowForecast.time
        };
      }
    }

    return {
      current:currentWind,
      forecast:{
        horizons,
        retrievedAt:Date.now(),
        utcOffsetSeconds:finiteNumber(data?.utc_offset_seconds)
      }
    };
  }

  function buildWindForecastUrl(locations){
    const url=new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude",locations.map(location=>location.lat).join(","));
    url.searchParams.set("longitude",locations.map(location=>location.lon).join(","));
    url.searchParams.set("current","wind_speed_10m,wind_direction_10m,wind_gusts_10m");
    url.searchParams.set("hourly","wind_speed_10m,wind_direction_10m,wind_gusts_10m");
    url.searchParams.set("forecast_hours","13");
    url.searchParams.set("wind_speed_unit","kmh");
    url.searchParams.set("timezone","auto");
    url.searchParams.set("timeformat","unixtime");
    return url;
  }

  async function fetchWindForecasts(locations,signal){
    if(!locations.length) return [];
    const url=buildWindForecastUrl(locations);
    const res=await fetchWithTimeout(
      url.toString(),
      {cache:"no-store"},
      signal,
      WEATHER_TIMEOUT_MS,
      "Délai météo dépassé"
    );
    if(!res.ok) throw new Error(`météo ${res.status}`);
    const data=await res.json();
    const forecasts=Array.isArray(data)?data:[data];
    if(forecasts.length!==locations.length){
      throw new Error("météo : réponse incomplète");
    }
    return forecasts.map(parseWindForecast);
  }

  async function fetchWindForecast(lat,lon,signal){
    return (await fetchWindForecasts([{lat,lon}],signal))[0];
  }

  function fireGroupSignature(group){
    return [
      group.center.lat.toFixed(5),
      group.center.lon.toFixed(5),
      group.count,
      Math.round(group.latest/60000)
    ].join("|");
  }

  function pruneSmokeForecastCache(){
    const now=Date.now();
    for(const [key,entry] of smokeForecastCache){
      if(entry.status==="resolved" && entry.expiresAt<=now){
        smokeForecastCache.delete(key);
      }
    }
  }

  async function fetchGroupSmokeForecast(group,signal){
    pruneSmokeForecastCache();
    const key=fireGroupSignature(group);
    const cached=smokeForecastCache.get(key);
    if(cached?.status==="resolved" && cached.expiresAt>Date.now()){
      return cached.value;
    }
    if(cached?.status==="pending" && !cached.signal?.aborted){
      return cached.promise;
    }

    const promise=fetchWindForecast(group.center.lat,group.center.lon,signal);
    smokeForecastCache.set(key,{status:"pending",promise,signal});
    try{
      const value=await promise;
      smokeForecastCache.set(key,{
        status:"resolved",
        value,
        expiresAt:Date.now()+SMOKE_FORECAST_CACHE_TTL_MS
      });
      return value;
    }catch(err){
      if(smokeForecastCache.get(key)?.promise===promise){
        smokeForecastCache.delete(key);
      }
      throw err;
    }
  }

  async function fetchGroupSmokeForecasts(groups,signal){
    pruneSmokeForecastCache();
    const results=new Map();
    const pending=[];
    const missing=[];

    for(const group of groups){
      const key=fireGroupSignature(group);
      const cached=smokeForecastCache.get(key);
      if(cached?.status==="resolved" && cached.expiresAt>Date.now()){
        results.set(key,cached.value);
      }else if(cached?.status==="pending" && !cached.signal?.aborted){
        pending.push({key,promise:cached.promise});
      }else{
        missing.push(group);
      }
    }

    if(missing.length){
      const batchPromise=fetchWindForecasts(
        missing.map(group=>group.center),
        signal
      );
      const batchEntries=missing.map((group,index)=>{
        const key=fireGroupSignature(group);
        const promise=batchPromise.then(forecasts=>forecasts[index]);
        smokeForecastCache.set(key,{status:"pending",promise,signal});
        return {group,key,promise};
      });
      const settled=await Promise.allSettled(batchEntries.map(entry=>entry.promise));
      const batchFailed=settled.some(result=>result.status==="rejected");

      if(!batchFailed){
        settled.forEach((result,index)=>{
          const entry=batchEntries[index];
          const value=result.value;
          if(smokeForecastCache.get(entry.key)?.promise===entry.promise){
            smokeForecastCache.set(entry.key,{
              status:"resolved",
              value,
              expiresAt:Date.now()+SMOKE_FORECAST_CACHE_TTL_MS
            });
          }
          results.set(entry.key,value);
        });
      }else{
        batchEntries.forEach(entry=>{
          if(smokeForecastCache.get(entry.key)?.promise===entry.promise){
            smokeForecastCache.delete(entry.key);
          }
        });
        const failure=settled.find(result=>result.status==="rejected")?.reason;
        if(failure?.name==="AbortError" || signal.aborted) throw failure;

        // Une réponse groupée défaillante ne prive pas toute la carte de vent :
        // les foyers sont retentés séparément avec une concurrence bornée.
        await runWithConcurrency(missing,MAIN_SMOKE_CONCURRENCY,async group=>{
          try{
            const value=await fetchGroupSmokeForecast(group,signal);
            results.set(fireGroupSignature(group),value);
          }catch(err){
            if(err.name==="AbortError") throw err;
          }
        });
      }
    }

    const pendingSettled=await Promise.allSettled(pending.map(entry=>entry.promise));
    pendingSettled.forEach((result,index)=>{
      if(result.status==="fulfilled"){
        results.set(pending[index].key,result.value);
      }
    });
    return results;
  }

  function cancelMainSmokeRequests(){
    mainSmokeController?.abort();
    mainSmokeController=null;
    mainSmokeRequestId++;
    mainSmokeForecasts.clear();
    mainSmokeLayer.clearLayers();
  }

  function dataScopeFromRequest(request){
    return {
      hours:request.hours,
      radius:request.radius,
      location:{lat:request.location.lat,lon:request.location.lon}
    };
  }

  function sameDataScope(a,b){
    return Boolean(
      a && b &&
      a.hours===b.hours &&
      a.radius===b.radius &&
      a.location.lat===b.location.lat &&
      a.location.lon===b.location.lon
    );
  }

  function sourceStatusMessage(){
    if(state.loading) return "Connexion aux satellites…";
    if(state.dataStatus==="stale" && state.lastFetch){
      return `Dernières données : ${fmtClock(state.lastFetch)}`;
    }
    if(state.dataStatus==="error") return "Données indisponibles";
    if(state.lastFetch) return `Mis à jour à ${fmtClock(state.lastFetch)}`;
    return "En attente";
  }

  async function refresh({mapKey=state.mapKey,manual=false,validation=false}={}){
    clearError();
    cancelMainSmokeRequests();

    if(!mapKey){
      state.dataStatus="idle";
      state.windLoading=false;
      state.airQualityLoading=false;
      $("keyStatus").textContent="Une clé MAP_KEY est requise pour charger les détections.";
      updateUI();
      if(manual) openOnboarding();
      return "missing-key";
    }

    const requestId=++refreshRequestId;
    state.abortController?.abort();
    const controller=new AbortController();
    state.abortController=controller;
    if(validation) keyValidationController=controller;
    const request={
      mapKey,
      hours:+state.settings.hours,
      radius:+state.settings.radius,
      location:{...currentLocation()}
    };

    state.loading=true;
    state.dataStatus="loading";
    state.wind=null;
    state.windLoading=true;
    state.windError=false;
    state.windAttemptedAt=Date.now();
    state.airQuality=null;
    state.airQualityLoading=true;
    state.airQualityError=false;
    state.airQualityAttemptedAt=Date.now();
    setLoading(true);
    updateUI();

    let firesFinished=false;
    let windFinished=false;
    let airQualityFinished=false;
    const releaseController=()=>{
      if(
        firesFinished &&
        windFinished &&
        airQualityFinished &&
        requestId===refreshRequestId &&
        state.abortController===controller
      ){
        state.abortController=null;
      }
    };
    const windPromise=fetchWindForecast(
      request.location.lat,
      request.location.lon,
      controller.signal
    ).then(result=>{
      if(requestId!==refreshRequestId || controller.signal.aborted) return;
      if(!result.current) throw new Error("prévision actuelle absente");
      state.windAttemptedAt=result.forecast.retrievedAt;
      state.wind={
        ...result.current,
        retrievedAt:result.forecast.retrievedAt
      };
      state.windLoading=false;
      state.windError=false;
      updateUI();
    }).catch(err=>{
      if(requestId!==refreshRequestId || err.name==="AbortError") return;
      state.wind=null;
      state.windLoading=false;
      state.windError=true;
      updateUI();
      if(state.dataStatus!=="error"){
        addErrorNotice("Prévision du vent indisponible. Les détections restent accessibles.");
      }
    }).finally(()=>{
      windFinished=true;
      releaseController();
    });
    void windPromise;

    const airQualityPromise=fetchAirQuality(
      request.location,
      controller.signal
    ).then(airQuality=>{
      if(requestId!==refreshRequestId || controller.signal.aborted) return;
      state.airQuality=airQuality;
      state.airQualityAttemptedAt=airQuality.retrievedAt;
      state.airQualityLoading=false;
      state.airQualityError=false;
      updateUI();
    }).catch(err=>{
      if(requestId!==refreshRequestId || err.name==="AbortError") return;
      state.airQuality=null;
      state.airQualityLoading=false;
      state.airQualityError=true;
      updateUI();
    }).finally(()=>{
      airQualityFinished=true;
      releaseController();
    });
    void airQualityPromise;

    let result="success";
    try{
      const fireSettled=await Promise.allSettled(
        SOURCES.map(src=>fetchSource(src,controller.signal,request))
      );
      if(requestId!==refreshRequestId || controller.signal.aborted) return "aborted";

      const availableSources=fireSettled.filter(x=>x.status==="fulfilled");
      if(!availableSources.length){
        const reason=fireSettled.find(x=>x.status==="rejected")?.reason?.message || "Aucune source disponible";
        throw new Error(reason);
      }

      const successful=availableSources.flatMap(x=>x.value);
      const cut=Date.now()-request.hours*36e5;
      state.points=dedupe(successful)
        .filter(p=>p.time>=cut && haversine(request.location,p)<=request.radius)
        .sort((a,b)=>b.time-a.time);
      state.lastFetch=new Date();
      state.dataScope=dataScopeFromRequest(request);
      state.dataStatus="ready";

      renderLayers();
      updateUI();
      void loadMainSmokeForecasts();

      const failed=fireSettled.filter(x=>x.status==="rejected").length;
      if(failed){
        addErrorNotice(
          `${failed} source${failed>1?"s":""} satellite${failed>1?"s":""} indisponible${failed>1?"s":""}, mais les autres données ont été chargées.`
        );
      }
    }catch(err){
      if(requestId!==refreshRequestId || err.name==="AbortError" || controller.signal.aborted){
        result="aborted";
      }else{
        result="failure";
        controller.abort(new DOMException("Données FIRMS indisponibles","AbortError"));
        const preserved=Boolean(
          sameDataScope(state.dataScope,dataScopeFromRequest(request)) && state.lastFetch
        );
        state.wind=null;
        state.windLoading=false;
        state.windError=true;
        state.airQuality=null;
        state.airQualityLoading=false;
        state.airQualityError=true;
        if(preserved){
          state.dataStatus="stale";
        }else{
          state.points=[];
          state.lastFetch=null;
          state.dataScope=null;
          state.dataStatus="error";
          renderLayers();
        }
        updateUI();
        if(!validation){
          showError(preserved
            ?`Actualisation impossible : ${err.message}. Les dernières détections restent affichées avec leur heure de mise à jour.`
            :`Impossible de charger les données : ${err.message}. Vérifiez la clé et la connexion.`
          );
        }
      }
    }finally{
      firesFinished=true;
      if(validation && keyValidationController===controller){
        keyValidationController=null;
      }
      if(requestId===refreshRequestId){
        state.loading=false;
        releaseController();
        setLoading(false);
        updateUI();
      }
    }
    return result;
  }

  function setLoading(on){
    const buttons=[$("refreshTop"),$("refreshBtn")];
    buttons.forEach(btn=>btn.disabled=on);
    $("refreshTop").innerHTML=on
      ?'<span class="loading-spin"></span><span class="refresh-button-label">Patientez</span>'
      :'<span class="material-symbols-outlined" aria-hidden="true">refresh</span><span class="refresh-button-label">Actualiser</span>';
    $("refreshTop").setAttribute(
      "aria-label",
      on?"Actualisation de la carte en cours":"Actualiser la carte"
    );
    $("refreshTop").title=on?"Actualisation en cours":"Actualiser la carte";
    $("refreshBtn").innerHTML=on
      ?'<span class="loading-spin"></span> Chargement…'
      :'<span class="material-symbols-outlined" aria-hidden="true">satellite_alt</span> Lancer la carte';
    $("sourceStatus").classList.toggle("loading",on);
    $("mapStage").setAttribute("aria-busy",String(on));
    setSourceStatus(sourceStatusMessage());
  }

  function hull(points){
    if(points.length<3) return points;
    const pts=[...points].sort((a,b)=>a.x===b.x?a.y-b.y:a.x-b.x);
    const cross=(o,a,b)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x);
    const lower=[];
    for(const p of pts){while(lower.length>=2&&cross(lower.at(-2),lower.at(-1),p)<=0)lower.pop();lower.push(p)}
    const upper=[];
    for(const p of [...pts].reverse()){while(upper.length>=2&&cross(upper.at(-2),upper.at(-1),p)<=0)upper.pop();upper.push(p)}
    lower.pop();upper.pop();return lower.concat(upper);
  }

  function clusterLatLng(points,maxKm){
    const groups=[],used=new Set();
    for(let i=0;i<points.length;i++){
      if(used.has(i)) continue;
      const group=[points[i]];used.add(i);let changed=true;
      while(changed){
        changed=false;
        for(let j=0;j<points.length;j++){
          if(used.has(j)) continue;
          if(group.some(p=>haversine(p,points[j])<=maxKm)){
            group.push(points[j]);used.add(j);changed=true;
          }
        }
      }
      groups.push(group);
    }
    return groups;
  }

  function buildFireGroups(points){
    if(!points.length) return [];

    // A detection joins another when both are within 5 km and 18 hours.
    // Transitive links let successive satellite passes describe one evolving event.
    const maxKm=5;
    const maxMs=18*36e5;
    const latStep=maxKm/111;
    const lonStep=maxKm/(111*Math.max(.2,Math.cos(rad(currentLocation().lat))));
    const timeStep=6*36e5;
    const parent=points.map((_,i)=>i);
    const rank=points.map(()=>0);
    const buckets=new Map();

    const find=i=>{
      while(parent[i]!==i){
        parent[i]=parent[parent[i]];
        i=parent[i];
      }
      return i;
    };
    const union=(a,b)=>{
      let ra=find(a),rb=find(b);
      if(ra===rb) return;
      if(rank[ra]<rank[rb]) [ra,rb]=[rb,ra];
      parent[rb]=ra;
      if(rank[ra]===rank[rb]) rank[ra]++;
    };
    const key=(x,y,t)=>`${x}|${y}|${t}`;

    for(let i=0;i<points.length;i++){
      const p=points[i];
      const x=Math.floor(p.lon/lonStep);
      const y=Math.floor(p.lat/latStep);
      const t=Math.floor(p.time/timeStep);

      for(let dx=-1;dx<=1;dx++){
        for(let dy=-1;dy<=1;dy++){
          for(let dt=-3;dt<=3;dt++){
            const candidates=buckets.get(key(x+dx,y+dy,t+dt));
            if(!candidates) continue;
            for(const j of candidates){
              const q=points[j];
              if(Math.abs(p.time-q.time)<=maxMs && haversine(p,q)<=maxKm) union(i,j);
            }
          }
        }
      }

      const ownKey=key(x,y,t);
      if(!buckets.has(ownKey)) buckets.set(ownKey,[]);
      buckets.get(ownKey).push(i);
    }

    const components=new Map();
    for(let i=0;i<points.length;i++){
      const root=find(i);
      if(!components.has(root)) components.set(root,[]);
      components.get(root).push(points[i]);
    }

    return [...components.values()].map((items,index)=>{
      items.sort((a,b)=>b.time-a.time);
      const lats=items.map(p=>p.lat),lons=items.map(p=>p.lon);
      const minLat=Math.min(...lats),maxLat=Math.max(...lats);
      const minLon=Math.min(...lons),maxLon=Math.max(...lons);
      const center={
        lat:items.reduce((sum,p)=>sum+p.lat,0)/items.length,
        lon:items.reduce((sum,p)=>sum+p.lon,0)/items.length
      };
      const extent=items.length>1
        ?haversine({lat:minLat,lon:minLon},{lat:maxLat,lon:maxLon})
        :0;
      const frps=items.map(p=>p.frp).filter(Number.isFinite);
      return {
        id:index,
        points:items,
        count:items.length,
        latest:items[0].time,
        earliest:items.at(-1).time,
        center,
        bounds:[[minLat,minLon],[maxLat,maxLon]],
        nearest:Math.min(...items.map(p=>haversine(currentLocation(),p))),
        extent,
        sensors:[...new Set(items.map(p=>p.sensor))],
        maxFrp:frps.length?Math.max(...frps):null
      };
    }).sort((a,b)=>b.latest-a.latest || b.count-a.count);
  }

  function focusFireGroup(group){
    if(!group) return;
    if(group.count===1){
      map.flyTo([group.center.lat,group.center.lon],Math.max(map.getZoom(),11),{duration:.45});
      return;
    }
    const bounds=L.latLngBounds(group.bounds);
    map.fitBounds(bounds,{padding:[50,50],maxZoom:12,animate:true,duration:.45});
  }

  function selectSignificantFireGroups(limit=map.getZoom()<=8?10:MAIN_SMOKE_MAX_GROUPS){
    return state.fireGroups
      .filter(group=>group.count>=15)
      .sort((a,b)=>b.count-a.count || b.latest-a.latest)
      .slice(0,limit);
  }

  function openMapGroupDetail(group){
    if(!group) return;
    focusFireGroup(group);
    openDetail(group);
  }

  function renderFireGroupOverlays(){
    fireGroupLayer.clearLayers();

    const zoom=map.getZoom();
    const significant=selectSignificantFireGroups();

    for(const group of significant){
      const age=(Date.now()-group.latest)/36e5;
      const color=colorForAge(age);
      const radiusMeters=Math.max(
        1200,
        Math.min(15000,900+group.extent*300+Math.sqrt(group.count)*26)
      );

      // Halo léger : donne une sensation d'échelle sans masquer la carte.
      L.circle([group.center.lat,group.center.lon],{
        radius:radiusMeters,
        color,
        weight:1.25,
        opacity:.42,
        fillColor:color,
        fillOpacity:zoom<=9?.045:.025,
        interactive:false
      }).addTo(fireGroupLayer);

      // Contour très discret uniquement pour les grands groupes et à zoom rapproché.
      if(group.count>=100 && zoom>=9){
        const outline=hull(group.points.map(p=>({x:p.lon,y:p.lat,p})));
        if(outline.length>=3){
          L.polygon(outline.map(q=>[q.p.lat,q.p.lon]),{
            color,
            weight:1.5,
            opacity:.62,
            fill:false,
            dashArray:"5 6",
            lineJoin:"round",
            interactive:false
          }).addTo(fireGroupLayer);
        }
      }

      L.circleMarker([group.center.lat,group.center.lon],{
        radius:zoom<=9?8:6,
        color:"#2b160f",
        weight:1.5,
        opacity:.95,
        fillColor:color,
        fillOpacity:.96,
        interactive:true,
        className:"fire-group-marker"
      })
      .bindTooltip(`🔥 ${group.count.toLocaleString("fr-FR")}`,{
        permanent:zoom<=10,
        direction:"top",
        offset:[0,-7],
        className:"fire-group-label"
      })
      .on("click",()=>openMapGroupDetail(group))
      .addTo(fireGroupLayer);
    }
  }

  function renderLayers(){
    pointLayer.clearLayers();
    hullLayer.clearLayers();
    state.fireGroups=buildFireGroups(state.points);

    const now=Date.now();
    const mode=state.settings.mode;

    if(mode!=="hulls"){
      const batch=L.layerGroup();
      for(const p of state.points){
        const age=(now-p.time)/36e5;
        L.circleMarker([p.lat,p.lon],{
          renderer,
          radius:age<3?5.2:4,
          color:"#2b160f",weight:1,opacity:.9,
          fillColor:colorForAge(age),fillOpacity:.94,
          interactive:false
        }).addTo(batch);
      }
      batch.addTo(pointLayer);
    }

    if(mode!=="points"){
      const bins=[
        {min:0,max:6,color:"#ff3d2e",opacity:.20},
        {min:6,max:18,color:"#ff9a3c",opacity:.16},
        {min:18,max:36,color:"#ffd85a",opacity:.13},
        {min:36,max:73,color:"#72b7ff",opacity:.10}
      ];
      for(const bin of bins){
        const pts=state.points.filter(p=>{
          const h=(now-p.time)/36e5;return h>=bin.min&&h<bin.max;
        });
        for(const group of clusterLatLng(pts,7)){
          if(group.length<3) continue;
          const local=group.map(p=>({x:p.lon,y:p.lat,p}));
          const hp=hull(local);
          L.polygon(hp.map(q=>[q.p.lat,q.p.lon]),{
            renderer,color:bin.color,weight:2,dashArray:"6 5",
            fillColor:bin.color,fillOpacity:bin.opacity,
            interactive:false
          }).addTo(hullLayer);
        }
      }
    }

    renderFireGroupOverlays();
    renderMainSmokeLayers();
  }

  function relTime(t){
    const m=Math.max(0,Math.round((Date.now()-t)/60000));
    if(m<60) return `${m} min`;
    const h=Math.floor(m/60),mm=m%60;
    return mm?`${h} h ${String(mm).padStart(2,"0")}`:`${h} h`;
  }

  function fmtDate(t){
    return new Intl.DateTimeFormat("fr-FR",{
      day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit",
      timeZone:"Europe/Paris"
    }).format(new Date(t));
  }

  function fmtClock(t){
    return new Intl.DateTimeFormat("fr-FR",{
      hour:"2-digit",minute:"2-digit"
    }).format(new Date(t));
  }

  function escapeHtml(value){
    return String(value??"").replace(/[&<>"']/g,m=>({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
    }[m]));
  }

  function updateUI(){
    const probableGroups=state.fireGroups.filter(group=>group.count>1);
    const hasResolvedData=Boolean(state.lastFetch);
    const hasCurrentEmptyResult=state.dataStatus==="ready" && hasResolvedData && !state.points.length;
    const groupCount=hasResolvedData
      ?probableGroups.length.toLocaleString("fr-FR")
      :"—";
    $("groupCount").textContent=groupCount;
    $("overviewGroupCount").textContent=groupCount;
    $("count").textContent=hasResolvedData
      ?`${state.points.length.toLocaleString("fr-FR")} détection${state.points.length>1?"s":""} NASA`
      :state.loading
        ?"Chargement des détections…"
        :state.dataStatus==="error"
          ?"Détections indisponibles"
          :"Données en attente";
    const smoke=smokeRisk();
    const smokeColor=statusColor(smoke.level);
    $("smokeRisk").textContent=smoke.level;
    $("smokeRisk").style.color=smokeColor;
    $("overviewSmokeRisk").textContent=smoke.level;
    $("overviewSmokeRisk").style.color=smokeColor;
    $("riskBadge").style.color=smokeColor;
    $("riskBadge").style.borderColor=smokeColor;
    $("riskBadge").style.backgroundColor=`${smokeColor}1f`;
    $("riskBadge").querySelector(".material-symbols-outlined").textContent=
      hasCurrentEmptyResult?"search_off":smoke.level==="Indisponible"?"help_outline":"warning";
    $("smokeCity").textContent=currentLocation().name;
    $("smokeStatus").textContent=smoke.level;
    $("smokeStatus").style.color=smokeColor;
    $("smokeExplanation").textContent=smoke.explanation;
    const airQuality=state.airQuality;
    const airCategory=airQuality?.category||"Indisponible";
    const airColor=airQualityColor(airCategory);
    const airValue=airQuality?Math.round(airQuality.value):null;
    const airLevel=airQuality?airQualityLevel(airCategory):0;
    $("airQualityBadge").dataset.level=String(airLevel);
    $("airQualityBadge").style.setProperty(
      "--air-position",
      airLevel?`${((airLevel-.5)/6)*100}%`:"50%"
    );
    $("airQualityBadge").style.setProperty("--air-current",airColor);
    $("airQualityBadge").querySelectorAll(".air-quality-segment").forEach((segment,index)=>{
      segment.classList.toggle("active",index<airLevel);
      segment.classList.toggle("current",index===airLevel-1);
    });
    $("airQualityBadge").setAttribute(
      "aria-label",
      airQuality
        ?`Qualité de l’air estimée : ${airCategory}, indice européen EAQI ${airValue}`
        :state.airQualityLoading
          ?"Qualité de l’air estimée : chargement en cours"
          :"Qualité de l’air estimée : indisponible"
    );
    $("airQualityCity").textContent=currentLocation().name;
    $("airQualityStatus").textContent=airQuality
      ?`${airCategory} · EAQI ${airValue}`
      :state.airQualityLoading
        ?"Mise à jour de la qualité de l’air…"
        :"Indisponible";
    $("airQualityStatus").style.color=airColor;
    $("airQualityPollutant").textContent=airQuality
      ?airQuality.determining.length
        ?`Polluant${airQuality.determining.length>1?"s":""} déterminant${airQuality.determining.length>1?"s":""} : ${airQuality.determining.join(" et ")}`
        :"Aucun polluant déterminant"
      :state.airQualityLoading
        ?"Estimation CAMS en cours."
        :state.airQualityAttemptedAt
          ?`Dernier essai à ${fmtClock(state.airQualityAttemptedAt)}.`
          :"Aucune estimation disponible.";
    $("airQualityRetrieved").textContent=airQuality
      ?`Récupérée à ${fmtClock(airQuality.retrievedAt)}`
      :"";
    const distances=state.points.map(p=>haversine(currentLocation(),p));
    $("nearest").textContent=distances.length
      ?`${Math.min(...distances).toFixed(0)} km`
      :hasCurrentEmptyResult
        ?"Aucune"
        :"—";
    if(distances.length){
      const nearestIndex=distances.indexOf(Math.min(...distances));
      $("nearestDirection").textContent=compassDirection(bearing(currentLocation(),state.points[nearestIndex]));
      $("nearestAge").textContent=`· ${relTime(state.points[nearestIndex].time)}`;
    }else{
      $("nearestDirection").textContent="";
      $("nearestAge").textContent="";
    }
    setSourceStatus(sourceStatusMessage());

    $("windCity").textContent=currentLocation().name;

    if(state.wind){
      const direction=directionName(state.wind.direction);
      const arrowAngle=(state.wind.direction+180)%360;
      const retrieved=state.wind.retrievedAt?` · Prévision reçue à ${fmtClock(state.wind.retrievedAt)}`:"";

      $("windArrow").style.transform=`rotate(${arrowAngle}deg)`;
      $("windArrow").textContent="↑";
      $("windSpeed").textContent=`${Math.round(state.wind.speed)} km/h`;
      $("windNeedle").style.transform=`rotate(${arrowAngle}deg)`;
      $("windDetailSpeed").textContent=`${Math.round(state.wind.speed)} km/h · vent venant du ${direction}`;
      $("windDetailDirection").textContent=state.wind.gusts!==null
        ?`Rafales jusqu'à ${Math.round(state.wind.gusts)} km/h${retrieved}`
        :`Rafales indisponibles${retrieved}`;
    }else{
      $("windArrow").style.transform="rotate(0deg)";
      $("windNeedle").style.transform="rotate(0deg)";
      $("windSpeed").textContent="—";
      $("windDetailSpeed").textContent=state.windLoading?"Mise à jour du vent…":"Prévision du vent indisponible";
      $("windDetailDirection").textContent=state.windLoading
        ?"Les détections restent accessibles."
        :state.windAttemptedAt
          ?`Dernier essai à ${fmtClock(state.windAttemptedAt)} · aucune ancienne prévision affichée.`
          :"Aucune ancienne donnée n'est présentée comme actuelle.";
    }

    const feed=$("feed");
    if(!state.fireGroups.length){
      const empty=state.lastFetch
        ?{icon:"search_off",message:"Aucune détection dans la fenêtre choisie."}
        :state.loading
          ?{icon:"satellite_alt",message:"Chargement des détections en cours…"}
          :state.dataStatus==="error"
            ?{icon:"cloud_off",message:"Les détections sont indisponibles pour le moment."}
            :{icon:"satellite_alt",message:"En attente des données…"};
      feed.innerHTML=`<div class="empty-state"><span class="material-symbols-outlined" aria-hidden="true">${empty.icon}</span>${empty.message}</div>`;
      return;
    }

    feed.innerHTML=state.fireGroups.slice(0,24).map((group,index)=>{
      const age=(Date.now()-group.latest)/36e5;
      const distance=`${group.nearest.toFixed(0)} km de ${escapeHtml(currentLocation().name)}`;
      if(group.count===1){
        const p=group.points[0];
        return `<div class="feed-item" data-group="${index}" role="button" tabindex="0" aria-label="Ouvrir le détail de cette détection">
          <span class="feed-accent" style="background:${colorForAge(age)}"></span>
          <div>
            <div class="feed-main">Détection isolée · ${distance}</div>
            <div class="feed-sub">${escapeHtml(p.sensor)}${p.frp!==null?` · FRP ${p.frp.toFixed(1)} MW`:""} · ${fmtDate(p.time)}</div>
          </div>
          <span class="badge">${relTime(p.time)}</span>
        </div>`;
      }

      const extent=group.extent<1?"moins de 1 km":`environ ${Math.max(1,Math.round(group.extent))} km`;
      const sources=`${group.sensors.length} source${group.sensors.length>1?"s":""} satellite${group.sensors.length>1?"s":""}`;
      const frp=group.maxFrp!==null?` · FRP max ${group.maxFrp.toFixed(1)} MW`:"";
      return `<div class="feed-item" data-group="${index}" role="button" tabindex="0" aria-label="Ouvrir le détail de ce foyer probable">
        <span class="feed-accent" style="background:${colorForAge(age)}"></span>
        <div>
          <div class="feed-main"><strong>Foyer probable</strong> · ${distance} · ${group.count.toLocaleString("fr-FR")} détections</div>
          <div class="feed-sub">Étendue observée : ${extent} · ${sources}${frp}</div>
        </div>
        <span class="badge">${relTime(group.latest)}</span>
      </div>`;
    }).join("");
  }

  function riskLabelForGroup(group){
    const age=(Date.now()-group.latest)/36e5;
    if(age<3) return {label:"Critique",color:colorForAge(age)};
    if(age<12) return {label:"Élevé",color:colorForAge(age)};
    if(age<24) return {label:"À surveiller",color:colorForAge(age)};
    return {label:"Ancien",color:colorForAge(age)};
  }

  function showToast(message){
    const toast=$("toast");
    toast.textContent=message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer=setTimeout(()=>toast.classList.remove("show"),2600);
  }

  function ensureDetailMap(){
    if(detailMap) return;
    detailMap=L.map("detailMap",{
      zoomControl:false,
      attributionControl:true,
      dragging:false,
      scrollWheelZoom:false,
      doubleClickZoom:false,
      boxZoom:false,
      keyboard:false,
      tap:false
    });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{
      maxZoom:19,
      attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
    }).addTo(detailMap);
    detailWindLayer=L.layerGroup().addTo(detailMap);
    detailLocalityLayer=L.layerGroup().addTo(detailMap);
  }

  function destinationPoint(start,degrees,distanceKm){
    const angular=distanceKm/6371;
    const bearingRadians=rad(degrees);
    const lat1=rad(start.lat);
    const lon1=rad(start.lon);
    const lat2=Math.asin(
      Math.sin(lat1)*Math.cos(angular)+
      Math.cos(lat1)*Math.sin(angular)*Math.cos(bearingRadians)
    );
    const lon2=lon1+Math.atan2(
      Math.sin(bearingRadians)*Math.sin(angular)*Math.cos(lat1),
      Math.cos(angular)-Math.sin(lat1)*Math.sin(lat2)
    );
    return {
      lat:lat2*180/Math.PI,
      lon:((lon2*180/Math.PI+540)%360)-180
    };
  }

  function averageAirMovement(samples){
    const usable=samples.filter(sample=>
      sample && sample.speed!==null && sample.direction!==null &&
      sample.speed>=MIN_DIRECTIONAL_WIND_KMH
    );
    if(!usable.length) return null;
    let east=0;
    let north=0;
    for(const sample of usable){
      const travel=(sample.direction+180)%360;
      east+=Math.sin(rad(travel))*sample.speed;
      north+=Math.cos(rad(travel))*sample.speed;
    }
    east/=usable.length;
    north/=usable.length;
    return {
      speed:Math.hypot(east,north),
      direction:(Math.atan2(east,north)*180/Math.PI+360)%360
    };
  }

  function buildSmokeRoute(origin,horizons){
    const future=horizons
      .filter(item=>
        item.hours>0 && item.speed!==null && item.direction!==null &&
        item.speed>=MIN_DIRECTIONAL_WIND_KMH
      )
      .sort((a,b)=>a.hours-b.hours);
    const now=horizons.find(item=>
      item.hours===0 && item.speed!==null && item.direction!==null &&
      item.speed>=MIN_DIRECTIONAL_WIND_KMH
    )||null;
    const raw=[];
    let previous=now;
    let previousHours=0;

    for(const item of future){
      const movement=averageAirMovement([previous,item]);
      if(!movement) continue;
      const duration=item.hours-previousHours;
      raw.push({
        startHours:previousHours,
        endHours:item.hours,
        direction:movement.direction,
        distance:movement.speed*duration
      });
      previous=item;
      previousHours=item.hours;
    }

    const total=raw.reduce((sum,item)=>sum+item.distance,0);
    const segments=[];
    const positions=[origin];
    let position=origin;
    for(const item of raw){
      const end=destinationPoint(position,item.direction,item.distance);
      segments.push({start:position,end,...item});
      positions.push(end);
      position=end;
    }
    return {origin,segments,positions,totalDistance:total};
  }

  function scaleSmokeRoute(route,scale){
    const segments=[];
    const positions=[route.origin];
    let position=route.origin;
    for(const segment of route.segments){
      const end=destinationPoint(position,segment.direction,segment.distance*scale);
      segments.push({...segment,start:position,end});
      positions.push(end);
      position=end;
    }
    return {segments,positions,compressed:scale<1,scale};
  }

  function buildSmokeDisplayRoute(route){
    // La géométrie métier reste entière. Seule sa copie destinée à la petite carte
    // est réduite au-delà de 120 km, comme dans la visualisation validée.
    const scale=route.totalDistance>120?120/route.totalDistance:1;
    return scaleSmokeRoute(route,scale);
  }

  function buildMainSmokeDisplayRoute(route){
    const detailDisplay=buildSmokeDisplayRoute(route);
    const size=map.getSize();
    const padding=34;
    const fits=scale=>{
      const candidate=scaleSmokeRoute(route,scale);
      return candidate.positions.every(position=>{
        const point=map.latLngToContainerPoint([position.lat,position.lon]);
        return (
          point.x>=padding &&
          point.x<=size.x-padding &&
          point.y>=padding &&
          point.y<=size.y-padding
        );
      });
    };
    if(fits(detailDisplay.scale)) return detailDisplay;

    // Réduction uniquement visuelle : les horizons et la géométrie physique
    // restent inchangés pour le détail et le filtrage des localités.
    let low=0;
    let high=detailDisplay.scale;
    for(let index=0;index<12;index++){
      const middle=(low+high)/2;
      if(fits(middle)) low=middle;
      else high=middle;
    }
    return scaleSmokeRoute(route,low);
  }

  function corridorHalfWidthKm(hours){
    // Largeur prudente de lecture du corridor, pas une mesure atmosphérique.
    // Elle augmente avec l'horizon pour représenter l'incertitude croissante.
    const widths=[
      {hours:0,width:2.5},
      {hours:3,width:5},
      {hours:6,width:9},
      {hours:12,width:16}
    ];
    if(hours<=0) return widths[0].width;
    for(let i=1;i<widths.length;i++){
      if(hours<=widths[i].hours){
        const before=widths[i-1];
        const after=widths[i];
        const progress=(hours-before.hours)/(after.hours-before.hours);
        return before.width+(after.width-before.width)*progress;
      }
    }
    return widths.at(-1).width;
  }

  function projectPointToSegmentKm(point,start,end){
    const segmentLength=haversine(start,end);
    if(!segmentLength) return {progress:0,distance:haversine(point,start)};
    const angularDistance=haversine(start,point)/6371;
    const angleFromStart=rad(bearing(start,point));
    const segmentAngle=rad(bearing(start,end));
    const difference=angleFromStart-segmentAngle;
    const crossTrack=Math.asin(Math.max(
      -1,
      Math.min(1,Math.sin(angularDistance)*Math.sin(difference))
    ))*6371;
    const alongTrack=Math.atan2(
      Math.sin(angularDistance)*Math.cos(difference),
      Math.cos(angularDistance)
    )*6371;
    const progress=Math.max(0,Math.min(1,alongTrack/segmentLength));
    const distance=alongTrack<0
      ?haversine(point,start)
      :alongTrack>segmentLength
        ?haversine(point,end)
        :Math.abs(crossTrack);
    return {progress,distance};
  }

  function localityHorizon(hours){
    return LOCALITY_HORIZONS.find(item=>hours<=item.maxHours)?.key || null;
  }

  function matchPointToCorridor(point,route){
    // La boîte ou le rayon Overpass ne suffit jamais : chaque point est reprojeté
    // sur les segments physiques successifs puis comparé à la largeur locale.
    for(const segment of route.segments){
      const projection=projectPointToSegmentKm(point,segment.start,segment.end);
      const hours=segment.startHours+
        (segment.endHours-segment.startHours)*projection.progress;
      const halfWidth=corridorHalfWidthKm(hours);
      const horizon=localityHorizon(hours);
      if(horizon && projection.distance<=halfWidth){
        return {
          horizon,
          hours,
          distance:projection.distance,
          halfWidth,
          ratio:projection.distance/halfWidth
        };
      }
    }
    return null;
  }

  function trimSmokeRoute(route,maxDistanceKm){
    let remaining=maxDistanceKm;
    const segments=[];
    const positions=[route.origin];
    for(const segment of route.segments){
      if(remaining<=0) break;
      const used=Math.min(segment.distance,remaining);
      const progress=segment.distance?used/segment.distance:0;
      const end=progress>=1
        ?segment.end
        :destinationPoint(segment.start,segment.direction,used);
      segments.push({
        ...segment,
        end,
        endHours:segment.startHours+
          (segment.endHours-segment.startHours)*progress,
        distance:used
      });
      positions.push(end);
      remaining-=used;
      if(progress<1) break;
    }
    return {
      segments,
      positions,
      clipped:route.totalDistance>maxDistanceKm
    };
  }

  function buildOverpassRequest(route){
    const queryRoute=trimSmokeRoute(route,OVERPASS_ROUTE_LIMIT_KM);
    const lastHours=queryRoute.segments.at(-1)?.endHours || 0;
    const radiusMeters=Math.ceil(
      (corridorHalfWidthKm(lastHours)+OVERPASS_MARGIN_KM)*1000
    );
    const coordinates=queryRoute.positions
      .map(point=>`${point.lat.toFixed(5)},${point.lon.toFixed(5)}`)
      .join(",");

    // Une seule requête Overpass suit la ligne calculée. Les quatre catégories
    // utiles sont demandées, puis le corridor est filtré précisément ci-dessous.
    const query=[
      `[out:json][timeout:${OVERPASS_QUERY_TIMEOUT_SECONDS}][maxsize:${OVERPASS_QUERY_MAXSIZE_BYTES}];`,
      `nwr["place"~"^(city|town|village|hamlet)$"]["name"](around:${radiusMeters},${coordinates});`,
      "out center tags;"
    ].join("");
    const signature=queryRoute.positions
      .map(point=>`${point.lat.toFixed(3)},${point.lon.toFixed(3)}`)
      .join("|");
    return {
      query,
      key:`${LOCALITY_CACHE_VERSION}|${radiusMeters}|${signature}`,
      clipped:queryRoute.clipped,
      radiusMeters
    };
  }

  function normalizeLocalityName(name){
    return String(name||"")
      .normalize("NFKD")
      .replace(/\p{Diacritic}/gu,"")
      .trim()
      .toLocaleLowerCase();
  }

  function parseOverpassLocalities(data){
    if(!data || !Array.isArray(data.elements)){
      throw new Error("réponse Overpass invalide");
    }

    const parsed=[];
    for(const element of data.elements){
      if(
        !["node","way","relation"].includes(element?.type) ||
        !Number.isFinite(+element?.id)
      ) continue;
      const place=String(element?.tags?.place||"");
      const name=String(element?.tags?.["name:fr"]||element?.tags?.name||"").trim();
      if(!LOCALITY_TYPES.has(place) || !name) continue;
      const directLat=finiteNumber(element.lat);
      const directLon=finiteNumber(element.lon);
      const lat=finiteNumber(element.lat??element.center?.lat);
      const lon=finiteNumber(element.lon??element.center?.lon);
      if(
        lat===null || lon===null ||
        lat < -90 || lat > 90 || lon < -180 || lon > 180
      ) continue;
      parsed.push({
        id:`${element.type||"object"}:${element.id}`,
        osmType:String(element.type||""),
        name,
        normalizedName:normalizeLocalityName(name),
        place,
        lat,
        lon,
        directCoordinates:directLat!==null && directLon!==null
      });
    }

    // OSM peut représenter un même lieu par un nœud et une relation. Deux objets
    // de même nom à moins de 4 km sont fusionnés ; les coordonnées directes priment.
    parsed.sort((a,b)=>
      Number(b.directCoordinates)-Number(a.directCoordinates) ||
      a.name.localeCompare(b.name,"fr")
    );
    const deduped=[];
    for(const locality of parsed){
      const duplicate=deduped.find(existing=>
        existing.normalizedName===locality.normalizedName &&
        haversine(existing,locality)<=4
      );
      if(!duplicate) deduped.push(locality);
    }
    return deduped;
  }

  async function fetchWithTimeout(url,options,parentSignal,timeoutMs,timeoutMessage="Délai dépassé"){
    const controller=new AbortController();
    const abortFromParent=()=>controller.abort(parentSignal?.reason);
    if(parentSignal?.aborted) abortFromParent();
    else parentSignal?.addEventListener("abort",abortFromParent,{once:true});
    const timeout=setTimeout(()=>{
      controller.abort(new DOMException(timeoutMessage,"TimeoutError"));
    },timeoutMs);
    try{
      return await fetch(url,{...options,signal:controller.signal});
    }catch(err){
      if(controller.signal.reason?.name==="TimeoutError"){
        throw controller.signal.reason;
      }
      throw err;
    }finally{
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort",abortFromParent);
    }
  }

  async function readTextWithLimit(response,maxBytes){
    if(!response.body?.getReader){
      const text=await response.text();
      if(new Blob([text]).size>maxBytes) throw new Error("volume Overpass excessif");
      return text;
    }
    const reader=response.body.getReader();
    const decoder=new TextDecoder();
    let total=0;
    let text="";
    while(true){
      const {done,value}=await reader.read();
      if(done) break;
      total+=value.byteLength;
      if(total>maxBytes){
        await reader.cancel();
        throw new Error("volume Overpass excessif");
      }
      text+=decoder.decode(value,{stream:true});
    }
    return text+decoder.decode();
  }

  async function fetchOverpassLocalities(route,signal){
    const request=buildOverpassRequest(route);
    const cached=localityCache.get(request.key);
    if(cached?.status==="resolved"){
      return {localities:cached.localities,request,fromCache:true};
    }
    if(cached?.status==="pending" && !cached.signal?.aborted){
      const localities=await cached.promise;
      return {localities,request,fromCache:true};
    }

    const promise=(async()=>{
      const response=await fetchWithTimeout(
        OVERPASS_ENDPOINT,
        {
          method:"POST",
          headers:{
            "Accept":"application/json",
            "Content-Type":"application/x-www-form-urlencoded;charset=UTF-8"
          },
          body:`data=${encodeURIComponent(request.query)}`,
          cache:"no-store"
        },
        signal,
        OVERPASS_TIMEOUT_MS,
        "Délai Overpass dépassé"
      );
      if(!response.ok){
        throw new Error(response.status===429
          ?"Overpass temporairement limité (429)"
          :`Overpass indisponible (${response.status})`
        );
      }
      const text=await readTextWithLimit(response,OVERPASS_MAX_RESPONSE_BYTES);
      if(!text) throw new Error("réponse Overpass vide");
      let data;
      try{data=JSON.parse(text)}catch{throw new Error("réponse Overpass invalide")}
      return parseOverpassLocalities(data);
    })();

    localityCache.set(request.key,{status:"pending",promise,signal});
    try{
      const localities=await promise;
      localityCache.set(request.key,{status:"resolved",localities});
      return {localities,request,fromCache:false};
    }catch(err){
      if(localityCache.get(request.key)?.promise===promise){
        localityCache.delete(request.key);
      }
      throw err;
    }
  }

  function localityTypeRank(place){
    return ({city:0,town:1,village:2,hamlet:3})[place]??4;
  }

  function evaluateWatchedCity(route,analysis){
    const location=currentLocation();
    if(analysis.kind==="changing"){
      const match=matchPointToCorridor(location,route);
      return {
        locality:match?{
          id:"watched-city",
          name:location.name,
          normalizedName:normalizeLocalityName(location.name),
          place:"watched",
          lat:location.lat,
          lon:location.lon,
          watched:true,
          ...match
        }:null,
        message:"Le vent change beaucoup : la situation reste difficile à anticiper."
      };
    }
    if(analysis.kind==="unavailable"){
      return {
        locality:null,
        message:`Impossible d’évaluer ${location.name} pour le moment.`
      };
    }
    if(analysis.kind==="weak"){
      return {
        locality:null,
        message:`Le vent est très faible : impossible d’évaluer ${location.name} pour le moment.`
      };
    }

    const match=matchPointToCorridor(location,route);
    if(!match){
      return {
        locality:null,
        message:`${location.name} ne semble pas dans l’axe estimé actuellement.`
      };
    }
    const messages={
      "0-3":`${location.name} pourrait se trouver au début du tracé estimé des fumées.`,
      "3-6":`${location.name} pourrait se trouver dans la suite du tracé estimé des fumées.`,
      "6-12":`${location.name} pourrait se trouver vers la fin du tracé estimé des fumées.`
    };
    return {
      locality:{
        id:"watched-city",
        name:location.name,
        normalizedName:normalizeLocalityName(location.name),
        place:"watched",
        lat:location.lat,
        lon:location.lon,
        watched:true,
        ...match
      },
      message:messages[match.horizon]
    };
  }

  function selectLocalities(candidates,route,watchedLocality){
    const matched=candidates.map(locality=>{
      const match=matchPointToCorridor(locality,route);
      return match?{...locality,...match}:null;
    }).filter(Boolean);

    if(watchedLocality){
      const withoutWatchedDuplicate=matched.filter(locality=>
        !(
          locality.normalizedName===watchedLocality.normalizedName &&
          haversine(locality,watchedLocality)<=5
        )
      );
      withoutWatchedDuplicate.push(watchedLocality);
      matched.length=0;
      matched.push(...withoutWatchedDuplicate);
    }

    const retained=[];
    for(const horizon of LOCALITY_HORIZONS){
      const group=matched
        .filter(locality=>locality.horizon===horizon.key)
        .sort((a,b)=>
          Number(Boolean(b.watched))-Number(Boolean(a.watched)) ||
          a.distance-b.distance ||
          localityTypeRank(a.place)-localityTypeRank(b.place) ||
          a.name.localeCompare(b.name,"fr")
        )
        .slice(0,3);
      retained.push(...group);
      if(retained.length>=9) break;
    }
    return retained.slice(0,9);
  }

  function analyzeSmokeForecast(forecast){
    const valid=forecast.horizons.filter(item=>item.speed!==null && item.direction!==null);
    const directional=valid.filter(item=>item.speed>=MIN_DIRECTIONAL_WIND_KMH);
    const availableUntil=valid.length?Math.max(...valid.map(item=>item.hours)):0;
    const received=`Prévision reçue à ${fmtClock(forecast.retrievedAt)}`;
    const coverage=availableUntil
      ?"tracé fondé sur les vents prévus disponibles"
      :"direction actuelle uniquement";
    const partial=valid.length<FORECAST_HOURS.length;

    if(!valid.length){
      return {
        kind:"unavailable",
        summary:"Prévision du vent indisponible pour le moment.",
        meta:`${received} · Données horaires absentes.`
      };
    }

    if(!directional.length){
      return {
        kind:"weak",
        summary:"Le vent devrait rester très faible : la direction des fumées reste incertaine.",
        meta:`${received} · ${coverage}.`
      };
    }

    const travelDirections=directional.map(item=>({
      ...item,
      travel:(item.direction+180)%360
    }));
    const first=travelDirections[0];
    const last=travelDirections.at(-1);
    const pairChanges=[];
    for(let i=1;i<travelDirections.length;i++){
      pairChanges.push(angleDiff(travelDirections[i-1].travel,travelDirections[i].travel));
    }
    let spread=0;
    for(let i=0;i<travelDirections.length;i++){
      for(let j=i+1;j<travelDirections.length;j++){
        spread=Math.max(spread,angleDiff(travelDirections[i].travel,travelDirections[j].travel));
      }
    }
    const maxStep=pairChanges.length?Math.max(...pairChanges):0;
    const meta=`${received} · ${coverage}${partial?" · Prévision partielle":""}.`;

    if(directional.length===1){
      return {
        kind:"partial",
        summary:`Les fumées pourraient se diriger vers ${directionWithArticle(first.travel)}, mais l'évolution reste incertaine.`,
        meta
      };
    }

    if(maxStep>=75 || spread>=90){
      return {
        kind:"changing",
        summary:"Le vent devrait beaucoup changer : la direction des fumées reste incertaine.",
        meta
      };
    }

    if(spread<=30){
      let east=0;
      let north=0;
      for(const item of travelDirections){
        east+=Math.sin(rad(item.travel))*item.speed;
        north+=Math.cos(rad(item.travel))*item.speed;
      }
      const average=(Math.atan2(east,north)*180/Math.PI+360)%360;
      return {
        kind:"stable",
        summary:`Les fumées pourraient se diriger vers ${directionWithArticle(average)}. La direction devrait rester assez stable.`,
        meta
      };
    }

    return {
      kind:"turning",
      summary:`Les fumées pourraient d'abord aller vers ${directionWithArticle(first.travel)}, puis s'infléchir vers ${directionWithArticle(last.travel)}.`,
      meta
    };
  }

  function mainSmokeWeight(endHours){
    const base=endHours<=3?8:endHours<=6?13:19;
    const zoomScale=Math.max(.72,Math.min(1.08,.72+(map.getZoom()-6)*.06));
    return base*zoomScale;
  }

  function bindMainSmokeInteraction(layer,group,label){
    layer.on("click",event=>{
      L.DomEvent.stopPropagation(event);
      openMapGroupDetail(group);
    });
    if(layer.bindTooltip){
      layer.bindTooltip(label,{direction:"top",sticky:true,opacity:.92});
    }
    return layer;
  }

  function renderMainSmokeLayers(){
    mainSmokeLayer.clearLayers();
    if(!state.settings.smokeVisible || !mainSmokeForecasts.size) return;

    const occupiedArrows=[];
    const visible=selectSignificantFireGroups();
    for(const group of visible){
      const entry=mainSmokeForecasts.get(fireGroupSignature(group));
      if(!entry) continue;

      if(entry.analysis.kind==="weak"){
        bindMainSmokeInteraction(
          L.circle([group.center.lat,group.center.lon],{
            renderer:smokeRenderer,
            pane:"smokeCorridorPane",
            radius:4500,
            color:"#607d86",
            weight:2,
            opacity:.42,
            fillColor:"#607d86",
            fillOpacity:.06,
            dashArray:"5 7",
            interactive:true,
            className:"main-smoke-corridor main-smoke-weak"
          }),
          group,
          "Vent très faible · ouvrir le détail"
        ).addTo(mainSmokeLayer);
        continue;
      }

      if(
        entry.analysis.kind==="unavailable" ||
        !entry.route.segments.length
      ) continue;

      const displayRoute=buildMainSmokeDisplayRoute(entry.route);
      for(const segment of displayRoute.segments){
        bindMainSmokeInteraction(
          L.polyline(
            [[segment.start.lat,segment.start.lon],[segment.end.lat,segment.end.lon]],
            {
              renderer:smokeRenderer,
              pane:"smokeCorridorPane",
              color:"#607d86",
              weight:mainSmokeWeight(segment.endHours),
              opacity:segment.endHours<=3?.22:segment.endHours<=6?.15:.10,
              lineCap:"round",
              lineJoin:"round",
              interactive:true,
              className:"main-smoke-corridor"
            }
          ),
          group,
          "Direction possible des fumées · ouvrir le détail"
        ).addTo(mainSmokeLayer);

        const arrowPoint=destinationPoint(
          segment.start,
          segment.direction,
          haversine(segment.start,segment.end)/2
        );
        const point=map.latLngToContainerPoint([arrowPoint.lat,arrowPoint.lon]);
        const overlaps=occupiedArrows.some(existing=>
          Math.abs(existing.x-point.x)<34 && Math.abs(existing.y-point.y)<26
        );
        if(!overlaps){
          occupiedArrows.push(point);
          L.marker([arrowPoint.lat,arrowPoint.lon],{
            pane:"smokeMarkerPane",
            interactive:true,
            keyboard:true,
            title:"Direction possible des fumées · ouvrir le détail",
            icon:L.divIcon({
              className:"smoke-direction-arrow main-smoke-direction-arrow",
              html:`<span style="display:block;transform:rotate(${segment.direction}deg)">↑</span>`,
              iconSize:[26,26],
              iconAnchor:[13,13]
            })
          })
          .on("click",event=>{
            L.DomEvent.stopPropagation(event);
            openMapGroupDetail(group);
          })
          .addTo(mainSmokeLayer);
        }
      }

      bindMainSmokeInteraction(
        L.polyline(displayRoute.positions.map(point=>[point.lat,point.lon]),{
          renderer:smokeRenderer,
          pane:"smokeCorridorPane",
          color:"#405861",
          weight:1.6,
          opacity:.55,
          dashArray:"4 8",
          lineCap:"round",
          interactive:true,
          className:"main-smoke-direction-line"
        }),
        group,
        "Sens potentiel des fumées · ouvrir le détail"
      ).addTo(mainSmokeLayer);
    }
  }

  async function runWithConcurrency(items,limit,worker){
    let index=0;
    const runners=Array.from(
      {length:Math.min(limit,items.length)},
      async()=>{
        while(index<items.length){
          const item=items[index++];
          await worker(item);
        }
      }
    );
    await Promise.all(runners);
  }

  async function loadMainSmokeForecasts(){
    mainSmokeController?.abort();
    const requestId=++mainSmokeRequestId;
    const controller=new AbortController();
    mainSmokeController=controller;
    mainSmokeForecasts.clear();
    renderMainSmokeLayers();

    // Reprise exacte de la sélection des overlays : les 16 foyers significatifs
    // couvrent aussi le sous-ensemble de 10 affiché aux zooms éloignés.
    const groups=selectSignificantFireGroups(MAIN_SMOKE_MAX_GROUPS);
    try{
      const forecasts=await fetchGroupSmokeForecasts(groups,controller.signal);
      if(requestId===mainSmokeRequestId && !controller.signal.aborted){
        for(const group of groups){
          const signature=fireGroupSignature(group);
          const result=forecasts.get(signature);
          if(!result) continue;
          const liveGroup=state.fireGroups.find(item=>fireGroupSignature(item)===signature);
          if(!liveGroup) continue;
          const analysis=analyzeSmokeForecast(result.forecast);
          const route=buildSmokeRoute(liveGroup.center,result.forecast.horizons);
          mainSmokeForecasts.set(signature,{analysis,route});
        }
        renderMainSmokeLayers();
      }
    }catch(err){
      if(err.name!=="AbortError" && requestId===mainSmokeRequestId){
        renderMainSmokeLayers();
      }
    }
    if(requestId===mainSmokeRequestId){
      mainSmokeController=null;
    }
  }

  function resetDetailWind(){
    detailWindLayer?.clearLayers();
    detailLocalityLayer?.clearLayers();
    $("detailSmokeSummary").textContent="Prévision du vent en attente…";
    $("detailSmokeMeta").textContent="Analyse des vents prévus disponibles.";
    $("detailWatchedCityStatus").textContent="Évaluation de la ville surveillée en attente…";
    $("detailLocalitiesMessage").textContent="Recherche des localités en attente…";
    $("detailLocalityGroups").replaceChildren();
    $("detailLocalitiesLimit").hidden=true;
    $("detailLocalitiesLimit").textContent="";
  }

  function renderDetailWind(group,forecast,analysis,route){
    detailWindLayer.clearLayers();
    $("detailSmokeSummary").textContent=analysis.summary;
    $("detailSmokeMeta").textContent=analysis.meta;

    if(analysis.kind==="unavailable") return;
    if(analysis.kind==="weak"){
      L.circle([group.center.lat,group.center.lon],{
        radius:4500,
        color:"#607d86",
        weight:2,
        opacity:.42,
        fillColor:"#607d86",
        fillOpacity:.06,
        dashArray:"5 7",
        interactive:false
      }).addTo(detailWindLayer);
      return;
    }

    if(!route.segments.length) return;
    const displayRoute=buildSmokeDisplayRoute(route);
    const weights={3:13,6:21,12:31};
    const opacities={3:.24,6:.17,12:.11};

    for(const segment of displayRoute.segments){
      L.polyline(
        [[segment.start.lat,segment.start.lon],[segment.end.lat,segment.end.lon]],
        {
          color:"#607d86",
          weight:weights[segment.endHours]||24,
          opacity:opacities[segment.endHours]||.12,
          lineCap:"round",
          lineJoin:"round",
          interactive:false
        }
      ).addTo(detailWindLayer);
      const arrowPoint=destinationPoint(
        segment.start,
        segment.direction,
        haversine(segment.start,segment.end)/2
      );
      L.marker([arrowPoint.lat,arrowPoint.lon],{
        interactive:false,
        keyboard:false,
        icon:L.divIcon({
          className:"smoke-direction-arrow",
          html:`<span style="display:block;transform:rotate(${segment.direction}deg)">↑</span>`,
          iconSize:[26,26],
          iconAnchor:[13,13]
        })
      }).addTo(detailWindLayer);
    }

    L.polyline(displayRoute.positions.map(point=>[point.lat,point.lon]),{
      color:"#405861",
      weight:2,
      opacity:.58,
      dashArray:"4 8",
      lineCap:"round",
      interactive:false
    }).addTo(detailWindLayer);

    if(displayRoute.compressed){
      $("detailSmokeMeta").textContent+= " Longueur du tracé réduite pour garder la carte lisible.";
    }
    detailMap.fitBounds(
      L.latLngBounds([...group.bounds,...displayRoute.positions.map(point=>[point.lat,point.lon])]),
      {padding:[32,32],maxZoom:11,animate:false}
    );
  }

  function renderLocalitiesUnavailable(){
    detailLocalityLayer?.clearLayers();
    $("detailLocalitiesMessage").textContent="Les noms des localités sont indisponibles pour le moment.";
    $("detailLocalityGroups").replaceChildren();
    $("detailLocalitiesLimit").hidden=true;
  }

  function renderSelectedLocalities(group,localities,request){
    detailLocalityLayer.clearLayers();
    const groups=LOCALITY_HORIZONS.map(horizon=>({
      ...horizon,
      localities:localities.filter(locality=>locality.horizon===horizon.key)
    })).filter(grouped=>grouped.localities.length);

    if(!groups.length){
      $("detailLocalitiesMessage").textContent="Aucune localité n’a été identifiée dans le tracé estimé.";
      $("detailLocalityGroups").replaceChildren();
    }else{
      $("detailLocalitiesMessage").textContent="";
      $("detailLocalityGroups").innerHTML=groups.map(grouped=>`
        <section class="locality-horizon">
          <h5>${grouped.label}</h5>
          <ul>
            ${grouped.localities.map(locality=>
              `<li class="${locality.watched?"watched":""}">${escapeHtml(locality.name)}</li>`
            ).join("")}
          </ul>
        </section>
      `).join("");
    }

    localities.forEach((locality,index)=>{
      L.marker([locality.lat,locality.lon],{
        interactive:true,
        keyboard:false,
        title:locality.name,
        icon:L.divIcon({
          className:"locality-map-marker",
          html:"",
          iconSize:[10,10],
          iconAnchor:[5,5]
        })
      }).bindTooltip(escapeHtml(locality.name),{
        permanent:false,
        direction:"top",
        offset:[0,-7],
        className:"locality-map-label"
      }).addTo(detailLocalityLayer);
    });

    const limit=$("detailLocalitiesLimit");
    limit.hidden=!request.clipped;
    limit.textContent=request.clipped
      ?`Recherche des localités limitée aux ${OVERPASS_ROUTE_LIMIT_KM} premiers kilomètres du tracé.`
      :"";

    if(localities.length){
      const bounds=L.latLngBounds([
        ...group.bounds,
        ...localities.map(locality=>[locality.lat,locality.lon])
      ]);
      detailMap.fitBounds(bounds,{padding:[36,36],maxZoom:11,animate:false});
    }
  }

  async function loadDetailLocalities(group,route,analysis,signal,requestId){
    const watched=evaluateWatchedCity(route,analysis);
    $("detailWatchedCityStatus").textContent=watched.message;

    if(!route.segments.length || analysis.kind==="unavailable" || analysis.kind==="weak"){
      $("detailLocalitiesMessage").textContent=
        "Les localités ne peuvent pas être évaluées sans trajectoire exploitable.";
      $("detailLocalityGroups").replaceChildren();
      return;
    }

    $("detailLocalitiesMessage").textContent="Recherche des localités selon les vents prévus…";
    $("detailLocalityGroups").replaceChildren();
    try{
      const result=await fetchOverpassLocalities(route,signal);
      if(
        requestId!==detailWindRequestId ||
        currentDetailGroup!==group ||
        !$("detailView").classList.contains("open")
      ) return;
      const selected=selectLocalities(result.localities,route,watched.locality);
      renderSelectedLocalities(group,selected,result.request);
    }catch(err){
      if(
        err.name==="AbortError" ||
        requestId!==detailWindRequestId ||
        currentDetailGroup!==group
      ) return;
      renderLocalitiesUnavailable();
    }
  }

  async function loadDetailWind(group){
    detailWindController?.abort();
    const requestId=++detailWindRequestId;
    const controller=new AbortController();
    detailWindController=controller;
    resetDetailWind();

    try{
      const result=await fetchGroupSmokeForecast(group,controller.signal);
      if(
        requestId!==detailWindRequestId ||
        currentDetailGroup!==group ||
        !$("detailView").classList.contains("open")
      ) return;
      const analysis=analyzeSmokeForecast(result.forecast);
      const route=buildSmokeRoute(group.center,result.forecast.horizons);
      renderDetailWind(group,result.forecast,analysis,route);
      await loadDetailLocalities(group,route,analysis,controller.signal,requestId);
    }catch(err){
      if(err.name==="AbortError" || requestId!==detailWindRequestId) return;
      detailWindLayer?.clearLayers();
      detailLocalityLayer?.clearLayers();
      $("detailSmokeSummary").textContent="Prévision du vent indisponible pour le moment.";
      $("detailSmokeMeta").textContent=`Dernier essai à ${fmtClock(Date.now())}.`;
      $("detailWatchedCityStatus").textContent=`Impossible d’évaluer ${currentLocation().name} pour le moment.`;
      $("detailLocalitiesMessage").textContent="Les localités ne peuvent pas être évaluées sans prévision du vent.";
      $("detailLocalityGroups").replaceChildren();
    }
  }

  function openDetail(group){
    if(!group) return;
    detailPreviousFocus=document.activeElement;
    currentDetailGroup=group;
    const risk=riskLabelForGroup(group);
    const title=group.count===1?"Détection isolée":"Foyer probable";
    $("detailName").textContent=title;
    $("detailCoordinates").textContent=`Lat. ${group.center.lat.toFixed(4)} · Lng. ${group.center.lon.toFixed(4)}`;
    $("detailRisk").textContent=risk.label;
    $("detailRisk").style.color=risk.color;
    $("detailRisk").style.borderColor=risk.color;
    $("detailRisk").style.backgroundColor=`${risk.color}1f`;
    $("directionsLink").href=`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${group.center.lat},${group.center.lon}`)}`;

    $("detailView").classList.add("open");
    $("detailView").inert=false;
    $("detailView").setAttribute("aria-hidden","false");
    $("scrim").classList.add("show");
    ensureDetailMap();
    resetDetailWind();
    setTimeout(()=>{
      if(currentDetailGroup!==group) return;
      detailMap.invalidateSize({pan:false});
      if(group.count>1){
        detailMap.fitBounds(L.latLngBounds(group.bounds),{padding:[42,42],maxZoom:12,animate:false});
      }else{
        detailMap.setView([group.center.lat,group.center.lon],11,{animate:false});
      }
      if(detailMarker) detailMap.removeLayer(detailMarker);
      detailMarker=L.circleMarker([group.center.lat,group.center.lon],{
        radius:9,color:"#fff",weight:2,fillColor:risk.color,fillOpacity:1
      }).addTo(detailMap);
      loadDetailWind(group);
    },30);
    $("closeDetail").focus();
  }

  function closeDetail(){
    $("detailView").classList.remove("open");
    $("detailView").inert=true;
    $("detailView").setAttribute("aria-hidden","true");
    $("scrim").classList.remove("show");
    detailWindController?.abort();
    detailWindController=null;
    detailWindRequestId++;
    detailWindLayer?.clearLayers();
    detailLocalityLayer?.clearLayers();
    currentDetailGroup=null;
    const previousFocus=detailPreviousFocus;
    detailPreviousFocus=null;
    if(previousFocus instanceof HTMLElement){
      setTimeout(()=>previousFocus.focus(),0);
    }
  }

  map.on("zoomend",renderFireGroupOverlays);
  map.on("moveend",renderMainSmokeLayers);

  $("feed").addEventListener("click",event=>{
    const item=event.target.closest("[data-group]");
    if(!item) return;
    const group=state.fireGroups[+item.dataset.group];
    focusFireGroup(group);
    openDetail(group);
  });

  $("feed").addEventListener("keydown",event=>{
    if(event.key!=="Enter" && event.key!==" ") return;
    const item=event.target.closest("[data-group]");
    if(!item) return;
    event.preventDefault();
    const group=state.fireGroups[+item.dataset.group];
    focusFireGroup(group);
    openDetail(group);
  });

  function fitPoints(){
    const location=currentLocation();
    if(!state.points.length){
      map.flyTo([location.lat,location.lon],8,{duration:.45});
      return;
    }
    const bounds=L.latLngBounds([[location.lat,location.lon],...state.points.map(p=>[p.lat,p.lon])]);
    map.fitBounds(bounds,{padding:[36,36],maxZoom:11,animate:true,duration:.45});
  }

  function waitForNominatimSlot(signal){
    if(signal.aborted){
      return Promise.reject(new DOMException("Recherche remplacée","AbortError"));
    }
    const wait=Math.max(0,nextNominatimRequestAt-Date.now());
    if(!wait){
      nextNominatimRequestAt=Date.now()+NOMINATIM_MIN_INTERVAL_MS;
      return Promise.resolve();
    }
    return new Promise((resolve,reject)=>{
      const onAbort=()=>{
        clearTimeout(timer);
        reject(new DOMException("Recherche remplacée","AbortError"));
      };
      const timer=setTimeout(()=>{
        signal.removeEventListener("abort",onAbort);
        nextNominatimRequestAt=Date.now()+NOMINATIM_MIN_INTERVAL_MS;
        resolve();
      },wait);
      signal.addEventListener("abort",onAbort,{once:true});
    });
  }

  function rememberCitySearch(key,results){
    citySearchCache.delete(key);
    citySearchCache.set(key,results);
    while(citySearchCache.size>CITY_SEARCH_CACHE_MAX){
      citySearchCache.delete(citySearchCache.keys().next().value);
    }
  }

  function showCityResults(results){
    const status=$("cityStatus");
    const wrap=$("cityResultWrap");
    const select=$("cityResults");
    if(!results.length){
      status.textContent="Aucune ville trouvée. Essayez avec le pays, par exemple « Nice, France ».";
      $("applyCity").hidden=true;
      return;
    }

    select.innerHTML=results.map((item,index)=>
      `<option value="${index}">${escapeHtml(item.label)}</option>`
    ).join("");
    select.dataset.results=JSON.stringify(results);
    wrap.hidden=false;
    select.hidden=false;
    $("applyCity").hidden=false;
    status.textContent="Choisissez le bon résultat, puis appuyez sur « Utiliser cette ville ».";
  }

  async function searchCities(){
    const query=$("cityQuery").value.trim();
    const status=$("cityStatus");
    const wrap=$("cityResultWrap");
    const select=$("cityResults");
    const requestId=++citySearchRequestId;
    citySearchController?.abort();
    citySearchController=null;

    if(query.length<2){
      $("searchCity").disabled=false;
      $("searchCity").textContent="Rechercher";
      status.textContent="Entrez au moins deux caractères.";
      wrap.hidden=true;
      select.hidden=true;
      $("applyCity").hidden=true;
      return;
    }

    const controller=new AbortController();
    citySearchController=controller;
    $("searchCity").disabled=true;
    $("searchCity").textContent="Recherche…";
    status.textContent="Recherche de la ville…";
    wrap.hidden=true;
    select.hidden=true;
    $("applyCity").hidden=true;

    try{
      const cacheKey=query.toLocaleLowerCase("fr-FR").replace(/\s+/g," ");
      const cached=citySearchCache.get(cacheKey);
      if(cached){
        rememberCitySearch(cacheKey,cached);
        showCityResults(cached);
        return;
      }

      await waitForNominatimSlot(controller.signal);
      const url=new URL("https://nominatim.openstreetmap.org/search");
      url.searchParams.set("q",query);
      url.searchParams.set("format","jsonv2");
      url.searchParams.set("limit","5");
      url.searchParams.set("addressdetails","1");
      url.searchParams.set("accept-language","fr");

      const res=await fetchWithTimeout(
        url.toString(),
        {headers:{"Accept":"application/json"}},
        controller.signal,
        NOMINATIM_TIMEOUT_MS,
        "Délai de recherche dépassé"
      );
      if(!res.ok) throw new Error(`service de recherche indisponible (${res.status})`);

      const rawResults=await res.json();
      if(requestId!==citySearchRequestId || controller.signal.aborted) return;
      if(!Array.isArray(rawResults)) throw new Error("réponse de recherche invalide");
      const results=rawResults.map(item=>({
        name:item.name || item.address?.city || item.address?.town || item.address?.village || item.display_name?.split(",")[0] || query,
        label:item.display_name || query,
        lat:+item.lat,
        lon:+item.lon
      })).filter(item=>Number.isFinite(item.lat)&&Number.isFinite(item.lon));
      rememberCitySearch(cacheKey,results);
      showCityResults(results);
    }catch(err){
      if(err.name!=="AbortError" && requestId===citySearchRequestId){
        status.textContent=`Impossible de rechercher la ville : ${err.message}.`;
        $("applyCity").hidden=true;
      }
    }finally{
      if(requestId===citySearchRequestId){
        citySearchController=null;
        $("searchCity").disabled=false;
        $("searchCity").textContent="Rechercher";
      }
    }
  }

  async function applySelectedCity(){
    let results=[];
    try{results=JSON.parse($("cityResults").dataset.results||"[]")}catch{}
    const selected=results[+$("cityResults").value];
    if(!selected||!Number.isFinite(selected.lat)||!Number.isFinite(selected.lon)) return;

    state.settings.location={name:selected.name,lat:selected.lat,lon:selected.lon};
    saveSettings();
    renderCityMarker();
    map.flyTo([selected.lat,selected.lon],8,{duration:.55});
    $("cityStatus").textContent=`${selected.label} sélectionnée. Mise à jour des incendies…`;
    $("applyCity").hidden=true;
    $("cityResultWrap").hidden=true;
    $("cityResults").hidden=true;
    state.points=[];
    state.wind=null;
    state.windLoading=true;
    state.windError=false;
    state.windAttemptedAt=null;
    state.airQuality=null;
    state.airQualityLoading=true;
    state.airQualityError=false;
    state.airQualityAttemptedAt=null;
    state.lastFetch=null;
    state.dataScope=null;
    state.dataStatus="loading";
    renderLayers();
    updateUI();
    setView("map");
    await refresh();
  }

  function showError(message){
    $("headerError").textContent=message;
    $("headerError").classList.add("show");
  }

  function addErrorNotice(message){
    const banner=$("headerError");
    const current=banner.classList.contains("show")?banner.textContent.trim():"";
    if(current.includes(message)) return;
    showError(current?`${current} ${message}`:message);
  }

  function clearError(){
    $("headerError").classList.remove("show");
    $("headerError").textContent="";
  }

  function setPanelPage(page){
    const target=["overview","settings","info"].includes(page)?page:"overview";
    document.querySelectorAll(".panel-page").forEach(panel=>{
      const active=panel.dataset.page===target;
      panel.classList.toggle("active",active);
      panel.setAttribute("aria-hidden",String(!active));
    });
    document.querySelectorAll(".panel-tab").forEach(tab=>{
      const active=tab.dataset.panel===target;
      tab.classList.toggle("active",active);
      tab.setAttribute("aria-selected",String(active));
      tab.tabIndex=active?0:-1;
    });
  }

  function setView(view){
    const target=["map","overview","settings","info"].includes(view)?view:"map";
    activeView=target;
    const desktop=window.matchMedia("(min-width: 900px)").matches;
    document.body.dataset.view=desktop?"map":target;
    setPanelPage(target==="map"?"overview":target);
    document.querySelectorAll("[data-nav]").forEach(button=>{
      const active=button.dataset.nav===target || (target==="overview" && button.dataset.nav==="map");
      button.classList.toggle("active",active);
      if(active) button.setAttribute("aria-current","page");
      else button.removeAttribute("aria-current");
    });
    $("scrim").classList.remove("show");
    setTimeout(()=>map.invalidateSize({pan:false}),30);
  }

  function openDrawer(){
    setView("settings");
  }

  function closeDrawer(){
    setView("map");
  }

  function focusableElements(container){
    return [...container.querySelectorAll(
      'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])'
    )].filter(element=>element.offsetParent!==null);
  }

  function openOnboarding(){
    const dialog=$("onboardingDialog");
    if(dialog.classList.contains("open")) return;
    if($("detailView").classList.contains("open")) closeDetail();
    onboardingPreviousFocus=document.activeElement instanceof HTMLElement
      ?document.activeElement
      :null;
    $("appShell").inert=true;
    $("onboardingBackdrop").classList.add("open");
    $("onboardingBackdrop").setAttribute("aria-hidden","false");
    dialog.classList.add("open");
    dialog.inert=false;
    dialog.setAttribute("aria-hidden","false");
    document.body.classList.add("onboarding-open");
    const initialFocus=$("onboardingKeyLink");
    initialFocus.focus({preventScroll:true});
    requestAnimationFrame(()=>{
      if(dialog.classList.contains("open")) initialFocus.focus({preventScroll:true});
    });
  }

  function cancelKeyValidation(){
    keyValidationRequestId++;
    keyValidationController?.abort(
      new DOMException("Vérification de la clé annulée","AbortError")
    );
    keyValidationController=null;
    setKeyValidationLoading(false);
  }

  function closeOnboarding({cancelValidation=true,restoreFocus=true}={}){
    const dialog=$("onboardingDialog");
    if(!dialog.classList.contains("open")) return;
    if(cancelValidation) cancelKeyValidation();
    dialog.classList.remove("open");
    dialog.inert=true;
    dialog.setAttribute("aria-hidden","true");
    $("onboardingBackdrop").classList.remove("open");
    $("onboardingBackdrop").setAttribute("aria-hidden","true");
    $("appShell").inert=false;
    document.body.classList.remove("onboarding-open");
    const previousFocus=onboardingPreviousFocus;
    onboardingPreviousFocus=null;
    if(restoreFocus && previousFocus?.isConnected){
      setTimeout(()=>previousFocus.focus({preventScroll:true}),0);
    }
  }

  function setKeyValidationLoading(on){
    $("saveKey").disabled=on;
    $("onboardingSave").disabled=on;
    $("saveKey").textContent=on?"Vérification…":"Enregistrer";
    $("onboardingSave").textContent=on
      ?"Vérification…"
      :"Enregistrer et ouvrir la carte";
    $("onboardingDialog").setAttribute("aria-busy",String(on));
  }

  function syncKeyFields(value){
    $("mapKey").value=value;
    $("onboardingMapKey").value=value;
  }

  async function validateAndSaveKey(input,status){
    const candidate=input.value.trim();
    if(!candidate){
      status.textContent="Collez une clé NASA FIRMS valide.";
      showToast("Clé NASA FIRMS manquante.");
      return;
    }

    const validationId=++keyValidationRequestId;
    status.textContent="Vérification…";
    setKeyValidationLoading(true);
    const result=await refresh({mapKey:candidate,validation:true});
    if(validationId!==keyValidationRequestId || result==="aborted") return;

    setKeyValidationLoading(false);
    if(result!=="success"){
      const message="Impossible de vérifier la clé. Vérifiez la clé et votre connexion, puis réessayez.";
      status.textContent=message;
      if($("onboardingDialog").classList.contains("open")){
        $("onboardingStatus").textContent=message;
      }
      return;
    }

    state.mapKey=candidate;
    localStorage.setItem(STORAGE_KEY,candidate);
    syncKeyFields(candidate);
    $("keyStatus").textContent="Clé vérifiée et enregistrée uniquement sur cet appareil.";
    $("onboardingStatus").textContent="Clé vérifiée.";
    closeOnboarding({cancelValidation:false,restoreFocus:false});
    setView("map");
    showToast("Clé vérifiée. Carte chargée.");
  }

  function togglePassword(input,toggle){
    const reveal=input.classList.contains("is-masked");
    input.classList.toggle("is-masked",!reveal);
    toggle.querySelector(".material-symbols-outlined").textContent=reveal
      ?"visibility_off"
      :"visibility";
    toggle.setAttribute("aria-label",reveal?"Masquer la clé":"Afficher la clé");
  }

  $("radius").value=String(state.settings.radius);
  $("radiusValue").textContent=`${state.settings.radius} km`;
  $("hours").value=String(state.settings.hours);
  document.querySelectorAll("[data-hours]").forEach(button=>{
    const active=+button.dataset.hours===+state.settings.hours;
    button.classList.toggle("active",active);
    button.setAttribute("aria-pressed",String(active));
  });
  $("displayMode").value=state.settings.mode;
  $("smokeToggle").checked=state.settings.smokeVisible;
  $("mapKey").value=state.mapKey;

  $("settingsBtn").addEventListener("click",openDrawer);
  $("closeDrawer").addEventListener("click",closeDrawer);
  $("scrim").addEventListener("click",()=>{
    if($("detailView").classList.contains("open")) closeDetail();
    else closeDrawer();
  });
  $("brandHome").addEventListener("click",()=>setView("map"));
  $("openDetections").addEventListener("click",()=>setView("overview"));

  document.querySelectorAll("[data-nav]").forEach(button=>{
    button.addEventListener("click",()=>setView(button.dataset.nav));
  });
  document.querySelectorAll(".panel-tab").forEach(button=>{
    button.addEventListener("click",()=>setView(button.dataset.panel));
  });
  document.querySelector(".panel-tabs").addEventListener("keydown",event=>{
    if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key)) return;
    const tabs=[...document.querySelectorAll(".panel-tab")];
    const current=Math.max(0,tabs.indexOf(document.activeElement));
    const next=event.key==="Home"
      ?0
      :event.key==="End"
        ?tabs.length-1
        :(current+(event.key==="ArrowRight"?1:-1)+tabs.length)%tabs.length;
    event.preventDefault();
    tabs[next].focus();
    setView(tabs[next].dataset.panel);
  });

  $("searchCity").addEventListener("click",searchCities);
  $("cityQuery").addEventListener("keydown",e=>{if(e.key==="Enter")searchCities()});
  $("cityResults").addEventListener("change",()=>{
    $("cityStatus").textContent="Ville sélectionnée. Appuyez sur « Utiliser cette ville » pour actualiser la carte.";
  });
  $("applyCity").addEventListener("click",applySelectedCity);

  $("saveKey").addEventListener("click",()=>validateAndSaveKey($("mapKey"),$("keyStatus")));

  $("mapKey").addEventListener("keydown",e=>{
    if(e.key==="Enter") $("saveKey").click();
  });

  $("clearKey").addEventListener("click",()=>{
    cancelKeyValidation();
    refreshRequestId++;
    state.abortController?.abort();
    state.abortController=null;
    cancelMainSmokeRequests();
    state.loading=false;
    state.mapKey="";
    state.points=[];
    state.wind=null;
    state.windLoading=false;
    state.windError=false;
    state.windAttemptedAt=null;
    state.airQuality=null;
    state.airQualityLoading=false;
    state.airQualityError=false;
    state.airQualityAttemptedAt=null;
    state.lastFetch=null;
    state.dataScope=null;
    state.dataStatus="idle";
    syncKeyFields("");
    localStorage.removeItem(STORAGE_KEY);
    $("keyStatus").textContent="Clé supprimée.";
    $("onboardingStatus").textContent="";
    setLoading(false);
    renderLayers();
    updateUI();
    showToast("Clé supprimée de cet appareil.");
    openOnboarding();
  });

  $("radius").addEventListener("input",()=>{
    $("radiusValue").textContent=`${$("radius").value} km`;
  });

  $("radius").addEventListener("change",()=>{
    state.settings.radius=+$("radius").value;
    saveSettings();refresh();
  });

  document.querySelectorAll("[data-hours]").forEach(button=>{
    button.addEventListener("click",()=>{
      $("hours").value=button.dataset.hours;
      document.querySelectorAll("[data-hours]").forEach(item=>{
        const active=item===button;
        item.classList.toggle("active",active);
        item.setAttribute("aria-pressed",String(active));
      });
      $("hours").dispatchEvent(new Event("change",{bubbles:true}));
    });
  });

  $("hours").addEventListener("change",()=>{
    state.settings.hours=+$("hours").value;
    saveSettings();refresh();
  });

  $("displayMode").addEventListener("change",()=>{
    state.settings.mode=$("displayMode").value;
    saveSettings();renderLayers();
  });

  $("smokeToggle").addEventListener("change",()=>{
    state.settings.smokeVisible=$("smokeToggle").checked;
    saveSettings();
    renderMainSmokeLayers();
  });

  $("refreshTop").addEventListener("click",()=>refresh({manual:true}));
  $("refreshBtn").addEventListener("click",async()=>{
    await refresh({manual:true});
    if(state.mapKey) setView("map");
  });
  $("fitDrawerBtn").addEventListener("click",()=>{fitPoints();closeDrawer()});
  $("homeBtn").addEventListener("click",()=>{const location=currentLocation();map.flyTo([location.lat,location.lon],8,{duration:.45})});
  $("zoomIn").addEventListener("click",()=>map.zoomIn());
  $("zoomOut").addEventListener("click",()=>map.zoomOut());

  $("themeToggle").addEventListener("click",()=>{
    applyTheme(document.documentElement.dataset.theme==="dark"?"light":"dark");
    updateUI();
  });

  $("toggleKey").addEventListener("click",()=>togglePassword($("mapKey"),$("toggleKey")));
  $("toggleOnboardingKey").addEventListener("click",()=>togglePassword(
    $("onboardingMapKey"),
    $("toggleOnboardingKey")
  ));
  $("onboardingSave").addEventListener("click",()=>validateAndSaveKey(
    $("onboardingMapKey"),
    $("onboardingStatus")
  ));
  $("onboardingMapKey").addEventListener("keydown",event=>{
    if(event.key==="Enter") $("onboardingSave").click();
  });
  $("onboardingLater").addEventListener("click",()=>closeOnboarding());

  $("closeDetail").addEventListener("click",closeDetail);
  $("shareAlert").addEventListener("click",async()=>{
    if(!currentDetailGroup) return;
    const group=currentDetailGroup;
    const text=`EGX Incendies — ${group.count>1?"foyer probable":"détection"} à ${group.nearest.toFixed(0)} km de ${currentLocation().name} (${group.center.lat.toFixed(4)}, ${group.center.lon.toFixed(4)}).`;
    const url=`https://www.openstreetmap.org/?mlat=${group.center.lat}&mlon=${group.center.lon}#map=11/${group.center.lat}/${group.center.lon}`;
    try{
      if(navigator.share) await navigator.share({title:"EGX Incendies",text,url});
      else{
        await navigator.clipboard.writeText(`${text} ${url}`);
        showToast("Lien copié dans le presse-papiers.");
      }
    }catch(err){
      if(err.name!=="AbortError") showToast("Partage indisponible sur cet appareil.");
    }
  });

  document.addEventListener("keydown",event=>{
    const onboardingOpen=$("onboardingDialog").classList.contains("open");
    if(event.key==="Escape" && onboardingOpen){
      event.preventDefault();
      closeOnboarding();
      return;
    }
    if(event.key==="Tab" && onboardingOpen){
      const dialog=$("onboardingDialog");
      const focusable=focusableElements(dialog);
      if(!focusable.length){
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first=focusable[0];
      const last=focusable.at(-1);
      if(event.shiftKey && (document.activeElement===first || document.activeElement===dialog)){
        event.preventDefault();
        last.focus();
      }else if(!event.shiftKey && document.activeElement===last){
        event.preventDefault();
        first.focus();
      }
      return;
    }
    const detailOpen=$("detailView").classList.contains("open");
    if(event.key==="Escape" && detailOpen){
      closeDetail();
      return;
    }
    if(event.key!=="Tab" || !detailOpen) return;
    const focusable=focusableElements($("detailView"));
    if(!focusable.length) return;
    const first=focusable[0];
    const last=focusable.at(-1);
    if(event.shiftKey && document.activeElement===first){
      event.preventDefault();
      last.focus();
    }else if(!event.shiftKey && document.activeElement===last){
      event.preventDefault();
      first.focus();
    }
  });

  document.addEventListener("visibilitychange",()=>{
    if(document.visibilityState==="visible" && state.lastFetch && Date.now()-state.lastFetch.getTime()>10*60*1000){
      refresh();
    }
  });

  window.addEventListener("online",()=>refresh());
  window.addEventListener("offline",()=>showError("Connexion Internet indisponible. La dernière carte reste visible."));

  const observer=new ResizeObserver(()=>map.invalidateSize({pan:false}));
  observer.observe($("mapStage"));
  window.addEventListener("resize",()=>setView(activeView));

  setPanelPage("overview");
  renderCityMarker();
  updateUI();
  if(state.mapKey) refresh();
  else{
    $("keyStatus").textContent="Une clé MAP_KEY est requise pour charger les détections.";
    openOnboarding();
  }

  setInterval(()=>{
    if(!document.hidden && navigator.onLine) refresh();
  },10*60*1000);
})();
