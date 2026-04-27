'use strict';
/* =====================================================
   LAYERS — list management, file loading, KML enhance
===================================================== */

const loadedLayers = {};
let layerCounter = 0;

/* ===== RECURSIVE BOUNDS COLLECTOR (robust KML zoom) ===== */
function _collectBounds(layer) {
  const b = L.latLngBounds([]);
  if (layer instanceof L.Marker || layer instanceof L.CircleMarker) {
    b.extend(layer.getLatLng());
  } else if (typeof layer.getLatLngs === 'function') {
    try {
      const lls = layer.getLatLngs();
      const flat = (lls.length && Array.isArray(lls[0])) ? [].concat(...lls) : lls;
      flat.forEach(ll => { if (ll && ll.lat !== undefined) b.extend(ll); });
    } catch(e) {}
  } else if (typeof layer.getBounds === 'function') {
    try { const sb = layer.getBounds(); if (sb && sb.isValid()) b.extend(sb); } catch(e) {}
  }
  if (typeof layer.eachLayer === 'function') {
    layer.eachLayer(sub => { const sb = _collectBounds(sub); if (sb.isValid()) b.extend(sb); });
  }
  return b;
}

function setLayerOpacity(layer, pct) {
  if (!layer) return;
  if (layer._isOL) { layer.setOpacity(pct / 100); return; }
  const o = pct / 100;
  if (typeof layer.setOpacity === 'function') { try { layer.setOpacity(o); } catch(e) {} }
  if (typeof layer.setStyle === 'function') {
    // Only change opacity; fillOpacity is a fixed design value (set on load or by hollow toggle)
    try { layer.setStyle(layer._hollow ? { opacity: o, fillOpacity: 0 } : { opacity: o }); } catch(e) {}
  }
  if (layer._icon) layer._icon.style.opacity = o;
  if (typeof layer.eachLayer === 'function') layer.eachLayer(c => setLayerOpacity(c, pct));
}

function _setLayerHollow(layer, hollow) {
  layer._hollow = hollow;
  if (typeof layer.setStyle === 'function') { try { layer.setStyle({ fillOpacity: hollow ? 0 : 1.0 }); } catch(_) {} }
  if (typeof layer.eachLayer === 'function') layer.eachLayer(c => _setLayerHollow(c, hollow));
}

function setLayerColor(layer, color) {
  if (!layer) return;
  if (layer._isOL) return; // color not applicable to WMS overlay
  if (typeof layer.setStyle === 'function')  { try { layer.setStyle({ color, fillColor: color }); } catch(e) {} }
  if (typeof layer.setIcon === 'function') {
    layer.setIcon(L.divIcon({
      html: `<div style="width:12px;height:12px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5)"></div>`,
      className: '', iconSize: [12,12], iconAnchor: [6,6]
    }));
  }
  if (typeof layer.eachLayer === 'function') layer.eachLayer(c => setLayerColor(c, color));
}

