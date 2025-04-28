const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
require("dotenv").config();
require('./recordatorios');  // Asegúrate de usar la ruta correcta

const app = express();
const PORT = process.env.PORT || 4000;



// Configuración mejorada de CORS
app.use(cors({
  origin: "http://localhost:5173",
  credentials: true
}));

app.use(morgan("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuración de la base de datos con manejo de errores
const dbConfig = {
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_DATABASE || "scanmed",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

const pool = mysql.createPool(dbConfig);

// Verificar conexión a la base de datos al iniciar
pool.getConnection()
  .then(conn => {
    console.log("Conexión a MySQL establecida correctamente");
    conn.release();
  })
  .catch(err => {
    console.error("Error al conectar a MySQL:", err);
    process.exit(1);
  });

// Rutas mejoradas con mejor manejo de errores

// Obtener tipos de documento
app.get("/api/documentos", async (req, res) => {
  try {
    const [documentos] = await pool.query("SELECT * FROM DocumentoIdentidad");
    if (!documentos || documentos.length === 0) {
      return res.status(404).json({ success: false, message: "No se encontraron tipos de documento" });
    }
    res.json({ success: true, data: documentos });
  } catch (error) {
    console.error("Error en /api/documentos:", error);
    res.status(500).json({ 
      success: false, 
      message: "Error al obtener documentos",
      error: error.message 
    });
  }
});

// Obtener departamentos por país
app.get("/api/departamentos/:paisId", async (req, res) => {
  try {
    const { paisId } = req.params;
    const [departamentos] = await pool.query(
      "SELECT * FROM Departamento WHERE ID_PAIS = ?", 
      [paisId]
    );
    
    if (!departamentos || departamentos.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: "No se encontraron departamentos para este país" 
      });
    }
    
    res.json({ success: true, data: departamentos });
  } catch (error) {
    console.error("Error en /api/departamentos:", error);
    res.status(500).json({ 
      success: false, 
      message: "Error al obtener departamentos",
      error: error.message 
    });
  }
});

// Obtener ciudades por departamento
app.get("/api/ciudades/:departamentoId", async (req, res) => {
  try {
    const { departamentoId } = req.params;
    const [ciudades] = await pool.query(
      "SELECT * FROM Ciudad WHERE ID_DEPARTAMENTO = ?", 
      [departamentoId]
    );
    
    if (!ciudades || ciudades.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: "No se encontraron ciudades para este departamento" 
      });
    }
    
    res.json({ success: true, data: ciudades });
  } catch (error) {
    console.error("Error en /api/ciudades:", error);
    res.status(500).json({ 
      success: false, 
      message: "Error al obtener ciudades",
      error: error.message 
    });
  }
});

