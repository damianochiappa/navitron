'use strict';
/* =====================================================
   UTILS — coordinate math, toast, file I/O
===================================================== */

function dd2dms(dd) {
  const d = Math.floor(Math.abs(dd));
  const m = Math.floor((Math.abs(dd) - d) * 60);
  const s = ((Math.abs(dd) - d) * 60 - m) * 60;
  return `${d}\u00b0${String(m).padStart(2,'0')}'${s.toFixed(2).padStart(5,'0')}"`;
}
function latToDMS(lat) { return dd2dms(lat) + (lat >= 0 ? 'N' : 'S'); }
function lonToDMS(lon) { return dd2dms(lon) + (lon >= 0 ? 'E' : 'W'); }

function coordToDM(lat, lon) {
  function fmt(deg, isLat) {
    const abs = Math.abs(deg);
    const d = Math.floor(abs);
    const m = (abs - d) * 60;
    const hem = isLat ? (deg >= 0 ? 'N' : 'S') : (deg >= 0 ? 'E' : 'W');
    return `${d}\u00b0${m.toFixed(3)}'${hem}`;
  }
  return `${fmt(lat, true)} ${fmt(lon, false)}`;
}

function dms2dd(dmsStr) {
  const neg = /[SWsw]/.test(dmsStr);
  const parts = dmsStr.replace(/[\u00b0'"NnSsEeWw\s]+/g,' ').trim().split(/\s+/).map(Number);
  const d = parts[0] || 0, m = parts[1] || 0, s = parts[2] || 0;
  return (neg ? -1 : 1) * (d + m/60 + s/3600);
}

function parseMGRS(raw) {
  const s = raw.replace(/\s/g, '').toUpperCase();
  try {
    const pt = window.mgrs.toPoint(s);
    if (pt && !isNaN(pt[0]) && !isNaN(pt[1])) return { lat: pt[1], lon: pt[0] };
  } catch(e) {}
  const m = s.match(/^(\d{1,2}[A-Z])([A-Z]{2})(\d{2,10})$/);
  if (!m) return null;
  const zone = m[1], band = m[2], digits = m[3];
  if (digits.length % 2 !== 0) return null;
  const half = digits.length / 2;
  const ex = digits.substring(0, half).padEnd(5, '0');
  const nx = digits.substring(half).padEnd(5, '0');
  try {
    const utm = UTMREF.toUTM({ zone, band, x: band[0], y: band[1] });
    const fullE = parseInt(utm.x) * 100000 + parseInt(ex);
    const fullN = parseInt(utm.y) * 100000 + parseInt(nx);
    const ll = UTM.toLatLng({ zone, x: fullE, y: fullN });
    if (ll && !isNaN(ll.lat)) return ll;
  } catch(e) {}
  return null;
}

function mgrsForward(lon, lat) {
  try {
    const s = window.mgrs.forward([lon, lat], 5);
    if (s && s.length > 5) return s;
  } catch(e) {}
  try {
    const utm = UTM.fromLatLng({ lat, lng: lon });
    const ref = UTMREF.fromUTM({ zone: utm.zone, x: String(Math.round(utm.x)), y: String(Math.round(utm.y)) });
    if (ref) return ref.zone + ref.band + ref.x + ref.y;
  } catch(e) {}
  return '--';
}

function calcBearing(lat1, lon1, lat2, lon2) {
  const toRad = d => d * Math.PI / 180;
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
             Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function toastMsg(msg, type='', dur) {
  if (dur === undefined) dur = type === 'error' ? 4000 : type === 'warn' ? 3500 : 2500;
  const t = document.getElementById('toast');
  const _icons = { error: '✖ ', warn: '⚠ ', success: '✔ ', info: 'ℹ ' };
  t.textContent = (_icons[type] || '') + msg;
  t.className = 'show ' + type;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.className = '', dur);
}

function _xmlEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function showPromptModal(message, defaultValue, onConfirm) {
  let modal = document.getElementById('prompt-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'prompt-modal';
    modal.className = 'modal-backdrop';
    modal.innerHTML =
      '<div class="modal-box">' +
        '<p id="prompt-modal-msg" style="margin-bottom:12px;font-size:13px;line-height:1.5"></p>' +
        '<div class="field"><input type="text" id="prompt-modal-input" autocomplete="off" autocorrect="off" spellcheck="false"></div>' +
        '<div class="modal-btns">' +
          '<button class="btn btn-secondary" id="prompt-modal-cancel">Cancel</button>' +
          '<button class="btn btn-primary" id="prompt-modal-ok">OK</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
    document.getElementById('prompt-modal-cancel').addEventListener('click', () => { modal.style.display = 'none'; });
    document.getElementById('prompt-modal-ok').addEventListener('click', () => {
      modal.style.display = 'none';
      if (modal._cb) modal._cb(document.getElementById('prompt-modal-input').value);
    });
    document.getElementById('prompt-modal-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('prompt-modal-ok').click();
      if (e.key === 'Escape') { modal.style.display = 'none'; }
    });
    modal.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none'; });
  }
  document.getElementById('prompt-modal-msg').textContent = message;
  const inp = document.getElementById('prompt-modal-input');
  inp.value = defaultValue || '';
  modal._cb = onConfirm;
  modal.style.display = 'flex';
  setTimeout(() => { inp.focus(); inp.select(); }, 80);
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); toastMsg('Coordinates copied', 'success'); }
  catch(_) { toastMsg('Copy not available', 'error'); }
  document.body.removeChild(ta);
}