function addLayerToList(layer, name, rawContent, rawMime, opts) {
  opts = opts || {};
  const initOpacity = opts.opacity !== undefined ? opts.opacity : 80;
  const initVisible = opts.visible !== false;
  const initColor   = opts.color || '#4f8ef7';
  const initHollow  = opts.hollow || false;
  if (initHollow) _setLayerHollow(layer, true);

  const id = 'layer_' + (++layerCounter);
  loadedLayers[id] = layer;
  // OL layers go to the OL map; Leaflet layers go to the Leaflet map
  if (layer._isOL) {
    if (window.olMap) olMap.addLayer(layer);
    if (!initVisible) layer.setVisible(false);
  } else {
    layer.addTo(map);
    if (!initVisible) map.removeLayer(layer);
  }

  const empty = document.querySelector('#layer-list .layer-empty');
  if (empty) empty.remove();

  const item = document.createElement('div');
  item.className = 'layer-item';
  item.dataset.id = id;
  if (opts.storeId) item.dataset.storeId = opts.storeId;
  item.setAttribute('draggable', 'true');
  item.innerHTML = `
    <span class="layer-drag" title="Drag to reorder">\u22EE</span>
    <input type="checkbox" ${initVisible ? 'checked' : ''} title="Show/hide">
    <span class="layer-name" title="${name} (double-tap to rename)">${name}</span>
    <input type="color" class="layer-color" value="${initColor}" title="Layer color">
    <button class="layer-hollow${initHollow ? ' active' : ''}" title="Hollow — no fill">\u2205</button>
    <button class="layer-zoom" title="Zoom to layer">\u29C6</button>
    <button class="layer-exp"  title="Export file">\u2B07</button>
    ${opts.isKml ? '<button class="layer-edit" title="Edit KML vertices">\u270F</button>' : ''}
    <button class="layer-del"  title="Remove">\u2715</button>
    <div class="layer-opacity-row">
      <span>\u03B1</span>
      <input type="range" class="layer-opacity" min="0" max="100" value="${initOpacity}" title="Opacity">
      <span class="layer-opacity-val">${initOpacity}%</span>
    </div>`;
  item.querySelector('.layer-color').addEventListener('input', e => {
    setLayerColor(loadedLayers[id], e.target.value);
    if (opts.onColorChange) opts.onColorChange(e.target.value);
  });
  item.querySelector('.layer-hollow').addEventListener('click', () => {
    const l = loadedLayers[id];
    const hollowBtn = item.querySelector('.layer-hollow');
    const nowHollow = !l._hollow;
    _setLayerHollow(l, nowHollow);
    // Restore correct opacity for non-hollow state
    if (!nowHollow) setLayerOpacity(l, parseInt(item.querySelector('.layer-opacity').value));
    hollowBtn.classList.toggle('active', nowHollow);
    if (opts.onHollowChange) opts.onHollowChange(nowHollow);
  });

  item.querySelector('input[type=checkbox]').addEventListener('change', e => {
    const l = loadedLayers[id];
    if (l._isOL) { l.setVisible(e.target.checked); }
    else         { e.target.checked ? map.addLayer(l) : map.removeLayer(l); }
    if (opts.onStateChange) opts.onStateChange({ opacity: parseInt(opacitySlider.value), visible: e.target.checked });
  });
  item.querySelector('.layer-zoom').addEventListener('click', () => {
    const l = loadedLayers[id];
    if (l._isOL) { toastMsg('Zoom not available for WMS overlay', 'warn'); return; }
    try {
      const b = _collectBounds(l);
      if (b && b.isValid()) map.fitBounds(b, { padding: [30,30], animate: true });
      else toastMsg('Bounds not available', 'warn');
    } catch(_) { toastMsg('Cannot calculate extent', 'error'); }
  });
  const opacitySlider = item.querySelector('.layer-opacity');
  const opacityLabel  = item.querySelector('.layer-opacity-val');
  opacitySlider.addEventListener('input', e => {
    const val = parseInt(e.target.value);
    opacityLabel.textContent = val + '%';
    setLayerOpacity(loadedLayers[id], val);
    if (opts.onStateChange) opts.onStateChange({ opacity: val, visible: item.querySelector('input[type=checkbox]').checked });
  });
  item.querySelector('.layer-exp').addEventListener('click', () => {
    if (rawContent && rawMime) {
      const baseName = name.replace(/\.[^.]+$/, '');
      const ext = rawMime.includes('kml') ? '.kml' : rawMime.includes('json') ? '.geojson' : '.gpx';
      showPromptModal('File name (without extension):', baseName, fname => {
        downloadFile(rawContent, (fname || baseName).trim() + ext, rawMime);
      });
    } else { toastMsg('Original content not available', 'error'); }
  });
  item.querySelector('.layer-del').addEventListener('click', () => {
    const l = loadedLayers[id];
    if (l._isOL) { if (window.olMap) olMap.removeLayer(l); }
    else         { map.removeLayer(l); }
    delete loadedLayers[id];
    item.remove();
    if (!Object.keys(loadedLayers).length)
      document.getElementById('layer-list').innerHTML = '<p class="layer-empty">No layers loaded</p>';
    if (opts.onDelete) opts.onDelete();
  });

  // Drag-and-drop reordering
  item.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => item.style.opacity = '0.4', 0);
  });
  item.addEventListener('dragend', () => {
    item.style.opacity = '';
    document.querySelectorAll('.layer-item').forEach(i => i.classList.remove('drag-over'));
  });
  item.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.layer-item').forEach(i => i.classList.remove('drag-over'));
    item.classList.add('drag-over');
  });
  item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
  item.addEventListener('drop', e => {
    e.preventDefault();
    item.classList.remove('drag-over');
    const fromId = e.dataTransfer.getData('text/plain');
    if (fromId === id) return;
    const fromItem = document.querySelector(`[data-id="${fromId}"]`);
    if (!fromItem) return;
    document.getElementById('layer-list').insertBefore(fromItem, item);
    const fl = loadedLayers[fromId];
    if (fl && !fl._isOL) try { if (fl.bringToFront) fl.bringToFront(); } catch(e) {}
    const orderedStoreIds = [...document.querySelectorAll('#layer-list .layer-item')]
      .map(el => el.dataset.storeId).filter(Boolean);
    if (orderedStoreIds.length) _reorderStore(orderedStoreIds);
  });

  // Rename on double-tap/dblclick
  const nameEl = item.querySelector('.layer-name');
  nameEl.addEventListener('dblclick', () => {
    showPromptModal('Rename layer:', nameEl.textContent, newName => {
      if (!newName || !newName.trim()) return;
      const n = newName.trim();
      nameEl.textContent = n; nameEl.title = n + ' (double-tap to rename)';
      if (opts.onRename) opts.onRename(n);
    });
  });

  // KML vertex edit button
  if (opts.isKml) {
    item.querySelector('.layer-edit').addEventListener('click', () => {
      _startKmlEdit(loadedLayers[id], id, opts.storeId || '');
    });
  }

  document.getElementById('layer-list').appendChild(item);
  setLayerOpacity(loadedLayers[id], initOpacity);
  if (opts.color) setLayerColor(loadedLayers[id], opts.color);
  if (!layer._isOL && !opts.noZoom) {
    try {
      const bounds = _collectBounds(layer);
      if (bounds && bounds.isValid()) map.fitBounds(bounds, { padding: [20,20] });
    } catch(e) {}
  }
  if (!opts.silent) toastMsg('Layer loaded: ' + name, 'success');
}