// Registro de usuario
app.post("/api/registro", async (req, res) => {
  try {
    const {
      primer_nombre, segundo_nombre, primer_apellido, segundo_apellido,
      edad, fecha_nacimiento, tipo_documento, numero_documento,
      id_ciudad, direccion, telefono, correo, contrasena
    } = req.body;

    // Validación de campos obligatorios
    const requiredFields = [
      "primer_nombre", "primer_apellido", "numero_documento", 
      "correo", "contrasena", "tipo_documento", "id_ciudad"
    ];

    const missingFields = requiredFields.filter(field => !req.body[field]);

    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Faltan campos obligatorios: ${missingFields.join(", ")}`
      });
    }

    // Verificar si el usuario ya existe
    const [userExists] = await pool.query(
      "SELECT ID_USUARIO FROM Usuarios WHERE Correo_Electronico = ? OR Num_Documento = ?",
      [correo, numero_documento]
    );

   // En tu ruta de registro (/api/registro)
if (userExists.length > 0) {
  return res.status(400).json({
    success: false,
    message: "El correo o documento ya están registrados",
    userExists: true // Añade esta propiedad para identificar este caso específico
  });
}

    // Encriptar la contraseña
    const hashedPassword = await bcrypt.hash(contrasena, 10);

    // Insertar usuario en la base de datos
    const [userResult] = await pool.query(
      `INSERT INTO Usuarios (
        ID_CIUDAD, ID_DOCUMENTOIDENTIDAD, Primer_Nombre, Segundo_Nombre,
        Primer_Apellido, Segundo_Apellido, Edad, Telefono, Contrasena,
        Correo_Electronico, Tipo_Usuario, Direccion, Num_Documento
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id_ciudad, tipo_documento, primer_nombre, segundo_nombre,
        primer_apellido, segundo_apellido, edad || null, telefono || null,
        hashedPassword, correo, "PACIENTE", direccion || null, numero_documento
      ]
    );

    // Verificar si la inserción fue exitosa
    if (userResult.affectedRows === 0) {
      throw new Error("No se pudo registrar el usuario");
    }

    const userId = userResult.insertId;

    // Si tiene fecha de nacimiento, insertar en Pacientes
    if (fecha_nacimiento) {
      await pool.query(
        `INSERT INTO Pacientes (ID_USUARIO, Fecha_Nacimiento) VALUES (?, ?)`,
        [userId, fecha_nacimiento]
      );
    }

    res.status(201).json({
      success: true,
      message: "Registro exitoso"
    });

  } catch (error) {
    console.error("Error en /api/registro:", error);
    res.status(500).json({
      success: false,
      message: "Error en el servidor al registrar usuario",
      error: error.message
    });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { correo, contrasena } = req.body;

    if (!correo || !contrasena) {
      return res.status(400).json({ success: false, message: "Todos los campos son obligatorios." });
    }

    const [users] = await pool.query("SELECT * FROM Usuarios WHERE Correo_Electronico = ?", [correo]);

    if (users.length === 0) {
      return res.status(401).json({ success: false, message: "Usuario no encontrado." });
    }

    const usuario = users[0];

    const match = await bcrypt.compare(contrasena, usuario.Contrasena);

    if (!match) {
      return res.status(401).json({ success: false, message: "Contraseña incorrecta." });
    }

    // Verifica si el usuario es médico
    const [medicoResult] = await pool.query(
      "SELECT * FROM Medicos WHERE ID_USUARIO = ?",
      [usuario.ID_USUARIO]
    );

    const esMedico = medicoResult.length > 0;

    const token = jwt.sign(
      { id: usuario.ID_USUARIO, correo: usuario.Correo_Electronico, rol: esMedico ? "MEDICO" : "PACIENTE" },
      'secreto',
      { expiresIn: '1h' }
    );

    const { Contrasena, ...userSinPass } = usuario;
    res.status(200).json({
      success: true,
      token,
      usuario: userSinPass,      // <— aquí
      userId: usuario.ID_USUARIO,
      role: esMedico ? "MEDICO" : "PACIENTE"
    });
  } catch (error) {
    console.error("Error en /api/login:", error);
    res.status(500).json({ success: false, message: "Error en el servidor", error: error.message });
  }
});

