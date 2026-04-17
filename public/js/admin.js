/* ============================================================
   Panel de Administración
   ============================================================ */

// ─── Tabs ───
function initAdminTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.tab).classList.add('active');
    });
  });
}

// ─── STATS: Métricas del día y semana ───
async function loadAdminStats() {
  const today = getTodayStr();
  const now = new Date();
  const dayOfWeek = now.getDay() === 0 ? 6 : now.getDay() - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - dayOfWeek);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const mondayStr = monday.toISOString().split('T')[0];
  const sundayStr = sunday.toISOString().split('T')[0];

  try {
    const snapshot = await db.collection('reservations').get();
    let hoy = 0, pendientes = 0, semana = 0, confirmadas = 0;
    snapshot.forEach(doc => {
      const r = doc.data();
      if (r.estado === 'pendiente_pago') return; // no contar los no confirmados
      if (r.fecha === today && r.estado !== 'cancelada') hoy++;
      if (r.estado === 'pendiente') pendientes++;
      if (r.estado === 'confirmada') confirmadas++;
      if (r.fecha >= mondayStr && r.fecha <= sundayStr && r.estado !== 'cancelada') semana++;
    });
    document.getElementById('stat-hoy').textContent = hoy;
    document.getElementById('stat-pendientes').textContent = pendientes;
    document.getElementById('stat-semana').textContent = semana;
    document.getElementById('stat-confirmadas').textContent = confirmadas;
  } catch (err) {
    console.error('Error al cargar stats:', err);
  }
}

// ─── AGENDA DEL DÍA ───
// Trae solo por fecha (sin orderBy para no requerir índice extra)
// y ordena en el cliente
async function loadAgendaHoy() {
  const today = getTodayStr();
  const container = document.getElementById('agenda-hoy');
  container.innerHTML = '<div class="loading-overlay" style="padding:1rem"><div class="spinner"></div></div>';

  try {
    const snapshot = await db.collection('reservations')
      .where('fecha', '==', today)
      .get();

    // Filtrar canceladas y ordenar por hora en el cliente
    let reservas = [];
    snapshot.forEach(doc => {
      const r = doc.data();
      if (r.estado !== 'cancelada') reservas.push(r);
    });
    reservas.sort((a, b) => a.hora.localeCompare(b.hora));

    if (reservas.length === 0) {
      container.innerHTML = '<p class="text-muted" style="padding:0.5rem 0">No hay turnos activos para hoy.</p>';
      return;
    }

    let html = '';
    reservas.forEach(r => {
      html += `
        <div class="agenda-item">
          <div class="agenda-hora">${r.hora}</div>
          <div class="agenda-info">
            <strong>${escapeHtml(r.servicioNombre)}</strong>
            <span>${escapeHtml(r.nombreUsuario || r.emailUsuario)}</span>
          </div>
          <span class="badge badge-${r.estado}">${r.estado}</span>
        </div>`;
    });
    container.innerHTML = html;
  } catch (err) {
    console.error('Error agenda:', err);
    container.innerHTML = '<p class="text-muted">Error al cargar la agenda.</p>';
  }
}

