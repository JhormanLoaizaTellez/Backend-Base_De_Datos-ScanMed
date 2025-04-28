// recordatorios.js
const cron = require('node-cron');
const transporter = require('./mailer');
const pool = require('./database');


console.log('recordatorios.js cargado correctamente');



// Función para enviar el correo de recordatorio
// Función para enviar el correo de recordatorio (actualizada)
async function enviarRecordatorio(cita) {
  const fechaCita = new Date(cita.Fecha_Hora);
  
  const mailOptions = {
    from: 'scanmed21@gmail.com',
    to: cita.correo,
    subject: 'Recordatorio de Cita Médica',
    text: `Hola ${cita.paciente},\n\nEste es un recordatorio de su cita médica programada para el ${fechaCita.toLocaleString()}.\n\nSaludos,\nEquipo Médico`,
  };

  try {
    // Enviar el correo
    const info = await transporter.sendMail(mailOptions);
    console.log(`Correo enviado a ${cita.correo}: ${info.response}`);
    
    // Marcar como enviado en la base de datos
    await pool.query(
      'UPDATE Citas SET recordatorio_enviado = TRUE WHERE ID_CITA = ?',
      [cita.ID_CITA]
    );
    
  } catch (error) {
    console.error(`Error al enviar el correo a ${cita.correo}:`, error);
  }
}

// Tarea programada (actualizada)
cron.schedule('* * * * *', async () => {
  console.log('Verificando citas para enviar recordatorios...');
  const ahora = new Date();

  // Rangos de tiempo (24h ±5min y catch-up)
  const fecha24HorasInicio = new Date(ahora.getTime() + 24 * 60 * 60 * 1000 - 5 * 60 * 1000);
  const fecha24HorasFin = new Date(ahora.getTime() + 24 * 60 * 60 * 1000 + 5 * 60 * 1000);
  const fechaCatchUpInicio = new Date(ahora.getTime() + 1 * 60 * 60 * 1000);
  const fechaCatchUpFin = new Date(ahora.getTime() + 24 * 60 * 60 * 1000);

  try {
    // Consulta que EXCLUYE citas ya recordadas
    const [citas] = await pool.query(`
      SELECT 
        c.ID_CITA, 
        CONCAT(u_p.Primer_Nombre, ' ', u_p.Primer_Apellido) AS paciente,
        u_p.Correo_Electronico AS correo,
        c.Fecha_Hora
      FROM Citas c
      JOIN Pacientes p ON c.ID_PACIENTE = p.ID_PACIENTE
      JOIN Usuarios u_p ON p.ID_USUARIO = u_p.ID_USUARIO
      WHERE (
        (c.Fecha_Hora BETWEEN ? AND ?) OR
        (c.Fecha_Hora BETWEEN ? AND ?)
      )
      AND c.ID_ESTADO IN (1,2)
      AND c.recordatorio_enviado = FALSE  -- Solo citas no recordadas
    `, [
      fecha24HorasInicio, fecha24HorasFin,
      fechaCatchUpInicio, fechaCatchUpFin
    ]);

    console.log(`Citas a recordar: ${citas.length}`);
    
    // Enviar recordatorios en paralelo
    await Promise.all(citas.map(enviarRecordatorio));

  } catch (error) {
    console.error('Error al verificar citas:', error);
  }
});