/* ===== KML ENHANCE ===== */
function enhanceKMLLayer(kmlLayer, propsArray, kmlDoc) {
  if (typeof kmlLayer.eachLayer !== 'function') return;
  if (propsArray && propsArray.length) {
    const leaves = _flattenKMLLeafLayers(kmlLayer);
    if (kmlDoc) {
      let leafIdx = 0;
      kmlDoc.querySelectorAll('Placemark').forEach((pm, pmIdx) => {
        const props = propsArray[pmIdx];
        const geomCount = pm.querySelectorAll('Point, LineString, Polygon').length || 1;
        for (let g = 0; g < geomCount && leafIdx < leaves.length; g++, leafIdx++)
          if (props) leaves[leafIdx]._kmlProps = props;
      });
    } else {
      leaves.forEach((l, i) => { if (propsArray[i]) l._kmlProps = propsArray[i]; });
    }
  }
  kmlLayer.eachLayer(sub => enhanceKMLSublayer(sub));
}

function enhanceKMLSublayer(layer) {
  if (typeof layer.eachLayer === 'function' && !(layer instanceof L.Marker)) {
    layer.eachLayer(sub => enhanceKMLSublayer(sub));
    return;
  }
  const isMarker = layer instanceof L.Marker;
  let existingHTML = '';
  if (layer.getPopup && layer.getPopup()) {
    const c = layer.getPopup().getContent();
    existingHTML = typeof c === 'string' ? c : (c && c.outerHTML) ? c.outerHTML : '';
    layer.unbindPopup();
  }

  const div = document.createElement('div');
  div.style.minWidth = '210px';

  const kmlProps = layer._kmlProps;
  if (kmlProps && Object.keys(kmlProps).length) {
    const propsDiv = document.createElement('div');
    propsDiv.style.cssText = 'margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--border)';
    const rows = Object.entries(kmlProps)
      .map(([k,v]) => `<tr><td style="opacity:.65;padding-right:8px;font-size:11px;font-family:monospace;white-space:nowrap">${k}</td><td style="font-size:11px;font-family:monospace">${v ?? ''}</td></tr>`)
      .join('');
    const tbl = document.createElement('table');
    tbl.style.cssText = 'width:100%;margin-bottom:2px';
    tbl.innerHTML = rows;
    propsDiv.appendChild(tbl);
    div.appendChild(propsDiv);
  } else if (existingHTML) {
    const info = document.createElement('div');
    info.innerHTML = existingHTML;
    info.style.cssText = 'margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--border);font-size:12px';
    div.appendChild(info);
  }

  const styleHdr = document.createElement('div');
  styleHdr.style.cssText = 'font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px';
  styleHdr.textContent = 'Style';
  div.appendChild(styleHdr);

  if (isMarker) {
    const pickerDiv = document.createElement('div');
    pickerDiv.className = 'icon-picker';
    let activeBtn = null;
    MARKER_ICONS.forEach(icon => {
      const btn = document.createElement('button');
      btn.className = 'icon-btn'; btn.title = icon.l; btn.innerHTML = icon.html;
      btn.addEventListener('click', ev => {
        ev.stopPropagation();
        if (activeBtn) activeBtn.classList.remove('selected');
        btn.classList.add('selected'); activeBtn = btn;
        layer._geoIcon = icon.e;
        if (typeof layer.setIcon === 'function') layer.setIcon(makeEmojiIcon(icon.e));
        setTimeout(() => layer.openPopup(), 30);
      });
      pickerDiv.appendChild(btn);
    });
    div.appendChild(pickerDiv);
  } else {
    const colorRow = document.createElement('div');
    colorRow.className = 'draw-color-row';
    const lbl = document.createElement('label'); lbl.textContent = 'Color:';
    const colorIn = document.createElement('input'); colorIn.type = 'color'; colorIn.value = '#4f8ef7';
    colorIn.addEventListener('input', () => {
      if (typeof layer.setStyle === 'function') layer.setStyle({ color: colorIn.value, fillColor: colorIn.value, fillOpacity: 0.3 });
    });
    colorRow.appendChild(lbl); colorRow.appendChild(colorIn); div.appendChild(colorRow);

    const wRow = document.createElement('div'); wRow.className = 'draw-color-row';
    const wLbl = document.createElement('label'); wLbl.textContent = 'Weight:';
    const wIn = document.createElement('input');
    wIn.type = 'range'; wIn.min = 1; wIn.max = 8; wIn.value = 2; wIn.style.flex = '1';
    wIn.addEventListener('input', () => {
      if (typeof layer.setStyle === 'function') layer.setStyle({ weight: parseInt(wIn.value) });
    });
    wRow.appendChild(wLbl); wRow.appendChild(wIn); div.appendChild(wRow);
  }

  layer.bindPopup(div, { maxWidth: 280 });
}

