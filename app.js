(() => {
  "use strict";

  const DEFAULT_LOCATION = {name:"Bordeaux", lat:44.8378, lon:-0.5792};
  const STORAGE_KEY = "egx_incendies_firms_key";
  const SETTINGS_KEY = "egx_incendies_settings";
  const THEME_KEY = "egx_incendies_theme";
  const SOURCES = ["VIIRS_SNPP_NRT","VIIRS_NOAA20_NRT","VIIRS_NOAA21_NRT","MODIS_NRT"];

  const $ = id => document.getElementById(id);
  const state = {
    mapKey: localStorage.getItem(STORAGE_KEY) || "",
    points: [],
    fireGroups: [],
    wind: null,
    lastFetch: null,
    loading: false,
    abortController: null,
    settings: {radius:100,hours:72,mode:"points+hulls",location:{...DEFAULT_LOCATION}}
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
  }catch{}

  const currentLocation = () => state.settings.location;
  let detailMap = null;
  let detailMarker = null;
  let currentDetailGroup = null;
  let detailPreviousFocus = null;
  let toastTimer = null;
  let activeView = "map";

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
    if(normalized==="faible") return dark?"#74d99f":"#16784a";
    if(normalized==="modéré") return dark?"#f3c969":"#946000";
    if(normalized==="élevé" || normalized==="très élevé") return dark?"#ff817a":"#b42318";
    return dark?"#b7bbc0":"#62676b";
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
    if(!state.wind || !state.points.length){
      return {
        level:"Indisponible",
        color:"#b8aea4",
        explanation:state.points.length
          ?"Vent indisponible : le trajet potentiel des fumées ne peut pas être estimé."
          :"Aucune détection récente à analyser dans la zone choisie."
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
    if(lines.length<2) return [];
    const headers=splitCSV(lines[0]).map(x=>x.trim().toLowerCase());
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

  function bbox(radius){
    const dLat=radius/111;
    const dLon=radius/(111*Math.cos(rad(currentLocation().lat)));
    const location=currentLocation();
    return [location.lon-dLon,location.lat-dLat,location.lon+dLon,location.lat+dLat].join(",");
  }

  async function fetchSource(source, signal){
    const days=Math.max(1,Math.ceil(state.settings.hours/24));
    const url=`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(state.mapKey)}/${source}/${bbox(state.settings.radius)}/${days}`;
    const res=await fetch(url,{cache:"no-store",signal});
    if(!res.ok) throw new Error(`${source}: erreur ${res.status}`);
    const text=await res.text();
    if(text.trim().startsWith("<")) throw new Error(`${source}: réponse invalide`);
    return parseCSV(text,source.replaceAll("_"," "));
  }

  function compassDirection(degrees){
    const labels=["N","NE","E","SE","S","SO","O","NO"];
    return labels[Math.round(((degrees%360)+360)%360/45)%8];
  }

  async function fetchWind(signal){
    const location=currentLocation();
    const url=new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude",location.lat);
    url.searchParams.set("longitude",location.lon);
    url.searchParams.set("current","wind_speed_10m,wind_direction_10m,wind_gusts_10m");
    url.searchParams.set("wind_speed_unit","kmh");
    url.searchParams.set("timezone","auto");

    const res=await fetch(url.toString(),{cache:"no-store",signal});
    if(!res.ok) throw new Error(`météo ${res.status}`);
    const data=await res.json();
    const current=data.current||{};
    const speed=+current.wind_speed_10m;
    const direction=+current.wind_direction_10m;
    const gusts=+current.wind_gusts_10m;
    if(!Number.isFinite(speed)||!Number.isFinite(direction)) throw new Error("données de vent incomplètes");
    return {speed,direction,gusts:Number.isFinite(gusts)?gusts:null,time:current.time||null};
  }

  async function refresh(){
    if(state.loading) return;
    clearError();

    if(!state.mapKey){
      showError("Ajoutez votre clé gratuite NASA FIRMS dans les réglages pour charger les données.");
      $("keyStatus").textContent="Une clé MAP_KEY est requise pour charger les détections.";
      openDrawer();
      updateUI();
      return;
    }

    state.loading=true;
    setLoading(true);
    state.abortController?.abort();
    state.abortController=new AbortController();

    try{
      const [fireSettled,windSettled]=await Promise.all([
        Promise.allSettled(SOURCES.map(src=>fetchSource(src,state.abortController.signal))),
        Promise.allSettled([fetchWind(state.abortController.signal)])
      ]);
      const successful=fireSettled.filter(x=>x.status==="fulfilled").flatMap(x=>x.value);
      if(!successful.length){
        const reason=fireSettled.find(x=>x.status==="rejected")?.reason?.message || "Aucune source disponible";
        throw new Error(reason);
      }
      if(windSettled[0]?.status==="fulfilled") state.wind=windSettled[0].value;

      const cut=Date.now()-state.settings.hours*36e5;
      state.points=dedupe(successful)
        .filter(p=>p.time>=cut && haversine(currentLocation(),p)<=state.settings.radius)
        .sort((a,b)=>b.time-a.time);
      state.lastFetch=new Date();

      renderLayers();
      updateUI();

      const failed=fireSettled.filter(x=>x.status==="rejected").length;
      if(failed) showError(`${failed} source${failed>1?"s":""} satellite${failed>1?"s":""} indisponible${failed>1?"s":""}, mais les autres données ont été chargées.`);
    }catch(err){
      if(err.name!=="AbortError"){
        state.points=[];
        renderLayers();
        updateUI();
        showError(`Impossible de charger les données : ${err.message}. Vérifiez la clé et la connexion.`);
      }
    }finally{
      state.loading=false;
      setLoading(false);
    }
  }

  function setLoading(on){
    const buttons=[$("refreshTop"),$("refreshBtn")];
    buttons.forEach(btn=>btn.disabled=on);
    $("refreshTop").innerHTML=on
      ?'<span class="loading-spin"></span>'
      :'<span class="material-symbols-outlined" aria-hidden="true">refresh</span>';
    $("refreshBtn").innerHTML=on
      ?'<span class="loading-spin"></span> Chargement…'
      :'<span class="material-symbols-outlined" aria-hidden="true">satellite_alt</span> Lancer la carte';
    $("sourceStatus").classList.toggle("loading",on);
    $("mapStage").setAttribute("aria-busy",String(on));
    setSourceStatus(on?"Connexion aux satellites…":(state.lastFetch?`Mis à jour à ${new Intl.DateTimeFormat("fr-FR",{hour:"2-digit",minute:"2-digit"}).format(state.lastFetch)}`:"En attente"));
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

  function renderFireGroupOverlays(){
    fireGroupLayer.clearLayers();

    const zoom=map.getZoom();
    const significant=state.fireGroups
      .filter(group=>group.count>=15)
      .sort((a,b)=>b.count-a.count)
      .slice(0,zoom<=8?10:16);

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
        interactive:true
      })
      .bindTooltip(`🔥 ${group.count.toLocaleString("fr-FR")}`,{
        permanent:zoom<=10,
        direction:"top",
        offset:[0,-7],
        className:"fire-group-label"
      })
      .on("click",()=>{
        focusFireGroup(group);
        openDetail(group);
      })
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
  }

  function relTime(t){
    const m=Math.max(0,Math.round((Date.now()-t)/60000));
    if(m<60) return `${m} min`;
    const h=Math.floor(m/60),mm=m%60;
    return mm?`${h} h ${mm}`:`${h} h`;
  }

  function fmtDate(t){
    return new Intl.DateTimeFormat("fr-FR",{
      day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit",
      timeZone:"Europe/Paris"
    }).format(new Date(t));
  }

  function escapeHtml(value){
    return String(value??"").replace(/[&<>"']/g,m=>({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
    }[m]));
  }

  function updateUI(){
    const probableGroups=state.fireGroups.filter(group=>group.count>1);
    $("groupCount").textContent=probableGroups.length.toLocaleString("fr-FR");
    $("overviewGroupCount").textContent=probableGroups.length.toLocaleString("fr-FR");
    $("count").textContent=`${state.points.length.toLocaleString("fr-FR")} détection${state.points.length>1?"s":""} NASA`;
    const smoke=smokeRisk();
    const smokeColor=statusColor(smoke.level);
    $("smokeRisk").textContent=smoke.level;
    $("smokeRisk").style.color=smokeColor;
    $("overviewSmokeRisk").textContent=smoke.level;
    $("overviewSmokeRisk").style.color=smokeColor;
    $("riskBadge").style.color=smokeColor;
    $("riskBadge").style.borderColor=smokeColor;
    $("riskBadge").style.backgroundColor=`${smokeColor}1f`;
    $("smokeCity").textContent=currentLocation().name;
    $("smokeStatus").textContent=smoke.level;
    $("smokeStatus").style.color=smokeColor;
    $("smokeExplanation").textContent=smoke.explanation;
    const distances=state.points.map(p=>haversine(currentLocation(),p));
    $("nearest").textContent=distances.length?`${Math.min(...distances).toFixed(0)} km`:"—";
    if(distances.length){
      const nearestIndex=distances.indexOf(Math.min(...distances));
      $("nearestDirection").textContent=compassDirection(bearing(currentLocation(),state.points[nearestIndex]));
    }else{
      $("nearestDirection").textContent="";
    }
    setSourceStatus(state.lastFetch
      ?`Mis à jour à ${new Intl.DateTimeFormat("fr-FR",{hour:"2-digit",minute:"2-digit"}).format(state.lastFetch)}`
      :"En attente"
    );

    $("windCity").textContent=currentLocation().name;

    if(state.wind){
      const direction=compassDirection(state.wind.direction);
      const arrowAngle=(state.wind.direction+180)%360;

      $("windArrow").style.transform=`rotate(${arrowAngle}deg)`;
      $("windArrow").textContent="↑";
      $("windSpeed").textContent=`${Math.round(state.wind.speed)} km/h`;
      $("windNeedle").style.transform=`rotate(${arrowAngle}deg)`;
      $("windDetailSpeed").textContent=`${Math.round(state.wind.speed)} km/h · ${direction}`;
      $("windDetailDirection").textContent=state.wind.gusts!==null
        ?`Rafales jusqu'à ${Math.round(state.wind.gusts)} km/h`
        :"Rafales indisponibles";
    }else{
      $("windSpeed").textContent="—";
      $("windDetailSpeed").textContent="Données en attente";
      $("windDetailDirection").textContent="Direction et rafales";
    }

    const feed=$("feed");
    if(!state.fireGroups.length){
      feed.innerHTML='<div class="empty-state"><span class="material-symbols-outlined" aria-hidden="true">search_off</span>Aucune détection dans la fenêtre choisie.</div>';
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

  function confidenceLabel(value){
    const normalized=String(value||"").toLowerCase();
    if(/^\d+$/.test(normalized)) return `${normalized} %`;
    if(normalized==="h" || normalized==="high") return "Élevée";
    if(normalized==="n" || normalized==="nominal") return "Nominale";
    if(normalized==="l" || normalized==="low") return "Faible";
    return normalized?normalized.toUpperCase():"—";
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
      attributionControl:false,
      dragging:false,
      scrollWheelZoom:false,
      doubleClickZoom:false,
      boxZoom:false,
      keyboard:false,
      tap:false
    });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{
      maxZoom:19,
      attribution:"&copy; OpenStreetMap"
    }).addTo(detailMap);
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
    $("detailDetectionCount").textContent=`Détections dans le foyer (${group.count.toLocaleString("fr-FR")})`;
    $("directionsLink").href=`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${group.center.lat},${group.center.lon}`)}`;

    $("detailDetections").innerHTML=group.points.slice(0,50).map(point=>{
      const age=(Date.now()-point.time)/36e5;
      const color=colorForAge(age);
      return `<article class="detection-card" style="border-left-color:${color}">
        <div class="detection-card-head">
          <div>
            <span class="confidence" style="color:${color}">${escapeHtml(confidenceLabel(point.confidence))} CONF.</span>
            <span class="sensor">${escapeHtml(point.sensor)}</span>
          </div>
          <span class="detection-time">${escapeHtml(fmtDate(point.time))}</span>
        </div>
        <div class="detection-card-data">
          <div><span>FRP</span><strong>${point.frp!==null?`${point.frp.toFixed(1)} MW`:"Indisponible"}</strong></div>
          <div><span>Ancienneté</span><strong>${escapeHtml(relTime(point.time))}</strong></div>
        </div>
      </article>`;
    }).join("");

    $("detailView").classList.add("open");
    $("detailView").inert=false;
    $("detailView").setAttribute("aria-hidden","false");
    $("scrim").classList.add("show");
    ensureDetailMap();
    setTimeout(()=>{
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
    },30);
    $("closeDetail").focus();
  }

  function closeDetail(){
    $("detailView").classList.remove("open");
    $("detailView").inert=true;
    $("detailView").setAttribute("aria-hidden","true");
    $("scrim").classList.remove("show");
    currentDetailGroup=null;
    const previousFocus=detailPreviousFocus;
    detailPreviousFocus=null;
    if(previousFocus instanceof HTMLElement){
      setTimeout(()=>previousFocus.focus(),0);
    }
  }

  map.on("zoomend",renderFireGroupOverlays);

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

  async function searchCities(){
    const query=$("cityQuery").value.trim();
    const status=$("cityStatus");
    const wrap=$("cityResultWrap");
    const select=$("cityResults");

    if(query.length<2){
      status.textContent="Entrez au moins deux caractères.";
      wrap.hidden=true;
      select.hidden=true;
      return;
    }

    $("searchCity").disabled=true;
    $("searchCity").textContent="Recherche…";
    status.textContent="Recherche de la ville…";
    wrap.hidden=true;
    select.hidden=true;
    $("applyCity").hidden=true;

    try{
      const url=new URL("https://nominatim.openstreetmap.org/search");
      url.searchParams.set("q",query);
      url.searchParams.set("format","jsonv2");
      url.searchParams.set("limit","5");
      url.searchParams.set("addressdetails","1");
      url.searchParams.set("accept-language","fr");

      const res=await fetch(url.toString(),{
        headers:{"Accept":"application/json"},
        cache:"no-store"
      });
      if(!res.ok) throw new Error(`service de recherche indisponible (${res.status})`);

      const results=await res.json();
      if(!Array.isArray(results)||!results.length){
        status.textContent="Aucune ville trouvée. Essayez avec le pays, par exemple « Nice, France ».";
        $("applyCity").hidden=true;
        return;
      }

      select.innerHTML=results.map((item,index)=>{
        const label=item.display_name || query;
        return `<option value="${index}">${escapeHtml(label)}</option>`;
      }).join("");
      select.dataset.results=JSON.stringify(results.map(item=>({
        name:item.name || item.address?.city || item.address?.town || item.address?.village || item.display_name?.split(",")[0] || query,
        label:item.display_name || query,
        lat:+item.lat,
        lon:+item.lon
      })));
      wrap.hidden=false;
      select.hidden=false;
      $("applyCity").hidden=false;
      status.textContent="Choisissez le bon résultat, puis appuyez sur « Utiliser cette ville ».";
    }catch(err){
      status.textContent=`Impossible de rechercher la ville : ${err.message}.`;
      $("applyCity").hidden=true;
    }finally{
      $("searchCity").disabled=false;
      $("searchCity").textContent="Rechercher";
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
    renderLayers();
    updateUI();
    await refresh();
  }

  function showError(message){
    $("headerError").textContent=message;
    $("headerError").classList.add("show");
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

  $("radius").value=String(state.settings.radius);
  $("radiusValue").textContent=`${state.settings.radius} km`;
  $("hours").value=String(state.settings.hours);
  document.querySelectorAll("[data-hours]").forEach(button=>{
    const active=+button.dataset.hours===+state.settings.hours;
    button.classList.toggle("active",active);
    button.setAttribute("aria-pressed",String(active));
  });
  $("displayMode").value=state.settings.mode;
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

  $("searchCity").addEventListener("click",searchCities);
  $("cityQuery").addEventListener("keydown",e=>{if(e.key==="Enter")searchCities()});
  $("cityResults").addEventListener("change",()=>{
    $("cityStatus").textContent="Ville sélectionnée. Appuyez sur « Utiliser cette ville » pour actualiser la carte.";
  });
  $("applyCity").addEventListener("click",applySelectedCity);

  $("saveKey").addEventListener("click",()=>{
    const value=$("mapKey").value.trim();
    if(!value){
      $("keyStatus").textContent="Collez une clé NASA FIRMS valide.";
      showToast("Clé NASA FIRMS manquante.");
      return;
    }
    state.mapKey=value;
    $("keyStatus").textContent="Clé enregistrée uniquement sur cet appareil.";
    localStorage.setItem(STORAGE_KEY,value);
    closeDrawer();
    refresh();
  });

  $("mapKey").addEventListener("keydown",e=>{
    if(e.key==="Enter") $("saveKey").click();
  });

  $("clearKey").addEventListener("click",()=>{
    state.mapKey="";
    state.points=[];
    $("mapKey").value="";
    localStorage.removeItem(STORAGE_KEY);
    $("keyStatus").textContent="Clé supprimée.";
    renderLayers();
    updateUI();
    showError("Clé effacée de cet appareil.");
    showToast("Clé supprimée de cet appareil.");
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

  $("refreshTop").addEventListener("click",refresh);
  $("refreshBtn").addEventListener("click",async()=>{
    await refresh();
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

  $("toggleKey").addEventListener("click",()=>{
    const input=$("mapKey");
    const visible=input.type==="text";
    input.type=visible?"password":"text";
    $("toggleKey").querySelector(".material-symbols-outlined").textContent=visible?"visibility":"visibility_off";
    $("toggleKey").setAttribute("aria-label",visible?"Afficher la clé":"Masquer la clé");
  });

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
    const detailOpen=$("detailView").classList.contains("open");
    if(event.key==="Escape" && detailOpen){
      closeDetail();
      return;
    }
    if(event.key!=="Tab" || !detailOpen) return;
    const focusable=[...$("detailView").querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),[tabindex]:not([tabindex="-1"])')]
      .filter(element=>element.offsetParent!==null);
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
    showError("Ajoutez votre clé gratuite NASA FIRMS dans les réglages pour charger les données.");
    $("keyStatus").textContent="Une clé MAP_KEY est requise pour charger les détections.";
    if(window.innerWidth<900) openDrawer();
    else setPanelPage("settings");
  }

  setInterval(()=>{
    if(!document.hidden && navigator.onLine) refresh();
  },10*60*1000);
})();