// Obtener todos los servicios disponibles 
app.get("/api/servicios", async (req, res) => {
  let connection;
  try {
  connection = await pool.getConnection();
  await connection.beginTransaction();
    
    // Verificar conexión a la base de datos
    await connection.ping();
    console.log("✅ Conexión a MySQL verificada");
    
    // Consulta con manejo explícito de errores
    const [servicios] = await connection.query(`
      SELECT ID_SERVICIO as id, Nombre as nombre 
      FROM Servicios 
      ORDER BY Nombre
    `);
    
    console.log(`📊 Resultados encontrados: ${servicios.length}`);
    
    if (!servicios || servicios.length === 0) {
      console.warn("⚠️ No se encontraron servicios en la base de datos");
      return res.status(404).json({ 
        success: false, 
        message: "No se encontraron servicios disponibles",
        details: "La tabla Servicios está vacía"
      });
    }
    
    console.log("✅ Servicios obtenidos correctamente");
    res.json({ 
      success: true, 
      data: servicios,
      message: "Servicios obtenidos correctamente"
    });
  } catch (error) {
    console.error("❌ Error en /api/servicios:", {
      message: error.message,
      sqlMessage: error.sqlMessage,
      stack: error.stack
    });
    
    res.status(500).json({ 
      success: false, 
      message: "Error interno al obtener servicios",
      error: error.message,
      sqlError: error.sqlMessage || "N/A"
    });
  } finally {
    if (connection) {
      console.log("🔌 Liberando conexión a la base de datos");
      connection.release();
    }
  }
});
// Obtener médicos por servicio (versión mejorada)
app.get("/api/medicos/servicio/:idServicio", async (req, res) => {
  let connection;
  try {
    const { idServicio } = req.params;
    
    if (!idServicio || isNaN(idServicio)) {
      return res.status(400).json({ 
        success: false, 
        message: "ID de servicio no válido" 
      });
    }
    
    connection = await pool.getConnection();
    const [medicos] = await connection.query(`
      SELECT 
        m.ID_MEDICO, 
        u.Primer_Nombre, 
        u.Segundo_Nombre,
        u.Primer_Apellido, 
        u.Segundo_Apellido,
        s.Nombre as Especialidad
      FROM Medicos m
      JOIN Usuarios u ON m.ID_USUARIO = u.ID_USUARIO
      JOIN Servicios s ON m.ID_SERVICIO = s.ID_SERVICIO
      WHERE m.ID_SERVICIO = ?
      ORDER BY u.Primer_Apellido, u.Primer_Nombre
    `, [idServicio]);
    
    if (medicos.length === 0) {
      return res.status(200).json({ 
        success: true, 
        data: [],
        message: "No hay médicos disponibles para este servicio en este momento" 
      });
    }
    
    res.json({ 
      success: true, 
      data: medicos,
      message: "Médicos obtenidos correctamente"
    });
  } catch (error) {
    console.error("Error en /api/medicos/servicio:", error);
    res.status(500).json({ 
      success: false, 
      message: "Error interno al obtener médicos",
      error: error.message 
    });
  } finally {
    if (connection) connection.release();
  }
});
// Obtener disponibilidad de un médico
app.get("/api/disponibilidad/:idMedico", async (req, res) => {
  try {
    const { idMedico } = req.params;
    
    // Validar ID
    if (!idMedico || isNaN(idMedico)) {
      return res.status(400).json({ 
        success: false, 
        message: "ID de médico no válido" 
      });
    }

    // Obtener citas existentes del médico
    const [citas] = await pool.query(`
      SELECT Fecha_Hora 
      FROM Citas 
      WHERE ID_MEDICO = ? 
      AND ID_ESTADO IN (1, 2) /* Programada o Confirmada */
      AND DATE(Fecha_Hora) >= CURDATE()
    `, [idMedico]);

    // Generar disponibilidad para las próximas 2 semanas
    const disponibilidad = generarDisponibilidad(citas);
    
    res.json({ 
      success: true, 
      data: disponibilidad,
      message: "Disponibilidad obtenida correctamente"
    });
  } catch (error) {
    console.error("Error en /api/disponibilidad:", error);
    res.status(500).json({ 
      success: false, 
      message: "Error al obtener disponibilidad",
      error: error.message 
    });
  }
});

// Función para generar horarios disponibles
// Función para generar horarios disponibles (versión corregida)
function generarDisponibilidad(citasExistentes) {
  const diasLaborales = [1, 2, 3, 4, 5]; // Lunes(1) a Viernes(5)
  const horarios = [];
  const hoy = new Date();
  
  // Ajustar hora local sin tiempo (para comparación exacta)
  hoy.setHours(0, 0, 0, 0);
  
  // Convertir citas existentes a formato comparable (manejo de zona horaria)
  const citasOcupadas = citasExistentes.map(c => {
    const fecha = new Date(c.Fecha_Hora);
    // Ajustar a fecha local sin zona horaria
    const fechaLocal = new Date(fecha.getTime() - fecha.getTimezoneOffset() * 60000);
    return {
      fecha: fechaLocal.toISOString().split('T')[0],
      hora: fechaLocal.getHours().toString().padStart(2, '0') + ':00'
    };
  });

  // Generar disponibilidad para los próximos 14 días (incluyendo hoy si es día laboral)
  for (let i = 0; i < 14; i++) {
    const fecha = new Date(hoy);
    fecha.setDate(hoy.getDate() + i);
    
    if (diasLaborales.includes(fecha.getDay())) {
      const fechaStr = fecha.toISOString().split('T')[0];
      
      // Horario de mañana (7-11)
      for (let h = 7; h < 12; h++) {
        const horaActual = new Date(fecha);
        horaActual.setHours(h, 0, 0, 0);
        
        // Solo agregar horarios futuros (incluyendo el momento actual)
        if (horaActual >= new Date()) {
          const horaStr = h.toString().padStart(2, '0') + ':00';
          
          if (!citasOcupadas.some(c => c.fecha === fechaStr && c.hora === horaStr)) {
            horarios.push({
              fecha: fechaStr,
              hora: horaStr,
              disponible: true
            });
          }
        }
      }
      
      // Horario de tarde (14-17)
      for (let h = 14; h < 18; h++) {
        const horaActual = new Date(fecha);
        horaActual.setHours(h, 0, 0, 0);
        
        if (horaActual >= new Date()) {
          const horaStr = h.toString().padStart(2, '0') + ':00';
          
          if (!citasOcupadas.some(c => c.fecha === fechaStr && c.hora === horaStr)) {
            horarios.push({
              fecha: fechaStr,
              hora: horaStr,
              disponible: true
            });
          }
        }
      }
    }
  }
  
  return horarios;
}