function calcArea(layer) {
  if (typeof L.GeometryUtil === 'undefined') return null;
  const latlngs = layer.getLatLngs ? layer.getLatLngs() : null;
  if (!latlngs) return null;
  try {
    const flat = Array.isArray(latlngs[0]) ? latlngs[0] : latlngs;
    const area = L.GeometryUtil.geodesicArea(flat);
    if (area < 10000) return area.toFixed(1) + ' m\u00b2';
    if (area < 1e6)   return (area/10000).toFixed(2) + ' ha';
    return (area/1e6).toFixed(3) + ' km\u00b2';
  } catch(e) { return null; }
}

function calcLength(layer) {
  const latlngs = layer.getLatLngs ? layer.getLatLngs() : null;
  if (!latlngs) return null;
  try {
    const pts = Array.isArray(latlngs[0]) ? latlngs[0] : latlngs;
    let total = 0;
    for (let i=1; i<pts.length; i++) total += pts[i-1].distanceTo(pts[i]);
    if (total < 1000) return total.toFixed(1) + ' m';
    return (total/1000).toFixed(3) + ' km';
  } catch(e) { return null; }
}

function showSavePathModal(path) {
  let modal = document.getElementById('save-path-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'save-path-modal';
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.7);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px';
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r);
                padding:20px;max-width:400px;width:100%;box-shadow:var(--shadow)">
      <div style="font-weight:700;margin-bottom:10px;color:var(--success);font-size:15px">File saved</div>
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">Path:</div>
      <div style="background:var(--surface2);border:1px solid var(--border);border-radius:4px;
                  padding:10px;font-size:12px;word-break:break-all;color:var(--text);
                  font-family:monospace;margin-bottom:14px">${path}</div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:16px">
        Open <b>Files by Google</b> (or any file manager)&nbsp;&rarr;<br>
        <span style="color:var(--accent)">Browse &rarr; Android &rarr; data &rarr; com.geotool.app &rarr; files</span>
      </div>
      <button onclick="document.getElementById('save-path-modal').style.display='none'"
              style="background:var(--accent);color:#fff;border:none;border-radius:var(--r);
                     padding:10px 20px;width:100%;font-size:14px;cursor:pointer">OK</button>
    </div>`;
  modal.style.display = 'flex';
}

function _writeToDir(blob, filename, dir, onFail) {
  window.resolveLocalFileSystemURL(dir,
    d => d.getFile(filename, { create: true, exclusive: false },
      fe => fe.createWriter(
        w => {
          w.onwriteend = () => {
            const disp = dir.replace('file://','').replace('/storage/emulated/0/','/sdcard/') + filename;
            if (dir === (window.cordova.file.externalDataDirectory || window.cordova.file.dataDirectory))
              showSavePathModal(disp);
            else
              toastMsg('Saved: ' + disp, '');
          };
          w.onerror = () => onFail();
          w.write(blob);
        },
        () => onFail()
      ),
      () => onFail()
    ),
    () => onFail()
  );
}

function _doSaveFile(blob, filename) {
  if (!window.cordova || !window.cordova.file) { _downloadBrowser(blob, filename); return; }
  const dlDir      = window.cordova.file.externalRootDirectory
                       ? window.cordova.file.externalRootDirectory + 'Download/'
                       : null;
  const sandboxDir = window.cordova.file.externalDataDirectory || window.cordova.file.dataDirectory;
  if (dlDir) {
    _writeToDir(blob, filename, dlDir,
      () => _writeToDir(blob, filename, sandboxDir, () => toastMsg('Save error', 'error'))
    );
  } else {
    _writeToDir(blob, filename, sandboxDir, () => toastMsg('Save error', 'error'));
  }
}

function downloadFile(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  if (window.SaveToDownloads) {
    window.SaveToDownloads.save(
      filename, content, mime,
      () => toastMsg('Saved to Downloads: ' + filename, 'success'),
      err  => {
        console.warn('SaveToDownloads error:', err);
        toastMsg('Downloads failed (' + (err || 'unknown') + ') — saving locally', 'warn');
        _doSaveFile(blob, filename);
      }
    );
    return;
  }
  _doSaveFile(blob, filename);
}

function _downloadBrowser(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}



/* ===== ADDRESS AUTOCOMPLETE ===== */
function _attachAddressAutocomplete(input, onPick, opts) {
  opts = opts || {};
  let _timer = null, _dropdown = null, _items = [], _activeIdx = -1;

  function _close() {
    if (_dropdown) { _dropdown.remove(); _dropdown = null; }
    _items = []; _activeIdx = -1;
  }

  function _show(results) {
    _close();
    if (!results.length) return;
    _dropdown = document.createElement('div');
    _dropdown.className = 'autocomplete-dropdown';
    _items = results;
    results.forEach((r, i) => {
      const item = document.createElement('div');
      item.className = 'autocomplete-item';
      item.textContent = r.display_name;
      item.addEventListener('mousedown', e => {
        e.preventDefault();
        input.value = r.display_name.split(',')[0];
        onPick(+r.lat, +r.lon, r.display_name.split(',')[0]);
        _close();
      });
      _dropdown.appendChild(item);
    });
    input.closest('[style*="position"]') ? input.closest('[style*="position"]').appendChild(_dropdown)
      : (input.parentElement.style.position = 'relative', input.parentElement.appendChild(_dropdown));
  }

  function _setActive(idx) {
    if (!_dropdown) return;
    const els = _dropdown.querySelectorAll('.autocomplete-item');
    els.forEach(el => el.classList.remove('ac-active'));
    _activeIdx = Math.max(-1, Math.min(idx, _items.length - 1));
    if (_activeIdx >= 0) els[_activeIdx].classList.add('ac-active');
  }

  input.addEventListener('input', () => {
    clearTimeout(_timer);
    const val = input.value.trim();
    if (val.length < 3) { _close(); return; }
    if (opts.onlyIfText && !/[a-zA-Z]/.test(val)) { _close(); return; }
    _timer = setTimeout(async () => {
      try {
        const r = await fetch(
          'https://nominatim.openstreetmap.org/search?format=json&limit=5&q=' + encodeURIComponent(val),
          { headers: { 'Accept-Language': 'en' } }
        );
        const data = await r.json();
        _show(data);
      } catch (_) { _close(); }
    }, 380);
  });

  input.addEventListener('keydown', e => {
    if (!_dropdown) return;
    if (e.key === 'ArrowDown')  { e.preventDefault(); _setActive(_activeIdx + 1); }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); _setActive(_activeIdx - 1); }
    else if (e.key === 'Enter' && _activeIdx >= 0) {
      e.preventDefault();
      const r = _items[_activeIdx];
      input.value = r.display_name.split(',')[0];
      onPick(+r.lat, +r.lon, r.display_name.split(',')[0]);
      _close();
    }
    else if (e.key === 'Escape') _close();
  });

  document.addEventListener('click', e => {
    if (!_dropdown) return;
    if (!input.contains(e.target) && !_dropdown.contains(e.target)) _close();
  });
}
