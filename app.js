(function(){
  // Protección anti-clickjacking en JS: como GitHub Pages no permite headers HTTP
  // reales, ni X-Frame-Options ni el "frame-ancestors" de CSP-vía-meta funcionan
  // (los navegadores los ignoran fuera de un header HTTP verdadero). Este es el
  // único mecanismo de respaldo posible en un sitio 100% estático: si la página
  // se detecta cargada dentro de un iframe ajeno, se saca de ahí a la fuerza.
  try{
    if(window.top !== window.self){
      window.top.location = window.self.location;
    }
  }catch(e){
    // Si un dominio distinto intenta enmarcarla, el navegador puede bloquear el
    // acceso a window.top por política de mismo origen; en ese caso, al menos
    // ocultamos el contenido para no dejarlo usable dentro del iframe ajeno.
    document.documentElement.style.display = 'none';
  }

  const STORE_KEY = 'finanzas-data';
  const SETTINGS_KEY = 'finanzas-settings';
  const TOKEN_KEY = 'finanzas-google-token';
  const HARDCODED_CLIENT_ID = '612254024162-kejmqp9ecnnehmgpm9liib71bf7g3u2l.apps.googleusercontent.com';
  const EMOJIS = ['💰','💳','🏦','💵','💶','💷','💴','🪙','📈','📉','💹','📊','🧾','🧮','💼','👛','📱','☕','🛒','🎯','🐷','✈️','🏠','🚗','🎓','🎁','⭐','🔒','📆','🍽️'];
  const COLORS = ['#2dd4a7','#38bdf8','#f59e0b','#a78bfa','#fb7185','#94a3b8','#34d399','#fbbf24','#60a5fa','#f472b6'];
  const MAX_AMOUNT = 1000000000000;
  const MAX_RECORDS = 10000;
  const SAFE_COLORS = new Set(COLORS);
  const SAFE_EMOJIS = new Set(EMOJIS);
  const SAFE_FREQUENCIES = new Set(['una_vez','diaria','semanal','quincenal','mensual','anual']);

  const CATEGORIAS_INGRESO = [
    {v:'Sueldo', e:'💼'}, {v:'Freelance / Trabajo independiente', e:'💻'}, {v:'Negocio propio', e:'🏪'},
    {v:'Arriendos recibidos', e:'🏠'}, {v:'Inversiones / Rendimientos', e:'📈'}, {v:'Regalo o ayuda familiar', e:'🎁'},
    {v:'Devolución / Reembolso', e:'↩️'}, {v:'Venta de artículos', e:'🛒'}, {v:'Otro ingreso', e:'➕'}
  ];
  const CATEGORIAS_EGRESO = [
    {v:'Vivienda', e:'🏠'}, {v:'Servicios públicos', e:'💡'}, {v:'Alimentación / Mercado', e:'🍽️'},
    {v:'Transporte', e:'🚗'}, {v:'Educación', e:'🎓'}, {v:'Salud', e:'🏥'}, {v:'Entretenimiento', e:'🎬'},
    {v:'Ropa y calzado', e:'👕'}, {v:'Cuidado personal', e:'💇'}, {v:'Suscripciones', e:'📱'},
    {v:'Tecnología', e:'💻'}, {v:'Mascotas', e:'🐾'}, {v:'Viajes', e:'✈️'}, {v:'Regalos y donaciones', e:'🎁'},
    {v:'Impuestos', e:'🧾'}, {v:'Otro gasto', e:'➕'}
  ];
  function poblarCategorias(selectId, tipo){
    const sel = document.getElementById(selectId);
    if(!sel) return;
    const lista = tipo === 'Ingreso' ? CATEGORIAS_INGRESO : CATEGORIAS_EGRESO;
    const actual = sel.value;
    sel.innerHTML = '<option value="">Sin categoría</option>' +
      lista.map(c=>`<option value="${c.v}">${c.e} ${c.v}</option>`).join('');
    if(lista.some(c=>c.v===actual)) sel.value = actual;
  }

  let data = { cuentas: [], movimientos: [], tarjetas: [], movimientosTC: [], planesCuotas: [] };
  let settings = { clientId: '', sheetId: '', ocultar: false, columnMap: {}, tcActivado: undefined };
  let tipoSel = 'Ingreso';
  let editingCuentaId = null;
  let editingTarjetaId = null;
  let tokenClient = null;
  let selectedEmoji = '';
  let selectedColor = '';
  let pendingAutomaticos = [];
  let autoTipoSel = 'Ingreso';
  let tcTipoSel = 'Compra';

  const fmt = n => '$ ' + Math.round(n).toLocaleString('es-CO');
  const todayLabel = () => new Date().toLocaleDateString('es-CO', {day:'2-digit', month:'short'});
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);

  // ---------- Seguridad: escape de HTML y neutralización de fórmulas ----------
  function escapeHtml(str){
    if(str===null || str===undefined) return '';
    return String(str)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  // Evita inyección de fórmulas en Google Sheets: si un valor empieza por = + - @,
  // Sheets podría interpretarlo como fórmula al usar valueInputOption=USER_ENTERED.
  function sheetSafe(str){
    const s = (str===null || str===undefined) ? '' : String(str);
    return /^[=+\-@]/.test(s) ? ("'" + s) : s;
  }
  function cleanText(value, max=200){
    return typeof value === 'string' ? value.trim().slice(0,max) : '';
  }
  function safeAmount(value, fallback=0){
    const number = Number(value);
    return Number.isFinite(number) && Math.abs(number) <= MAX_AMOUNT ? number : fallback;
  }
  function safePositiveAmount(value, fallback=0){
    const number = safeAmount(value, fallback);
    return number > 0 ? number : fallback;
  }
  function safeColor(value){ return SAFE_COLORS.has(value) ? value : ''; }
  function safeEmoji(value){ return SAFE_EMOJIS.has(value) ? value : ''; }
  function safeDate(value){
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
  }
  function safeKey(value){
    const key = cleanText(value,60);
    return key && key !== '__proto__' && key !== 'constructor' && key !== 'prototype' ? key : '';
  }
  function readJson(value){
    try{ return value ? JSON.parse(value) : null; }catch(e){ return null; }
  }
  function sanitizeAutomaticos(items){
    if(!Array.isArray(items)) return [];
    return items.slice(0,MAX_RECORDS).flatMap(item=>{
      if(!item || typeof item !== 'object') return [];
      const tipo = item.tipo === 'Ingreso' ? 'Ingreso' : item.tipo === 'Egreso' ? 'Egreso' : '';
      const monto = safePositiveAmount(item.monto);
      const frecuencia = SAFE_FREQUENCIES.has(item.frecuencia) ? item.frecuencia : '';
      if(!tipo || !monto || !frecuencia) return [];
      return [{id:cleanText(item.id,40) || uid(), tipo, monto, descripcion:cleanText(item.descripcion), categoria:cleanText(item.categoria,60), frecuencia, inicio:safeDate(item.inicio), proxima:safeDate(item.proxima || item.inicio), activo:!!item.activo}];
    });
  }
  function sanitizeData(parsed){
    const raw = parsed && typeof parsed === 'object' ? parsed : {};
    const cuentas = Array.isArray(raw.cuentas) ? raw.cuentas.slice(0,MAX_RECORDS).flatMap(c=>{
      const nombre = safeKey(c && c.nombre);
      if(!nombre) return [];
      const rendimiento = c.rendimiento && Number.isFinite(Number(c.rendimiento.ea)) && Number(c.rendimiento.ea) >= 0 && Number(c.rendimiento.ea) <= 100 ? {ea:Number(c.rendimiento.ea)} : null;
      return [{id:cleanText(c.id,40) || uid(), nombre, saldoBase:safeAmount(c.saldoBase), incluirTotal:!!c.incluirTotal, emoji:safeEmoji(c.emoji), color:safeColor(c.color), oculto:!!c.oculto, rendimiento, automaticos:sanitizeAutomaticos(c.automaticos), lastAccrual:safeDate(c.lastAccrual)}];
    }) : [];
    const movimientos = Array.isArray(raw.movimientos) ? raw.movimientos.slice(0,MAX_RECORDS).flatMap(m=>{
      const cuenta = safeKey(m && m.cuenta), monto = safePositiveAmount(m && m.monto);
      if(!cuenta || !monto || !['Ingreso','Egreso'].includes(m.tipo)) return [];
      return [{id:cleanText(m.id,40) || uid(), tipo:m.tipo, cuenta, monto, descripcion:cleanText(m.descripcion), categoria:cleanText(m.categoria,60), groupId:cleanText(m.groupId,40) || null, fecha:safeDate(m.fecha), fechaLabel:cleanText(m.fechaLabel,20)}];
    }) : [];
    const tarjetas = Array.isArray(raw.tarjetas) ? raw.tarjetas.slice(0,MAX_RECORDS).flatMap(t=>{
      const nombre = safeKey(t && t.nombre);
      if(!nombre) return [];
      return [{id:cleanText(t.id,40) || uid(), nombre, cupoInicial:safeAmount(t.cupoInicial === undefined ? t.cupoActual : t.cupoInicial), incluirTotal:!!t.incluirTotal, emoji:safeEmoji(t.emoji), color:safeColor(t.color), oculto:!!t.oculto}];
    }) : [];
    const movimientosTC = Array.isArray(raw.movimientosTC) ? raw.movimientosTC.slice(0,MAX_RECORDS).flatMap(m=>{
      const tarjeta = safeKey(m && m.tarjeta), monto = safePositiveAmount(m && m.monto);
      if(!tarjeta || !monto || !['Compra','Pago'].includes(m.tipo)) return [];
      return [{id:cleanText(m.id,40) || uid(), tipo:m.tipo, tarjeta, monto, descripcion:cleanText(m.descripcion), cuentaRelacionada:safeKey(m.cuentaRelacionada) || null, groupId:cleanText(m.groupId,40) || null, fecha:safeDate(m.fecha), fechaLabel:cleanText(m.fechaLabel,20)}];
    }) : [];
    const planesCuotas = Array.isArray(raw.planesCuotas) ? raw.planesCuotas.slice(0,MAX_RECORDS).flatMap(p=>{
      const tarjeta = safeKey(p && p.tarjeta), cuenta = safeKey(p && p.cuenta), montoCuota = safePositiveAmount(p && p.montoCuota);
      const cuotasTotal = Math.round(Number(p && p.cuotasTotal));
      if(!tarjeta || !cuenta || !montoCuota || !Number.isFinite(cuotasTotal) || cuotasTotal < 1 || cuotasTotal > 120) return [];
      return [{id:cleanText(p.id,40) || uid(), tarjeta, cuenta, cuotasTotal, cuotasPagadas:Math.min(cuotasTotal,Math.max(0,Math.round(safeAmount(p.cuotasPagadas)))), montoCuota, descripcion:cleanText(p.descripcion), interesEA:Math.min(200,Math.max(0,safeAmount(p.interesEA))), inicio:safeDate(p.inicio), proxima:safeDate(p.proxima), activo:!!p.activo}];
    }) : [];
    return {cuentas,movimientos,tarjetas,movimientosTC,planesCuotas};
  }

  // ---------- Logging de eventos de seguridad ----------
  // Registro local únicamente (consola del navegador del propio usuario).
  // Nunca se envía a ningún servidor externo. Nunca incluye tokens, montos,
  // descripciones ni ningún otro dato financiero o credencial — solo el
  // tipo de evento, la hora, y un detalle mínimo no sensible.
  function logSecurityEvent(evento, detalle){
    try{
      console.info('[Reckly][seguridad]', new Date().toISOString(), evento, detalle||'');
    }catch(e){}
  }

  // Fusión segura de configuración: copia solo las claves esperadas, nunca
  // "__proto__"/"constructor"/"prototype" ni claves desconocidas — evita
  // contaminación del prototipo si algún día esta clave se escribe desde
  // fuera del propio código (defensa en profundidad).
  const SETTINGS_ALLOWED_KEYS = ['clientId','sheetId','ocultar','columnMap','tcActivado','gridMov','gridSaldos','estiloVersion'];
  function safeMergeSettings(target, parsed){
    if(!parsed || typeof parsed !== 'object') return target;
    SETTINGS_ALLOWED_KEYS.forEach(k=>{
      if(Object.prototype.hasOwnProperty.call(parsed, k)) target[k] = parsed[k];
    });
    target.sheetId = /^[A-Za-z0-9_-]{20,100}$/.test(target.sheetId || '') ? target.sheetId : '';
    target.ocultar = !!target.ocultar;
    target.tcActivado = target.tcActivado === undefined ? undefined : !!target.tcActivado;
    const columnMap = {};
    if(target.columnMap && typeof target.columnMap === 'object' && !Array.isArray(target.columnMap)){
      Object.keys(target.columnMap).slice(0,MAX_RECORDS).forEach(name=>{
        const key = safeKey(name), index = Number(target.columnMap[name]);
        if(key && Number.isInteger(index) && index >= 2 && index <= 1024) columnMap[key] = index;
      });
    }
    target.columnMap = columnMap;
    return target;
  }

  function loadAll(){
    const savedData = readJson(localStorage.getItem(STORE_KEY));
    const savedSettings = readJson(localStorage.getItem(SETTINGS_KEY));
    data = sanitizeData(savedData);
    settings = safeMergeSettings(settings, savedSettings);
    if(settings.tcActivado === undefined){
      settings.tcActivado = data.tarjetas.length > 0;
      saveSettingsLS();
    }
    let migrado = false;
    data.tarjetas.forEach(t=>{
      if(t.cupoInicial===undefined){
        t.cupoInicial = (t.cupoActual!==undefined ? t.cupoActual : 0);
        delete t.cupoActual;
        migrado = true;
      }
    });
    if(migrado) save();
  }
  function save(){ localStorage.setItem(STORE_KEY, JSON.stringify(data)); }
  function saveSettingsLS(){ localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }

  // ---------- Formato de moneda en inputs ----------
  function attachCurrencyInput(el){
    el.addEventListener('input', ()=>{
      let digits = el.value.replace(/\D/g,'');
      digits = digits.replace(/^0+(?=\d)/,'');
      el.value = digits ? Number(digits).toLocaleString('es-CO') : '';
    });
  }
  function currencyValue(el){
    const digits = el.value.replace(/\D/g,'');
    const amount = digits ? Number(digits) : 0;
    return Number.isSafeInteger(amount) && amount <= MAX_AMOUNT ? amount : 0;
  }
  attachCurrencyInput(document.getElementById('inCuentaSaldo'));
  attachCurrencyInput(document.getElementById('inMovMonto'));
  attachCurrencyInput(document.getElementById('inAutoMonto'));
  attachCurrencyInput(document.getElementById('inTarjetaCupo'));
  attachCurrencyInput(document.getElementById('inMovTCMonto'));

  // ---------- Cálculo de saldos ----------
  function saldoCuenta(nombre){
    const c = data.cuentas.find(c=>c.nombre===nombre);
    if(!c) return 0;
    let s = c.saldoBase;
    data.movimientos.forEach(m=>{
      if(m.cuenta!==nombre) return;
      s += m.tipo==='Ingreso' ? m.monto : -m.monto;
    });
    return s;
  }

  function cupoDisponible(nombreTarjeta){
    const t = data.tarjetas.find(t=>t.nombre===nombreTarjeta);
    if(!t) return 0;
    let s = t.cupoInicial;
    data.movimientosTC.forEach(m=>{
      if(m.tarjeta!==nombreTarjeta) return;
      s += m.tipo==='Pago' ? m.monto : -m.monto;
    });
    return s;
  }

  // Cuota fija mensual (sistema francés): monto*i / (1-(1+i)^-cuotas)
  function calcularCuotaFija(monto, cuotas, eaPercent){
    if(!eaPercent || eaPercent<=0) return monto/cuotas;
    const i = Math.pow(1 + eaPercent/100, 1/12) - 1;
    return (monto * i) / (1 - Math.pow(1+i, -cuotas));
  }

  // ---------- Gráficas ----------
  let chartDonut = null, chartLine = null;
  let chartsStale = true;
  let lineRangeDays = 365;
  let currentPageIndex = 1;

  function computeBalanceSeries(rangeDays){
    const dateSet = new Set();
    data.movimientos.forEach(m=> dateSet.add(m.fecha.slice(0,10)));
    const hoy = new Date().toISOString().slice(0,10);
    dateSet.add(hoy);
    let dateList = Array.from(dateSet).sort();
    if(rangeDays){
      const cutoff = new Date(Date.now() - rangeDays*86400000).toISOString().slice(0,10);
      dateList = dateList.filter(d=>d>=cutoff);
      if(!dateList.length) dateList = [hoy];
    }
    const series = {};
    data.cuentas.forEach(c=>{
      series[c.nombre] = dateList.map(d=>{
        let s = c.saldoBase;
        data.movimientos.forEach(m=>{
          if(m.cuenta!==c.nombre) return;
          if(m.fecha.slice(0,10) <= d) s += (m.tipo==='Ingreso' ? m.monto : -m.monto);
        });
        return Math.round(s);
      });
    });
    return { labels: dateList, series };
  }

  function renderDonutChart(){
    if(typeof Chart === 'undefined'){
      document.getElementById('donutChart').style.display = 'none';
      const eb = document.getElementById('donutEmpty');
      eb.style.display = 'block';
      eb.textContent = 'No se pudo cargar el motor de gráficas (revisa tu conexión y refresca).';
      return;
    }
    const incluidas = data.cuentas.filter(c=>c.incluirTotal);
    const valores = incluidas.map(c=>Math.max(0, saldoCuenta(c.nombre)));
    const colores = incluidas.map((c,i)=> c.color || COLORS[i % COLORS.length]);
    const total = valores.reduce((a,b)=>a+b,0);
    const canvas = document.getElementById('donutChart');
    const emptyBox = document.getElementById('donutEmpty');
    if(chartDonut){ chartDonut.destroy(); chartDonut = null; }

    if(!incluidas.length || total<=0){
      canvas.style.display = 'none';
      emptyBox.style.display = 'block';
      document.getElementById('donutLegend').innerHTML = '';
      return;
    }
    canvas.style.display = 'block';
    emptyBox.style.display = 'none';
    chartDonut = new Chart(canvas, {
      type: 'doughnut',
      data: { labels: incluidas.map(c=>c.nombre), datasets: [{ data: valores, backgroundColor: colores, borderWidth: 2, borderColor: '#ffffff' }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '62%',
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx)=> ctx.label + ': ' + fmt(ctx.parsed) + ' (' + Math.round(ctx.parsed/total*100) + '%)' } }
        }
      }
    });
    document.getElementById('donutLegend').innerHTML = incluidas.map((c,i)=>{
      const val = valores[i];
      const pct = total>0 ? Math.round(val/total*100) : 0;
      return `<div class="legend-row"><span class="legend-dot" style="background:${colores[i]}"></span><span class="legend-name">${c.emoji?c.emoji+' ':''}${escapeHtml(c.nombre)}</span><span class="legend-val num">${fmt(val)} · ${pct}%</span></div>`;
    }).join('');
  }

  function renderLineChart(){
    if(typeof Chart === 'undefined'){
      document.getElementById('lineChart').style.display = 'none';
      const eb = document.getElementById('lineEmpty');
      eb.style.display = 'block';
      eb.textContent = 'No se pudo cargar el motor de gráficas (revisa tu conexión y refresca).';
      return;
    }
    const canvas = document.getElementById('lineChart');
    const emptyBox = document.getElementById('lineEmpty');
    if(chartLine){ chartLine.destroy(); chartLine = null; }

    if(!data.cuentas.length){
      canvas.style.display = 'none';
      emptyBox.style.display = 'block';
      return;
    }
    canvas.style.display = 'block';
    emptyBox.style.display = 'none';
    const { labels, series } = computeBalanceSeries(lineRangeDays || null);
    const displayLabels = labels.map(d => new Date(d+'T00:00:00').toLocaleDateString('es-CO', {day:'2-digit', month:'short'}));
    const datasets = data.cuentas.map((c,i)=>({
      label: c.nombre,
      data: series[c.nombre],
      borderColor: c.color || COLORS[i % COLORS.length],
      backgroundColor: 'transparent',
      tension: 0.2, pointRadius: 2, pointHoverRadius: 4, borderWidth: 2
    }));
    chartLine = new Chart(canvas, {
      type: 'line',
      data: { labels: displayLabels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true, position: 'bottom', labels: { boxWidth: 10, font: {size:10.5}, color: '#3c4a63' } },
          tooltip: { callbacks: { label: (ctx)=> ctx.dataset.label + ': ' + fmt(ctx.parsed.y) } }
        },
        scales: {
          y: { ticks: { font:{size:10}, callback: (v)=> '$'+(Math.abs(v)>=1000000 ? Math.round(v/1000000)+'M' : Math.abs(v)>=1000 ? Math.round(v/1000)+'k' : v) }, grid: { color:'#e4e8f0' } },
          x: { ticks: { font:{size:10}, maxRotation:0, autoSkip:true, maxTicksLimit:6 }, grid: { display:false } }
        }
      }
    });
  }

  function renderGraficas(){
    chartsStale = false;
    renderDonutChart();
    renderLineChart();
  }

  document.querySelectorAll('.range-tab').forEach(btn=>{
    btn.onclick = ()=>{
      document.querySelectorAll('.range-tab').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      lineRangeDays = parseInt(btn.dataset.range, 10) || 0;
      renderLineChart();
    };
  });

  // ---------- Gráficas de tarjetas de crédito ----------
  let chartDonutTC = null, chartLineTC = null;
  let chartsTCStale = true;
  let tcLineRangeDays = 365;
  let tcGraficaSeleccionada = null;

  // Cupo utilizado = cupoInicial - cupoDisponible; por construcción, utilizado + disponible = cupoInicial (el "cupo total").
  function cupoUtilizadoTarjeta(nombre){
    const t = data.tarjetas.find(t=>t.nombre===nombre);
    if(!t) return 0;
    return Math.max(0, t.cupoInicial - cupoDisponible(nombre));
  }

  function computeCupoUtilizadoSeries(nombreTarjeta, rangeDays){
    const dateSet = new Set();
    data.movimientosTC.forEach(m=>{ if(m.tarjeta===nombreTarjeta) dateSet.add(m.fecha.slice(0,10)); });
    const hoy = new Date().toISOString().slice(0,10);
    dateSet.add(hoy);
    let dateList = Array.from(dateSet).sort();
    if(rangeDays){
      const cutoff = new Date(Date.now() - rangeDays*86400000).toISOString().slice(0,10);
      dateList = dateList.filter(d=>d>=cutoff);
      if(!dateList.length) dateList = [hoy];
    }
    const serie = dateList.map(d=>{
      let s = 0;
      data.movimientosTC.forEach(m=>{
        if(m.tarjeta!==nombreTarjeta) return;
        if(m.fecha.slice(0,10) <= d) s += (m.tipo==='Compra' ? m.monto : -m.monto);
      });
      return Math.round(Math.max(0, s));
    });
    return { labels: dateList, data: serie };
  }

  function poblarSelectorGraficaTC(){
    const sel = document.getElementById('graficaTCSelect');
    if(!data.tarjetas.some(t=>t.nombre===tcGraficaSeleccionada)){
      tcGraficaSeleccionada = data.tarjetas.length ? data.tarjetas[0].nombre : null;
    }
    sel.innerHTML = data.tarjetas.map(t=>`<option value="${escapeHtml(t.nombre)}" ${t.nombre===tcGraficaSeleccionada?'selected':''}>${t.emoji?t.emoji+' ':''}${escapeHtml(t.nombre)}</option>`).join('');
  }

  function renderDonutChartTC(){
    if(typeof Chart === 'undefined'){
      document.getElementById('donutChartTC').style.display = 'none';
      const eb = document.getElementById('donutTCEmpty');
      eb.style.display = 'block';
      eb.textContent = 'No se pudo cargar el motor de gráficas (revisa tu conexión y refresca).';
      return;
    }
    const canvas = document.getElementById('donutChartTC');
    const emptyBox = document.getElementById('donutTCEmpty');
    if(chartDonutTC){ chartDonutTC.destroy(); chartDonutTC = null; }
    const t = data.tarjetas.find(t=>t.nombre===tcGraficaSeleccionada);
    if(!t){
      canvas.style.display = 'none'; emptyBox.style.display = 'block';
      document.getElementById('donutTCLegend').innerHTML = '';
      return;
    }
    canvas.style.display = 'block'; emptyBox.style.display = 'none';
    const utilizado = cupoUtilizadoTarjeta(t.nombre);
    const disponible = Math.max(0, cupoDisponible(t.nombre));
    const total = utilizado + disponible;
    const pct = total>0 ? Math.round(utilizado/total*100) : 0;
    chartDonutTC = new Chart(canvas, {
      type: 'doughnut',
      data: { labels: ['Cupo utilizado','Cupo disponible'], datasets: [{ data: [utilizado, disponible], backgroundColor: ['#c1443c','#159a80'], borderWidth: 2, borderColor:'#ffffff' }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '62%',
        plugins: {
          legend: { display:false },
          tooltip: { callbacks: { label:(ctx)=> ctx.label+': '+fmt(ctx.parsed) } }
        }
      }
    });
    document.getElementById('donutTCLegend').innerHTML = `
      <div class="legend-row"><span class="legend-dot" style="background:#c1443c"></span><span class="legend-name">Cupo utilizado</span><span class="legend-val num">${fmt(utilizado)} · ${pct}%</span></div>
      <div class="legend-row"><span class="legend-dot" style="background:#159a80"></span><span class="legend-name">Cupo disponible</span><span class="legend-val num">${fmt(disponible)} · ${100-pct}%</span></div>
      <div class="legend-row"><span class="legend-dot" style="background:var(--ink)"></span><span class="legend-name">Cupo total</span><span class="legend-val num">${fmt(total)}</span></div>
    `;
  }

  function renderLineChartTC(){
    if(typeof Chart === 'undefined'){
      document.getElementById('lineChartTC').style.display = 'none';
      const eb = document.getElementById('lineTCEmpty');
      eb.style.display = 'block';
      eb.textContent = 'No se pudo cargar el motor de gráficas (revisa tu conexión y refresca).';
      return;
    }
    const canvas = document.getElementById('lineChartTC');
    const emptyBox = document.getElementById('lineTCEmpty');
    if(chartLineTC){ chartLineTC.destroy(); chartLineTC = null; }
    const t = data.tarjetas.find(t=>t.nombre===tcGraficaSeleccionada);
    if(!t){
      canvas.style.display = 'none'; emptyBox.style.display = 'block';
      return;
    }
    canvas.style.display = 'block'; emptyBox.style.display = 'none';
    const { labels, data: serie } = computeCupoUtilizadoSeries(t.nombre, tcLineRangeDays || null);
    const displayLabels = labels.map(d => new Date(d+'T00:00:00').toLocaleDateString('es-CO', {day:'2-digit', month:'short'}));
    chartLineTC = new Chart(canvas, {
      type: 'line',
      data: { labels: displayLabels, datasets: [{
        label: 'Cupo utilizado', data: serie,
        borderColor: '#c1443c', backgroundColor: 'rgba(193,68,60,.08)', fill: true,
        tension: 0.2, pointRadius: 2, pointHoverRadius: 4, borderWidth: 2
      }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode:'index', intersect:false },
        plugins: {
          legend: { display:false },
          tooltip: { callbacks: { label:(ctx)=> 'Cupo utilizado: '+fmt(ctx.parsed.y) } }
        },
        scales: {
          y: { ticks: { font:{size:10}, callback:(v)=> '$'+(Math.abs(v)>=1000000?Math.round(v/1000000)+'M':Math.abs(v)>=1000?Math.round(v/1000)+'k':v) }, grid:{color:'#e4e8f0'} },
          x: { ticks: { font:{size:10}, maxRotation:0, autoSkip:true, maxTicksLimit:6 }, grid:{display:false} }
        }
      }
    });
  }

  function renderGraficasTC(){
    chartsTCStale = false;
    poblarSelectorGraficaTC();
    renderDonutChartTC();
    renderLineChartTC();
  }

  document.getElementById('graficaTCSelect').addEventListener('change', (e)=>{
    tcGraficaSeleccionada = e.target.value;
    renderDonutChartTC();
    renderLineChartTC();
  });

  document.querySelectorAll('.range-tab-tc').forEach(btn=>{
    btn.onclick = ()=>{
      document.querySelectorAll('.range-tab-tc').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      tcLineRangeDays = parseInt(btn.dataset.rangetc, 10) || 0;
      renderLineChartTC();
    };
  });

  function accrueInterest(){
    const now = Date.now();
    let changed = false;
    data.cuentas.forEach(c=>{
      if(!c.lastAccrual){ c.lastAccrual = new Date(now).toISOString(); changed = true; return; }
      if(!c.rendimiento) return;
      const last = new Date(c.lastAccrual).getTime();
      const days = Math.floor((now-last)/86400000);
      if(days>=1){
        const dailyRate = Math.pow(1 + c.rendimiento.ea/100, 1/365) - 1;
        for(let i=0;i<days;i++){
          const actual = saldoCuenta(c.nombre);
          c.saldoBase += actual*dailyRate;
        }
        c.lastAccrual = new Date(last + days*86400000).toISOString();
        changed = true;
      }
    });
    if(changed) save();
  }

  // ---------- Movimientos automáticos programados ----------
  function addInterval(d, frecuencia){
    const nd = new Date(d);
    switch(frecuencia){
      case 'diaria': nd.setDate(nd.getDate()+1); break;
      case 'semanal': nd.setDate(nd.getDate()+7); break;
      case 'quincenal': nd.setDate(nd.getDate()+15); break;
      case 'mensual': {
        const day = nd.getDate();
        nd.setDate(1);
        nd.setMonth(nd.getMonth()+1);
        const lastDay = new Date(nd.getFullYear(), nd.getMonth()+1, 0).getDate();
        nd.setDate(Math.min(day, lastDay));
        break;
      }
      case 'anual': nd.setFullYear(nd.getFullYear()+1); break;
    }
    return nd;
  }

  function processAutomaticos(){
    const now = Date.now();
    let changed = false;
    let huboOmitidos = false;
    const nuevos = [];
    data.cuentas.forEach(c=>{
      let saldoProyectado = saldoCuenta(c.nombre);
      (c.automaticos||[]).forEach(rule=>{
        if(!rule.activo) return;
        let proxima = new Date(rule.proxima || rule.inicio).getTime();
        let guard = 0;
        while(proxima <= now && guard < 300){
          if(rule.tipo === 'Egreso' && (saldoProyectado - rule.monto) < 0){
            huboOmitidos = true;
            break; // sin saldo suficiente: queda pendiente, se reintenta en el próximo refresco
          }
          nuevos.push({
            id: uid(), tipo: rule.tipo, cuenta: c.nombre, monto: rule.monto,
            descripcion: rule.descripcion || ('Automático · '+rule.tipo), categoria: rule.categoria || '',
            fecha: new Date(proxima).toISOString(),
            fechaLabel: new Date(proxima).toLocaleDateString('es-CO', {day:'2-digit', month:'short'})
          });
          saldoProyectado += (rule.tipo === 'Ingreso' ? rule.monto : -rule.monto);
          changed = true;
          guard++;
          if(rule.frecuencia === 'una_vez'){ rule.activo = false; break; }
          proxima = addInterval(new Date(proxima), rule.frecuencia).getTime();
        }
        rule.proxima = new Date(proxima).toISOString();
      });
    });
    if(changed){
      nuevos.forEach(m=> data.movimientos.push(m));
      save();
      nuevos.forEach(m=> queueSync(()=> syncMovimientoBackground(m)));
    } else if(huboOmitidos){
      save();
    }
    if(huboOmitidos) showToast('Un movimiento automático no se hizo por falta de saldo, queda pendiente');
    return changed;
  }

  function processPlanesCuotas(){
    const now = Date.now();
    let changed = false;
    let huboOmitidos = false;
    const saldoProyectado = {};
    const nuevasTC = [];
    const nuevasCuenta = [];
    data.planesCuotas.forEach(plan=>{
      if(!plan.activo) return;
      if(!data.cuentas.some(c=>c.nombre===plan.cuenta)) return; // cuenta origen ya no existe
      if(saldoProyectado[plan.cuenta] === undefined) saldoProyectado[plan.cuenta] = saldoCuenta(plan.cuenta);
      let proxima = new Date(plan.proxima).getTime();
      let guard = 0;
      while(proxima <= now && plan.cuotasPagadas < plan.cuotasTotal && guard < 300){
        if((saldoProyectado[plan.cuenta] - plan.montoCuota) < 0){
          huboOmitidos = true;
          break; // sin saldo suficiente en la cuenta: la cuota queda pendiente, se reintenta después
        }
        const numCuota = plan.cuotasPagadas + 1;
        const linkId = uid();
        const fechaISO = new Date(proxima).toISOString();
        const fechaLabel = new Date(proxima).toLocaleDateString('es-CO', {day:'2-digit', month:'short'});
        const descBase = plan.descripcion ? plan.descripcion+' · ' : '';
        nuevasTC.push({
          id: uid(), tipo:'Pago', tarjeta: plan.tarjeta, monto: plan.montoCuota,
          descripcion: descBase+'cuota '+numCuota+'/'+plan.cuotasTotal, cuentaRelacionada: plan.cuenta,
          groupId: linkId, fecha: fechaISO, fechaLabel
        });
        nuevasCuenta.push({
          id: uid(), tipo:'Egreso', cuenta: plan.cuenta, monto: plan.montoCuota,
          descripcion: 'Cuota '+numCuota+'/'+plan.cuotasTotal+' tarjeta '+plan.tarjeta,
          groupId: linkId, fecha: fechaISO, fechaLabel
        });
        saldoProyectado[plan.cuenta] -= plan.montoCuota;
        plan.cuotasPagadas = numCuota;
        changed = true;
        guard++;
        if(plan.cuotasPagadas >= plan.cuotasTotal){ plan.activo = false; break; }
        proxima = addInterval(new Date(proxima), 'mensual').getTime();
      }
      plan.proxima = new Date(proxima).toISOString();
    });
    if(huboOmitidos) showToast('Una cuota de tarjeta no se pagó por falta de saldo, queda pendiente');
    if(changed){
      nuevasTC.forEach(m=> data.movimientosTC.push(m));
      nuevasCuenta.forEach(m=> data.movimientos.push(m));
      save();
      nuevasCuenta.forEach(m=> queueSync(()=> syncMovimientoBackground(m)));
      nuevasTC.forEach(m=> queueSync(()=> syncMovimientoBackground({
        tipo: m.tipo, cuenta: 'TC: '+m.tarjeta, monto: m.monto,
        descripcion: m.descripcion + ' · Cuenta origen: ' + m.cuentaRelacionada,
        fecha: m.fecha
      })));
    }
    return changed;
  }

  // ---------- Render ----------
  function renderTarjetas(){
    const totalTC = data.tarjetas.filter(t=>t.incluirTotal).reduce((a,t)=>a+cupoDisponible(t.nombre),0);
    document.getElementById('totalTC').textContent = settings.ocultar ? '•••••••' : fmt(totalTC);
    document.getElementById('tarjetasCount').textContent =
      data.tarjetas.length ? data.tarjetas.length + ' tarjeta' + (data.tarjetas.length>1?'s':'') + ' · ' + data.tarjetas.filter(t=>t.incluirTotal).length + ' en el total' : 'Sin tarjetas todavía';
    document.getElementById('btnEyeTC').textContent = settings.ocultar ? '🙈' : '👁️';

    const grid = document.getElementById('tarjetasGrid');
    grid.innerHTML = '';
    data.tarjetas.forEach(t=>{
      const oculto = settings.ocultar || t.oculto;
      const color = t.color || '';
      const cupo = cupoDisponible(t.nombre);
      const el = document.createElement('div');
      el.className = 'cuenta-card' + (t.incluirTotal ? '' : ' excluded');
      if(color){
        el.style.background = color + '17';
        el.style.borderColor = color + '55';
      }
      el.innerHTML = `
        <div class="crow">
          <div class="cuenta-badge" style="background:${color?color+'30':'var(--paper)'};">${t.emoji || '💳'}</div>
          <button class="cuenta-eye" data-id="${t.id}">${oculto?'🙈':'👁️'}</button>
        </div>
        <div class="nombre">${escapeHtml(t.nombre)}</div>
        <div class="saldo num" style="color:${cupo<0?'var(--down)':'var(--ink)'}">${oculto?'••••':fmt(cupo)}</div>
      `;
      el.onclick = ()=>openEditTarjeta(t.id);
      el.querySelector('.cuenta-eye').onclick = (ev)=>{
        ev.stopPropagation();
        const tt = data.tarjetas.find(x=>x.id===t.id);
        tt.oculto = !tt.oculto;
        save(); render();
      };
      grid.appendChild(el);
    });
    const addCard = document.createElement('div');
    addCard.className = 'cuenta-card add';
    addCard.textContent = '＋';
    addCard.onclick = ()=>openNewTarjeta();
    grid.appendChild(addCard);

    const movSelectTC = document.getElementById('inMovTCTarjeta');
    if(movSelectTC) movSelectTC.innerHTML = data.tarjetas.map(t=>`<option value="${escapeHtml(t.nombre)}">${t.emoji?t.emoji+' ':''}${escapeHtml(t.nombre)}</option>`).join('');
    const cuentaSelectsTC = [document.getElementById('inMovTCCuentaPago'), document.getElementById('inCompraCuenta')];
    cuentaSelectsTC.forEach(sel=>{ if(sel) sel.innerHTML = data.cuentas.map(c=>`<option value="${escapeHtml(c.nombre)}">${c.emoji?c.emoji+' ':''}${escapeHtml(c.nombre)}</option>`).join(''); });

    const listTC = document.getElementById('movListTC');
    if(listTC){
      const recientesTC = [...data.movimientosTC].reverse().slice(0,30);
      if(!recientesTC.length){
        listTC.innerHTML = '<div class="empty">Todavía no has registrado movimientos de tarjetas.<br>Toca "Registrar movimiento" para empezar.</div>';
      } else {
        listTC.innerHTML = recientesTC.map(m=>{
          const cls = m.tipo==='Pago' ? 'in':'out';
          const sign = m.tipo==='Pago' ? '+':'−';
          return `<div class="mov-item">
            <div class="mov-icon ${cls}">${m.tipo==='Pago'?'↑':'↓'}</div>
            <div class="mov-mid">
              <div class="mov-desc">${escapeHtml(m.descripcion) || m.tipo}</div>
              <div class="mov-meta">${escapeHtml(m.tarjeta)} · ${m.fechaLabel}</div>
            </div>
            <div class="mov-amt ${cls} num">${settings.ocultar?'••••':(sign+' '+Math.round(m.monto).toLocaleString('es-CO'))}</div>
          </div>`;
        }).join('');
      }
    }
  }

  function render(){
    const total = data.cuentas.filter(c=>c.incluirTotal).reduce((a,c)=>a+saldoCuenta(c.nombre),0);
    document.getElementById('totalSaldo').textContent = settings.ocultar ? '•••••••' : fmt(total);
    document.getElementById('cuentasCount').textContent =
      data.cuentas.length ? data.cuentas.length + ' cuenta' + (data.cuentas.length>1?'s':'') + ' · ' + data.cuentas.filter(c=>c.incluirTotal).length + ' en el total' : 'Sin cuentas todavía';
    document.getElementById('btnEye').textContent = settings.ocultar ? '🙈' : '👁️';

    const grid = document.getElementById('cuentasGrid');
    grid.innerHTML = '';
    data.cuentas.forEach(c=>{
      const s = saldoCuenta(c.nombre);
      const oculto = settings.ocultar || c.oculto;
      const color = c.color || '';
      const el = document.createElement('div');
      el.className = 'cuenta-card' + (c.incluirTotal ? '' : ' excluded');
      if(color){
        el.style.background = color + '17';
        el.style.borderColor = color + '55';
      }
      el.innerHTML = `
        <div class="crow">
          <div class="cuenta-badge" style="background:${color?color+'30':'var(--paper)'};">${c.emoji || '💼'}</div>
          <button class="cuenta-eye" data-id="${c.id}">${oculto?'🙈':'👁️'}</button>
        </div>
        <div class="nombre">${escapeHtml(c.nombre)}</div>
        <div class="saldo num" style="color:${s<0?'var(--down)':'var(--ink)'}">${oculto?'••••':fmt(s)}</div>
        ${c.rendimiento?'<span class="badge">'+c.rendimiento.ea+'% EA</span>':''}
      `;
      el.onclick = ()=>openEditCuenta(c.id);
      el.querySelector('.cuenta-eye').onclick = (ev)=>{
        ev.stopPropagation();
        const cc = data.cuentas.find(x=>x.id===c.id);
        cc.oculto = !cc.oculto;
        save(); render();
      };
      grid.appendChild(el);
    });
    const addCard = document.createElement('div');
    addCard.className = 'cuenta-card add';
    addCard.textContent = '＋';
    addCard.onclick = ()=>openNewCuenta();
    grid.appendChild(addCard);

    const movSelect = document.getElementById('inMovCuenta');
    movSelect.innerHTML = data.cuentas.map(c=>`<option value="${escapeHtml(c.nombre)}">${c.emoji?c.emoji+' ':''}${escapeHtml(c.nombre)}</option>`).join('');

    const list = document.getElementById('movList');
    const recientes = [...data.movimientos].reverse().slice(0,30);
    if(!recientes.length){
      list.innerHTML = '<div class="empty">Todavía no has registrado movimientos.<br>Toca "Registrar movimiento" para empezar.</div>';
    } else {
      list.innerHTML = recientes.map(m=>{
        const cls = m.tipo==='Ingreso' ? 'in':'out';
        const sign = m.tipo==='Ingreso' ? '+':'−';
        return `<div class="mov-item">
          <div class="mov-icon ${cls}">${m.tipo==='Ingreso'?'↑':'↓'}</div>
          <div class="mov-mid">
            <div class="mov-desc">${escapeHtml(m.descripcion) || m.tipo}</div>
            <div class="mov-meta">${escapeHtml(m.cuenta)} · ${m.fechaLabel}${m.categoria?' · '+escapeHtml(m.categoria):''}</div>
          </div>
          <div class="mov-amt ${cls} num">${settings.ocultar?'••••':(sign+' '+Math.round(m.monto).toLocaleString('es-CO'))}</div>
        </div>`;
      }).join('');
    }

    renderTarjetas();

    chartsStale = true;
    if(currentPageIndex === 0) renderGraficas();
    chartsTCStale = true;
    if(currentPageIndex === 3) renderGraficasTC();

    document.getElementById('banner').style.display = settings.sheetId ? 'none' : 'flex';
    document.getElementById('btnSheetLink').style.display = settings.sheetId ? 'flex' : 'none';
    const statusLine = document.getElementById('statusLine');
    const dot = document.getElementById('statusDot');
    const text = document.getElementById('statusText');
    if(settings.sheetId){
      statusLine.style.display = 'flex';
      if(lastError){
        statusLine.classList.add('err');
        dot.classList.remove('on');
        text.textContent = 'No se pudo sincronizar el último cambio · toca para ver por qué';
        statusLine.onclick = ()=>showError(lastError, 'No se pudo sincronizar');
      } else {
        statusLine.classList.remove('err');
        dot.classList.add('on');
        text.textContent = 'Sincronizado con Google Sheets';
        statusLine.onclick = null;
      }
    } else {
      statusLine.style.display = 'none';
    }
  }

  function toggleOverlay(id, show){ document.getElementById(id).classList.toggle('show', show); }
  function showToast(msg){
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    const dur = msg.length > 40 ? 5000 : 2200;
    setTimeout(()=>t.classList.remove('show'), dur);
  }

  // ---------- Errores claros ----------
  let lastError = null;
  function friendlyError(raw){
    const s = (raw||'').toLowerCase();
    if(s.includes('no-client-id')) return 'Falta pegar tu Client ID de Google en Ajustes ⚙️ antes de conectar.';
    if(s.includes('access_denied') || s.includes('403') || s.includes('has not completed') || s.includes('verification')) return 'Tu cuenta de Google no está autorizada todavía para usar esta app. Ve a Google Cloud Console > APIs & Services > OAuth consent screen > sección "Test users", y agrega ahí tu correo de Gmail exacto.';
    if(s.includes('has not been used') || (s.includes('disabled') && s.includes('api'))) return 'La Google Sheets API no está habilitada (o Google todavía no terminó de activarla, puede tardar 2-3 minutos). Ve a APIs & Services > Library > busca "Google Sheets API" > Enable, espera un momento y vuelve a intentar.';
    if(s.includes('popup') || s.includes('closed') || s.includes('cancel')) return 'Parece que cerraste la ventana de inicio de sesión de Google antes de terminar. Toca Conectar de nuevo y completa todo el proceso hasta el final (incluyendo el botón Continuar/Permitir).';
    if(s.includes('redirect_uri') || s.includes('origin') || s.includes('idpiframe') || s.includes('unregistered')) return 'El origen de esta página no está autorizado en tu Client ID de Google. Revisa en Google Cloud > Credentials que "Orígenes autorizados de JavaScript" tenga exactamente tu dominio de github.io, sin barra ni ruta al final.';
    if(s.includes('invalid_client') || s.includes('client')) return 'El Client ID pegado en Ajustes no parece válido. Revisa que lo copiaste completo, sin espacios, terminando en .apps.googleusercontent.com.';
    if(s.includes('failed to fetch') || s.includes('networkerror') || s.includes('load failed')) return 'No se pudo conectar a internet en este momento para hablar con Google. Revisa tu conexión e intenta de nuevo.';
    return 'Google devolvió un error que no reconozco automáticamente. Copia el detalle técnico de abajo y compártemelo para revisarlo juntos.';
  }
  function showError(raw, title){
    lastError = raw;
    document.getElementById('errorTitle').textContent = title || 'No se pudo conectar';
    document.getElementById('errorFriendly').textContent = friendlyError(raw);
    document.getElementById('errorTech').textContent = (raw && raw.toString) ? raw.toString() : JSON.stringify(raw);
    toggleOverlay('errorOverlay', true);
  }
  document.getElementById('errorClose').onclick = ()=>toggleOverlay('errorOverlay', false);
  document.getElementById('errorCopy').onclick = async ()=>{
    try{
      await navigator.clipboard.writeText(document.getElementById('errorTech').textContent);
      showToast('Detalle copiado');
    }catch(e){ showToast('No se pudo copiar, selecciona el texto manualmente'); }
  };

  // ---------- Ojo global ----------
  document.getElementById('btnEye').onclick = ()=>{
    settings.ocultar = !settings.ocultar;
    saveSettingsLS(); render();
  };
  document.getElementById('btnEyeTC').onclick = ()=>{
    settings.ocultar = !settings.ocultar;
    saveSettingsLS(); render();
  };

  // ---------- Qué cuentas suman al total ----------
  function renderTotalConfigList(){
    const box = document.getElementById('totalConfigList');
    if(!data.cuentas.length){
      box.innerHTML = '<div class="empty">Todavía no tienes cuentas creadas.</div>';
      return;
    }
    box.innerHTML = '';
    data.cuentas.forEach(c=>{
      const row = document.createElement('div');
      row.className = 'swrow';
      row.innerHTML = `<span class="swlabel">${c.emoji?c.emoji+' ':''}${escapeHtml(c.nombre)}</span>
        <div class="swtoggle ${c.incluirTotal?'on':''}" data-id="${c.id}"><div class="knob"></div></div>`;
      row.querySelector('.swtoggle').onclick = ()=>{
        c.incluirTotal = !c.incluirTotal;
        save(); render(); renderTotalConfigList();
        syncSaldosBackground();
      };
      box.appendChild(row);
    });
  }
  document.getElementById('tickerInfo').onclick = ()=>{
    renderTotalConfigList();
    toggleOverlay('overlayTotalConfig', true);
  };
  document.getElementById('closeTotalConfig').onclick = ()=>toggleOverlay('overlayTotalConfig', false);

  // ---------- Qué tarjetas suman al total ----------
  function renderTotalTCConfigList(){
    const box = document.getElementById('totalTCConfigList');
    if(!data.tarjetas.length){
      box.innerHTML = '<div class="empty">Todavía no tienes tarjetas creadas.</div>';
      return;
    }
    box.innerHTML = '';
    data.tarjetas.forEach(t=>{
      const row = document.createElement('div');
      row.className = 'swrow';
      row.innerHTML = `<span class="swlabel">${t.emoji?t.emoji+' ':''}${escapeHtml(t.nombre)}</span>
        <div class="swtoggle ${t.incluirTotal?'on':''}" data-id="${t.id}"><div class="knob"></div></div>`;
      row.querySelector('.swtoggle').onclick = ()=>{
        t.incluirTotal = !t.incluirTotal;
        save(); render(); renderTotalTCConfigList();
      };
      box.appendChild(row);
    });
  }
  document.getElementById('tickerInfoTC').onclick = ()=>{
    renderTotalTCConfigList();
    toggleOverlay('overlayTotalTCConfig', true);
  };
  document.getElementById('closeTotalTCConfig').onclick = ()=>toggleOverlay('overlayTotalTCConfig', false);


  // ---------- Ajustes ----------
  document.getElementById('btnSettings').onclick = ()=>{
    const list = document.getElementById('shortcutAccountsList');
    list.innerHTML = data.cuentas.length
      ? data.cuentas.map(c=>`• ${escapeHtml(c.nombre)}`).join('<br>')
      : 'Todavía no tienes cuentas creadas.';
    toggleOverlay('overlaySettings', true);
  };
  document.getElementById('btnCopyAccounts').onclick = async ()=>{
    if(!data.cuentas.length){ showToast('Todavía no tienes cuentas creadas'); return; }
    const texto = data.cuentas.map(c=>c.nombre).join(', ');
    try{ await navigator.clipboard.writeText(texto); showToast('Lista de cuentas copiada'); }
    catch(e){ showToast('No se pudo copiar, selecciona el texto manualmente'); }
  };
  document.getElementById('shareShortcutHelp').onclick = async ()=>{
    const baseUrl = window.location.origin + window.location.pathname;
    const cuentasTxt = data.cuentas.length ? data.cuentas.map(c=>c.nombre).join(', ') : '(agrega cuentas primero)';
    const texto = `Guía para el Atajo de Reckly\n\n1) Preguntar por entrada (Lista): Ingreso / Egreso\n2) Preguntar por entrada (Lista), cuentas exactas: ${cuentasTxt}\n3) Preguntar por entrada (Número): Monto\n4) Preguntar por entrada (Texto, opcional): Descripción\n5) Acción URL, arma:\n${baseUrl}?quickadd=1&tipo=[P1]&cuenta=[P2]&monto=[P3]&desc=[P4]\n6) Acción "Abrir URLs" con esa URL.\n7) Ancla el atajo al Centro de Control o pantalla de inicio.`;
    if(navigator.share){
      try{ await navigator.share({title:'Guía Atajo Reckly', text: texto}); }
      catch(e){}
    } else {
      try{ await navigator.clipboard.writeText(texto); showToast('Guía copiada (compartir no disponible aquí)'); }
      catch(e){ showToast('No se pudo compartir ni copiar'); }
    }
  };
  document.getElementById('cancelSettings').onclick = ()=>toggleOverlay('overlaySettings', false);
  // ---------- Copia de seguridad local (exportar / restaurar) ----------
  // Los datos de la app viven solo en localStorage de este dispositivo. La hoja de
  // Google guarda los movimientos, pero NO las cuentas, tarjetas, saldos iniciales
  // ni programaciones — por eso esta copia es la única vía real de recuperación
  // ante pérdida del teléfono o borrado del almacenamiento del navegador.
  document.getElementById('btnExportBackup').onclick = ()=>{
    try{
      const backup = {
        formato: 'reckly-backup',
        version: 1,
        exportado: new Date().toISOString(),
        data: data,
        preferencias: {
          ocultar: !!settings.ocultar,
          tcActivado: !!settings.tcActivado,
          sheetId: settings.sheetId || null,
          columnMap: settings.columnMap || {}
        }
      };
      // Nunca se incluye el token de acceso de Google en la copia.
      const blob = new Blob([JSON.stringify(backup, null, 2)], {type:'application/json'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const hoy = new Date().toISOString().slice(0,10);
      a.href = url;
      a.download = `reckly-backup-${hoy}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(()=>URL.revokeObjectURL(url), 1000);
      logSecurityEvent('backup_exported', 'Copia de seguridad local generada');
      showToast('Copia descargada. Guárdala en un lugar seguro.');
    }catch(e){
      showError((e && e.message) ? e.message : 'Error desconocido', 'No se pudo generar la copia');
    }
  };

  document.getElementById('btnImportBackup').onclick = ()=>{
    document.getElementById('fileImportBackup').click();
  };

  document.getElementById('fileImportBackup').addEventListener('change', (ev)=>{
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = ''; // permite volver a elegir el mismo archivo después
    if(!file) return;
    // Validación de tipo y tamaño antes de leer nada.
    if(file.size > 5 * 1024 * 1024){
      showToast('El archivo es demasiado grande para ser una copia válida');
      return;
    }
    if(!/\.json$/i.test(file.name) && file.type !== 'application/json'){
      showToast('Selecciona un archivo .json de copia de Reckly');
      return;
    }
    const reader = new FileReader();
    reader.onerror = ()=> showToast('No se pudo leer el archivo');
    reader.onload = ()=>{
      let parsed;
      try{ parsed = JSON.parse(reader.result); }
      catch(e){
        logSecurityEvent('backup_import_rejected', 'JSON inválido');
        showToast('El archivo no es una copia válida de Reckly');
        return;
      }
      // Validación estricta del contenido: se valida la estructura real,
      // nunca se confía en el archivo solo por su nombre o extensión.
      if(!parsed || parsed.formato !== 'reckly-backup' || !parsed.data || typeof parsed.data !== 'object'){
        logSecurityEvent('backup_import_rejected', 'Estructura no reconocida');
        showToast('El archivo no es una copia válida de Reckly');
        return;
      }
      const d = parsed.data;
      if(!Array.isArray(d.cuentas) || !Array.isArray(d.movimientos)){
        logSecurityEvent('backup_import_rejected', 'Faltan colecciones obligatorias');
        showToast('La copia está incompleta o dañada');
        return;
      }
      // Validación por elemento: nunca se confía en que un array bien formado
      // por fuera tenga objetos válidos por dentro. Se filtran entradas
      // corruptas y se fuerza el tipo esperado en cada campo.
      const num = (v,def)=>{ const n = Number(v); return isFinite(n) ? n : def; };
      const str = (v,max)=> typeof v === 'string' ? v.slice(0,max||200) : '';
      const sanitizarCuentas = arr => (Array.isArray(arr)?arr:[]).filter(c=>c && typeof c==='object' && typeof c.nombre==='string' && c.nombre.trim()).map(c=>({
        id: str(c.id,40) || uid(), nombre: str(c.nombre,60), saldoBase: num(c.saldoBase,0),
        incluirTotal: !!c.incluirTotal, emoji: str(c.emoji,8), color: str(c.color,20), oculto: !!c.oculto,
        rendimiento: (c.rendimiento && isFinite(Number(c.rendimiento.ea))) ? {ea: num(c.rendimiento.ea,0)} : null,
        automaticos: Array.isArray(c.automaticos) ? c.automaticos : [],
        lastAccrual: str(c.lastAccrual,40) || new Date().toISOString()
      }));
      const sanitizarMovs = (arr, campoCuenta) => (Array.isArray(arr)?arr:[]).filter(m=>m && typeof m==='object' && typeof m[campoCuenta]==='string').map(m=>({
        id: str(m.id,40) || uid(), tipo: (m.tipo==='Ingreso'||m.tipo==='Egreso'||m.tipo==='Compra'||m.tipo==='Pago') ? m.tipo : 'Egreso',
        [campoCuenta]: str(m[campoCuenta],60), monto: Math.abs(num(m.monto,0)),
        descripcion: str(m.descripcion,200), categoria: str(m.categoria,60),
        fecha: str(m.fecha,40) || new Date().toISOString(), fechaLabel: str(m.fechaLabel,20) || '',
        cuentaRelacionada: m.cuentaRelacionada ? str(m.cuentaRelacionada,60) : null,
        groupId: m.groupId ? str(m.groupId,40) : null
      }));
      const sanitizarTarjetas = arr => (Array.isArray(arr)?arr:[]).filter(t=>t && typeof t==='object' && typeof t.nombre==='string' && t.nombre.trim()).map(t=>({
        id: str(t.id,40) || uid(), nombre: str(t.nombre,60), cupoInicial: num(t.cupoInicial,0),
        incluirTotal: !!t.incluirTotal, emoji: str(t.emoji,8), color: str(t.color,20), oculto: !!t.oculto
      }));
      const sanitizarPlanes = arr => (Array.isArray(arr)?arr:[]).filter(p=>p && typeof p==='object' && typeof p.tarjeta==='string' && typeof p.cuenta==='string').map(p=>({
        id: str(p.id,40) || uid(), tarjeta: str(p.tarjeta,60), cuenta: str(p.cuenta,60),
        cuotasTotal: Math.min(120, Math.max(1, Math.round(num(p.cuotasTotal,1)))),
        cuotasPagadas: Math.max(0, Math.round(num(p.cuotasPagadas,0))),
        montoCuota: Math.abs(num(p.montoCuota,0)), descripcion: str(p.descripcion,200),
        interesEA: Math.min(200, Math.max(0, num(p.interesEA,0))),
        inicio: str(p.inicio,40) || new Date().toISOString(), proxima: str(p.proxima,40) || new Date().toISOString(),
        activo: !!p.activo
      }));

      const resumen = `${d.cuentas.length} cuenta(s), ${d.movimientos.length} movimiento(s)`
        + (Array.isArray(d.tarjetas) && d.tarjetas.length ? `, ${d.tarjetas.length} tarjeta(s)` : '');
      if(!confirm(`Vas a restaurar: ${resumen}.\n\nEsto REEMPLAZA todos los datos actuales de este dispositivo. ¿Continuar?`)) return;

      data = {
        cuentas: sanitizarCuentas(d.cuentas),
        movimientos: sanitizarMovs(d.movimientos, 'cuenta'),
        tarjetas: sanitizarTarjetas(d.tarjetas),
        movimientosTC: sanitizarMovs(d.movimientosTC, 'tarjeta'),
        planesCuotas: sanitizarPlanes(d.planesCuotas)
      };
      const p = parsed.preferencias || {};
      settings.ocultar = !!p.ocultar;
      settings.tcActivado = !!p.tcActivado;
      if(typeof p.sheetId === 'string') settings.sheetId = p.sheetId;
      if(p.columnMap && typeof p.columnMap === 'object' && !Array.isArray(p.columnMap)){
        const cm = {};
        Object.keys(p.columnMap).forEach(k=>{ if(k!=='__proto__' && k!=='constructor' && typeof p.columnMap[k]==='number') cm[k]=p.columnMap[k]; });
        settings.columnMap = cm;
      }
      save();
      saveSettingsLS();
      updatePagerVisibility();
      render();
      logSecurityEvent('backup_imported', resumen);
      showToast('Copia restaurada correctamente');
      toggleOverlay('overlaySettings', false);
    };
    reader.readAsText(file);
  });

  document.getElementById('btnDisconnectGoogle').onclick = ()=>{
    if(!localStorage.getItem(TOKEN_KEY)){
      showToast('No hay ninguna sesión activa con Google en este dispositivo');
      return;
    }
    const cached = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null');
    const finalizar = ()=>{
      localStorage.removeItem(TOKEN_KEY);
      tokenClient = null;
      render();
      toggleOverlay('overlaySettings', false);
      logSecurityEvent('logout', 'Acceso a Google Drive revocado por el usuario');
      showToast('Acceso revocado. Tu hoja de Sheets y tus datos locales siguen intactos.');
    };
    if(cached && cached.access_token && typeof google !== 'undefined' && google.accounts && google.accounts.oauth2){
      try{ google.accounts.oauth2.revoke(cached.access_token, finalizar); }
      catch(e){ finalizar(); }
    } else {
      finalizar();
    }
  };
  document.getElementById('btnSheetLink').onclick = ()=>{
    if(settings.sheetId) window.open('https://docs.google.com/spreadsheets/d/'+settings.sheetId+'/edit', '_blank');
  };

  // ---------- Refrescar / TC toggle en el header ----------
  document.getElementById('btnRefresh').onclick = ()=>{
    accrueInterest();
    const a = processAutomaticos();
    const b = processPlanesCuotas();
    render();
    renderGraficas();
    if(settings.tcActivado) renderGraficasTC();
    showToast((a||b) ? 'Se registraron movimientos programados ✅' : 'Ya está todo al día ✅');
  };
  document.getElementById('btnTC').onclick = ()=>{
    setSwitch('swTcActivado', settings.tcActivado);
    toggleOverlay('overlayTC', true);
  };
  document.getElementById('closeOverlayTC').onclick = ()=>toggleOverlay('overlayTC', false);

  // ---------- Guías: Centro de Control / Widget ----------
  function guideStepsHtml(steps){
    return steps.map((s,i)=>`
      <div class="guide-step">
        <div class="guide-num">${i+1}</div>
        <div>
          <div class="guide-step-title">${s.title}</div>
          <div class="guide-step-desc">${s.desc}</div>
        </div>
      </div>`).join('');
  }
  function buildShortcutSteps(){
    const baseUrl = window.location.origin + window.location.pathname;
    const cuentasTxtRaw = data.cuentas.length ? data.cuentas.map(c=>c.nombre).join(', ') : '(agrega tus cuentas primero para tener nombres que usar aquí)';
    const cuentasTxt = escapeHtml(cuentasTxtRaw);
    const baseUrlSafe = escapeHtml(baseUrl);
    return [
      {title:'Crea un Atajo nuevo', desc:'Abre la app <b>Atajos</b> de Apple &gt; toca + &gt; "Atajo nuevo".'},
      {title:'Pregunta el tipo', desc:'Agrega "Preguntar por entrada" tipo <b>Lista</b>: "¿Ingreso o Egreso?" con opciones Ingreso y Egreso.'},
      {title:'Pregunta la cuenta', desc:'Agrega otra "Preguntar por entrada" tipo <b>Lista</b>: "¿Qué cuenta?" con estas opciones exactas: <code>'+cuentasTxt+'</code>'},
      {title:'Pregunta el monto', desc:'Agrega "Preguntar por entrada" tipo <b>Número</b>: "¿Monto?". Opcional: una cuarta tipo Texto para la descripción.'},
      {title:'Arma la URL', desc:'Agrega la acción <b>URL</b> con: <code>'+baseUrlSafe+'?quickadd=1&tipo=[P1]&cuenta=[P2]&monto=[P3]&desc=[P4]</code>, insertando cada variable de las preguntas anteriores en su lugar.'},
      {title:'Abre la URL', desc:'Agrega la acción <b>"Abrir URLs"</b> usando esa URL armada. Nombra el atajo, por ejemplo "Registrar movimiento".'}
    ];
  }
  function openGuideCC(){
    const steps = buildShortcutSteps().concat([
      {title:'Activa el módulo en Ajustes', desc:'Ve a <b>Ajustes del iPhone &gt; Centro de Control</b>, y agrega el módulo <b>"Accesos Directos"</b> si no está ya en tu Centro de Control (con el botón + verde).'},
      {title:'Úsalo desde el Centro de Control', desc:'Abre el Centro de Control (desliza desde la esquina superior derecha), toca el ícono de Accesos Directos, y elige "Registrar movimiento". Ahí mismo, sin abrir la app, te va a preguntar tipo, cuenta y monto.'}
    ]);
    document.getElementById('guideCCSteps').innerHTML = guideStepsHtml(steps);
    toggleOverlay('overlayGuideCC', true);
  }
  function openGuideWidget(){
    const steps = buildShortcutSteps().concat([
      {title:'Mantén presionada la pantalla de inicio', desc:'En cualquier parte vacía de tu pantalla de inicio, mantén el dedo hasta que los íconos empiecen a moverse, y toca el + arriba a la izquierda.'},
      {title:'Busca el widget de Atajos', desc:'Busca "Atajos" en la lista, elige un tamaño (el pequeño alcanza para un solo botón), y toca "Añadir widget".'},
      {title:'Asigna tu atajo al widget', desc:'Mantén presionado el widget recién agregado &gt; Editar Atajo &gt; elige "Registrar movimiento". Listo: ahora es un ícono en tu pantalla de inicio, sin pasar por el Centro de Control.'}
    ]);
    document.getElementById('guideWidgetSteps').innerHTML = guideStepsHtml(steps);
    toggleOverlay('overlayGuideWidget', true);
  }
  document.getElementById('openGuideCC').onclick = openGuideCC;
  document.getElementById('openGuideWidget').onclick = openGuideWidget;
  document.getElementById('closeGuideCC').onclick = ()=>toggleOverlay('overlayGuideCC', false);
  document.getElementById('closeGuideWidget').onclick = ()=>toggleOverlay('overlayGuideWidget', false);

  // ---------- Selector de emoji / color ----------
  function buildPickers(){
    ['emojiPicker','emojiPickerTC'].forEach(id=>{
      const ep = document.getElementById(id);
      if(!ep) return;
      ep.innerHTML = '';
      EMOJIS.forEach(e=>{
        const b = document.createElement('div');
        b.className = 'emoji-opt' + (selectedEmoji===e ? ' sel':'');
        b.textContent = e;
        b.onclick = ()=>{ selectedEmoji = (selectedEmoji===e ? '' : e); buildPickers(); };
        ep.appendChild(b);
      });
    });
    ['colorPicker','colorPickerTC'].forEach(id=>{
      const cp = document.getElementById(id);
      if(!cp) return;
      cp.innerHTML = '';
      COLORS.forEach(col=>{
        const b = document.createElement('div');
        b.className = 'color-opt' + (selectedColor===col ? ' sel':'');
        b.style.background = col;
        b.onclick = ()=>{ selectedColor = (selectedColor===col ? '' : col); buildPickers(); };
        cp.appendChild(b);
      });
    });
  }

  // ---------- Cuentas: crear / editar ----------
  function resetCuentaForm(){
    document.getElementById('inCuentaNombre').value = '';
    document.getElementById('inCuentaSaldo').value = '';
    document.getElementById('inEA').value = '';
    selectedEmoji = ''; selectedColor = '';
    pendingAutomaticos = [];
    setSwitch('swIncluir', true);
    setSwitch('swRendimiento', false);
    setSwitch('swProgramar', false);
    document.getElementById('fieldEA').style.display = 'none';
    document.getElementById('automaticosSection').style.display = 'none';
    buildPickers();
    renderAutomaticosList();
  }
  function setSwitch(id, on){ document.getElementById(id).classList.toggle('on', on); }
  function isOn(id){ return document.getElementById(id).classList.contains('on'); }

  document.getElementById('swIncluir').onclick = ()=>setSwitch('swIncluir', !isOn('swIncluir'));
  document.getElementById('swRendimiento').onclick = ()=>{
    const on = !isOn('swRendimiento');
    setSwitch('swRendimiento', on);
    document.getElementById('fieldEA').style.display = on ? 'block' : 'none';
  };
  document.getElementById('swProgramar').onclick = ()=>{
    const on = !isOn('swProgramar');
    setSwitch('swProgramar', on);
    document.getElementById('automaticosSection').style.display = on ? 'block' : 'none';
  };

  const FREQ_LABELS = {una_vez:'Solo una vez', diaria:'Diaria', semanal:'Semanal', quincenal:'Cada 15 días', mensual:'Mensual', anual:'Anual'};
  function renderAutomaticosList(){
    const box = document.getElementById('automaticosList');
    if(!pendingAutomaticos.length){
      box.innerHTML = '<div class="empty" style="margin-bottom:10px;">Todavía no tienes movimientos programados en esta cuenta.</div>';
      return;
    }
    box.innerHTML = '';
    pendingAutomaticos.forEach(r=>{
      const proxima = new Date(r.proxima || r.inicio);
      const row = document.createElement('div');
      row.className = 'auto-item';
      row.innerHTML = `<div class="auto-mid">
          <div class="auto-title">${r.tipo==='Ingreso'?'↑':'↓'} ${fmt(r.monto)} ${r.descripcion?'· '+escapeHtml(r.descripcion):''}</div>
          <div class="auto-meta">${FREQ_LABELS[r.frecuencia]}${r.categoria?' · '+escapeHtml(r.categoria):''} · próxima: ${proxima.toLocaleDateString('es-CO')} ${proxima.toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'})}</div>
        </div>
        <button class="auto-del" data-id="${r.id}">✕</button>`;
      row.querySelector('.auto-del').onclick = ()=>{
        pendingAutomaticos = pendingAutomaticos.filter(x=>x.id!==r.id);
        renderAutomaticosList();
      };
      box.appendChild(row);
    });
  }

  document.getElementById('btnAddAutomatico').onclick = ()=>{
    autoTipoSel = 'Ingreso';
    document.getElementById('autoTipoIngreso').classList.add('sel','in');
    document.getElementById('autoTipoEgreso').classList.remove('sel','out');
    document.getElementById('inAutoMonto').value = '';
    document.getElementById('inAutoDesc').value = '';
    document.getElementById('inAutoFecha').value = '';
    document.getElementById('selAutoFrecuencia').value = 'mensual';
    poblarCategorias('inAutoCategoria', autoTipoSel);
    toggleOverlay('overlayAutomatico', true);
  };
  document.getElementById('cancelAutomatico').onclick = ()=>toggleOverlay('overlayAutomatico', false);
  document.getElementById('autoTipoIngreso').onclick = ()=>{
    autoTipoSel='Ingreso';
    document.getElementById('autoTipoIngreso').classList.add('sel','in');
    document.getElementById('autoTipoEgreso').classList.remove('sel','out');
    poblarCategorias('inAutoCategoria', autoTipoSel);
  };
  document.getElementById('autoTipoEgreso').onclick = ()=>{
    autoTipoSel='Egreso';
    document.getElementById('autoTipoEgreso').classList.add('sel','out');
    document.getElementById('autoTipoIngreso').classList.remove('sel','in');
    poblarCategorias('inAutoCategoria', autoTipoSel);
  };
  document.getElementById('saveAutomatico').onclick = ()=>{
    const monto = currencyValue(document.getElementById('inAutoMonto'));
    const categoria = document.getElementById('inAutoCategoria').value;
    const descripcion = document.getElementById('inAutoDesc').value.trim();
    const fechaVal = document.getElementById('inAutoFecha').value;
    const frecuencia = document.getElementById('selAutoFrecuencia').value;
    if(!monto || monto<=0){ showToast('Escribe un monto válido'); return; }
    if(!fechaVal){ showToast('Elige la fecha y hora del primer movimiento'); return; }
    const inicio = new Date(fechaVal).toISOString();
    pendingAutomaticos.push({
      id: uid(), tipo: autoTipoSel, monto, descripcion, categoria, frecuencia,
      inicio, proxima: inicio, activo: true
    });
    renderAutomaticosList();
    toggleOverlay('overlayAutomatico', false);
    showToast('Programación agregada');
  };

  function openNewCuenta(){
    editingCuentaId = null;
    document.getElementById('cuentaTitulo').textContent = 'Agregar cuenta';
    document.getElementById('fieldSaldoInicial').style.display = 'block';
    document.getElementById('deleteRow').style.display = 'none';
    resetCuentaForm();
    toggleOverlay('overlayCuenta', true);
  }
  function openEditCuenta(id){
    const c = data.cuentas.find(c=>c.id===id);
    if(!c) return;
    editingCuentaId = id;
    document.getElementById('cuentaTitulo').textContent = 'Editar cuenta';
    document.getElementById('fieldSaldoInicial').style.display = 'none';
    document.getElementById('deleteRow').style.display = 'flex';
    document.getElementById('inCuentaNombre').value = c.nombre;
    selectedEmoji = c.emoji || ''; selectedColor = c.color || '';
    setSwitch('swIncluir', c.incluirTotal);
    setSwitch('swRendimiento', !!c.rendimiento);
    document.getElementById('fieldEA').style.display = c.rendimiento ? 'block' : 'none';
    document.getElementById('inEA').value = c.rendimiento ? c.rendimiento.ea : '';
    pendingAutomaticos = JSON.parse(JSON.stringify(c.automaticos || []));
    const hayAuto = pendingAutomaticos.length > 0;
    setSwitch('swProgramar', hayAuto);
    document.getElementById('automaticosSection').style.display = hayAuto ? 'block' : 'none';
    renderAutomaticosList();
    buildPickers();
    toggleOverlay('overlayCuenta', true);
  }
  document.getElementById('cancelCuenta').onclick = ()=>toggleOverlay('overlayCuenta', false);

  document.getElementById('saveCuenta').onclick = ()=>{
    const nombre = document.getElementById('inCuentaNombre').value.trim();
    if(!nombre){ showToast('Escribe un nombre de cuenta'); return; }
    const incluirTotal = isOn('swIncluir');
    const tieneRend = isOn('swRendimiento');
    let ea = parseFloat(document.getElementById('inEA').value || '0');
    if(tieneRend){
      if(!isFinite(ea) || ea < 0 || ea > 100){
        showToast('La tasa E.A. debe estar entre 0% y 100%');
        return;
      }
    } else {
      ea = 0;
    }

    if(editingCuentaId){
      const c = data.cuentas.find(c=>c.id===editingCuentaId);
      if(data.cuentas.some(o=>o.id!==editingCuentaId && o.nombre.toLowerCase()===nombre.toLowerCase())){ showToast('Ya existe otra cuenta con ese nombre'); return; }
      const oldNombre = c.nombre;
      c.nombre = nombre;
      c.incluirTotal = incluirTotal;
      c.emoji = selectedEmoji; c.color = selectedColor;
      c.rendimiento = tieneRend ? {ea: ea} : null;
      c.automaticos = pendingAutomaticos;
      if(oldNombre !== nombre){ data.movimientos.forEach(m=>{ if(m.cuenta===oldNombre) m.cuenta = nombre; }); }
    } else {
      if(data.cuentas.some(c=>c.nombre.toLowerCase()===nombre.toLowerCase())){ showToast('Esa cuenta ya existe'); return; }
      const saldo = currencyValue(document.getElementById('inCuentaSaldo'));
      data.cuentas.push({
        id: uid(), nombre, saldoBase: saldo, incluirTotal,
        emoji: selectedEmoji, color: selectedColor, oculto: false,
        rendimiento: tieneRend ? {ea: ea} : null,
        automaticos: pendingAutomaticos,
        lastAccrual: new Date().toISOString()
      });
    }
    save();
    toggleOverlay('overlayCuenta', false);
    render();
    syncSaldosBackground();
    showToast('Cuenta guardada');
  };

  document.getElementById('deleteCuenta').onclick = ()=>{
    if(!editingCuentaId) return;
    const c = data.cuentas.find(c=>c.id===editingCuentaId);
    if(!c) return;
    data.cuentas = data.cuentas.filter(c=>c.id!==editingCuentaId);
    data.movimientos = data.movimientos.filter(m=>m.cuenta!==c.nombre);
    save();
    toggleOverlay('overlayCuenta', false);
    render();
    syncSaldosBackground();
    showToast('Cuenta eliminada');
  };

  // ---------- Tarjetas de crédito: crear / editar ----------
  function openNewTarjeta(){
    editingTarjetaId = null;
    document.getElementById('tarjetaTitulo').textContent = 'Agregar tarjeta';
    document.getElementById('fieldCupoInicial').style.display = 'block';
    document.getElementById('deleteRowTC').style.display = 'none';
    document.getElementById('inTarjetaNombre').value = '';
    document.getElementById('inTarjetaCupo').value = '';
    selectedEmoji = ''; selectedColor = '';
    setSwitch('swIncluirTC', true);
    buildPickers();
    toggleOverlay('overlayTarjeta', true);
  }
  function openEditTarjeta(id){
    const t = data.tarjetas.find(t=>t.id===id);
    if(!t) return;
    editingTarjetaId = id;
    document.getElementById('tarjetaTitulo').textContent = 'Editar tarjeta';
    document.getElementById('fieldCupoInicial').style.display = 'none';
    document.getElementById('deleteRowTC').style.display = 'flex';
    document.getElementById('inTarjetaNombre').value = t.nombre;
    selectedEmoji = t.emoji || ''; selectedColor = t.color || '';
    setSwitch('swIncluirTC', t.incluirTotal);
    buildPickers();
    toggleOverlay('overlayTarjeta', true);
  }
  document.getElementById('cancelTarjeta').onclick = ()=>toggleOverlay('overlayTarjeta', false);
  document.getElementById('swIncluirTC').onclick = ()=>setSwitch('swIncluirTC', !isOn('swIncluirTC'));

  document.getElementById('saveTarjeta').onclick = ()=>{
    const nombre = document.getElementById('inTarjetaNombre').value.trim();
    if(!nombre){ showToast('Escribe un nombre de tarjeta'); return; }
    const incluirTotal = isOn('swIncluirTC');

    if(editingTarjetaId){
      const t = data.tarjetas.find(t=>t.id===editingTarjetaId);
      if(data.tarjetas.some(o=>o.id!==editingTarjetaId && o.nombre.toLowerCase()===nombre.toLowerCase())){ showToast('Ya existe otra tarjeta con ese nombre'); return; }
      const oldNombre = t.nombre;
      t.nombre = nombre;
      t.incluirTotal = incluirTotal;
      t.emoji = selectedEmoji; t.color = selectedColor;
      if(oldNombre !== nombre){
        data.movimientosTC.forEach(m=>{ if(m.tarjeta===oldNombre) m.tarjeta = nombre; });
        data.planesCuotas.forEach(p=>{ if(p.tarjeta===oldNombre) p.tarjeta = nombre; });
      }
    } else {
      if(data.tarjetas.some(t=>t.nombre.toLowerCase()===nombre.toLowerCase())){ showToast('Esa tarjeta ya existe'); return; }
      const cupoInicial = currencyValue(document.getElementById('inTarjetaCupo'));
      data.tarjetas.push({
        id: uid(), nombre, cupoInicial, incluirTotal,
        emoji: selectedEmoji, color: selectedColor, oculto: false
      });
    }
    save();
    toggleOverlay('overlayTarjeta', false);
    render();
    showToast('Tarjeta guardada');
  };

  document.getElementById('deleteTarjeta').onclick = ()=>{
    if(!editingTarjetaId) return;
    const tActual = data.tarjetas.find(t=>t.id===editingTarjetaId);
    if(!tActual) return;
    const tarjetaNombre = tActual.nombre;
    data.tarjetas = data.tarjetas.filter(t=>t.id!==editingTarjetaId);
    data.movimientosTC = data.movimientosTC.filter(m=>m.tarjeta!==tarjetaNombre);
    data.planesCuotas = data.planesCuotas.filter(p=>p.tarjeta!==tarjetaNombre);
    save();
    toggleOverlay('overlayTarjeta', false);
    render();
    showToast('Tarjeta eliminada');
  };

  // ---------- Movimientos ----------
  document.getElementById('btnAddMov').onclick = ()=>{
    if(!data.cuentas.length){ showToast('Primero agrega una cuenta'); return; }
    poblarCategorias('inMovCategoria', tipoSel);
    toggleOverlay('overlayMov', true);
  };
  document.getElementById('cancelMov').onclick = ()=>toggleOverlay('overlayMov', false);
  document.getElementById('tipoIngreso').onclick = ()=>{
    tipoSel='Ingreso';
    document.getElementById('tipoIngreso').classList.add('sel','in');
    document.getElementById('tipoEgreso').classList.remove('sel','out');
    poblarCategorias('inMovCategoria', tipoSel);
  };
  document.getElementById('tipoEgreso').onclick = ()=>{
    tipoSel='Egreso';
    document.getElementById('tipoEgreso').classList.add('sel','out');
    document.getElementById('tipoIngreso').classList.remove('sel','in');
    poblarCategorias('inMovCategoria', tipoSel);
  };

  function registrarMovimiento(tipo, cuenta, monto, descripcion, groupId, categoria){
    const now = new Date();
    const m = { id: uid(), tipo, cuenta, monto, descripcion: descripcion||'', categoria: categoria||'', groupId: groupId||null, fecha: now.toISOString(), fechaLabel: todayLabel() };
    data.movimientos.push(m);
    save();
    render();
    syncMovimientoBackground(m);
    return m;
  }

  document.getElementById('saveMov').onclick = ()=>{
    const cuenta = document.getElementById('inMovCuenta').value;
    const categoria = document.getElementById('inMovCategoria').value;
    const monto = currencyValue(document.getElementById('inMovMonto'));
    const descripcion = document.getElementById('inMovDesc').value.trim();
    if(!cuenta){ showToast('Selecciona una cuenta'); return; }
    if(!monto || monto<=0){ showToast('Escribe un monto válido'); return; }
    if(tipoSel === 'Egreso' && (saldoCuenta(cuenta) - monto) < 0){
      showToast('No hay saldo suficiente en '+cuenta+' (disponible: '+fmt(saldoCuenta(cuenta))+')');
      return;
    }
    registrarMovimiento(tipoSel, cuenta, monto, descripcion, undefined, categoria);
    document.getElementById('inMovMonto').value=''; document.getElementById('inMovDesc').value='';
    toggleOverlay('overlayMov', false);
    showToast('Movimiento guardado');
  };

  // ---------- Movimientos de tarjetas de crédito ----------
  function registrarMovimientoTC(tipo, tarjeta, monto, descripcion, cuentaRelacionada, groupId){
    const now = new Date();
    const m = { id: uid(), tipo, tarjeta, monto, descripcion: descripcion||'', cuentaRelacionada: cuentaRelacionada||null, groupId: groupId||null, fecha: now.toISOString(), fechaLabel: todayLabel() };
    data.movimientosTC.push(m);
    save();
    render();
    syncMovimientoBackground({ tipo: m.tipo, cuenta: 'TC: '+tarjeta, monto: m.monto,
      descripcion: m.descripcion + (cuentaRelacionada ? ' · Cuenta origen: '+cuentaRelacionada : ''),
      fecha: m.fecha });
    return m;
  }

  function actualizarCuotaPreview(){
    const monto = currencyValue(document.getElementById('inMovTCMonto'));
    const cuotas = parseInt(document.getElementById('inCompraCuotas').value || '0', 10);
    const conInteres = isOn('swCompraInteres');
    const ea = parseFloat(document.getElementById('inCompraEA').value || '0');
    const prev = document.getElementById('cuotaPreview');
    if(!monto || !cuotas || cuotas<1){ prev.textContent = ''; return; }
    const valorCuota = calcularCuotaFija(monto, cuotas, conInteres ? ea : 0);
    prev.textContent = `Cada cuota quedaría en ${fmt(valorCuota)} × ${cuotas} = ${fmt(valorCuota*cuotas)} en total.`;
  }

  document.getElementById('btnAddMovTC').onclick = ()=>{
    if(!data.tarjetas.length){ showToast('Primero agrega una tarjeta'); return; }
    tcTipoSel = 'Compra';
    document.getElementById('tcTipoCompra').classList.add('sel','out');
    document.getElementById('tcTipoPago').classList.remove('sel','in');
    document.getElementById('inMovTCMonto').value = '';
    document.getElementById('inMovTCDesc').value = '';
    document.getElementById('fieldPagoCuenta').style.display = 'none';
    document.getElementById('compraProgramarBlock').style.display = data.cuentas.length ? 'block' : 'none';
    setSwitch('swProgramarCompra', false);
    document.getElementById('programarCompraFields').style.display = 'none';
    setSwitch('swCompraInteres', false);
    document.getElementById('fieldCompraEA').style.display = 'none';
    document.getElementById('inCompraCuotas').value = '';
    document.getElementById('inCompraFecha').value = '';
    document.getElementById('inCompraEA').value = '';
    document.getElementById('cuotaPreview').textContent = '';
    toggleOverlay('overlayMovTC', true);
  };
  document.getElementById('cancelMovTC').onclick = ()=>toggleOverlay('overlayMovTC', false);

  document.getElementById('tcTipoCompra').onclick = ()=>{
    tcTipoSel = 'Compra';
    document.getElementById('tcTipoCompra').classList.add('sel','out');
    document.getElementById('tcTipoPago').classList.remove('sel','in');
    document.getElementById('fieldPagoCuenta').style.display = 'none';
    document.getElementById('compraProgramarBlock').style.display = data.cuentas.length ? 'block' : 'none';
  };
  document.getElementById('tcTipoPago').onclick = ()=>{
    tcTipoSel = 'Pago';
    document.getElementById('tcTipoPago').classList.add('sel','in');
    document.getElementById('tcTipoCompra').classList.remove('sel','out');
    document.getElementById('compraProgramarBlock').style.display = 'none';
    document.getElementById('fieldPagoCuenta').style.display = data.cuentas.length ? 'block' : 'none';
    if(!data.cuentas.length) showToast('Necesitas al menos una cuenta creada para registrar un pago');
  };
  document.getElementById('swProgramarCompra').onclick = ()=>{
    const on = !isOn('swProgramarCompra');
    setSwitch('swProgramarCompra', on);
    document.getElementById('programarCompraFields').style.display = on ? 'block' : 'none';
  };
  document.getElementById('swCompraInteres').onclick = ()=>{
    const on = !isOn('swCompraInteres');
    setSwitch('swCompraInteres', on);
    document.getElementById('fieldCompraEA').style.display = on ? 'block' : 'none';
    actualizarCuotaPreview();
  };
  ['inMovTCMonto','inCompraCuotas','inCompraEA'].forEach(id=>{
    document.getElementById(id).addEventListener('input', actualizarCuotaPreview);
  });

  document.getElementById('saveMovTC').onclick = ()=>{
    const tarjeta = document.getElementById('inMovTCTarjeta').value;
    const monto = currencyValue(document.getElementById('inMovTCMonto'));
    const descripcion = document.getElementById('inMovTCDesc').value.trim();
    if(!tarjeta){ showToast('Selecciona una tarjeta'); return; }
    if(!monto || monto<=0){ showToast('Escribe un monto válido'); return; }

    if(tcTipoSel === 'Pago'){
      const cuentaPago = document.getElementById('inMovTCCuentaPago').value;
      if(!cuentaPago){ showToast('Selecciona desde qué cuenta se paga'); return; }
      if((saldoCuenta(cuentaPago) - monto) < 0){
        showToast('No hay saldo suficiente en '+cuentaPago+' (disponible: '+fmt(saldoCuenta(cuentaPago))+')');
        return;
      }
      const linkId = uid();
      registrarMovimiento('Egreso', cuentaPago, monto, 'Pago tarjeta ' + tarjeta + (descripcion ? ' · '+descripcion : ''), linkId);
      registrarMovimientoTC('Pago', tarjeta, monto, descripcion, cuentaPago, linkId);
      toggleOverlay('overlayMovTC', false);
      showToast('Pago registrado: cupo liberado y descontado de '+cuentaPago);
      return;
    }

    // Compra
    if((cupoDisponible(tarjeta) - monto) < 0){
      showToast('No hay cupo suficiente en '+tarjeta+' (disponible: '+fmt(cupoDisponible(tarjeta))+')');
      return;
    }
    registrarMovimientoTC('Compra', tarjeta, monto, descripcion, null);

    if(isOn('swProgramarCompra')){
      const cuotas = parseInt(document.getElementById('inCompraCuotas').value || '0', 10);
      const fechaVal = document.getElementById('inCompraFecha').value;
      const cuentaCuotas = document.getElementById('inCompraCuenta').value;
      const conInteres = isOn('swCompraInteres');
      const ea = parseFloat(document.getElementById('inCompraEA').value || '0');
      if(!cuotas || !isFinite(cuotas) || cuotas<1 || cuotas>120){ showToast('Compra guardada, pero el número de cuotas debe estar entre 1 y 120'); toggleOverlay('overlayMovTC', false); return; }
      if(conInteres && (!isFinite(ea) || ea<0 || ea>200)){ showToast('Compra guardada, pero la tasa E.A. no es válida (debe estar entre 0% y 200%)'); toggleOverlay('overlayMovTC', false); return; }
      if(!fechaVal){ showToast('Compra guardada, pero falta la fecha del primer pago para programarlo'); toggleOverlay('overlayMovTC', false); return; }
      if(!cuentaCuotas){ showToast('Compra guardada, pero falta la cuenta que pagará las cuotas'); toggleOverlay('overlayMovTC', false); return; }
      const montoCuota = calcularCuotaFija(monto, cuotas, conInteres ? ea : 0);
      const inicio = new Date(fechaVal).toISOString();
      data.planesCuotas.push({
        id: uid(), tarjeta, cuenta: cuentaCuotas, cuotasTotal: cuotas, cuotasPagadas: 0,
        montoCuota, descripcion, interesEA: conInteres ? ea : 0,
        inicio, proxima: inicio, activo: true
      });
      save();
      showToast('Compra guardada y pago automático programado a '+cuotas+' cuotas');
    } else {
      showToast('Compra registrada');
    }
    toggleOverlay('overlayMovTC', false);
  };

  // ---------- Google Sheets ----------
  function getTokenClient(){
    if(!HARDCODED_CLIENT_ID || HARDCODED_CLIENT_ID.indexOf('PEGA_AQUI') === 0 || typeof google === 'undefined') return null;
    if(!tokenClient){
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: HARDCODED_CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/drive.file',
        callback: ()=>{}
      });
    }
    return tokenClient;
  }

  function getToken(interactive){
    return new Promise((resolve,reject)=>{
      const cached = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null');
      if(cached && cached.expires_at > Date.now()+60000){ resolve(cached.access_token); return; }
      const tc = getTokenClient();
      if(!tc){ reject('no-client-id'); return; }
      tc.callback = (resp)=>{
        if(resp.error){ reject(resp.error); return; }
        const expires_at = Date.now() + (resp.expires_in*1000);
        localStorage.setItem(TOKEN_KEY, JSON.stringify({access_token: resp.access_token, expires_at}));
        resolve(resp.access_token);
      };
      tc.requestAccessToken({ prompt: interactive ? 'consent' : '' });
    });
  }

  function colLetter(idx0){
    let n = idx0 + 1, s = '';
    while(n>0){ const m=(n-1)%26; s = String.fromCharCode(65+m)+s; n=Math.floor((n-1)/26); }
    return s;
  }

  // ---------- Formato visual de la hoja (paleta de CashMap) ----------
  const XL_NAVY = {red:0.0824, green:0.1333, blue:0.2196};   // --ink
  const XL_MINT = {red:0.0824, green:0.6039, blue:0.5020};   // --mint-deep
  const XL_MINT_SOFT = {red:0.851, green:0.961, blue:0.925}; // --up-soft / --mint-soft
  const XL_WHITE = {red:1, green:1, blue:1};
  const XL_LINE = {red:0.878, green:0.898, blue:0.941}; // gris azulado suave, igual al --line de la app

  async function sheetsBatchUpdate(token, sheetId, requests){
    if(!requests.length) return;
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
      method:'POST', headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},
      body: JSON.stringify({requests})
    });
    if(!res.ok){
      const j = await res.json().catch(()=>({}));
      throw new Error((j.error && j.error.message) ? j.error.message : ('HTTP '+res.status));
    }
  }

  function xlHeaderRequest(gridId, endColumnIndex){
    return { repeatCell: {
      range: {sheetId:gridId, startRowIndex:0, endRowIndex:1, startColumnIndex:0, endColumnIndex},
      cell: { userEnteredFormat: {
        backgroundColor: XL_NAVY,
        textFormat: {foregroundColor: XL_WHITE, bold:true, fontSize:11, fontFamily:'Roboto'},
        horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE',
        borders: { bottom: { style:'SOLID_THICK', color: XL_MINT } }
      }},
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,borders)'
    }};
  }
  function xlBodyFontRequest(gridId, endColumnIndex){
    return { repeatCell: {
      range: {sheetId:gridId, startRowIndex:1, startColumnIndex:0, endColumnIndex},
      cell: { userEnteredFormat: { textFormat: {fontFamily:'Roboto', fontSize:10}, verticalAlignment:'MIDDLE' } },
      fields: 'userEnteredFormat(textFormat,verticalAlignment)'
    }};
  }
  function xlCurrencyRequest(gridId, startColumnIndex, endColumnIndex){
    return { repeatCell: {
      range: {sheetId:gridId, startRowIndex:1, startColumnIndex, endColumnIndex},
      cell: { userEnteredFormat: { numberFormat: {type:'CURRENCY', pattern:'$#,##0'}, horizontalAlignment:'RIGHT' } },
      fields: 'userEnteredFormat.numberFormat,userEnteredFormat.horizontalAlignment'
    }};
  }
  function xlDateRequest(gridId, columnIndex){
    return { repeatCell: {
      range: {sheetId:gridId, startRowIndex:1, startColumnIndex:columnIndex, endColumnIndex:columnIndex+1},
      cell: { userEnteredFormat: { numberFormat: {type:'DATE_TIME', pattern:'dd/mm/yyyy hh:mm'}, horizontalAlignment:'CENTER' } },
      fields: 'userEnteredFormat.numberFormat,userEnteredFormat.horizontalAlignment'
    }};
  }
  function xlColWidth(gridId, startIndex, endIndex, pixelSize){
    return { updateDimensionProperties: {
      range: {sheetId:gridId, dimension:'COLUMNS', startIndex, endIndex},
      properties: {pixelSize}, fields: 'pixelSize'
    }};
  }
  function xlRowHeight(gridId, startIndex, endIndex, pixelSize){
    return { updateDimensionProperties: {
      range: {sheetId:gridId, dimension:'ROWS', startIndex, endIndex},
      properties: {pixelSize}, fields: 'pixelSize'
    }};
  }

  async function aplicarFormatoHoja(token, spreadsheetId, gridMov, gridSaldos){
    const requests = [
      // Idioma/formato regional: evita ambigüedad en fechas (DD/MM vs MM/DD) sin importar la cuenta de Google usada.
      { updateSpreadsheetProperties: { properties: { locale:'es_CO' }, fields:'locale' } },

      { updateSheetProperties: { properties: { sheetId: gridMov, gridProperties:{frozenRowCount:1}, tabColor: XL_MINT }, fields: 'gridProperties.frozenRowCount,tabColor' } },
      { updateSheetProperties: { properties: { sheetId: gridSaldos, gridProperties:{frozenRowCount:1, frozenColumnCount:1}, tabColor: XL_NAVY }, fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount,tabColor' } },

      xlHeaderRequest(gridMov, 6),
      xlHeaderRequest(gridSaldos, 12),
      xlBodyFontRequest(gridMov, 6),
      xlBodyFontRequest(gridSaldos, 12),

      xlRowHeight(gridMov, 0, 1, 30),
      xlRowHeight(gridSaldos, 0, 1, 30),
      xlRowHeight(gridMov, 1, 2000, 24),
      xlRowHeight(gridSaldos, 1, 2000, 24),

      { addBanding: { bandedRange: { range:{sheetId:gridMov, startRowIndex:1, startColumnIndex:0, endColumnIndex:6},
          rowProperties: { firstBandColor:XL_WHITE, secondBandColor:XL_MINT_SOFT } } } },
      { addBanding: { bandedRange: { range:{sheetId:gridSaldos, startRowIndex:1, startColumnIndex:0, endColumnIndex:12},
          rowProperties: { firstBandColor:XL_WHITE, secondBandColor:XL_MINT_SOFT } } } },

      xlCurrencyRequest(gridMov, 2, 3),
      xlCurrencyRequest(gridSaldos, 1, 12),
      xlDateRequest(gridMov, 0),
      xlDateRequest(gridSaldos, 0),

      // Bordes finos en toda la zona de datos, para un acabado de tabla más prolijo.
      { updateBorders: {
          range: {sheetId:gridMov, startRowIndex:0, endRowIndex:1000, startColumnIndex:0, endColumnIndex:6},
          top:{style:'SOLID', color:XL_LINE}, bottom:{style:'SOLID', color:XL_LINE},
          left:{style:'SOLID', color:XL_LINE}, right:{style:'SOLID', color:XL_LINE},
          innerHorizontal:{style:'SOLID', color:XL_LINE}, innerVertical:{style:'SOLID', color:XL_LINE}
      }},
      { updateBorders: {
          range: {sheetId:gridSaldos, startRowIndex:0, endRowIndex:1000, startColumnIndex:0, endColumnIndex:12},
          top:{style:'SOLID', color:XL_LINE}, bottom:{style:'SOLID', color:XL_LINE},
          left:{style:'SOLID', color:XL_LINE}, right:{style:'SOLID', color:XL_LINE},
          innerHorizontal:{style:'SOLID', color:XL_LINE}, innerVertical:{style:'SOLID', color:XL_LINE}
      }},

      // Columna "Total disponible" resaltada: es el dato más importante de la hoja Saldos.
      { repeatCell: {
          range: {sheetId:gridSaldos, startRowIndex:1, startColumnIndex:1, endColumnIndex:2},
          cell: { userEnteredFormat: { textFormat:{bold:true, fontFamily:'Roboto', fontSize:10.5}, backgroundColor: XL_MINT_SOFT } },
          fields: 'userEnteredFormat(textFormat,backgroundColor)'
      }},
      // Descripción con ajuste de texto para que no se vea cortada.
      { repeatCell: {
          range: {sheetId:gridMov, startRowIndex:1, startColumnIndex:4, endColumnIndex:5},
          cell: { userEnteredFormat: { wrapStrategy:'WRAP' } },
          fields: 'userEnteredFormat.wrapStrategy'
      }},

      xlColWidth(gridMov, 0, 1, 140),
      xlColWidth(gridMov, 1, 2, 90),
      xlColWidth(gridMov, 2, 3, 120),
      xlColWidth(gridMov, 3, 4, 160),
      xlColWidth(gridMov, 4, 5, 260),
      xlColWidth(gridMov, 5, 6, 170),
      xlColWidth(gridSaldos, 0, 1, 140),
      xlColWidth(gridSaldos, 1, 2, 140),

      { addConditionalFormatRule: { index:0, rule: {
          ranges:[{sheetId:gridMov, startRowIndex:1, startColumnIndex:0, endColumnIndex:6}],
          booleanRule: {
            condition: { type:'CUSTOM_FORMULA', values:[{userEnteredValue:'=OR($B2="Egreso",$B2="Compra")'}] },
            format: { backgroundColor: {red:0.984,green:0.902,blue:0.894} }
          }
        }}},
      { addConditionalFormatRule: { index:0, rule: {
          ranges:[{sheetId:gridMov, startRowIndex:1, startColumnIndex:0, endColumnIndex:6}],
          booleanRule: {
            condition: { type:'CUSTOM_FORMULA', values:[{userEnteredValue:'=OR($B2="Ingreso",$B2="Pago")'}] },
            format: { backgroundColor: XL_MINT_SOFT }
          }
        }}}
    ];
    await sheetsBatchUpdate(token, spreadsheetId, requests);
  }

  async function obtenerGridIds(token, spreadsheetId){
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`, {
      headers:{'Authorization':'Bearer '+token}
    });
    const j = await res.json();
    if(!res.ok) throw new Error((j.error && j.error.message) ? j.error.message : ('HTTP '+res.status));
    const mov = j.sheets.find(s=>s.properties.title==='Movimientos');
    const sal = j.sheets.find(s=>s.properties.title==='Saldos');
    if(!mov || !sal) throw new Error('No se encontraron las hojas Movimientos/Saldos');
    return { gridMov: mov.properties.sheetId, gridSaldos: sal.properties.sheetId };
  }

  const ESTILO_HOJA_VERSION = 4;

  async function ensureSheet(token){
    if(settings.sheetId){
      if(settings.estiloVersion !== ESTILO_HOJA_VERSION){
        try{
          const ids = (settings.gridMov!==undefined && settings.gridSaldos!==undefined)
            ? { gridMov: settings.gridMov, gridSaldos: settings.gridSaldos }
            : await obtenerGridIds(token, settings.sheetId);
          settings.gridMov = ids.gridMov;
          settings.gridSaldos = ids.gridSaldos;
          // Asegura el encabezado "Categoría" en hojas creadas antes de esta función.
          await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${settings.sheetId}/values/Movimientos!A1:F1?valueInputOption=RAW`, {
            method:'PUT', headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},
            body: JSON.stringify({values:[['Fecha','Tipo','Cantidad','Cuenta','Descripción','Categoría']]})
          });
          await aplicarFormatoHoja(token, settings.sheetId, ids.gridMov, ids.gridSaldos);
          settings.estiloVersion = ESTILO_HOJA_VERSION;
          saveSettingsLS();
        }catch(e){ /* el formato es cosmético, si falla no debe romper la sincronización */ }
      }
      return settings.sheetId;
    }
    const res = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
      method:'POST',
      headers:{'Authorization':'Bearer '+token, 'Content-Type':'application/json'},
      body: JSON.stringify({
        properties: {title:'Reckly'},
        sheets: [{properties:{title:'Movimientos'}}, {properties:{title:'Saldos'}}]
      })
    });
    const j = await res.json();
    if(!res.ok || !j.spreadsheetId){
      const msg = (j.error && j.error.message) ? j.error.message : ('HTTP '+res.status);
      throw new Error(msg);
    }
    settings.sheetId = j.spreadsheetId;
    settings.columnMap = {};
    settings.gridMov = j.sheets[0].properties.sheetId;
    settings.gridSaldos = j.sheets[1].properties.sheetId;
    saveSettingsLS();
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${settings.sheetId}/values/Movimientos!A1:F1?valueInputOption=RAW`, {
      method:'PUT', headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},
      body: JSON.stringify({values:[['Fecha','Tipo','Cantidad','Cuenta','Descripción','Categoría']]})
    });
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${settings.sheetId}/values/Saldos!A1:B1?valueInputOption=RAW`, {
      method:'PUT', headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},
      body: JSON.stringify({values:[['Fecha','Total disponible']]})
    });
    try{
      await aplicarFormatoHoja(token, settings.sheetId, settings.gridMov, settings.gridSaldos);
      settings.estiloVersion = ESTILO_HOJA_VERSION;
      saveSettingsLS();
    }
    catch(e){ /* el formato es cosmético, si falla no debe romper la creación de la hoja */ }
    return settings.sheetId;
  }

  async function ensureColumnsForAccounts(token, sheetId){
    let changed = false;
    data.cuentas.forEach(c=>{
      if(!(c.nombre in settings.columnMap)){
        const nextIndex = 2 + Object.keys(settings.columnMap).length;
        settings.columnMap[c.nombre] = nextIndex;
        changed = true;
      }
    });
    if(changed){
      saveSettingsLS();
      const maxIndex = 1 + Object.keys(settings.columnMap).length;
      const header = new Array(maxIndex+1).fill('');
      header[0] = 'Fecha'; header[1] = 'Total disponible';
      Object.entries(settings.columnMap).forEach(([nombre, idx])=>{ header[idx] = nombre; });
      const lastLetter = colLetter(maxIndex);
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Saldos!A1:${lastLetter}1?valueInputOption=RAW`, {
        method:'PUT', headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},
        body: JSON.stringify({values:[header]})
      });
      if(settings.gridSaldos!==undefined){
        try{
          await sheetsBatchUpdate(token, sheetId, [
            xlHeaderRequest(settings.gridSaldos, maxIndex+1),
            xlBodyFontRequest(settings.gridSaldos, maxIndex+1),
            xlCurrencyRequest(settings.gridSaldos, 1, maxIndex+1),
            xlColWidth(settings.gridSaldos, maxIndex, maxIndex+1, 130)
          ]);
        }catch(e){ /* cosmético, no bloquea */ }
      }
    }
  }

  // Fecha+hora en formato DD/MM/AAAA HH:mm (24h), sin AM/PM para que Sheets la reconozca
  // siempre como fecha real, sin depender de la configuración regional del dispositivo.
  function fechaHoraSheets(d){
    const pad = n => String(n).padStart(2,'0');
    return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  async function appendSaldosRow(token, sheetId){
    await ensureColumnsForAccounts(token, sheetId);
    const maxIndex = Object.keys(settings.columnMap).length ? (1 + Object.keys(settings.columnMap).length) : 1;
    const row = new Array(maxIndex+1).fill('');
    const now = new Date();
    row[0] = fechaHoraSheets(now);
    const total = data.cuentas.filter(c=>c.incluirTotal).reduce((a,c)=>a+saldoCuenta(c.nombre),0);
    row[1] = Math.round(total);
    Object.entries(settings.columnMap).forEach(([nombre, idx])=>{
      const cuenta = data.cuentas.find(c=>c.nombre===nombre);
      row[idx] = cuenta ? Math.round(saldoCuenta(nombre)) : '';
    });
    const lastLetter = colLetter(maxIndex);
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Saldos!A:${lastLetter}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
      method:'POST', headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},
      body: JSON.stringify({values:[row]})
    });
  }

  // Cola de sincronización: evita ráfagas de peticiones simultáneas a la API de
  // Google (por ejemplo si se acumularon muchos movimientos automáticos pendientes
  // tras varios días sin abrir la app). Procesa una a la vez, con una pequeña
  // pausa entre cada una, en vez de disparar todas en paralelo.
  let syncQueue = Promise.resolve();
  function queueSync(taskFn){
    syncQueue = syncQueue.then(taskFn).catch(()=>{}).then(()=> new Promise(r=>setTimeout(r,150)));
    return syncQueue;
  }

  async function syncMovimientoBackground(m){
    try{
      const token = await getToken(false);
      const sheetId = await ensureSheet(token);
      const fecha = fechaHoraSheets(new Date(m.fecha));
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Movimientos!A:F:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
        method:'POST', headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},
        body: JSON.stringify({values:[[fecha, m.tipo, m.monto, sheetSafe(m.cuenta), sheetSafe(m.descripcion||''), sheetSafe(m.categoria||'')]]})
      });
      await appendSaldosRow(token, sheetId);
      lastError = null;
      render();
    }catch(e){
      lastError = (e && e.message) ? e.message : (typeof e==='string' ? e : JSON.stringify(e));
      logSecurityEvent('sync_call_failed', 'Movimientos.append: '+lastError);
      render();
    }
  }

  async function syncSaldosBackground(){
    try{
      const token = await getToken(false);
      const sheetId = await ensureSheet(token);
      await appendSaldosRow(token, sheetId);
      lastError = null;
      render();
    }catch(e){
      lastError = (e && e.message) ? e.message : (typeof e==='string' ? e : JSON.stringify(e));
      logSecurityEvent('sync_call_failed', 'Saldos.append: '+lastError);
      render();
    }
  }

  document.getElementById('btnConnect').onclick = async ()=>{
    if(!HARDCODED_CLIENT_ID || HARDCODED_CLIENT_ID.indexOf('PEGA_AQUI') === 0){
      showToast('Falta configurar el Client ID de Google en el código de la app');
      return;
    }
    try{
      showToast('Conectando con Google...');
      const token = await getToken(true);
      const sheetId = await ensureSheet(token);
      await appendSaldosRow(token, sheetId);
      lastError = null;
      render();
      logSecurityEvent('login_success', 'Conexión con Google Drive establecida');
      showToast('Conectado y sincronizado ✅');
    }catch(e){
      const detalle = (e && e.message) ? e.message : (typeof e==='string' ? e : JSON.stringify(e));
      logSecurityEvent('login_failure', detalle);
      showError(detalle, 'No se pudo conectar con Google');
      render();
    }
  };

  // ---------- Quick add por URL (Atajos) ----------
  function processQuickAdd(){
    const p = new URLSearchParams(window.location.search);
    if(!p.has('quickadd')) return;
    const tipo = p.get('tipo') === 'Egreso' ? 'Egreso' : 'Ingreso';
    const cuenta = (p.get('cuenta') || '').slice(0, 60);
    const monto = parseFloat(p.get('monto') || '0');
    const desc = (p.get('desc') || '').slice(0, 200);
    history.replaceState({}, '', window.location.pathname);
    if(!cuenta || !monto || !isFinite(monto) || monto<=0 || monto>1e12 || !data.cuentas.some(c=>c.nombre===cuenta)){
      logSecurityEvent('quickadd_rejected', 'Parámetros inválidos o cuenta inexistente en URL de Atajo');
      showToast('No se pudo registrar: revisa cuenta/monto del Atajo');
      return;
    }
    registrarMovimiento(tipo, cuenta, monto, desc);
    logSecurityEvent('quickadd_success', 'Movimiento registrado vía Atajo');
    showToast('Movimiento agregado desde el Atajo ✅');
  }

  // ---------- Pager: Cuentas / Tarjetas ----------
  const PAGE_LABELS = ['Gráficas', 'Cuentas', 'Tarjetas de crédito', 'Gráficas de tarjetas'];

  function pageCount(){ return settings.tcActivado ? 4 : 2; }

  function updatePagerVisibility(){
    document.getElementById('pageTarjetas').style.display = settings.tcActivado ? '' : 'none';
    document.getElementById('pageGraficasTC').style.display = settings.tcActivado ? '' : 'none';
    document.getElementById('btnActivarTC').style.display = settings.tcActivado ? 'none' : 'block';
    document.getElementById('tcDot').style.display = settings.tcActivado ? 'block' : 'none';
    const dots = document.querySelectorAll('.ind-dot');
    dots.forEach((d,i)=>{ d.style.display = i < pageCount() ? 'inline-block' : 'none'; });
    if(!settings.tcActivado && currentPageIndex >= 2){
      goToPage(1);
    }
  }

  function goToPage(idx){
    const vp = document.getElementById('pagerViewport');
    vp.scrollTo({left: idx * vp.clientWidth, behavior:'smooth'});
  }
  function setActivePage(idx){
    currentPageIndex = idx;
    document.querySelectorAll('.ind-dot').forEach(d=> d.classList.toggle('active', parseInt(d.dataset.i,10)===idx));
    document.getElementById('pageLabel').textContent = PAGE_LABELS[idx] || '';
    document.getElementById('btnAddMov').style.display = idx===1 ? 'flex' : 'none';
    document.getElementById('btnAddMovTC').style.display = idx===2 ? 'flex' : 'none';
    if(idx===0 && chartsStale) renderGraficas();
    if(idx===3 && chartsTCStale) renderGraficasTC();
  }
  (function(){
    const vp = document.getElementById('pagerViewport');
    let scrollTimeout;
    vp.addEventListener('scroll', ()=>{
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(()=>{
        const idx = Math.round(vp.scrollLeft / vp.clientWidth);
        setActivePage(idx);
      }, 80);
    });
  })();

  document.getElementById('btnActivarTC').onclick = ()=>{
    settings.tcActivado = true;
    saveSettingsLS();
    updatePagerVisibility();
    showToast('Tarjetas de crédito activadas · desliza a la izquierda para verlas');
  };
  document.getElementById('swTcActivado').onclick = ()=>{
    if(settings.tcActivado){
      if(data.tarjetas.length>0){
        showToast('Para desactivar, primero elimina todas tus tarjetas creadas');
        return;
      }
      settings.tcActivado = false;
    } else {
      settings.tcActivado = true;
    }
    saveSettingsLS();
    setSwitch('swTcActivado', settings.tcActivado);
    updatePagerVisibility();
  };

  // ---------- Init ----------
  loadAll();
  accrueInterest();
  const huboAutomaticos = processAutomaticos();
  const huboCuotas = processPlanesCuotas();
  buildPickers();
  render();
  updatePagerVisibility();

  // Dibuja las gráficas siempre al abrir, sin depender de en qué página quede el usuario
  // (evita que queden en blanco si el salto inicial de página se desincroniza).
  renderGraficas();
  if(settings.tcActivado) renderGraficasTC();

  const vpInit = document.getElementById('pagerViewport');
  requestAnimationFrame(()=>{
    vpInit.scrollLeft = vpInit.clientWidth; // abre directo en Cuentas (página 1), sin animación
    // Verifica dónde quedó realmente el scroll en vez de asumirlo, para que el indicador
    // y el FAB nunca queden desincronizados con lo que se ve en pantalla.
    requestAnimationFrame(()=>{
      const idxReal = vpInit.clientWidth ? Math.round(vpInit.scrollLeft / vpInit.clientWidth) : 1;
      setActivePage(idxReal);
    });
  });

  if(huboAutomaticos || huboCuotas) showToast('Se registraron movimientos programados automáticos');
  processQuickAdd();
})();