// Crear nueva cita
// Crear nueva cita - Versión corregida
app.post("/api/citas", async (req, res) => {
  let connection;
  try {
    const { 
      nombre, apellidos, documento, correo,
      servicioId, doctorId, fecha, hora
    } = req.body;

    // Validaciones
    if (!nombre || !apellidos || !documento || !correo || 
        !servicioId || !doctorId || !fecha || !hora) {
      return res.status(400).json({ 
        success: false, 
        message: "Todos los campos son obligatorios" 
      });
    }

// Formatear hora con seguridad
let [h, m] = hora.split(':');
h = h.padStart(2, '0');
m = (m || '00').padStart(2, '0');
const horaFormateada = `${h}:${m}`;

const fechaSolo = fecha.split(' ')[0];


const fechaHoraStr = `${fechaSolo} ${horaFormateada}:00`;


    connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      // 1. Verificar que el usuario existe
      const [usuario] = await connection.query(
        `SELECT ID_USUARIO FROM Usuarios WHERE Num_Documento = ? LIMIT 1`,
        [documento]
      );
  
      if (usuario.length === 0) {
        return res.status(404).json({ 
          success: false, 
          message: "Usuario no registrado. Por favor complete su registro primero."
        });
      }
  
      // 2. Verificar que el correo coincide con el usuario
      const [usuarioCorreo] = await connection.query(
        `SELECT ID_USUARIO FROM Usuarios WHERE Num_Documento = ? AND Correo_Electronico = ? LIMIT 1`,
        [documento, correo]
      );
  
      if (usuarioCorreo.length === 0) {
        return res.status(400).json({ 
          success: false, 
          message: "El correo no coincide con el usuario registrado."
        });
      }

      // 3. Buscar o crear registro en Pacientes
      const [paciente] = await connection.query(
        `SELECT ID_PACIENTE FROM Pacientes WHERE ID_USUARIO = ? LIMIT 1`,
        [usuario[0].ID_USUARIO]
      );
  
      let idPaciente;
      if (paciente.length > 0) {
        idPaciente = paciente[0].ID_PACIENTE;
      } else {
        // Solo crea el registro en Pacientes (no en Usuarios)
        const [nuevoPaciente] = await connection.query(
          `INSERT INTO Pacientes (ID_USUARIO) VALUES (?)`,
          [usuario[0].ID_USUARIO]
        );
        idPaciente = nuevoPaciente.insertId;
      }

      // 4. Verificar disponibilidad del horario
      const [citaExistente] = await connection.query(
        `SELECT ID_CITA FROM Citas 
         WHERE ID_MEDICO = ? 
         AND Fecha_Hora = ?
         AND ID_ESTADO IN (1, 2)
         LIMIT 1`,
        [doctorId, fechaHoraStr]
      );

      if (citaExistente.length > 0) {
        throw new Error("El horario seleccionado ya está reservado");
      }

      // 5. Crear la cita
      const [nuevaCita] = await connection.query(
        `INSERT INTO Citas (
          ID_ESTADO, ID_PACIENTE, ID_MEDICO, ID_ASISTENCIA, Fecha_Hora
        ) VALUES (?, ?, ?, ?, ?)`,
        [2, idPaciente, doctorId, 1, fechaHoraStr]
      );

      // 6. Crear registro en Historial_Consultas
      await connection.query(
        `INSERT INTO Historial_Consultas (
          ID_PACIENTE, ID_MEDICO, ID_CITA, Diagnostico
        ) VALUES (?, ?, ?, ?)`,
        [idPaciente, doctorId, nuevaCita.insertId, "Cita programada - Pendiente de atención"]
      );

      // Obtener detalles para la respuesta
      const [medico] = await connection.query(
        `SELECT u.Primer_Nombre, u.Primer_Apellido 
         FROM Medicos m
         JOIN Usuarios u ON m.ID_USUARIO = u.ID_USUARIO
         WHERE m.ID_MEDICO = ?`,
        [doctorId]
      );

      const [servicio] = await connection.query(
        `SELECT Nombre FROM Servicios WHERE ID_SERVICIO = ?`,
        [servicioId]
      );

      await connection.commit();

      return res.json({ 
        success: true, 
        message: "Cita reservada exitosamente",
        data: {
          citaId: nuevaCita.insertId,
          fecha: fecha,
          hora: horaFormateada,
          paciente: `${nombre} ${apellidos}`,
          medico: `${medico[0].Primer_Nombre} ${medico[0].Primer_Apellido}`,
          servicio: servicio[0].Nombre
        }
      });

    } catch (error) {
      await connection.rollback();
      console.error("Error en la transacción:", error);
      throw error;
    }
  } catch (error) {
    console.error("Error en /api/citas:", error);
    return res.status(500).json({ 
      success: false, 
      message: error.message || "Error al procesar la reserva"
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// Reemplaza o añade este endpoint ANTES de tus middlewares de 404:
app.get("/historial/:idUsuario", async (req, res) => {
  const { idUsuario } = req.params;
  try {
    const [rows] = await pool.query(`
      SELECT 
        c.ID_CITA,
        CONCAT(u_m.Primer_Nombre, ' ', u_m.Primer_Apellido) AS Nombre_Medico,
        CONCAT(u_p.Primer_Nombre, ' ', u_p.Primer_Apellido) AS Nombre_Paciente,
        c.Fecha_Hora,
        h.Diagnostico
      FROM Historial_Consultas h
      JOIN Citas c      ON h.ID_CITA    = c.ID_CITA
      JOIN Medicos m    ON h.ID_MEDICO  = m.ID_MEDICO
      JOIN Usuarios u_m ON m.ID_USUARIO = u_m.ID_USUARIO
      JOIN Pacientes p  ON h.ID_PACIENTE= p.ID_PACIENTE
      JOIN Usuarios u_p ON p.ID_USUARIO = u_p.ID_USUARIO
      WHERE p.ID_USUARIO = ?
      ORDER BY c.Fecha_Hora DESC
    `, [idUsuario]);

    return res.json(rows);
  } catch (err) {
    console.error("Error en GET /historial/:idUsuario:", err);
    return res.status(500).json({ success: false, message: "Error al obtener el historial" });
  }
});





app.get('/pacientes/:idUsuario', async (req, res) => {
  const { idUsuario } = req.params;
  try {
    const paciente = await db.query('SELECT ID_PACIENTE FROM pacientes WHERE ID_USUARIO = ?', [idUsuario]);
    if (paciente.length === 0) {
      return res.status(404).json({ message: 'Paciente no encontrado' });
    }
    res.json(paciente[0]);
  } catch (error) {
    console.error('Error al obtener paciente:', error);
    res.status(500).json({ message: 'Error en el servidor' });
  }
});

// Manejo de errores y rutas no encontradas (DEBE IR AL FINAL)
app.use((req, res, next) => {
  console.error("Ruta no encontrada:", req.originalUrl);
  res.status(404).json({ success: false, message: "Ruta no encontrada" });
});

app.use((err, req, res, next) => {
  console.error("Error global:", err.stack);
  res.status(500).json({ 
    success: false, 
    message: "Error interno del servidor",
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Manejo de errores mejorado
app.use((req, res, next) => {
  console.error("Ruta no encontrada:", req.originalUrl); // Agrega este log
  res.status(404).json({ success: false, message: "Ruta no encontrada" });
});

app.use((err, req, res, next) => {
  console.error("Error global:", err.stack);
  res.status(500).json({ 
    success: false, 
    message: "Error interno del servidor",
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

app.listen(PORT, () => {
  console.log(`Servidor backend corriendo en http://localhost:${PORT}`);
});

module.exports = app;





