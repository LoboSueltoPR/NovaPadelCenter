/* ============================================================
   Autenticación — Registro, Login, Recuperación de contraseña
   ============================================================ */

// ─── Registro de nuevo usuario ───
async function handleRegister(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;

  const nombre = document.getElementById('reg-nombre').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const telefono = document.getElementById('reg-telefono').value.trim();
  const password = document.getElementById('reg-password').value;
  const password2 = document.getElementById('reg-password2').value;

  // Validaciones
  if (!nombre || !email || !telefono || !password) {
    showAlert('auth-alert', 'Completá todos los campos, incluyendo el teléfono.');
    btn.disabled = false;
    return;
  }

  if (password.length < 6) {
    showAlert('auth-alert', 'La contraseña debe tener al menos 6 caracteres.');
    btn.disabled = false;
    return;
  }

  if (password !== password2) {
    showAlert('auth-alert', 'Las contraseñas no coinciden.');
    btn.disabled = false;
    return;
  }

  // ── Paso 1: Crear usuario en Firebase Auth ──
  let cred;
  try {
    cred = await auth.createUserWithEmailAndPassword(email, password);
    await cred.user.updateProfile({ displayName: nombre });
  } catch (err) {
    let msg = 'Error al registrarse.';
    if (err.code === 'auth/email-already-in-use') msg = 'Este email ya está registrado.';
    if (err.code === 'auth/invalid-email') msg = 'El email no es válido.';
    if (err.code === 'auth/weak-password') msg = 'La contraseña es muy débil.';
    showAlert('auth-alert', msg);
    btn.disabled = false;
    return;
  }

  // ── Paso 2: Crear documento en Firestore ──
  try {
    await db.collection('users').doc(cred.user.uid).set({
      uid: cred.user.uid,
      nombre: nombre,
      email: email,
      telefono: telefono || '',
      rol: 'cliente',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    // Éxito — redirigir
    window.location.href = 'dashboard.html';
  } catch (err) {
    // Mostrar error EN PANTALLA para diagnóstico
    showAlert('auth-alert', 'Auth OK pero Firestore falló: [' + err.code + '] ' + err.message, 'warning');
    btn.disabled = false;
  }
}

// ─── Inicio de sesión ───
async function handleLogin(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;

  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  if (!email || !password) {
    showAlert('auth-alert', 'Completá email y contraseña.');
    btn.disabled = false;
    return;
  }

  try {
    await auth.signInWithEmailAndPassword(email, password);
    window.location.href = 'dashboard.html';
  } catch (err) {
    let msg = 'Error al iniciar sesión.';
    if (err.code === 'auth/user-not-found') msg = 'No existe una cuenta con ese email.';
    if (err.code === 'auth/wrong-password') msg = 'Contraseña incorrecta.';
    if (err.code === 'auth/invalid-email') msg = 'El email no es válido.';
    if (err.code === 'auth/too-many-requests') msg = 'Demasiados intentos. Esperá un momento.';
    showAlert('auth-alert', msg);
    btn.disabled = false;
  }
}

// ─── Recuperar contraseña ───
async function handleForgotPassword(e) {
  e.preventDefault();
  const email = document.getElementById('forgot-email').value.trim();

  if (!email) {
    showAlert('auth-alert', 'Ingresá tu email.');
    return;
  }

  try {
    await auth.sendPasswordResetEmail(email);
    showAlert('auth-alert', 'Te enviamos un email para restablecer tu contraseña. Revisá tu bandeja de entrada.', 'success');
  } catch (err) {
    let msg = 'Error al enviar el email.';
    if (err.code === 'auth/user-not-found') msg = 'No existe una cuenta con ese email.';
    showAlert('auth-alert', msg);
  }
}
