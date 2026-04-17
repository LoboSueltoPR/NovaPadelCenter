/* ============================================================
   Tienda — Catálogo Nova Padel Center
   ============================================================ */

// ─── Cargar y renderizar productos (con cache local) ───
async function loadProductos(containerId, categoriaFiltro = 'todos') {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '<div class="loading-overlay"><div class="spinner"></div> Cargando productos...</div>';

  try {
    // Lectura cacheada: primero localStorage (TTL 15min), si expira va a Firestore
    let productos = await cachedFetch('products:activos', CACHE_TTL.PRODUCTS, async () => {
      const snap = await db.collection('products').where('activo', '==', true).get();
      const arr = [];
      snap.forEach(doc => arr.push({ id: doc.id, ...doc.data() }));
      // Orden client-side (evita índice compuesto)
      arr.sort((a, b) =>
        (a.categoria || '').localeCompare(b.categoria || '') ||
        (a.nombre || '').localeCompare(b.nombre || '')
      );
      return arr;
    });

    if (!productos || productos.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <span class="empty-state-icon" aria-hidden="true">🧴</span>
          <p>No hay cremas disponibles en este momento.<br>¡Volvé pronto!</p>
        </div>`;
      return;
    }

    if (categoriaFiltro !== 'todos') productos = productos.filter(p => p.categoria === categoriaFiltro);

    if (productos.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <span class="empty-state-icon" aria-hidden="true">🔍</span>
          <p>No hay cremas en esta categoría.</p>
        </div>`;
      return;
    }

    container.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'productos-grid';

    productos.forEach(p => {
      const tienePrecio  = p.precio && p.precio > 0;
      const ingredientes = Array.isArray(p.ingredientes) ? p.ingredientes : [];
      const card         = document.createElement('div');
      card.className     = 'producto-card';

      card.innerHTML = `
        <div class="producto-img">🧴</div>
        <div class="producto-body">
          <div class="producto-cat">${escapeHtml(p.categoria)}</div>
          <h3 class="producto-nombre">${escapeHtml(p.nombre)}</h3>
          ${p.ml ? `<span class="producto-ml">${p.ml}cc</span>` : ''}
          ${p.descripcion ? `<p class="producto-desc">${escapeHtml(p.descripcion)}</p>` : ''}
          ${ingredientes.length ? `
            <ul class="ingredientes-list">
              ${ingredientes.map(i => `<li>${escapeHtml(i)}</li>`).join('')}
            </ul>` : ''}
          <div class="producto-footer">
            ${tienePrecio
              ? `<span class="producto-precio">$${p.precio.toLocaleString('es-AR')}</span>
                 <button class="btn btn-primary btn-sm"
                   onclick="abrirModalPedido('${p.id}','${p.nombre.replace(/'/g,"\\'")}',${p.precio})">
                   Encargar
                 </button>`
              : `<span class="producto-sin-precio">Consultá precio</span>
                 <a href="https://wa.me/5492914362710" target="_blank" class="btn btn-secondary btn-sm">Consultar</a>`
            }
          </div>
        </div>`;
      grid.appendChild(card);
    });

    container.appendChild(grid);
  } catch (err) {
    console.error('Error productos:', err);
    container.innerHTML = '<div class="alert alert-error">Error al cargar los productos.</div>';
  }
}

// ─── Modal de pedido ───
function abrirModalPedido(productoId, productoNombre, precio) {
  if (!auth.currentUser) {
    window.location.href = 'login.html';
    return;
  }
  const senia = Math.round(precio * 0.10);
  document.getElementById('modal-nombre').textContent   = productoNombre;
  document.getElementById('modal-precio').textContent   = `$${precio.toLocaleString('es-AR')}`;
  document.getElementById('modal-senia').textContent    = `$${senia.toLocaleString('es-AR')}`;
  document.getElementById('modal-saldo').textContent    = `$${(precio - senia).toLocaleString('es-AR')}`;
  const btn = document.getElementById('modal-btn-pagar');
  btn.dataset.productoId = productoId;
  btn.dataset.nombre     = productoNombre;
  btn.dataset.precio     = precio;
  btn.disabled           = false;
  btn.textContent        = 'Pagar seña con Mercado Pago';
  document.getElementById('pedido-modal').classList.add('active');
  document.getElementById('pedido-alert').innerHTML = '';
}

function cerrarModal() {
  document.getElementById('pedido-modal').classList.remove('active');
}