/* ===== FILE OVERLAY PERSISTENCE ===== */
const _OVL_KEY = 'navitron_file_overlays';

function _loadOverlayStore() {
  try { return JSON.parse(localStorage.getItem(_OVL_KEY)) || []; } catch(_) { return []; }
}
function _saveOverlayStore(list) {
  try { localStorage.setItem(_OVL_KEY, JSON.stringify(list)); } catch(_) {}
}
function _persistOverlay(storeId, name, content, mime, opacity, visible, color, hollow) {
  const list = _loadOverlayStore().filter(e => e.id !== storeId);
  list.push({ id: storeId, name, content, mime, opacity, visible, color: color || null, hollow: hollow || false });
  _saveOverlayStore(list);
}
function _removeOverlay(storeId) {
  _saveOverlayStore(_loadOverlayStore().filter(e => e.id !== storeId));
}
function _updateOverlay(storeId, updates) {
  const list = _loadOverlayStore();
  const e = list.find(e => e.id === storeId);
  if (e) { Object.assign(e, updates); _saveOverlayStore(list); }
}
function _renameOverlay(storeId, newName) {
  const list = _loadOverlayStore();
  const e = list.find(e => e.id === storeId);
  if (e) { e.name = newName; _saveOverlayStore(list); }
}
function _reorderStore(orderedStoreIds) {
  const list = _loadOverlayStore();
  const byId = {};
  list.forEach(e => { byId[e.id] = e; });
  const reordered = orderedStoreIds.filter(id => byId[id]).map(id => byId[id]);
  list.forEach(e => { if (!orderedStoreIds.includes(e.id)) reordered.push(e); });
  _saveOverlayStore(reordered);
}

function _extractPlacemarkProps(kmlDoc) {
  const result = [];
  kmlDoc.querySelectorAll('Placemark').forEach(pm => {
    const props = {};
    const nmEl   = [...pm.children].find(c => c.tagName.toLowerCase() === 'name');
    const descEl = [...pm.children].find(c => c.tagName.toLowerCase() === 'description');
    if (nmEl   && nmEl.textContent.trim())   props.name        = nmEl.textContent.trim();
    if (descEl && descEl.textContent.trim()) props.description = descEl.textContent.trim();
    const extData = pm.querySelector('ExtendedData');
    if (extData) {
      extData.querySelectorAll('Data').forEach(d => {
        const k = d.getAttribute('name');
        const vEl = d.querySelector('value');
        if (k && vEl) props[k] = vEl.textContent.trim();
      });
    }
    result.push(props);
  });
  return result;
}

function _flattenKMLLeafLayers(group, result) {
  result = result || [];
  if (typeof group.eachLayer !== 'function') return result;
  group.eachLayer(l => {
    if (typeof l.eachLayer === 'function') _flattenKMLLeafLayers(l, result);
    else result.push(l);
  });
  return result;
}

/* ===== SHARED LAYER BUILDER ===== */
/* Parses content into a Leaflet layer and adds it to the list.
   listOpts: passed directly to addLayerToList (opacity, visible, onStateChange, onDelete, noZoom, silent). */
