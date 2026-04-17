/**
 * Nova Padel Center — Firebase Cloud Functions
 *
 * Funciones:
 *   createPayment  → Crea preferencia en Mercado Pago y reserva en Firestore
 *   mpWebhook      → Recibe notificación de MP y confirma la reserva al pagar
 *
 * Configuración necesaria (una sola vez):
 *   Crear el archivo functions/.env con:
 *     MP_ACCESS_TOKEN=TU_ACCESS_TOKEN
 *     MP_SANDBOX=true
 *     SITE_URL=https://lobosueltopr.github.io/NovaPadelCenter
 */

const functions = require('firebase-functions');
const admin     = require('firebase-admin');
const mp        = require('mercadopago');

admin.initializeApp();
const db = admin.firestore();

// ── Inicializar Mercado Pago ──────────────────────────────────────────────────
function initMP() {
  const token = process.env.MP_ACCESS_TOKEN || '';
  mp.configure({ access_token: token });
}

// ── Helper: obtener URL del sitio ─────────────────────────────────────────────
function getSiteUrl(requestedUrl) {
  const configured = process.env.SITE_URL || '';
  if (configured) return configured;
  return requestedUrl || 'https://lobosueltopr.github.io/NovaPadelCenter';
}

// ═══════════════════════════════════════════════════════════════════════════════
// createPayment — Callable desde el frontend
// Recibe: { servicioId, servicioNombre, fecha, hora, precioTotal, nombreUsuario, siteUrl }
// Devuelve: { init_point, reservaId }
// ═══════════════════════════════════════════════════════════════════════════════
exports.createPayment = functions.https.onCall(async (data, context) => {

  // 1. Verificar autenticación
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'Debés iniciar sesión para reservar.'
    );
  }

  const {
    servicioId, servicioNombre,
    fecha, hora,
    precioTotal, nombreUsuario,
    siteUrl
  } = data;

  // 2. Validar campos requeridos
  if (!servicioId || !fecha || !hora || !precioTotal) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Faltan datos para crear la reserva.'
    );
  }

  // 3. Verificar que el horario no esté ocupado (check atómico)
  const ocupados = await db.collection('reservations')
    .where('fecha', '==', fecha)
    .where('hora', '==', hora)
    .where('estado', 'in', ['pendiente_pago', 'pendiente', 'confirmada'])
    .get();

  if (!ocupados.empty) {
    throw new functions.https.HttpsError(
      'already-exists',
      'Ese horario ya no está disponible. Por favor elegí otro.'
    );
  }

  // 4. Calcular seña (10%)
  const senia = Math.round(precioTotal * 0.10);

  // 5. Crear reserva en Firestore con estado "pendiente_pago"
  //    Expira en 30 minutos si no se paga
  const expiraAt = new Date(Date.now() + 30 * 60 * 1000);

  const reservaRef = await db.collection('reservations').add({
    userId:        context.auth.uid,
    nombreUsuario: nombreUsuario || '',
    emailUsuario:  context.auth.token.email || '',
    servicioId,
    servicioNombre,
    fecha,
    hora,
    estado:        'pendiente_pago',
    precioTotal,
    senia,
    expiraAt,
    paymentId:     null,
    createdAt:     admin.firestore.FieldValue.serverTimestamp(),
    updatedAt:     admin.firestore.FieldValue.serverTimestamp()
  });

  // 6. Crear preferencia en Mercado Pago
  initMP();

  const baseUrl = getSiteUrl(siteUrl);

  const preferenceData = {
    items: [{
      title:       `Seña — ${servicioNombre}`,
      quantity:    1,
      unit_price:  senia,
      currency_id: 'ARS'
    }],
    payer: {
      name:  nombreUsuario || '',
      email: context.auth.token.email || ''
    },
    payment_methods: {
    excluded_payment_types: [],
    excluded_payment_methods: [],
    installments: 12
    },
    external_reference: reservaRef.id,
    back_urls: {
      success: `${baseUrl}/pago-exitoso.html`,
      failure: `${baseUrl}/nueva-reserva.html?error=pago_fallido`,
      pending: `${baseUrl}/pago-exitoso.html?pending=1`
    },
    auto_return: 'approved',
    notification_url:
      `https://us-central1-${process.env.GCLOUD_PROJECT}.cloudfunctions.net/mpWebhook`,
    statement_descriptor: 'WANDA CUADRADO',
    expires: true,
    expiration_date_to: expiraAt.toISOString()
  };

  let preference;
  try {
    preference = await mp.preferences.create(preferenceData);
  } catch (err) {
    // Si MP falla, eliminar la reserva creada para no dejar el slot bloqueado
    await reservaRef.delete();
    console.error('Error MP:', err);
    throw new functions.https.HttpsError(
      'internal',
      'Error al conectar con Mercado Pago. Intentá de nuevo.'
    );
  }

  const isSandbox = process.env.MP_SANDBOX === 'true';

  return {
    init_point:         isSandbox
      ? preference.body.sandbox_init_point
      : preference.body.init_point,
    reservaId: reservaRef.id
  };
});

// ═══════════════════════════════════════════════════════════════════════════════
// mpWebhook — HTTP endpoint que llama Mercado Pago cuando hay un pago
// ═══════════════════════════════════════════════════════════════════════════════
exports.mpWebhook = functions.https.onRequest(async (req, res) => {
  // MP requiere respuesta 200 siempre para no reintentar
  try {
    const { type, data } = req.body || {};

    if (type === 'payment' && data?.id) {
      initMP();

      // Verificar el pago directamente con la API de MP
      const payment = await mp.payment.get(data.id);
      const pago    = payment.body;

      console.log(`Webhook pago ${data.id}: status=${pago.status}`);

      const reservaId = pago.external_reference;
      if (!reservaId) { res.sendStatus(200); return; }

      if (pago.status === 'approved') {
        // Pago aprobado → activar reserva
        await db.collection('reservations').doc(reservaId).update({
          estado:        'pendiente',
          paymentId:     String(data.id),
          paymentStatus: 'approved',
          updatedAt:     admin.firestore.FieldValue.serverTimestamp()
        });
        console.log(`Reserva ${reservaId} confirmada por pago.`);

      } else if (['cancelled', 'rejected', 'refunded', 'charged_back'].includes(pago.status)) {
        // Pago fallido/cancelado → liberar el slot
        await db.collection('reservations').doc(reservaId).update({
          estado:        'cancelada',
          paymentId:     String(data.id),
          paymentStatus: pago.status,
          updatedAt:     admin.firestore.FieldValue.serverTimestamp()
        });
        console.log(`Reserva ${reservaId} cancelada (pago ${pago.status}).`);
      }
    }
  } catch (err) {
    console.error('Error en webhook:', err);
  }

  res.sendStatus(200);
});

// ═══════════════════════════════════════════════════════════════════════════════
// cleanupExpiredReservations — Se ejecuta cada 30 min para limpiar reservas
// que iniciaron el pago pero nunca pagaron
// ═══════════════════════════════════════════════════════════════════════════════
exports.cleanupExpiredReservations = functions.pubsub
  .schedule('every 30 minutes')
  .onRun(async () => {
    const now = new Date();
    const snap = await db.collection('reservations')
      .where('estado', '==', 'pendiente_pago')
      .where('expiraAt', '<=', now)
      .get();

    if (snap.empty) return null;

    const batch = db.batch();
    snap.forEach(doc => {
      batch.update(doc.ref, {
        estado:    'cancelada',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });

    await batch.commit();
    console.log(`Limpieza: ${snap.size} reservas vencidas canceladas.`);
    return null;
  });