// ─── Procesar pedido + pago MP ───
async function procesarPedido() {
  const btn            = document.getElementById('modal-btn-pagar');
  const productoId     = btn.dataset.productoId;
  const productoNombre = btn.dataset.nombre;
  const precio         = parseInt(btn.dataset.precio, 10);
  const user           = auth.currentUser;

  if (!user || !productoId || !precio) return;

  btn.disabled    = true;
  btn.textContent = 'Procesando...';

  try {
    // Leer token MP
    const mpDoc = await db.collection('config').doc('mp').get();
    if (!mpDoc.exists || !mpDoc.data().access_token) {
      showAlert('pedido-alert', 'Los pagos aún no están configurados. Contactá al local.');
      btn.disabled = false; btn.textContent = 'Pagar seña con Mercado Pago';
      return;
    }
    const { access_token, sandbox } = mpDoc.data();

    // Teléfono del usuario
    let telefonoUsuario = '';
    try {
      const uDoc = await db.collection('users').doc(user.uid).get();
      if (uDoc.exists) telefonoUsuario = uDoc.data().telefono || '';
    } catch (e) {}

    const senia    = Math.round(precio * 0.10);
    const expiraAt = new Date(Date.now() + 10 * 60 * 1000);

    // Crear pedido en Firestore
    const pedidoRef = await db.collection('orders').add({
      userId:          user.uid,
      nombreUsuario:   user.displayName || '',
      emailUsuario:    user.email,
      telefonoUsuario: telefonoUsuario,
      productoId,
      productoNombre,
      precio,
      senia,
      estado:          'pendiente_pago',
      paymentId:       null,
      paymentStatus:   null,
      expiraAt,
      createdAt:       firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt:       firebase.firestore.FieldValue.serverTimestamp()
    });

    // Crear preferencia MP
    const base = window.location.href.replace('mis-cremas.html', '').replace(/\?.*$/, '');
    const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${access_token}` },
      body: JSON.stringify({
        items: [{ title: `Seña — ${productoNombre}`, quantity: 1, unit_price: senia, currency_id: 'ARS' }],
        payer: { email: user.email },
        external_reference: pedidoRef.id,
        back_urls: {
          success: `${base}pago-pedido-exitoso.html`,
          failure: `${base}mis-cremas.html?error=pago_fallido`,
          pending: `${base}pago-pedido-exitoso.html?pending=1`
        },
        auto_return: 'approved',
        statement_descriptor: 'WANDA CUADRADO'
      })
    });

    if (!mpRes.ok) { await pedidoRef.delete(); throw new Error('Error al conectar con Mercado Pago.'); }

    const pref      = await mpRes.json();
    const initPoint = sandbox ? pref.sandbox_init_point : pref.init_point;

    // Guardar initPoint para poder reanudar si se cierra la ventana
    await pedidoRef.update({ initPoint });

    window.location.href = initPoint;

  } catch (err) {
    console.error('Error pedido:', err);
    showAlert('pedido-alert', err.message || 'Error al iniciar el pago. Intentá de nuevo.');
    btn.disabled = false; btn.textContent = 'Pagar seña con Mercado Pago';
  }
}

// ─── Seed productos iniciales ───
async function seedProductos() {
  if (!confirm('¿Cargar los productos iniciales? No se duplicarán los existentes.')) return;
  const btn = document.getElementById('btn-seed-productos');
  if (btn) btn.disabled = true;

  const lista = [
    { nombre:'Crema Tensora',             descripcion:'Crema facial tensora de textura cremosa.',                          ingredientes:['Peptonas de Colágeno','Peptonas de Elastina','Hialurónico al 1%','Argireline'],                               ml:60,  categoria:'facial',   precio:0, activo:true },
    { nombre:'Crema Tensora Gel',         descripcion:'Crema tensora en formato gel, textura ultra ligera.',               ingredientes:['Peptonas de Colágeno','Peptonas de Elastina','Hialurónico al 1%','Argireline'],                               ml:60,  categoria:'facial',   precio:0, activo:true },
    { nombre:'Gloss Hidratante',          descripcion:'Gloss labial hidratante artesanal con activos premium.',            ingredientes:['Glicerina','Hidrolizado de Colágeno','Hialurónico al 1%','Rosa Mosqueta'],                                     ml:null,categoria:'facial',   precio:0, activo:true },
    { nombre:'Sérum Contorno de Ojos',   descripcion:'Sérum específico para el área del contorno de ojos.',             ingredientes:['AO3','Peptonas de Colágeno','Peptonas de Elastina','Hialurónico 1%','Argireline'],                              ml:30,  categoria:'facial',   precio:0, activo:true },
    { nombre:'Gel Revitalizante',         descripcion:'Gel revitalizante facial de textura fresca y ligera.',              ingredientes:['Peptonas de Piel','Argireline','Hialurónico 1%'],                                                              ml:60,  categoria:'facial',   precio:0, activo:true },
    { nombre:'Brumas Faciales',           descripcion:'Brumas en 4 variedades: hidratante, tensora, piel mixta y efecto hidratante. Indicá tu variedad preferida al encargar.',ingredientes:['Loción Hidratante','Loción Tensora','Loción Piel Mixta','Efecto Hidratante'],ml:null,categoria:'facial',   precio:0, activo:true },
    { nombre:'Crema Hidratante Corporal', descripcion:'Crema hidratante para todo el cuerpo.',                             ingredientes:['Peptonas de Piel','Vitamina C','Aceite de Almendra'],                                                          ml:125, categoria:'corporal', precio:0, activo:true },
    { nombre:'Crema Hidratante Manos y Pies',descripcion:'Crema hidratante especial para manos y pies.',                  ingredientes:['Peptonas de Piel','Vitamina C','Aceite de Almendra'],                                                          ml:125, categoria:'corporal', precio:0, activo:true },
    { nombre:'Crema Antiestrias',         descripcion:'Crema preventiva y correctora de estrías.',                         ingredientes:['Peptonas de Piel','Peptonas de Elastina','Centella'],                                                          ml:125, categoria:'corporal', precio:0, activo:true },
    { nombre:'Crema Reductora',           descripcion:'Crema reductora para celulitis y estrías.',                         ingredientes:['Peptonas de Colágeno','L-Carnitina','Centella'],                                                               ml:125, categoria:'corporal', precio:0, activo:true }
  ];

  const existing = new Set();
  const snap = await db.collection('products').get();
  snap.forEach(doc => existing.add(doc.data().nombre));

  let count = 0;
  const batch = db.batch();
  for (const p of lista) {
    if (!existing.has(p.nombre)) { batch.set(db.collection('products').doc(), p); count++; }
  }
  if (count > 0) { await batch.commit(); invalidateCachePrefix('products:'); alert(`Se cargaron ${count} productos.`); if (typeof loadAllProducts === 'function') loadAllProducts(); }
  else { alert('Todos los productos ya estaban cargados.'); }
  if (btn) btn.disabled = false;
}