function _addContentLayer(content, name, mime, listOpts) {
  listOpts = listOpts || {};
  if (mime.includes('kml')) {
    const parser = new DOMParser();
    const kmlDoc = parser.parseFromString(content, 'text/xml');
    const parseErr = kmlDoc.querySelector('parsererror');
    if (parseErr) throw new Error('Invalid XML: ' + parseErr.textContent.substring(0, 80));
    const layer = new L.KML(kmlDoc);
    if ((layer.getLayers ? layer.getLayers().length : -1) === 0)
      toastMsg('KML loaded but empty or without geometries: ' + name, '');
    const propsArray = _extractPlacemarkProps(kmlDoc);
    enhanceKMLLayer(layer, propsArray, kmlDoc);
    addLayerToList(layer, name, content, mime, { ...listOpts, isKml: true });
  } else if (mime.includes('json')) {
    const geoData = JSON.parse(content);
    const layer = L.geoJSON(geoData, {
      style: { color: '#4f8ef7', weight: 2, fillOpacity: 0.3 },
      pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 6, color: '#4f8ef7' }),
      onEachFeature: (f, l) => {
        const props = f.properties;
        if (props) {
          const nm = props.name || props.Name || '';
          const desc = props.description || '';
          if (nm || desc) l.bindPopup(`<b>${nm}</b>${desc ? '<br>' + desc : ''}`);
        }
      }
    });
    addLayerToList(layer, name, content, mime, listOpts);
  } else if (mime.includes('gpx')) {
    const gpxDoc = new DOMParser().parseFromString(content, 'text/xml');
    const geoData = toGeoJSON.gpx(gpxDoc);
    const layer = L.geoJSON(geoData, {
      style: { color: '#f0a830', weight: 3 },
      pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 5, color: '#f0a830' })
    });
    addLayerToList(layer, name, content, mime, listOpts);
  } else {
    throw new Error('Unsupported MIME: ' + mime);
  }
}

/* ===== RESTORE SAVED OVERLAYS AT STARTUP ===== */
let _overlaysRestored = false;
function _restoreFileOverlays() {
  if (_overlaysRestored) return;
  _overlaysRestored = true;
  const list = _loadOverlayStore();
  list.forEach(e => {
    try {
      const storeId = e.id;
      _addContentLayer(e.content, e.name, e.mime, {
        storeId,
        opacity:        e.opacity,
        visible:        e.visible,
        color:          e.color || null,
        hollow:         e.hollow || false,
        noZoom:         true,
        silent:         true,
        onStateChange:  upd => _updateOverlay(storeId, upd),
        onColorChange:  color => _updateOverlay(storeId, { color }),
        onHollowChange: hollow => _updateOverlay(storeId, { hollow }),
        onRename:       newName => _renameOverlay(storeId, newName),
        onDelete:       () => _removeOverlay(storeId)
      });
    } catch(err) {
      _removeOverlay(e.id);
    }
  });
  if (list.length) toastMsg(list.length + ' overlay' + (list.length > 1 ? 's' : '') + ' restored', 'success');
}
document.addEventListener('deviceready', _restoreFileOverlays, { once: true });
setTimeout(_restoreFileOverlays, 350);

/* ===== FILE LOADER ===== */
const uploadArea = document.getElementById('upload-area');
const fileInput  = document.getElementById('file-input');

uploadArea.addEventListener('click', () => fileInput.click());
uploadArea.addEventListener('dragover', e => { e.preventDefault(); uploadArea.classList.add('drag-over'); });
uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('drag-over'));
uploadArea.addEventListener('drop', e => {
  e.preventDefault();
  uploadArea.classList.remove('drag-over');
  [...e.dataTransfer.files].forEach(loadFile);
});
fileInput.addEventListener('change', e => {
  [...e.target.files].forEach(loadFile);
  fileInput.value = '';
});

function _loadAndPersist(content, name, mime) {
  const storeId = 'ovl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  _persistOverlay(storeId, name, content, mime, 80, true, null, false);
  _addContentLayer(content, name, mime, {
    storeId,
    onStateChange:  upd => _updateOverlay(storeId, upd),
    onColorChange:  color => _updateOverlay(storeId, { color }),
    onHollowChange: hollow => _updateOverlay(storeId, { hollow }),
    onRename:       newName => _renameOverlay(storeId, newName),
    onDelete:       () => _removeOverlay(storeId)
  });
}

