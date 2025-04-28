const transporter = require('./mailer');

const mailOptions = {
  from: 'scanmed21@gmail.com',
  to: 'andreysteven12@gmail.com',
  subject: 'Prueba de envío de correo',
  text: 'Este es un correo de prueba enviado desde Nodemailer.',
};

transporter.sendMail(mailOptions, (error, info) => {
  if (error) {
    return console.log(`Error al enviar el correo: ${error}`);
  }
  console.log(`Correo enviado: ${info.response}`);
});
