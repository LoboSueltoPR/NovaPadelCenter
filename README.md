# Estética Agus — Sistema de Reservas Web

Sistema web de reservas para un centro de estética y bienestar, desarrollado con HTML/CSS/JS puro y Firebase.

## Funcionalidades

- **Autenticación**: registro, login, recuperación de contraseña (Firebase Auth)
- **Reservas**: crear, ver, editar y cancelar turnos
- **Servicios**: catálogo completo de tratamientos faciales, corporales y capilares
- **Panel de usuario**: dashboard con próximas reservas y datos personales
- **Panel admin**: gestión de reservas, servicios y configuración de disponibilidad
- **Buscador de tratamientos**: búsqueda por nombre y filtro por categoría
- **Responsive**: diseño adaptado a celular y PC

## Tecnologías

- HTML5, CSS3, JavaScript (vanilla)
- Firebase Authentication
- Cloud Firestore
- Firebase Hosting (opcional)

## Estructura del proyecto

```
EsteticaAgus/
├── public/                   # Archivos del sitio web
│   ├── index.html            # Home
│   ├── login.html            # Inicio de sesión
│   ├── register.html         # Registro
│   ├── dashboard.html        # Panel del usuario
│   ├── nueva-reserva.html    # Crear reserva
│   ├── mis-reservas.html     # Listar reservas propias
│   ├── editar-reserva.html   # Editar reserva existente
│   ├── tratamientos.html     # Info y búsqueda de tratamientos
│   ├── admin.html            # Panel de administración
│   ├── css/
│   │   └── styles.css        # Estilos globales
│   ├── js/
│   │   ├── firebase-config.js  # Configuración de Firebase
│   │   ├── auth.js             # Lógica de autenticación
│   │   ├── utils.js            # Utilidades compartidas
│   │   ├── reservas.js         # CRUD de reservas
│   │   └── admin.js            # Lógica del panel admin
│   └── img/                  # Imágenes (opcional)
├── firestore.rules           # Reglas de seguridad de Firestore
├── firebase.json             # Configuración de Firebase Hosting
├── .env.example              # Ejemplo de variables de entorno
├── .gitignore
└── README.md
```

## Instalación y configuración

### 1. Crear proyecto en Firebase

1. Ir a [Firebase Console](https://console.firebase.google.com/)
2. Crear un nuevo proyecto
3. Activar **Authentication** → método "Email/Password"
4. Activar **Cloud Firestore** → empezar en modo test (luego aplicar reglas)
5. Ir a **Project Settings** → agregar una app web → copiar la configuración

### 2. Configurar credenciales

Editar el archivo `public/js/firebase-config.js` y reemplazar los valores de `firebaseConfig`:

```javascript
const firebaseConfig = {
  apiKey: "TU_API_KEY",
  authDomain: "TU_PROYECTO.firebaseapp.com",
  projectId: "TU_PROYECTO",
  storageBucket: "TU_PROYECTO.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};
```

### 3. Aplicar reglas de seguridad

En Firebase Console → Firestore → Rules, copiar el contenido de `firestore.rules`.

### 4. Crear índices en Firestore

Firestore requiere índices compuestos para ciertas consultas. Al usar la app, Firebase te mostrará errores en la consola del navegador con links para crear los índices automáticamente. Los índices necesarios son:

| Colección    | Campos                                   |
|-------------|------------------------------------------|
| reservations | `fecha` ASC, `estado` IN, `hora` ASC     |
| reservations | `userId` ASC, `fecha` DESC, `hora` DESC  |
| reservations | `userId` ASC, `fecha` ASC, `estado` IN, `hora` ASC |
| services     | `activo` ASC, `categoria` ASC, `nombre` ASC |
| services     | `categoria` ASC, `nombre` ASC            |

### 5. Cargar servicios iniciales

1. Registrar un usuario en la app
2. En Firestore Console, ir a la colección `users` → buscar tu usuario → cambiar el campo `rol` de `"cliente"` a `"admin"`
3. Refrescar la app → ahora verás el menú "Admin"
4. En Admin → Servicios → click en **"Cargar servicios iniciales"**

### 6. Desplegar (opcional)

#### Firebase Hosting

```bash
npm install -g firebase-tools
firebase login
firebase init hosting    # seleccionar "public" como directorio
firebase deploy
```

#### Alternativa: cualquier hosting estático

Simplemente subir el contenido de la carpeta `public/` a cualquier hosting estático (Netlify, Vercel, GitHub Pages, etc).

## Colecciones en Firestore

### `users`
```json
{
  "uid": "abc123",
  "nombre": "María García",
  "email": "maria@email.com",
  "telefono": "11-1234-5678",
  "rol": "cliente",
  "createdAt": "timestamp"
}
```

### `services`
```json
{
  "nombre": "Limpieza facial",
  "categoria": "facial",
  "duracionMin": 60,
  "activo": true
}
```

### `reservations`
```json
{
  "userId": "abc123",
  "nombreUsuario": "María García",
  "emailUsuario": "maria@email.com",
  "servicioId": "svc456",
  "servicioNombre": "Limpieza facial",
  "fecha": "2026-04-15",
  "hora": "10:00",
  "estado": "pendiente",
  "createdAt": "timestamp",
  "updatedAt": "timestamp"
}
```

### `config`
```json
{
  "horaInicio": 9,
  "horaFin": 20,
  "intervaloMin": 60,
  "updatedAt": "timestamp"
}
```

## Reglas de seguridad

- **Usuarios**: solo pueden leer/editar su propio perfil. Admins pueden leer todos.
- **Servicios**: lectura pública. Solo admins pueden crear/editar/eliminar.
- **Reservas**: cada cliente ve y edita solo sus reservas. Admins ven y editan todas.
- **Config**: lectura pública, escritura solo admins.

## Próximos pasos

- [ ] Recordatorio por WhatsApp 24hs antes de la reserva (Firebase Cloud Functions + API de WhatsApp)
- [ ] Bloqueo de días completos (feriados, vacaciones)
- [ ] Descripciones detalladas de cada tratamiento
- [ ] Galería de imágenes
- [ ] Sistema de valoraciones y comentarios
- [ ] Notificaciones push