function loadFile(file) {
  const name = file.name;
  const ext = name.split('.').pop().toLowerCase();

  if (ext === 'kmz') {
    file.arrayBuffer().then(buf => {
      return JSZip.loadAsync(buf).then(zip => {
        const kmlFiles = zip.file(/\.kml$/i);
        if (!kmlFiles.length) { toastMsg('No KML in KMZ: ' + name, 'error'); return; }
        const mainKml = kmlFiles.find(f => f.name.toLowerCase() === 'doc.kml') || kmlFiles[0];
        return mainKml.async('string').then(content => {
          _loadAndPersist(content, name.replace(/\.kmz$/i, '.kml'), 'application/vnd.google-earth.kml+xml');
        });
      });
    }).catch(err => toastMsg('KMZ error: ' + (err.message || name), 'error'));
    return;
  }

  const mimeMap = {
    kml: 'application/vnd.google-earth.kml+xml',
    geojson: 'application/json', json: 'application/json',
    gpx: 'application/gpx+xml'
  };
  const mime = mimeMap[ext];
  if (!mime) { toastMsg('Unsupported format: ' + ext, 'error'); return; }

  const reader = new FileReader();
  reader.onerror = () => toastMsg('File read error: ' + name, 'error');
  reader.onload = ev => {
    const content = ev.target.result;
    if (!content || content.length === 0) { toastMsg('Empty file: ' + name, 'error'); return; }
    try {
      _loadAndPersist(content, name, mime);
    } catch(err) {
      toastMsg('Error: ' + (err.message || name), 'error');
      console.error('loadFile error:', err);
    }
  };
  reader.readAsText(file, 'UTF-8');
}

/* ===== KML VERTEX EDITOR ===== */
let _kmlEditActive = null;

function _startKmlEdit(origLayer, layerId, storeId) {
  if (_kmlEditActive) { toastMsg('Finish current KML edit first', 'warn'); return; }

  const leaves = _flattenKMLLeafLayers(origLayer);
  if (!leaves.length) { toastMsg('No editable geometries', 'error'); return; }

  const tempGroup = L.featureGroup();
  leaves.forEach(l => {
    let clone;
    try {
      if (l instanceof L.Polygon) {
        clone = L.polygon(l.getLatLngs(), { ...l.options });
      } else if (l instanceof L.Polyline) {
        clone = L.polyline(l.getLatLngs(), { ...l.options });
      } else if (l instanceof L.Marker) {
        clone = L.marker(l.getLatLng());
      }
      if (clone) { clone._kmlProps = l._kmlProps; tempGroup.addLayer(clone); }
    } catch(_) {}
  });

  if (!tempGroup.getLayers().length) { toastMsg('No supported shapes to edit', 'error'); return; }

  try { map.removeLayer(origLayer); } catch(_) {}
  tempGroup.addTo(map);

  const handler = new L.EditToolbar.Edit(map, { featureGroup: tempGroup });
  handler.enable();
  _patchVertexDelete(tempGroup);

  const item = document.querySelector(`[data-id="${layerId}"]`);
  const layerName = item ? item.querySelector('.layer-name').textContent : 'layer';
  _kmlEditActive = { handler, tempGroup, layerId, storeId, origLayer, layerName };

  const bar = document.getElementById('kml-edit-bar');
  if (bar) {
    bar.classList.remove('hidden');
    document.getElementById('kml-edit-label').textContent = 'Editing: ' + layerName;
  }
}

function _patchVertexDelete(tempGroup) {
  tempGroup.eachLayer(l => _attachVertexDelete(l, tempGroup));
}

function _attachVertexDelete(layer, tempGroup) {
  if (!layer.editing || !layer.editing._markers) return;
  const markers = layer.editing._markers;
  const nested = markers.length > 0 && Array.isArray(markers[0]);

  function attach(m, ri, mi) {
    if (!m || m._vdel) return;
    m._vdel = true;
    m.on('dblclick', e => {
      L.DomEvent.stop(e);
      const lls = layer.getLatLngs();
      const isPolygon = layer instanceof L.Polygon;
      const ring = isPolygon ? (lls[ri] || lls) : lls;
      const minLen = isPolygon ? 3 : 2;
      if (ring.length <= minLen) {
        toastMsg(isPolygon ? 'Poligono: minimo 3 vertici' : 'Linea: minimo 2 vertici', 'warn');
        return;
      }
      ring.splice(mi, 1);
      layer.setLatLngs(lls);
      layer.edited = true;
      layer.editing.disable();
      layer.editing.enable();
      _attachVertexDelete(layer, tempGroup);
    });
  }

  if (nested) {
    markers.forEach((ring, ri) => ring.forEach((m, mi) => attach(m, ri, mi)));
  } else {
    markers.forEach((m, mi) => attach(m, 0, mi));
  }
}

