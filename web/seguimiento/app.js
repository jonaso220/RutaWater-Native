// Seguimiento del camión para clientes. Lee seguimiento/<token> de Realtime
// Database por streaming REST (EventSource), sin SDK ni cuenta: las reglas
// dejan leer solo con el token del link y hasta que vence.
(function () {
  'use strict';

  var LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  // Instancia por defecto del proyecto rutawater; en local, el emulador.
  var DB = LOCAL ? 'http://' + location.hostname + ':9000' : 'https://rutawater-default-rtdb.firebaseio.com';
  var NS = LOCAL ? '?ns=rutawater-default-rtdb' : '';

  var STALE_MS = 3 * 60 * 1000;
  var TOKEN_RE = /^[A-Za-z0-9_-]{22,64}$/;
  var URUGUAY = [-32.8, -56.0];

  var $ = function (id) { return document.getElementById(id); };

  var pathToken = (location.pathname.match(/\/s\/([^/?#]+)/) || [])[1];
  var token = decodeURIComponent(pathToken || location.hash.slice(1) || '');
  if (!TOKEN_RE.test(token)) token = '';

  var data = null;
  var status = token ? 'loading' : 'invalid';
  var source = null;
  var retryTimer = null;
  var following = true;
  var hasCentered = false;

  // ---- Mapa ----
  var map = L.map('map', { attributionControl: false, zoomControl: true }).setView(URUGUAY, 6);
  L.control.attribution({ position: 'topright', prefix: false })
    .addAttribution('© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>')
    .addTo(map);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

  var trail = L.polyline([], { color: '#2563EB', weight: 5, opacity: 0.5, lineJoin: 'round' }).addTo(map);
  var truck = L.marker(URUGUAY, {
    keyboard: false,
    icon: L.divIcon({
      className: '',
      iconSize: [44, 44],
      iconAnchor: [22, 22],
      html: '<div class="truck"><div class="truck-heading"></div><div class="truck-dot">'
        + '<svg viewBox="0 0 24 24" fill="#FFFFFF" aria-hidden="true"><path d="M3 6h11v9H3zM14 9h4l3 3v3h-7z"/>'
        + '<circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/></svg></div></div>',
    }),
  });

  map.on('dragstart', function () {
    following = false;
    $('recenter').hidden = !hasPosition();
  });
  $('recenter').addEventListener('click', function () {
    following = true;
    $('recenter').hidden = true;
    if (hasPosition()) map.setView([data.lat, data.lng], Math.max(map.getZoom(), 15));
  });

  // El mapa termina donde empieza la ficha de abajo.
  var sheet = document.querySelector('.sheet');
  var syncSheet = function () {
    document.documentElement.style.setProperty('--sheet-h', sheet.offsetHeight + 'px');
    map.invalidateSize();
  };
  if (window.ResizeObserver) new ResizeObserver(syncSheet).observe(sheet);
  syncSheet();

  // ---- Datos ----
  var setAt = function (root, path, value) {
    var parts = path.split('/').filter(Boolean);
    if (!parts.length) return value;
    root = root && typeof root === 'object' ? root : {};
    var node = root;
    for (var i = 0; i < parts.length - 1; i += 1) {
      if (!node[parts[i]] || typeof node[parts[i]] !== 'object') node[parts[i]] = {};
      node = node[parts[i]];
    }
    var last = parts[parts.length - 1];
    if (value === null) delete node[last]; else node[last] = value;
    return root;
  };

  var hasPosition = function () {
    return !!data && data.estado === 'en_camino' && typeof data.lat === 'number' && typeof data.lng === 'number';
  };

  var trailPoints = function () {
    var points = Object.keys((data && data.rastro) || {}).map(function (key) { return data.rastro[key]; })
      .filter(function (point) { return point && typeof point.lat === 'number' && typeof point.lng === 'number'; })
      .sort(function (a, b) { return (a.t || 0) - (b.t || 0); })
      .map(function (point) { return [point.lat, point.lng]; });
    if (hasPosition()) points.push([data.lat, data.lng]);
    return points;
  };

  var agoText = function (ms) {
    var minutes = Math.floor(ms / 60000);
    if (minutes < 1) return 'hace unos segundos';
    if (minutes === 1) return 'hace 1 minuto';
    if (minutes < 60) return 'hace ' + minutes + ' minutos';
    return 'hace más de una hora';
  };

  // ---- Pantalla ----
  var show = function (headline, detail, options) {
    options = options || {};
    $('headline').textContent = headline;
    $('detail').textContent = detail || '';
    $('detail').classList.toggle('warn', !!options.warn);
    $('updated').textContent = options.updated || '';
    document.body.classList.toggle('no-map', !options.map);
  };

  var render = function () {
    // Cada link dura lo que fija la app (30 minutos desde «En camino»).
    if (data && typeof data.vence === 'number' && data.vence <= Date.now() && status !== 'inactive') {
      status = 'inactive';
      disconnect();
    }
    $('brand').textContent = (data && data.titulo) || 'RutaWater';

    var live = status === 'ok' && hasPosition();
    if (status === 'invalid') {
      show('El link está incompleto', 'Pedile a tu repartidor que te lo vuelva a mandar.');
    } else if (status === 'loading') {
      show('Buscando el camión…', '');
    } else if (status === 'inactive' || !data) {
      show('Este seguimiento ya terminó', 'El link muestra el camión durante un rato después del aviso.');
    } else if (data.estado === 'terminado') {
      show('El reparto de hoy terminó', '¡Gracias por tu compra!');
    } else if (data.estado === 'preparado') {
      show('El reparto todavía no salió', 'Esta página se actualiza sola cuando el camión arranque.');
    } else if (live) {
      var ago = Math.max(0, Date.now() - (data.actualizado || 0));
      var stale = ago > STALE_MS;
      show(
        '¡Estamos cerca!',
        stale ? 'Sin señal del camión ' + agoText(ago) + '. Te mostramos la última ubicación conocida.' : '',
        { map: true, warn: stale, updated: stale ? '' : 'Ubicación actualizada ' + agoText(ago) },
      );
    } else {
      show('¡Estamos cerca!', 'Esperando la ubicación del camión…');
    }

    trail.setLatLngs(live ? trailPoints() : []);
    if (live) {
      var position = [data.lat, data.lng];
      truck.setLatLng(position);
      if (!map.hasLayer(truck)) truck.addTo(map);
      var element = truck.getElement();
      if (element) {
        var icon = element.querySelector('.truck');
        var stalePosition = Date.now() - (data.actualizado || 0) > STALE_MS;
        icon.classList.toggle('live', !stalePosition);
        icon.classList.toggle('stale', stalePosition);
        var heading = element.querySelector('.truck-heading');
        heading.style.display = typeof data.rumbo === 'number' ? '' : 'none';
        heading.style.transform = 'rotate(' + (data.rumbo || 0) + 'deg)';
      }
      if (!hasCentered) {
        hasCentered = true;
        map.setView(position, 15);
      } else if (following) {
        map.panTo(position, { animate: true });
      }
    } else if (map.hasLayer(truck)) {
      truck.remove();
      $('recenter').hidden = true;
    }
  };

  // ---- Conexión ----
  var url = function () { return DB + '/seguimiento/' + encodeURIComponent(token) + '.json' + NS; };

  var disconnect = function () {
    if (source) source.close();
    source = null;
    clearTimeout(retryTimer);
  };

  var retry = function () {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(connect, 10000);
  };

  var onMessage = function (patch) {
    return function (event) {
      var message = JSON.parse(event.data);
      if (patch) {
        Object.keys(message.data || {}).forEach(function (key) {
          data = setAt(data, message.path + '/' + key, message.data[key]);
        });
      } else {
        data = setAt(data, message.path, message.data);
      }
      status = data ? 'ok' : 'inactive';
      render();
    };
  };

  var revoked = function () {
    disconnect();
    status = 'inactive';
    render();
  };

  // EventSource no informa el código HTTP: si se cerró, preguntamos una vez
  // para distinguir un link vencido (401) de un corte de red.
  var check = function () {
    fetch(url(), { cache: 'no-store' }).then(function (response) {
      if (response.status === 401 || response.status === 403) revoked();
      else retry();
    }, retry);
  };

  function connect() {
    disconnect();
    if (!token || document.hidden || status === 'inactive') return;
    source = new EventSource(url());
    source.addEventListener('put', onMessage(false));
    source.addEventListener('patch', onMessage(true));
    source.addEventListener('cancel', revoked);
    source.addEventListener('auth_revoked', revoked);
    source.onerror = function () {
      if (source && source.readyState === EventSource.CLOSED) {
        disconnect();
        check();
      }
    };
  }

  // Con la pestaña oculta no se descarga nada.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) disconnect(); else connect();
  });

  setInterval(render, 5000);
  render();
  connect();
})();
