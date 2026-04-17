/* ============================================================
   Reservas — CRUD de turnos
   ============================================================ */

// ─── Cargar servicios activos en un <select> (con cache local) ───
async function loadServicesSelect(selectId) {
  const select = document.getElementById(selectId);
  if (!select) return;

  select.innerHTML = '<option value="">Seleccioná un servicio...</option>';

  // Lectura cacheada con TTL — reduce hits a Firestore
  const servicios = await cachedFetch('services:activos', CACHE_TTL.SERVICES, async () => {
    const snap = await db.collection('services').where('activo', '==', true).get();
    const arr = [];
    snap.forEach(doc => arr.push({ id: doc.id, ...doc.data() }));
    arr.sort((a, b) =>
      (a.categoria || '').localeCompare(b.categoria || '') ||
      (a.nombre || '').localeCompare(b.nombre || '')
    );
    return arr;
  });

  let currentCat = '';
  let optgroup = null;

  servicios.forEach(s => {
    if (s.categoria !== currentCat) {
      currentCat = s.categoria;
      optgroup = document.createElement('optgroup');
      optgroup.label = currentCat.charAt(0).toUpperCase() + currentCat.slice(1);
      select.appendChild(optgroup);
    }
    const option = document.createElement('option');
    option.value = s.id;
    option.textContent = `${s.nombre} (${s.duracionMin} min)`;
    option.dataset.nombre = s.nombre;
    option.dataset.duracion = s.duracionMin;
    option.dataset.precio = s.precio || 0;
    (optgroup || select).appendChild(option);
  });
}

// ─── Renderizar horarios disponibles (3 canchas por slot) ───
async function renderTimeSlots(containerId, fecha, excludeReservationId = null) {
  const container = document.getElementById(containerId);
  if (!container || !fecha) return;

  container.innerHTML = '<div class="loading-overlay"><div class="spinner"></div> Cargando horarios...</div>';

  const allSlots = generateTimeSlots(9, 20, 60);
  const info     = await getSlotInfo(fecha, excludeReservationId);

  container.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'time-slots';

  allSlots.forEach(slot => {
    const div = document.createElement('div');
    div.className = 'time-slot';
    const count = info.slotCounts.get(slot) || 0;

    const label = document.createElement('span');
    label.textContent = slot;
    div.appendChild(label);

    const countEl = document.createElement('span');
    countEl.className = 'time-slot-count';
    countEl.textContent = `${count}/${CANCHAS_TOTAL} canchas`;
    div.appendChild(countEl);

    if (info.occupied.has(slot)) {
      div.classList.add('occupied');
      div.title = 'Horario completo o bloqueado';
    } else {
      if (count > 0 && count < CANCHAS_TOTAL) div.classList.add('partial');
      div.addEventListener('click', () => {
        container.querySelectorAll('.time-slot.selected').forEach(s => s.classList.remove('selected'));
        div.classList.add('selected');
        const hiddenInput = document.getElementById('selected-time');
        if (hiddenInput) hiddenInput.value = slot;
      });
    }

    grid.appendChild(div);
  });

  container.appendChild(grid);
}