function _saveKmlEdit() {
  if (!_kmlEditActive) return;
  const { handler, tempGroup, layerId, storeId, origLayer } = _kmlEditActive;

  handler.save();
  handler.disable();

  const features = [];
  tempGroup.eachLayer(l => {
    try {
      const gj = l.toGeoJSON ? l.toGeoJSON() : null;
      if (!gj) return;
      gj.properties = gj.properties || {};
      if (l._kmlProps) Object.assign(gj.properties, l._kmlProps);
      features.push(gj);
    } catch(_) {}
  });

  try { map.removeLayer(tempGroup); } catch(_) {}
  const bar = document.getElementById('kml-edit-bar');
  if (bar) bar.classList.add('hidden');
  _kmlEditActive = null;

  if (!features.length) {
    try { origLayer.addTo(map); } catch(_) {}
    loadedLayers[layerId] = origLayer;
    toastMsg('No features — edit cancelled', 'warn');
    return;
  }

  const newKmlContent = tokml({ type: 'FeatureCollection', features });
  try {
    const kmlDoc = new DOMParser().parseFromString(newKmlContent, 'text/xml');
    const newLayer = new L.KML(kmlDoc);
    enhanceKMLLayer(newLayer, _extractPlacemarkProps(kmlDoc), kmlDoc);
    newLayer.addTo(map);
    loadedLayers[layerId] = newLayer;
    const _editItem = document.querySelector(`[data-id="${layerId}"]`);
    if (_editItem) {
      const _cp = _editItem.querySelector('.layer-color');
      if (_cp) setLayerColor(newLayer, _cp.value);
      const _op = _editItem.querySelector('.layer-opacity');
      if (_op) setLayerOpacity(newLayer, parseInt(_op.value));
    }
    if (storeId) {
      const list = _loadOverlayStore();
      const entry = list.find(e => e.id === storeId);
      if (entry) { entry.content = newKmlContent; _saveOverlayStore(list); }
    }
    toastMsg('KML saved', 'success');
  } catch(err) {
    try { origLayer.addTo(map); } catch(_) {}
    loadedLayers[layerId] = origLayer;
    toastMsg('Save error: ' + (err.message || ''), 'error');
  }
}

function _cancelKmlEdit() {
  if (!_kmlEditActive) return;
  const { handler, tempGroup, origLayer, layerId } = _kmlEditActive;
  try { handler.revertLayers(); handler.disable(); } catch(_) {}
  try { map.removeLayer(tempGroup); } catch(_) {}
  try { origLayer.addTo(map); } catch(_) {}
  loadedLayers[layerId] = origLayer;
  const bar = document.getElementById('kml-edit-bar');
  if (bar) bar.classList.add('hidden');
  _kmlEditActive = null;
  toastMsg('Edit cancelled', '');
}

/* ===== DISSOLVE WIZARD ===== */
function _dissolveUpdateBtn() {
  const ok = document.getElementById('dissolve-ok');
  if (!ok) return;
  const any = !!document.querySelector('#dissolve-picker-list input[type=checkbox]:checked');
  ok.disabled = !any;
  ok.className = any ? 'btn btn-success' : 'btn btn-secondary';
}

function _startDissolve() {
  if (typeof turf === 'undefined') {
    toastMsg('Turf.js not loaded — place turf.min.js in the app folder', 'error'); return;
  }
  if (_kmlEditActive) { toastMsg('Finish KML edit first', 'warn'); return; }

  const kmlEntries = Object.entries(loadedLayers).filter(([, l]) =>
    l && !l._isOL && _flattenKMLLeafLayers(l).some(ll => ll instanceof L.Polygon)
  );
  if (!kmlEntries.length) { toastMsg('No KML polygon layers loaded', 'warn'); return; }

  const list = document.getElementById('dissolve-picker-list');
  const picker = document.getElementById('dissolve-picker');
  if (!list || !picker) return;

  list.innerHTML = kmlEntries.map(([id]) => {
    const nameEl = document.querySelector(`[data-id="${id}"] .layer-name`);
    const name = (nameEl ? nameEl.textContent : id).replace(/</g, '&lt;');
    return `<label style="display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer">` +
           `<input type="checkbox" data-dissolve-id="${id}" style="width:16px;height:16px">` +
           `<span style="font-size:13px">${name}</span></label>`;
  }).join('');

  list.querySelectorAll('input[type=checkbox]').forEach(cb =>
    cb.addEventListener('change', _dissolveUpdateBtn)
  );

  picker.classList.remove('hidden');
  const wrap = document.getElementById('dissolve-progress-wrap');
  if (wrap) wrap.classList.add('hidden');
  _dissolveUpdateBtn();
}

function _cancelDissolve() {
  const picker = document.getElementById('dissolve-picker');
  if (picker) picker.classList.add('hidden');
}

