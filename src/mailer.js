// mailer.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'Gmail',
  auth: {
    user: 'scanmed21@gmail.com',
    pass: 'wvhtsikesgrnmakn', // Contraseña de aplicación
  },
  tls: {
    rejectUnauthorized: false, // Aceptar certificados autofirmados
  },
  logger: true, // Opcional: habilita el registro detallado
  debug: true,  // Opcional: habilita la depuración
});


module.exports = transporter;