// ─── RESERVAS: Cargar con filtros ───
async function loadAllReservations(filtroEstado = 'todos', filtroFecha = '') {
  const container = document.getElementById('admin-reservations');
  container.innerHTML = '<div class="loading-overlay"><div class="spinner"></div> Cargando...</div>';

  try {
    const snapshot = await db.collection('reservations')
      .orderBy('fecha', 'desc')
      .orderBy('hora', 'desc')
      .get();

    let reservas = [];
    snapshot.forEach(doc => reservas.push({ id: doc.id, ...doc.data() }));

    // Nunca mostrar pendiente_pago ni canceladas: salen del panel del admin
    reservas = reservas.filter(r => r.estado !== 'pendiente_pago' && r.estado !== 'cancelada');
    if (filtroEstado !== 'todos') reservas = reservas.filter(r => r.estado === filtroEstado);
    if (filtroFecha) reservas = reservas.filter(r => r.fecha === filtroFecha);

    if (reservas.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>No hay reservas con esos filtros.</p></div>';
      return;
    }

    let html = `
    <div class="table-responsive">
      <table>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Hora</th>
            <th>Cliente</th>
            <th>Servicio</th>
            <th>Estado</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>`;

    // Mapa de datos para ficha de cliente (evita problemas con comillas en nombres)
    window._fichaData = window._fichaData || {};

    reservas.forEach(r => {
      const waPhone = formatWAPhone(r.telefonoUsuario || '');
      const waLink  = waPhone ? buildWAUrl(waPhone, buildReservaReminderMessage(r)) : '';
      if (r.userId) {
        window._fichaData[r.userId] = {
          nombre:   r.nombreUsuario  || '',
          email:    r.emailUsuario   || '',
          telefono: r.telefonoUsuario || ''
        };
      }

      const estadoLabel = r.estado === 'completado' ? 'Realizado' : r.estado;
      const puedeCompletar = r.estado === 'confirmada' || r.estado === 'pendiente';

      html += `
          <tr>
            <td>${formatDate(r.fecha)}</td>
            <td><strong>${r.hora}</strong></td>
            <td>
              ${r.userId
                ? `<button class="btn-cliente" onclick="abrirFichaCliente('${r.userId}')">${escapeHtml(r.nombreUsuario || 'Sin nombre')}</button>`
                : `<span>${escapeHtml(r.nombreUsuario || 'Sin nombre')}</span>`}
              <br><small class="text-muted">${escapeHtml(r.emailUsuario || '')}</small>
              ${r.telefonoUsuario ? `<br><small class="text-muted">📱 ${escapeHtml(r.telefonoUsuario)}</small>` : ''}
            </td>
            <td>${escapeHtml(r.servicioNombre)}</td>
            <td><span class="badge badge-${r.estado}">${estadoLabel}</span></td>
            <td>
              <div class="btn-group">
                ${waLink ? `<a class="btn btn-sm btn-whatsapp" href="${waLink}" target="_blank" title="Enviar recordatorio por WhatsApp">📱 Recordatorio</a>` : ''}
                ${puedeCompletar ? `<button class="btn btn-sm btn-success" onclick="completeReservation('${r.id}')">✓ Realizado</button>` : ''}
                ${r.estado !== 'cancelada' && r.estado !== 'completado' ? `<button class="btn btn-sm btn-danger" onclick="cancelReservationAdmin('${r.id}')">Cancelar</button>` : ''}
              </div>
            </td>
          </tr>`;
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;
  } catch (err) {
    console.error('Error al cargar reservas:', err);
    container.innerHTML = '<div class="alert alert-error">Error al cargar reservas.</div>';
  }
}

// ─── RESERVAS: Cancelar (con opción de devolución de seña) ───
async function cancelReservationAdmin(id) {
  // Leer datos de la reserva
  let reserva;
  try {
    const doc = await db.collection('reservations').doc(id).get();
    if (!doc.exists) { alert('Reserva no encontrada.'); return; }
    reserva = doc.data();
  } catch (err) {
    alert('Error al obtener la reserva.');
    return;
  }

  const tieneSenia = reserva.paymentId && reserva.paymentStatus === 'approved';

  if (tieneSenia) {
    const devolver = confirm(
      `Esta clienta pagó una seña de $${(reserva.senia || 0).toLocaleString('es-AR')}.\n\n` +
      `¿Querés devolver la seña automáticamente a su medio de pago?\n\n` +
      `• Aceptar → devuelve el dinero por Mercado Pago y cancela el turno\n` +
      `• Cancelar → solo cancela el turno (la devolución la manejás vos)`
    );

    if (devolver) {
      await procesarDevolucion(id, reserva);
      return;
    }
  } else {
    if (!confirm('¿Cancelar este turno?')) return;
  }

  // Cancelar sin devolución
  await cancelarEnFirestore(id);
}

// ─── Procesar devolución via Mercado Pago ───
async function procesarDevolucion(id, reserva) {
  try {
    // Leer access token de config/mp
    const mpDoc = await db.collection('config').doc('mp').get();
    if (!mpDoc.exists || !mpDoc.data().access_token) {
      alert('No se encontró la configuración de Mercado Pago. Cancelá el turno y hacé la devolución manualmente.');
      return;
    }
    const { access_token } = mpDoc.data();

    // Llamar API de devolución de MP
    const response = await fetch(
      `https://api.mercadopago.com/v1/payments/${reserva.paymentId}/refunds`,
      {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${access_token}`
        },
        body: JSON.stringify({})
      }
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      console.error('Error MP refund:', err);
      const msg = err.message || 'Error desconocido';
      const continuar = confirm(
        `No se pudo procesar la devolución automática: ${msg}\n\n` +
        `¿Cancelar el turno igualmente y hacer la devolución manual?`
      );
      if (continuar) await cancelarEnFirestore(id, { refundStatus: 'manual' });
      return;
    }

    const refundData = await response.json();
    // Cancelar la reserva con registro de devolución
    await cancelarEnFirestore(id, {
      refundStatus: 'devuelta',
      refundId:     String(refundData.id || '')
    });

    alert(`Seña devuelta correctamente. El dinero vuelve al medio de pago original de la clienta en 1-10 días hábiles.`);

  } catch (err) {
    console.error('Error devolución:', err);
    alert('Error al procesar la devolución. Cancelá el turno manualmente y gestioná la devolución desde tu cuenta de Mercado Pago.');
  }
}

// ─── Cancelar en Firestore ───
async function cancelarEnFirestore(id, extra = {}) {
  try {
    await db.collection('reservations').doc(id).update({
      estado:    'cancelada',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      ...extra
    });
    const filtroEstado = document.getElementById('filtro-estado').value;
    const filtroFecha  = document.getElementById('filtro-fecha').value;
    loadAllReservations(filtroEstado, filtroFecha);
    loadAdminStats();
    loadAgendaHoy();
  } catch (err) {
    alert('Error al cancelar la reserva.');
  }
}

// ─── RESERVAS: Marcar como realizado ───
async function completeReservation(id) {
  if (!confirm('¿Marcar este turno como realizado?')) return;
  try {
    await db.collection('reservations').doc(id).update({
      estado:    'completado',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    const filtroEstado = document.getElementById('filtro-estado').value;
    const filtroFecha  = document.getElementById('filtro-fecha').value;
    loadAllReservations(filtroEstado, filtroFecha);
    loadAdminStats();
    loadAgendaHoy();
  } catch (err) {
    alert('Error al actualizar la reserva.');
  }
}

// ─── RESERVAS: Cambiar estado (genérico, solo para uso interno) ───
async function updateReservationStatus(id, nuevoEstado) {
  try {
    await db.collection('reservations').doc(id).update({
      estado: nuevoEstado,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    const filtroEstado = document.getElementById('filtro-estado').value;
    const filtroFecha = document.getElementById('filtro-fecha').value;
    loadAllReservations(filtroEstado, filtroFecha);
    loadAdminStats();
    loadAgendaHoy();
  } catch (err) {
    alert('Error al actualizar el estado.');
  }
}

// ─── SERVICIOS: Cargar todos ───
async function loadAllServices() {
  const container = document.getElementById('admin-services-list');
  container.innerHTML = '<div class="loading-overlay"><div class="spinner"></div> Cargando...</div>';

  try {
    const snapshot = await db.collection('services').orderBy('categoria').orderBy('nombre').get();

    if (snapshot.empty) {
      container.innerHTML = '<div class="empty-state"><p>No hay servicios. Usá el botón para cargar los iniciales.</p></div>';
      return;
    }

    let html = `
    <div class="table-responsive">
      <table>
        <thead>
          <tr><th>Nombre</th><th>Categoría</th><th>Duración</th><th>Precio</th><th>Activo</th><th>Acciones</th></tr>
        </thead>
        <tbody>`;

    snapshot.forEach(doc => {
      const s = doc.data();
      html += `
          <tr>
            <td>${escapeHtml(s.nombre)}</td>
            <td style="text-transform:capitalize">${escapeHtml(s.categoria)}</td>
            <td>${s.duracionMin} min</td>
            <td>${s.precio ? `$${s.precio.toLocaleString('es-AR')}` : '<span class="text-muted">Sin precio</span>'}</td>
            <td><span class="badge ${s.activo ? 'badge-confirmada' : 'badge-cancelada'}">${s.activo ? 'Sí' : 'No'}</span></td>
            <td>
              <div class="btn-group">
                <button class="btn btn-sm btn-secondary" onclick="editServiceModal('${doc.id}')">Editar</button>
                <button class="btn btn-sm ${s.activo ? 'btn-danger' : 'btn-success'}" onclick="toggleServiceActive('${doc.id}',${!s.activo})">${s.activo ? 'Desactivar' : 'Activar'}</button>
              </div>
            </td>
          </tr>`;
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = '<div class="alert alert-error">Error al cargar servicios.</div>';
  }
}

async function toggleServiceActive(id, nuevoEstado) {
  try {
    await db.collection('services').doc(id).update({ activo: nuevoEstado });
    invalidateCachePrefix('services:');
    loadAllServices();
  } catch (err) { console.error(err); }
}

function showServiceModal(data = null, docId = null) {
  const prev = document.getElementById('service-modal');
  if (prev) prev.remove();
  const isEdit = !!docId;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'service-modal';
  overlay.innerHTML = `
    <div class="modal">
      <h2>${isEdit ? 'Editar' : 'Nuevo'} Servicio</h2>
      <div id="service-modal-alert"></div>
      <form id="service-form">
        <div class="form-group">
          <label>Nombre</label>
          <input type="text" class="form-control" id="svc-nombre" value="${data ? data.nombre : ''}" required>
        </div>
        <div class="form-group">
          <label>Categoría</label>
          <select class="form-control" id="svc-categoria">
            <option value="facial" ${data && data.categoria==='facial'?'selected':''}>Facial</option>
            <option value="corporal" ${data && data.categoria==='corporal'?'selected':''}>Corporal</option>
            <option value="capilar" ${data && data.categoria==='capilar'?'selected':''}>Capilar</option>
            <option value="otros" ${data && data.categoria==='otros'?'selected':''}>Otros</option>
          </select>
        </div>
        <div class="form-group">
          <label>Duración (minutos)</label>
          <input type="number" class="form-control" id="svc-duracion" value="${data ? data.duracionMin : 60}" min="15" step="15" required>
        </div>
        <div class="form-group">
          <label>Precio (ARS) <span style="font-size:0.75rem;color:var(--color-text-muted)">— requerido para cobrar seña</span></label>
          <input type="number" class="form-control" id="svc-precio" value="${data && data.precio ? data.precio : ''}" min="0" step="100" placeholder="Ej: 5000">
        </div>
        <div class="form-group">
          <label><input type="checkbox" id="svc-activo" ${!data || data.activo ? 'checked' : ''}> Activo</label>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick="document.getElementById('service-modal').remove()">Cancelar</button>
          <button type="submit" class="btn btn-primary">${isEdit ? 'Guardar' : 'Crear'}</button>
        </div>
      </form>
    </div>`;

  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  document.getElementById('service-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const precioVal = document.getElementById('svc-precio').value;
    const d = {
      nombre: document.getElementById('svc-nombre').value.trim(),
      categoria: document.getElementById('svc-categoria').value,
      duracionMin: parseInt(document.getElementById('svc-duracion').value),
      precio: precioVal ? parseInt(precioVal) : 0,
      activo: document.getElementById('svc-activo').checked
    };
    if (!d.nombre) { showAlert('service-modal-alert', 'Ingresá un nombre.'); return; }
    try {
      if (isEdit) { await db.collection('services').doc(docId).update(d); }
      else { await db.collection('services').add(d); }
      invalidateCachePrefix('services:');
      overlay.remove();
      loadAllServices();
    } catch { showAlert('service-modal-alert', 'Error al guardar.'); }
  });
}

async function editServiceModal(docId) {
  const doc = await db.collection('services').doc(docId).get();
  if (doc.exists) showServiceModal(doc.data(), docId);
}

// ─── BLOQUEOS: helpers ───
async function loadBloqueos() {
  try {
    const doc = await db.collection('config').doc('bloqueos').get();
    const data = doc.exists ? doc.data() : {};
    return { diasBloqueados: data.diasBloqueados || [], horariosBloqueados: data.horariosBloqueados || {} };
  } catch { return { diasBloqueados: [], horariosBloqueados: {} }; }
}

// ─── BLOQUEOS: Días ───
async function renderDiasBloqueados() {
  const container = document.getElementById('dias-bloqueados-list');
  const bloqueos = await loadBloqueos();
  const dias = [...bloqueos.diasBloqueados].sort();

  if (dias.length === 0) {
    container.innerHTML = '<p class="text-muted">No hay días bloqueados.</p>';
    return;
  }
  container.innerHTML = dias.map(d => `
    <div class="bloqueo-item">
      <span>${formatDate(d)}</span>
      <button class="btn btn-sm btn-danger" onclick="desbloquearDia('${d}')">Desbloquear</button>
    </div>`).join('');
}

async function bloquearDia() {
  const input = document.getElementById('bloqueo-fecha');
  const fecha = input.value;
  if (!fecha) { showAlert('bloqueo-alert', 'Seleccioná una fecha.'); return; }
  try {
    const bloqueos = await loadBloqueos();
    if (bloqueos.diasBloqueados.includes(fecha)) {
      showAlert('bloqueo-alert', 'Ese día ya está bloqueado.', 'warning'); return;
    }
    bloqueos.diasBloqueados.push(fecha);
    await db.collection('config').doc('bloqueos').set(bloqueos);
    showAlert('bloqueo-alert', `Día ${formatDate(fecha)} bloqueado.`, 'success');
    input.value = '';
    renderDiasBloqueados();
  } catch { showAlert('bloqueo-alert', 'Error al bloquear el día.'); }
}

async function desbloquearDia(fecha) {
  if (!confirm(`¿Desbloquear el ${formatDate(fecha)}?`)) return;
  try {
    const bloqueos = await loadBloqueos();
    bloqueos.diasBloqueados = bloqueos.diasBloqueados.filter(d => d !== fecha);
    await db.collection('config').doc('bloqueos').set(bloqueos);
    renderDiasBloqueados();
  } catch { showAlert('bloqueo-alert', 'Error al desbloquear.'); }
}

// ─── BLOQUEOS: Horarios específicos ───
function initHorariosBloqueadosSelect() {
  const select = document.getElementById('bloqueo-hora-select');
  select.innerHTML = '';
  generateTimeSlots(9, 20, 60).forEach(slot => {
    const opt = document.createElement('option');
    opt.value = slot;
    opt.textContent = slot;
    select.appendChild(opt);
  });
}

async function renderHorariosBloqueados(fecha) {
  if (!fecha) return;
  const container = document.getElementById('horarios-bloqueados-list');
  const bloqueos = await loadBloqueos();
  const horarios = [...(bloqueos.horariosBloqueados[fecha] || [])].sort();

  if (horarios.length === 0) {
    container.innerHTML = '<p class="text-muted">No hay horarios bloqueados ese día.</p>';
    return;
  }
  container.innerHTML = horarios.map(h => `
    <div class="bloqueo-item">
      <span>${h}</span>
      <button class="btn btn-sm btn-danger" onclick="desbloquearHorario('${fecha}','${h}')">Quitar</button>
    </div>`).join('');
}

async function bloquearHorario() {
  const fecha = document.getElementById('bloqueo-hora-fecha').value;
  const hora  = document.getElementById('bloqueo-hora-select').value;
  if (!fecha || !hora) { showAlert('bloqueo-alert', 'Seleccioná fecha y horario.'); return; }
  try {
    const bloqueos = await loadBloqueos();
    if (!bloqueos.horariosBloqueados[fecha]) bloqueos.horariosBloqueados[fecha] = [];
    if (bloqueos.horariosBloqueados[fecha].includes(hora)) {
      showAlert('bloqueo-alert', 'Ese horario ya está bloqueado.', 'warning'); return;
    }
    bloqueos.horariosBloqueados[fecha].push(hora);
    await db.collection('config').doc('bloqueos').set(bloqueos);
    showAlert('bloqueo-alert', `Horario ${hora} del ${formatDate(fecha)} bloqueado.`, 'success');
    renderHorariosBloqueados(fecha);
  } catch { showAlert('bloqueo-alert', 'Error al bloquear el horario.'); }
}

async function desbloquearHorario(fecha, hora) {
  try {
    const bloqueos = await loadBloqueos();
    bloqueos.horariosBloqueados[fecha] = (bloqueos.horariosBloqueados[fecha] || []).filter(h => h !== hora);
    await db.collection('config').doc('bloqueos').set(bloqueos);
    renderHorariosBloqueados(fecha);
  } catch { showAlert('bloqueo-alert', 'Error al desbloquear.'); }
}

// ─── SEED servicios iniciales ───
async function seedServices() {
  if (!confirm('¿Cargar todos los servicios iniciales? No se duplicarán los existentes.')) return;
  const services = [
    { nombre:"Vela Body", categoria:"corporal", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Inner", categoria:"corporal", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Body Sculpt", categoria:"corporal", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Criolipolisis", categoria:"corporal", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Radiofrecuencia Corporal", categoria:"corporal", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Cavitación + electrodos", categoria:"corporal", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Peptonas", categoria:"corporal", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Mesoterapia Corporal", categoria:"corporal", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Vela/Radio y meso", categoria:"corporal", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Hidrolip", categoria:"corporal", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Drenaje linfático", categoria:"corporal", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Drenaje completo", categoria:"corporal", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Maderoterapia cuerpo completo", categoria:"corporal", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Madero por zona", categoria:"corporal", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Body Up", categoria:"corporal", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Electrodos", categoria:"corporal", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Reflexología", categoria:"corporal", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Refle más ventosas", categoria:"corporal", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Masaje completo", categoria:"corporal", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Masaje por zona", categoria:"corporal", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Plasma para alopecia", categoria:"corporal", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Hifu Corporal", categoria:"corporal", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Hifu vaginal", categoria:"corporal", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Diagnóstico", categoria:"facial", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Limpieza facial", categoria:"facial", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Limpieza básica", categoria:"facial", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Dermaplaning", categoria:"facial", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Dermapen", categoria:"facial", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Radiofrecuencia Facial", categoria:"facial", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Inner ball", categoria:"facial", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Parches de colágeno", categoria:"facial", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Baby Lips", categoria:"facial", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Hydralips", categoria:"facial", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Hilos sólidos y líquidos", categoria:"facial", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Hilos nubes", categoria:"facial", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Baby Botox", categoria:"facial", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Baby Glow", categoria:"facial", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Peeling", categoria:"facial", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Plasma Facial", categoria:"facial", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Hydrapeel", categoria:"facial", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Mesoterapia Facial", categoria:"facial", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Mesoterapia y dermaplaning", categoria:"facial", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Hyaluron Pen", categoria:"facial", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Perfilado con hilo en cejas", categoria:"facial", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Perfilado con hilo en bozo y cejas", categoria:"facial", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Tintura + perfilado", categoria:"facial", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Laminado de cejas", categoria:"facial", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Henna en cejas", categoria:"facial", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Lifting de pestañas", categoria:"facial", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Exosoma", categoria:"facial", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Em face premium", categoria:"facial", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Em face", categoria:"facial", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Combos de lifting y laminado", categoria:"facial", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Lifting de pestañas y laminado", categoria:"facial", duracionMin:60, activo:true, precio:70000 },
    { nombre:"Mesoterapia capilar", categoria:"capilar", duracionMin:60, activo:true, precio:70000 },
  ];

  const btn = document.getElementById('btn-seed');
  if (btn) btn.disabled = true;
  const existing = new Set();
  const snap = await db.collection('services').get();
  snap.forEach(doc => existing.add(doc.data().nombre));

  let count = 0;
  const batch = db.batch();
  for (const svc of services) {
    if (!existing.has(svc.nombre)) { batch.set(db.collection('services').doc(), svc); count++; }
  }
  if (count > 0) { await batch.commit(); invalidateCachePrefix('services:'); alert(`Se cargaron ${count} servicios nuevos.`); }
  else { alert('Todos los servicios ya estaban cargados.'); }
  if (btn) btn.disabled = false;
  loadAllServices();
}

// ═══════════════════════════════════════════════════════════════════════════════
// PEDIDOS DE CREMAS
// ═══════════════════════════════════════════════════════════════════════════════

async function loadAllOrders(filtroEstado = 'todos') {
  const container = document.getElementById('admin-orders');
  if (!container) return;
  container.innerHTML = '<div class="loading-overlay"><div class="spinner"></div> Cargando...</div>';

  try {
    const snapshot = await db.collection('orders').orderBy('createdAt', 'desc').get();
    let pedidos = [];
    snapshot.forEach(doc => pedidos.push({ id: doc.id, ...doc.data() }));

    // Nunca mostrar pendiente_pago ni cancelados: salen del panel del admin
    pedidos = pedidos.filter(p => p.estado !== 'pendiente_pago' && p.estado !== 'cancelada');
    if (filtroEstado !== 'todos') pedidos = pedidos.filter(p => p.estado === filtroEstado);

    if (pedidos.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>No hay pedidos confirmados todavía.</p></div>';
      return;
    }

    let html = `
    <div class="table-responsive">
      <table>
        <thead><tr>
          <th>Fecha</th><th>Cliente</th><th>Producto</th>
          <th>Seña</th><th>Saldo</th><th>Estado</th><th>Acciones</th>
        </tr></thead><tbody>`;

    window._fichaData = window._fichaData || {};

    pedidos.forEach(p => {
      const fecha   = p.createdAt ? formatDateTime(p.createdAt) : '—';
      const saldo   = (p.precio || 0) - (p.senia || 0);
      const waPhone = formatWAPhone(p.telefonoUsuario || '');
      const waLink  = waPhone ? buildWAUrl(waPhone, buildPedidoReadyMessage(p)) : '';
      if (p.userId) {
        window._fichaData[p.userId] = {
          nombre:   p.nombreUsuario  || '',
          email:    p.emailUsuario   || '',
          telefono: p.telefonoUsuario || ''
        };
      }

      const clienteBtn = p.userId
        ? '<button class="btn-cliente" onclick="abrirFichaCliente(\'' + p.userId + '\')">' + escapeHtml(p.nombreUsuario || 'Sin nombre') + '</button>'
        : '<span>' + escapeHtml(p.nombreUsuario || 'Sin nombre') + '</span>';

      html += '<tr>' +
        '<td style="font-size:.82rem">' + fecha + '</td>' +
        '<td>' + clienteBtn + '<br><small class="text-muted">' + escapeHtml(p.emailUsuario || '') + '</small>' +
        (p.telefonoUsuario ? '<br><small class="text-muted">📱 ' + escapeHtml(p.telefonoUsuario) + '</small>' : '') + '</td>' +
        '<td><strong>' + escapeHtml(p.productoNombre) + '</strong></td>' +
        '<td>$' + (p.senia || 0).toLocaleString('es-AR') + '</td>' +
        '<td>$' + saldo.toLocaleString('es-AR') + '</td>' +
        '<td><span class="badge badge-' + p.estado + '">' + p.estado + '</span></td>' +
        '<td><div class="btn-group">' +
        (waLink ? '<a class="btn btn-sm btn-whatsapp" href="' + waLink + '" target="_blank" title="Avisar que el pedido está listo">📱 Avisar listo</a>' : '') +
        (p.estado === 'pendiente' ? '<button class="btn btn-sm btn-success" onclick="completeOrder(\'' + p.id + '\')">Entregado</button>' : '') +
        (p.estado !== 'cancelada' ? '<button class="btn btn-sm btn-danger" onclick="cancelOrderAdmin(\'' + p.id + '\')">Cancelar</button>' : '') +
        '</div></td></tr>';
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;
  } catch (err) {
    console.error('Error pedidos:', err);
    container.innerHTML = '<div class="alert alert-error">Error al cargar los pedidos.</div>';
  }
}

async function completeOrder(id) {
  if (!confirm('Marcar este pedido como entregado y cobrado?')) return;
  try {
    await db.collection('orders').doc(id).update({
      estado: 'completado',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    loadAllOrders(document.getElementById('filtro-estado-pedido').value);
  } catch (err) { alert('Error al actualizar el pedido.'); }
}

async function cancelOrderAdmin(id) {
  let pedido;
  try {
    const doc = await db.collection('orders').doc(id).get();
    if (!doc.exists) { alert('Pedido no encontrado.'); return; }
    pedido = doc.data();
  } catch (err) { alert('Error al obtener el pedido.'); return; }

  const tieneSenia = pedido.paymentId && pedido.paymentStatus === 'approved';
  if (tieneSenia) {
    const devolver = confirm('Esta clienta pago una sena de $' + (pedido.senia || 0).toLocaleString('es-AR') + '.\n\nQueres devolver la sena automaticamente?\n\nAceptar = devuelve por MP y cancela\nCancelar = solo cancela (devolucion manual)');
    if (devolver) { await procesarDevolucionOrder(id, pedido); return; }
  } else {
    if (!confirm('Cancelar este pedido?')) return;
  }
  await cancelarOrderEnFirestore(id);
}

async function procesarDevolucionOrder(id, pedido) {
  try {
    const mpDoc = await db.collection('config').doc('mp').get();
    if (!mpDoc.exists || !mpDoc.data().access_token) {
      alert('No se encontro la config de MP. Cancela el pedido y hace la devolucion manual.');
      return;
    }
    const access_token = mpDoc.data().access_token;
    const response = await fetch(
      'https://api.mercadopago.com/v1/payments/' + pedido.paymentId + '/refunds',
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + access_token }, body: '{}' }
    );
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const continuar = confirm('No se pudo devolver: ' + (errData.message || 'Error') + '.\nCancelar el pedido igual?');
      if (continuar) await cancelarOrderEnFirestore(id, { refundStatus: 'manual' });
      return;
    }
    const refund = await response.json();
    await cancelarOrderEnFirestore(id, { refundStatus: 'devuelta', refundId: String(refund.id || '') });
    alert('Sena devuelta. El dinero vuelve al medio de pago en 1-10 dias habiles.');
  } catch (err) {
    alert('Error al procesar la devolucion. Gestionala manualmente desde MP.');
  }
}

async function cancelarOrderEnFirestore(id, extra = {}) {
  try {
    const update = Object.assign({ estado: 'cancelada', updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, extra);
    await db.collection('orders').doc(id).update(update);
    const filtroEl = document.getElementById('filtro-estado-pedido');
    loadAllOrders(filtroEl ? filtroEl.value : 'todos');
  } catch (err) { alert('Error al cancelar el pedido.'); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GESTION DE PRODUCTOS (CREMAS)
// ═══════════════════════════════════════════════════════════════════════════════

async function loadAllProducts() {
  const container = document.getElementById('admin-products-list');
  if (!container) return;
  container.innerHTML = '<div class="loading-overlay"><div class="spinner"></div> Cargando...</div>';

  try {
    const snapshot = await db.collection('products').get();
    if (snapshot.empty) {
      container.innerHTML = '<div class="empty-state"><p>No hay productos. Usa el boton para cargar los iniciales.</p></div>';
      return;
    }
    // Ordenar client-side para evitar requerir índice compuesto en Firestore
    let prods = [];
    snapshot.forEach(doc => prods.push({ _id: doc.id, ...doc.data() }));
    prods.sort((a, b) => (a.categoria||'').localeCompare(b.categoria||'') || (a.nombre||'').localeCompare(b.nombre||''));

    let html = '<div class="table-responsive"><table><thead><tr><th>Nombre</th><th>Categoría</th><th>Tamaño</th><th>Precio</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>';
    prods.forEach(p => {
      const docId = p._id;
      html += '<tr>' +
        '<td><strong>' + escapeHtml(p.nombre) + '</strong></td>' +
        '<td>' + escapeHtml(p.categoria) + '</td>' +
        '<td>' + (p.ml ? p.ml + 'cc' : '—') + '</td>' +
        '<td>' + (p.precio ? '$' + p.precio.toLocaleString('es-AR') : '<span style="color:var(--color-warning)">Sin precio</span>') + '</td>' +
        '<td><span class="badge ' + (p.activo ? 'badge-confirmada' : 'badge-cancelada') + '">' + (p.activo ? 'Activo' : 'Inactivo') + '</span></td>' +
        '<td><div class="btn-group">' +
        '<button class="btn btn-sm btn-secondary" onclick="editProductModal(\'' + docId + '\')">Editar</button>' +
        '<button class="btn btn-sm btn-danger" onclick="deleteProduct(\'' + docId + '\')">Eliminar</button>' +
        '</div></td></tr>';
    });
    html += '</tbody></table></div>';
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = '<div class="alert alert-error">Error al cargar productos.</div>';
  }
}

function showProductModal(data, docId) {
  const isEdit = !!docId;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay active';
  const ingredientesStr = data && data.ingredientes ? data.ingredientes.join('\n') : '';
  overlay.innerHTML = '<div class="modal-box" style="max-width:480px">' +
    '<div class="modal-header"><h3>' + (isEdit ? 'Editar producto' : 'Nuevo producto') + '</h3>' +
    '<button class="modal-close" onclick="this.closest(\'.modal-overlay\').remove()">x</button></div>' +
    '<div id="product-modal-alert"></div>' +
    '<div class="form-group"><label>Nombre *</label><input class="form-control" id="prod-nombre" value="' + (data && data.nombre ? data.nombre : '') + '"></div>' +
    '<div class="form-group"><label>Descripcion</label><textarea class="form-control" id="prod-desc" rows="2">' + (data && data.descripcion ? data.descripcion : '') + '</textarea></div>' +
    '<div class="form-group"><label>Ingredientes (uno por linea)</label><textarea class="form-control" id="prod-ingredientes" rows="3">' + ingredientesStr + '</textarea></div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">' +
    '<div class="form-group"><label>Categoria</label><select class="form-control" id="prod-cat">' +
    '<option value="facial"' + (data && data.categoria === 'facial' ? ' selected' : '') + '>Facial</option>' +
    '<option value="corporal"' + (data && data.categoria === 'corporal' ? ' selected' : '') + '>Corporal</option>' +
    '</select></div>' +
    '<div class="form-group"><label>Tamano (cc)</label><input type="number" class="form-control" id="prod-ml" value="' + (data && data.ml ? data.ml : '') + '" placeholder="Ej: 60"></div></div>' +
    '<div class="form-group"><label>Precio (ARS) *</label><input type="number" class="form-control" id="prod-precio" value="' + (data && data.precio ? data.precio : '') + '" min="0" step="100" placeholder="Ej: 5000"></div>' +
    '<div class="form-group" style="display:flex;align-items:center;gap:.5rem">' +
    '<input type="checkbox" id="prod-activo"' + (data && data.activo !== false ? ' checked' : '') + '>' +
    '<label for="prod-activo" style="margin:0">Activo (visible en la tienda)</label></div>' +
    '<button class="btn btn-primary btn-block" id="prod-save-btn">' + (isEdit ? 'Guardar cambios' : 'Crear producto') + '</button></div>';
  document.body.appendChild(overlay);
  overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
  document.getElementById('prod-save-btn').addEventListener('click', async function() {
    const nombre = document.getElementById('prod-nombre').value.trim();
    const precioVal = document.getElementById('prod-precio').value;
    if (!nombre || !precioVal) { showAlert('product-modal-alert', 'Nombre y precio son obligatorios.'); return; }
    const mlVal = document.getElementById('prod-ml').value;
    const d = {
      nombre: nombre,
      descripcion: document.getElementById('prod-desc').value.trim(),
      ingredientes: document.getElementById('prod-ingredientes').value.split('\n').map(function(s) { return s.trim(); }).filter(Boolean),
      categoria: document.getElementById('prod-cat').value,
      ml: mlVal ? parseInt(mlVal) : null,
      precio: parseInt(precioVal),
      activo: document.getElementById('prod-activo').checked
    };
    try {
      if (isEdit) { await db.collection('products').doc(docId).update(d); }
      else { await db.collection('products').add(d); }
      invalidateCachePrefix('products:');
      overlay.remove();
      loadAllProducts();
    } catch (err) { showAlert('product-modal-alert', 'Error al guardar.'); }
  });
}

async function editProductModal(docId) {
  const doc = await db.collection('products').doc(docId).get();
  if (doc.exists) showProductModal(doc.data(), docId);
}

async function deleteProduct(docId) {
  if (!confirm('Eliminar este producto? Esta accion no se puede deshacer.')) return;
  try {
    await db.collection('products').doc(docId).delete();
    invalidateCachePrefix('products:');
    loadAllProducts();
  } catch (err) { alert('Error al eliminar el producto.'); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FICHA DE CLIENTE
// ═══════════════════════════════════════════════════════════════════════════════

async function abrirFichaCliente(userId) {
  const info = (window._fichaData || {})[userId] || {};
  const nombre   = info.nombre   || 'Sin nombre';
  const email    = info.email    || '';
  const telefono = info.telefono || '';

  // Quitar modal previo si existe
  const prev = document.getElementById('ficha-modal');
  if (prev) prev.remove();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay active';
  overlay.id = 'ficha-modal';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  const waPhone = formatWAPhone(telefono);
  const contactBtns = telefono ? `
    <div class="ficha-contacto">
      <a href="tel:${escapeHtml(telefono)}" class="btn btn-sm btn-secondary">📞 Llamar</a>
      <a href="${buildWAUrl(waPhone, 'Hola ' + nombre + '!')}" target="_blank" class="btn btn-sm btn-whatsapp">📱 WhatsApp</a>
    </div>` : '';

  overlay.innerHTML = `
    <div class="modal-box ficha-box">
      <div class="modal-header">
        <div>
          <h3 style="margin-bottom:.1rem">${escapeHtml(nombre)}</h3>
          <p style="font-size:.82rem;color:var(--color-text-muted);margin:0">${escapeHtml(email)}${telefono ? ' · 📱 ' + escapeHtml(telefono) : ''}</p>
        </div>
        <button class="modal-close" aria-label="Cerrar" onclick="document.getElementById('ficha-modal').remove()">✕</button>
      </div>
      ${contactBtns}
      <div id="ficha-body">
        <div style="padding:2rem;text-align:center"><div class="spinner" style="margin:0 auto"></div></div>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  const escHandler = e => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escHandler); } };
  document.addEventListener('keydown', escHandler);

  try {
    const [resSnap, ordSnap] = await Promise.all([
      db.collection('reservations').where('userId', '==', userId).get(),
      db.collection('orders').where('userId', '==', userId).get()
    ]);

    // Procesar reservas (excluir pendiente_pago)
    let reservas = [];
    resSnap.forEach(doc => {
      const r = { id: doc.id, ...doc.data() };
      if (r.estado !== 'pendiente_pago') reservas.push(r);
    });
    reservas.sort((a, b) => b.fecha.localeCompare(a.fecha) || b.hora.localeCompare(a.hora));

    // Procesar pedidos (excluir pendiente_pago)
    let pedidos = [];
    ordSnap.forEach(doc => {
      const p = { id: doc.id, ...doc.data() };
      if (p.estado !== 'pendiente_pago') pedidos.push(p);
    });
    pedidos.sort((a, b) => {
      const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
      const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
      return tb - ta;
    });

    // Stats
    const turnosRealizados = reservas.filter(r => r.estado === 'completado').length;
    const turnosFuturos    = reservas.filter(r => ['pendiente','confirmada'].includes(r.estado)).length;
    const totalSenias = [
      ...reservas.filter(r => r.paymentStatus === 'approved').map(r => r.senia || 0),
      ...pedidos.filter(p => p.paymentStatus === 'approved').map(p => p.senia || 0)
    ].reduce((s, v) => s + v, 0);

    let html = `
      <div class="ficha-stats">
        <div class="ficha-stat"><span>${turnosRealizados}</span><small>Turnos realizados</small></div>
        <div class="ficha-stat"><span>${turnosFuturos}</span><small>Turnos activos</small></div>
        <div class="ficha-stat"><span>$${totalSenias.toLocaleString('es-AR')}</span><small>Total en señas</small></div>
      </div>`;

    // Turnos
    html += '<h4 class="ficha-section-title">Turnos</h4>';
    if (reservas.length === 0) {
      html += '<p class="text-muted" style="font-size:.85rem;padding:.4rem 0 .8rem">Sin turnos registrados.</p>';
    } else {
      html += '<div class="ficha-historial">';
      reservas.forEach(r => {
        const lbl = { completado:'Realizado', cancelada:'Cancelado', confirmada:'Confirmado', pendiente:'Pendiente' }[r.estado] || r.estado;
        html += `
          <div class="ficha-item">
            <div class="ficha-item-info">
              <strong>${escapeHtml(r.servicioNombre)}</strong>
              <small class="text-muted">${formatDate(r.fecha)} · ${r.hora} hs</small>
            </div>
            <span class="badge badge-${r.estado}">${lbl}</span>
          </div>`;
      });
      html += '</div>';
    }

    // Pedidos de cremas
    if (pedidos.length > 0) {
      html += '<h4 class="ficha-section-title" style="margin-top:1.1rem">Cremas</h4>';
      html += '<div class="ficha-historial">';
      pedidos.forEach(p => {
        const lbl = { completado:'Entregado', cancelada:'Cancelado', pendiente:'En preparación' }[p.estado] || p.estado;
        html += `
          <div class="ficha-item">
            <div class="ficha-item-info">
              <strong>${escapeHtml(p.productoNombre)}</strong>
              <small class="text-muted">${formatDateTime(p.createdAt)}</small>
            </div>
            <span class="badge badge-${p.estado}">${lbl}</span>
          </div>`;
      });
      html += '</div>';
    }

    document.getElementById('ficha-body').innerHTML = html;
  } catch (err) {
    console.error('Error ficha cliente:', err);
    document.getElementById('ficha-body').innerHTML = '<p class="text-muted" style="padding:1rem">Error al cargar los datos.</p>';
  }
}