function _proceedDissolve() {
  const checked = document.querySelectorAll('#dissolve-picker-list input[type=checkbox]:checked');
  if (!checked.length) return;

  const features = [];
  checked.forEach(cb => {
    const layer = loadedLayers[cb.dataset.dissolveId];
    if (!layer) return;
    _flattenKMLLeafLayers(layer).forEach(l => {
      if (!(l instanceof L.Polygon)) return;
      try { const gj = l.toGeoJSON(); if (gj) features.push(gj); } catch(_) {}
    });
  });
  if (!features.length) { toastMsg('No polygon features found in selected layers', 'error'); return; }

  const ok = document.getElementById('dissolve-ok');
  const wrap = document.getElementById('dissolve-progress-wrap');
  const fill = document.getElementById('dissolve-progress-fill');
  const txt  = document.getElementById('dissolve-progress-text');
  if (ok) ok.disabled = true;
  if (wrap) wrap.classList.remove('hidden');
  if (fill) fill.style.width = '10%';
  if (txt)  txt.textContent = 'Merging ' + features.length + ' features…';

  // Defer heavy work so the progress bar renders first
  setTimeout(() => {
    let result;
    try {
      if (fill) fill.style.width = '40%';
      result = turf.union(turf.featureCollection(features));
    } catch(_) {
      try {
        result = features[0];
        for (let i = 1; i < features.length; i++) {
          result = turf.union(result, features[i]);
          if (fill) fill.style.width = (40 + Math.round(40 * i / features.length)) + '%';
        }
      } catch(err) {
        if (wrap) wrap.classList.add('hidden');
        if (ok) { ok.disabled = false; ok.className = 'btn btn-success'; }
        toastMsg('Dissolve error: ' + (err.message || ''), 'error'); return;
      }
    }

    if (!result || !result.geometry) {
      if (wrap) wrap.classList.add('hidden');
      if (ok) { ok.disabled = false; ok.className = 'btn btn-success'; }
      toastMsg('Dissolve failed', 'error'); return;
    }

    if (fill) fill.style.width = '80%';
    if (txt)  txt.textContent = 'Simplifying…';

    setTimeout(() => {
      try { result = turf.simplify(result, { tolerance: 0.000036, highQuality: true }); } catch(_) {}
      if (!result || !result.geometry) {
        if (wrap) wrap.classList.add('hidden');
        if (ok) { ok.disabled = false; ok.className = 'btn btn-success'; }
        toastMsg('Dissolve failed after simplify', 'error'); return;
      }
      try {
        const coords = result.geometry.coordinates;
        if (result.geometry.type === 'Polygon' && coords.length > 1) {
          result = turf.polygon([coords[0]], result.properties);
        } else if (result.geometry.type === 'MultiPolygon') {
          result = turf.multiPolygon(coords.map(rings => [rings[0]]), result.properties);
        }
      } catch(_) {}

      if (fill) fill.style.width = '100%';
      if (txt)  txt.textContent = 'Done';

      setTimeout(() => {
        _cancelDissolve();
        const modal = document.getElementById('dissolve-modal');
        if (modal) {
          document.getElementById('dissolve-name-input').value = '';
          document.getElementById('dissolve-desc-input').value = '';
          modal.classList.remove('hidden');
          document.getElementById('dissolve-modal-ok').onclick = () => {
            const name = (document.getElementById('dissolve-name-input').value || '').trim() || 'Dissolved';
            const desc = (document.getElementById('dissolve-desc-input').value || '').trim();
            modal.classList.add('hidden');
            result.properties = { name, description: desc };
            const kmlContent = tokml({ type: 'FeatureCollection', features: [result] });
            _loadAndPersist(kmlContent, name + '.kml', 'application/vnd.google-earth.kml+xml');
            downloadFile(kmlContent, name + '.kml', 'application/vnd.google-earth.kml+xml');
            toastMsg('Layer loaded: ' + name, 'success');
          };
          document.getElementById('dissolve-modal-cancel').onclick = () => {
            modal.classList.add('hidden');
          };
        }
      }, 400);
    }, 30);
  }, 30);
}

/* ===== DOM LISTENERS (layers panel) ===== */
document.addEventListener('DOMContentLoaded', () => {
  const kmlSave   = document.getElementById('kml-edit-save');
  const kmlCancel = document.getElementById('kml-edit-cancel');
  if (kmlSave)   kmlSave.addEventListener('click', _saveKmlEdit);
  if (kmlCancel) kmlCancel.addEventListener('click', _cancelKmlEdit);

  const dissolveBtn    = document.getElementById('btn-dissolve');
  const dissolveOk     = document.getElementById('dissolve-ok');
  const dissolveCancel = document.getElementById('dissolve-cancel');
  if (dissolveBtn)    dissolveBtn.addEventListener('click', _startDissolve);
  if (dissolveOk)     dissolveOk.addEventListener('click', _proceedDissolve);
  if (dissolveCancel) dissolveCancel.addEventListener('click', _cancelDissolve);
  // Close picker if Draw panel is closed
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.panel !== 'draw') _cancelDissolve();
    });
  });
});