// ─── Crear nueva reserva ───
async function handleCreateReservation(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;

  const servicioSelect = document.getElementById('reserva-servicio');
  const fecha = document.getElementById('reserva-fecha').value;
  const hora = document.getElementById('selected-time').value;

  if (!servicioSelect.value || !fecha || !hora) {
    showAlert('reserva-alert', 'Completá todos los campos y seleccioná un horario.');
    btn.disabled = false;
    return;
  }

  // Verificar disponibilidad de cancha (3 por horario)
  const info = await getSlotInfo(fecha);
  if (info.occupied.has(hora)) {
    showAlert('reserva-alert', 'Horario completo (3 canchas ocupadas). Elegí otro.');
    btn.disabled = false;
    renderTimeSlots('time-slots-container', fecha);
    return;
  }
  const canchaAsignada = pickCanchaLibre(info.canchasUsadas, hora);
  if (!canchaAsignada) {
    showAlert('reserva-alert', 'Horario completo (3 canchas ocupadas). Elegí otro.');
    btn.disabled = false;
    renderTimeSlots('time-slots-container', fecha);
    return;
  }

  const user = auth.currentUser;
  const selectedOption = servicioSelect.options[servicioSelect.selectedIndex];

  try {
    await db.collection('reservations').add({
      userId: user.uid,
      nombreUsuario: user.displayName || '',
      emailUsuario: user.email,
      servicioId: servicioSelect.value,
      servicioNombre: selectedOption.dataset.nombre,
      fecha: fecha,
      hora: hora,
      cancha: canchaAsignada,
      estado: 'pendiente',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    showAlert('reserva-alert', 'Reserva creada con éxito.', 'success');
    setTimeout(() => {
      window.location.href = 'mis-reservas.html';
    }, 1500);
  } catch (err) {
    console.error('Error al crear reserva:', err);
    showAlert('reserva-alert', 'Error al crear la reserva. Intentá de nuevo.');
    btn.disabled = false;
  }
}

// ─── Cargar mis reservas activas (solo próximas, no historial) ───
async function loadMyReservations(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const user = auth.currentUser;
  if (!user) return;

  container.innerHTML = '<div class="loading-overlay"><div class="spinner"></div> Cargando reservas...</div>';

  try {
    const today = getTodayStr();
    const snapshot = await db.collection('reservations')
      .where('userId', '==', user.uid)
      .get();

    // Filtrar y ordenar client-side para evitar índices compuestos
    const now = new Date();
    let reservas = [];
    snapshot.forEach(doc => {
      const r = { id: doc.id, ...doc.data() };
      if (r.fecha < today) return; // pasadas no

      if (r.estado === 'pendiente_pago') {
        // Incluir solo si no venció aún
        const exp = r.expiraAt;
        const expDate = exp ? (exp.toDate ? exp.toDate() : new Date(exp)) : null;
        if (expDate && expDate > now) reservas.push(r);
        return;
      }

      if (r.estado === 'pendiente' || r.estado === 'confirmada') {
        reservas.push(r);
      }
    });
    reservas.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.hora.localeCompare(b.hora));

    if (reservas.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <span class="empty-state-icon" aria-hidden="true">🎾</span>
          <p>No tenés reservas de cancha próximas.<br>¡Reservá una cuando quieras!</p>
          <a href="nueva-reserva.html" class="btn btn-primary">Reservar cancha</a>
        </div>`;
      return;
    }

    let html = `
    <div class="table-responsive">
      <table>
        <thead>
          <tr>
            <th>Servicio</th>
            <th>Fecha</th>
            <th>Hora</th>
            <th>Cancha</th>
            <th>Estado</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>`;

    reservas.forEach(r => {
      const canchaTxt = r.cancha ? `Cancha ${r.cancha}` : '—';
      if (r.estado === 'pendiente_pago') {
        const exp = r.expiraAt;
        const expDate = exp ? (exp.toDate ? exp.toDate() : new Date(exp)) : null;
        const minsLeft = expDate ? Math.max(0, Math.ceil((expDate - now) / 60000)) : 0;
        const initPoint = r.initPoint || '';
        html += `
          <tr style="background:#F5F5F5">
            <td>${escapeHtml(r.servicioNombre)}</td>
            <td>${formatDate(r.fecha)}</td>
            <td>${r.hora}</td>
            <td>${canchaTxt}</td>
            <td>
              <span class="badge" style="background:var(--color-warning);color:#fff">Pago pendiente</span>
              <br><small style="color:var(--color-text-muted);font-size:.75rem">Expira en ${minsLeft} min</small>
            </td>
            <td>
              <button class="btn btn-sm btn-mp" onclick="continuarPagoReserva('${r.id}','${initPoint}')">
                Continuar pago
              </button>
            </td>
          </tr>`;
      } else {
        html += `
          <tr>
            <td>${escapeHtml(r.servicioNombre)}</td>
            <td>${formatDate(r.fecha)}</td>
            <td>${r.hora}</td>
            <td><strong>${canchaTxt}</strong></td>
            <td><span class="badge badge-${r.estado}">${r.estado}</span></td>
            <td>
              <div class="btn-group">
                <a href="editar-reserva.html?id=${r.id}" class="btn btn-sm btn-secondary">Editar</a>
                <button class="btn btn-sm btn-danger" onclick="cancelReservation('${r.id}')">Cancelar</button>
              </div>
            </td>
          </tr>`;
      }
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;
  } catch (err) {
    console.error('Error al cargar reservas:', err);
    container.innerHTML = '<div class="alert alert-error">Error al cargar las reservas.</div>';
  }
}

// ─── Historial completo de tratamientos (pasados, cancelados, etc) ───
async function loadTreatmentHistory(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const user = auth.currentUser;
  if (!user) return;

  const today = getTodayStr();

  try {
    const snapshot = await db.collection('reservations')
      .where('userId', '==', user.uid)
      .get();

    // Historial = turnos pasados (ya realizados) — sin canceladas
    let items = [];
    snapshot.forEach(doc => {
      const r = doc.data();
      if (r.estado === 'pendiente_pago') return;
      if (r.estado === 'cancelada') return; // no mostrar canceladas en perfil
      if (r.fecha < today) {
        items.push({ id: doc.id, ...r });
      }
    });

    items.sort((a, b) => b.fecha.localeCompare(a.fecha) || b.hora.localeCompare(a.hora));

    if (items.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <span class="empty-state-icon" aria-hidden="true">🏆</span>
          <p>Todavía no tenés historial de partidos.<br>Después de tu primera reserva va a aparecer acá.</p>
        </div>`;
      return;
    }

    let html = '<div class="historial-grid">';
    items.forEach(r => {
      const estadoLabel = 'Realizado';
      const canchaTxt = r.cancha ? ` · Cancha ${r.cancha}` : '';
      html += `
        <div class="historial-item">
          <div class="historial-fecha">${formatDate(r.fecha)} · ${r.hora} hs${canchaTxt}</div>
          <div class="historial-servicio">${escapeHtml(r.servicioNombre)}</div>
          <div class="historial-meta">
            <span class="badge badge-${r.estado}">${estadoLabel}</span>
            ${r.precioTotal ? `<span class="historial-precio">$${r.precioTotal.toLocaleString('es-AR')}</span>` : ''}
          </div>
        </div>`;
    });
    html += '</div>';
    container.innerHTML = html;

  } catch (err) {
    console.warn('Error al cargar historial:', err.message);
    container.innerHTML = '<div class="alert alert-error">Error al cargar el historial.</div>';
  }
}

// ─── Historial de pedidos de cremas (completados + cancelados) ───
async function loadOrderHistory(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const user = auth.currentUser;
  if (!user) return;

  try {
    const snapshot = await db.collection('orders')
      .where('userId', '==', user.uid)
      .get();

    let items = [];
    snapshot.forEach(doc => {
      const p = doc.data();
      if (p.estado === 'pendiente_pago') return;
      // Historial: solo los entregados (no mostrar cancelados)
      if (p.estado === 'completado') {
        items.push({ id: doc.id, ...p });
      }
    });

    // Ordenar por createdAt desc
    items.sort((a, b) => {
      const ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
      const tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
      return tb - ta;
    });

    if (items.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <span class="empty-state-icon" aria-hidden="true">🎾</span>
          <p>Todavía no hiciste ningún pedido del catálogo.<br>¡Mirá los productos disponibles!</p>
          <a href="mis-cremas.html" class="btn btn-primary">Ver catálogo</a>
        </div>`;
      return;
    }

    let html = '<div class="historial-grid">';
    items.forEach(p => {
      const fecha = p.createdAt ? formatDateTime(p.createdAt) : '—';
      const estadoLabel = 'Entregado';
      html += `
        <div class="historial-item">
          <div class="historial-fecha">${fecha}</div>
          <div class="historial-servicio">${escapeHtml(p.productoNombre)}</div>
          <div class="historial-meta">
            <span class="badge badge-${p.estado}">${estadoLabel}</span>
            ${p.precio ? `<span class="historial-precio">$${p.precio.toLocaleString('es-AR')}</span>` : ''}
          </div>
        </div>`;
    });
    html += '</div>';
    container.innerHTML = html;

  } catch (err) {
    console.warn('Error al cargar historial de pedidos:', err.message);
    container.innerHTML = '<div class="alert alert-error">Error al cargar el historial.</div>';
  }
}

// ─── Pedidos de cremas activos (con seña pagada, no entregados) ───
async function loadMyActiveOrders(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const user = auth.currentUser;
  if (!user) return;

  try {
    const snapshot = await db.collection('orders')
      .where('userId', '==', user.uid)
      .get();

    const now = new Date();
    let items = [];
    snapshot.forEach(doc => {
      const p = { id: doc.id, ...doc.data() };
      if (p.estado === 'pendiente') {
        items.push(p);
      } else if (p.estado === 'pendiente_pago') {
        // Incluir solo si no venció aún
        const exp = p.expiraAt;
        const expDate = exp ? (exp.toDate ? exp.toDate() : new Date(exp)) : null;
        if (expDate && expDate > now) items.push(p);
      }
    });

    items.sort((a, b) => {
      const ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
      const tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
      return tb - ta;
    });

    if (items.length === 0) {
      container.innerHTML = '<p class="text-muted" style="padding:.5rem 0;font-size:.9rem">No tenés pedidos en preparación.</p>';
      return;
    }

    let html = '<div class="historial-grid">';
    items.forEach(p => {
      const saldo = (p.precio || 0) - (p.senia || 0);
      if (p.estado === 'pendiente_pago') {
        const exp = p.expiraAt;
        const expDate = exp ? (exp.toDate ? exp.toDate() : new Date(exp)) : null;
        const minsLeft = expDate ? Math.max(0, Math.ceil((expDate - now) / 60000)) : 0;
        const initPoint = p.initPoint || '';
        html += `
          <div class="historial-item" style="border-left:3px solid var(--color-warning)">
            <div class="historial-fecha">${formatDateTime(p.createdAt)}</div>
            <div class="historial-servicio">${escapeHtml(p.productoNombre)}</div>
            <div class="historial-meta">
              <span class="badge" style="background:var(--color-warning);color:#fff">Pago pendiente</span>
              <small style="color:var(--color-text-muted);font-size:.75rem">Expira en ${minsLeft} min</small>
            </div>
            <div style="margin-top:.6rem">
              <button class="btn btn-sm btn-mp" onclick="continuarPagoOrden('${p.id}','${initPoint}')">
                Continuar pago
              </button>
            </div>
          </div>`;
      } else {
        html += `
          <div class="historial-item">
            <div class="historial-fecha">${formatDateTime(p.createdAt)}</div>
            <div class="historial-servicio">${escapeHtml(p.productoNombre)}</div>
            <div class="historial-meta">
              <span class="badge badge-pendiente">En preparación</span>
              <span class="historial-precio">Saldo: $${saldo.toLocaleString('es-AR')}</span>
            </div>
          </div>`;
      }
    });
    html += '</div>';
    container.innerHTML = html;
  } catch (err) {
    console.warn('Error al cargar pedidos activos:', err.message);
  }
}

// ─── Cancelar reserva ───
async function cancelReservation(reservationId) {
  if (!confirm('¿Estás segura de que querés cancelar esta reserva?')) return;

  try {
    await db.collection('reservations').doc(reservationId).update({
      estado: 'cancelada',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    // Recargar lista
    loadMyReservations('reservations-list');
    showAlert('reserva-alert', 'Reserva cancelada.', 'warning');
  } catch (err) {
    console.error('Error al cancelar:', err);
    showAlert('reserva-alert', 'Error al cancelar la reserva.');
  }
}

// ─── Cargar datos de reserva para edición ───
async function loadReservationForEdit(reservationId) {
  try {
    const doc = await db.collection('reservations').doc(reservationId).get();
    if (!doc.exists) {
      showAlert('reserva-alert', 'Reserva no encontrada.');
      return null;
    }

    const data = doc.data();
    const user = auth.currentUser;

    // Verificar que sea del usuario
    if (data.userId !== user.uid) {
      showAlert('reserva-alert', 'No tenés permiso para editar esta reserva.');
      return null;
    }

    if (data.estado === 'cancelada') {
      showAlert('reserva-alert', 'No se puede editar una reserva cancelada.');
      return null;
    }

    return { id: doc.id, ...data };
  } catch (err) {
    console.error('Error al cargar reserva:', err);
    showAlert('reserva-alert', 'Error al cargar la reserva.');
    return null;
  }
}

// ─── Guardar edición de reserva ───
async function handleEditReservation(e, reservationId) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;

  const servicioSelect = document.getElementById('reserva-servicio');
  const fecha = document.getElementById('reserva-fecha').value;
  const hora = document.getElementById('selected-time').value;

  if (!servicioSelect.value || !fecha || !hora) {
    showAlert('reserva-alert', 'Completá todos los campos y seleccioná un horario.');
    btn.disabled = false;
    return;
  }

  // Verificar disponibilidad (excluyendo la reserva actual)
  const info = await getSlotInfo(fecha, reservationId);
  if (info.occupied.has(hora)) {
    showAlert('reserva-alert', 'Horario completo (3 canchas ocupadas). Elegí otro.');
    btn.disabled = false;
    renderTimeSlots('time-slots-container', fecha, reservationId);
    return;
  }

  // Cargar reserva actual para ver si cambió el horario/fecha
  let canchaAsignada = null;
  try {
    const curDoc = await db.collection('reservations').doc(reservationId).get();
    const cur = curDoc.exists ? curDoc.data() : {};
    if (cur.fecha === fecha && cur.hora === hora && cur.cancha) {
      canchaAsignada = cur.cancha; // mantener cancha
    } else {
      canchaAsignada = pickCanchaLibre(info.canchasUsadas, hora);
      if (!canchaAsignada) {
        showAlert('reserva-alert', 'Horario completo (3 canchas ocupadas). Elegí otro.');
        btn.disabled = false;
        renderTimeSlots('time-slots-container', fecha, reservationId);
        return;
      }
    }
  } catch (err) {
    console.error('Error al leer reserva actual:', err);
  }

  const selectedOption = servicioSelect.options[servicioSelect.selectedIndex];

  try {
    await db.collection('reservations').doc(reservationId).update({
      servicioId: servicioSelect.value,
      servicioNombre: selectedOption.dataset.nombre,
      fecha: fecha,
      hora: hora,
      cancha: canchaAsignada,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    showAlert('reserva-alert', 'Reserva actualizada con éxito.', 'success');
    setTimeout(() => {
      window.location.href = 'mis-reservas.html';
    }, 1500);
  } catch (err) {
    console.error('Error al editar reserva:', err);
    showAlert('reserva-alert', 'Error al actualizar la reserva.');
    btn.disabled = false;
  }
}

// ─── Reanudar pago de reserva pendiente ───
function continuarPagoReserva(reservaId, initPoint) {
  if (initPoint) {
    window.location.href = initPoint;
  } else {
    showAlert('reserva-alert', 'No se encontró el link de pago. Cancelá la reserva y volvé a crearla.', 'error');
  }
}

// ─── Reanudar pago de pedido de crema pendiente ───
function continuarPagoOrden(pedidoId, initPoint) {
  if (initPoint) {
    window.location.href = initPoint;
  } else {
    alert('No se encontró el link de pago. Por favor volvé a encargar el producto.');
  }
}
