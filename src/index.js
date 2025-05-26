const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");
require("dotenv").config();
require("./recordatorios");
const transporter = require("./mailer");

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

app.post("/api/login", async (req, res) => {
  try {
    const { correo, contrasena } = req.body;
    console.log(`Intento de login con correo: ${correo}`);

    if (!correo || !contrasena) {
      console.warn("Campos incompletos en la solicitud");
      return res
        .status(400)
        .json({
          success: false,
          message: "Todos los campos son obligatorios.",
        });
    }

    // 1) Buscar usuario
    const [users] = await pool.query(
      "SELECT * FROM Usuarios WHERE Correo_Electronico = ?",
      [correo]
    );
    console.log(`Resultado de búsqueda de usuario: ${users.length} encontrado(s)`);
    if (users.length === 0) {
      console.warn(`Usuario no encontrado para correo: ${correo}`);
      return res
        .status(401)
        .json({ success: false, message: "Usuario no encontrado.", code: "USER_NOT_FOUND" });
    }
    const usuario = users[0];
    console.log(`Usuario encontrado: ID=${usuario.ID_USUARIO}, Tipo_Usuario=${usuario.Tipo_Usuario}`);

    // 2) Validar contraseña
    const match = await bcrypt.compare(contrasena, usuario.Contrasena);
    if (!match) {
      console.warn(`Contraseña incorrecta para correo: ${correo}`);
      return res
        .status(401)
        .json({ success: false, message: "Contraseña incorrecta.", code: "INVALID_PASSWORD" });
    }
    console.log("Contraseña validada correctamente");

    // 3) Determinar rol consultando tablas especializadas
    // 3a) ¿Es administrador?
    const [adminRows] = await pool.query(
      "SELECT ID_ADMINISTRADOR FROM Administradores WHERE ID_USUARIO = ?",
      [usuario.ID_USUARIO]
    );
    console.log(`Administradores encontrados: ${adminRows.length}`);
    if (adminRows.length > 0) {
      console.log(`Usuario es ADMINISTRADOR, ID_ADMINISTRADOR=${adminRows[0].ID_ADMINISTRADOR}`);
      const token = jwt.sign(
        {
          id: usuario.ID_USUARIO,
          correo: usuario.Correo_Electronico,
          role: "ADMINISTRADOR",
        },
        "secreto",
        { expiresIn: "1h" }
      );
      const { Contrasena, ...userSinPass } = usuario;
      return res.json({
        success: true,
        token,
        usuario: userSinPass,
        userId: usuario.ID_USUARIO,
        role: "ADMINISTRADOR",
        admin: { adminId: adminRows[0].ID_ADMINISTRADOR },
      });
    }

    // 3b) ¿Es médico?
    const [medRows] = await pool.query(
      "SELECT m.ID_MEDICO, m.ID_SERVICIO FROM Medicos m WHERE m.ID_USUARIO = ?",
      [usuario.ID_USUARIO]
    );
    console.log(`Médicos encontrados: ${medRows.length}`);
    if (medRows.length > 0) {
      console.log(`Usuario es MEDICO, ID_MEDICO=${medRows[0].ID_MEDICO}`);
      const token = jwt.sign(
        {
          id: usuario.ID_USUARIO,
          correo: usuario.Correo_Electronico,
          role: "MEDICO",
        },
        "secreto",
        { expiresIn: "1h" }
      );
      const { Contrasena, ...userSinPass } = usuario;
      return res.json({
        success: true,
        token,
        usuario: userSinPass,
        userId: usuario.ID_USUARIO,
        role: "MEDICO",
        medico: {
          medicoId: medRows[0].ID_MEDICO,
          servicioId: medRows[0].ID_SERVICIO,
        },
      });
    }

    // 3c) Si no es ni admin ni médico, será paciente
    console.log("Usuario es PACIENTE");
    const token = jwt.sign(
      {
        id: usuario.ID_USUARIO,
        correo: usuario.Correo_Electronico,
        role: "PACIENTE",
      },
      "secreto",
      { expiresIn: "1h" }
    );
    const { Contrasena, ...userSinPass } = usuario;
    return res.json({
      success: true,
      token,
      usuario: userSinPass,
      userId: usuario.ID_USUARIO,
      role: "PACIENTE",
    });
  } catch (error) {
    console.error("Error en /api/login:", error);
    return res
      .status(500)
      .json({
        success: false,
        message: "Error en el servidor",
        error: error.message,
      });
  }
});

// GET all users
app.get("/api/usuarios", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        ID_USUARIO AS id, 
        CONCAT(Primer_Nombre, ' ', Primer_Apellido) AS nombre, 
        Correo_Electronico AS email, 
        Num_Documento AS identificacion,
        Tipo_Usuario AS role 
      FROM usuarios
    `);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error("Error en /api/usuarios:", error);
    res.status(500).json({ success: false, message: "Error al obtener usuarios" });
  }
});

// PUT change user role
app.put("/api/usuarios/:id/role", async (req, res) => {
  const { role } = req.body;
  await pool.query(
    "UPDATE usuarios SET Tipo_Usuario = ? WHERE ID_USUARIO = ?",
    [role, req.params.id]
  );
  res.json({ success: true });
});

// GET all citas
app.get("/api/citas", async (req, res) => {
  const [rows] = await pool.query(
    `SELECT c.ID_CITA AS id, CONCAT(u.Primer_Nombre,' ',u.Primer_Apellido) AS pacienteNombre,
            c.Fecha_Hora AS fecha, e.Tipo_Estado AS estado
     FROM citas c
     JOIN pacientes p ON c.ID_PACIENTE = p.ID_PACIENTE
     JOIN usuarios u  ON p.ID_USUARIO   = u.ID_USUARIO
     JOIN estado e   ON c.ID_ESTADO    = e.ID_ESTADO
     ORDER BY c.Fecha_Hora`
  );
  res.json({ success: true, data: rows });
});

// PUT change cita status
app.put("/api/citas/:id/estado", async (req, res) => {
  const { estado } = req.body;
  // Busca el ID_ESTADO numérico según el texto, o envíalo desde el front
  await pool.query(
    "UPDATE citas SET ID_ESTADO = (SELECT ID_ESTADO FROM estado WHERE Tipo_Estado = ?) WHERE ID_CITA = ?",
    [estado, req.params.id]
  );
  res.json({ success: true });
});


// En tu archivo de rutas del backend (ej: server.js)
app.get("/api/citas/medico/:medicoId", async (req, res) => {
  try {
    const { medicoId } = req.params;
    const [citas] = await pool.query(`
      SELECT
        c.ID_CITA        AS id,
        c.Fecha_Hora     AS fecha,
        c.ID_ESTADO      AS estadoId,
        c.ID_PACIENTE,
        u.Primer_Nombre  AS pacienteNombre,
        s.Nombre         AS examen
      FROM citas c
      LEFT JOIN pacientes p ON c.ID_PACIENTE = p.ID_PACIENTE
      LEFT JOIN usuarios u ON p.ID_USUARIO = u.ID_USUARIO
      LEFT JOIN servicios s ON c.ID_ASISTENCIA = s.ID_SERVICIO
      WHERE c.ID_MEDICO = ?
    `, [medicoId]);
    

    res.json({ success: true, data: citas });
  } catch (error) {
    console.error("Error en GET /api/citas/medico:", error);
    res.status(500).json({ 
      success: false, 
      message: "Error al obtener citas",
      error: error.message 
    });
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
      SELECT 
        ID_SERVICIO AS id, 
        Nombre AS nombre,
        Precio AS precio
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

app.get("/api/servicios/:id", async (req, res) => {
  try {
    const [servicio] = await pool.query("SELECT * FROM servicios WHERE ID_SERVICIO = ?", [req.params.id]);
    res.json(servicio[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// Obtener médicos por servicio (versión mejorada)
app.get("/api/medicos/servicio/:idServicio", async (req, res) => {
  let connection;
  try {
    const { idServicio } = req.params;
      console.log("ID Servicio recibido:", idServicio);

    
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
        s.Nombre as Servicios
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

app.get("/api/medicos", async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const [medicos] = await connection.query(`
      SELECT 
        m.ID_MEDICO, 
        u.Primer_Nombre, 
        u.Segundo_Nombre,
        u.Primer_Apellido, 
        u.Segundo_Apellido,
        s.Nombre as Servicios
      FROM Medicos m
      JOIN Usuarios u ON m.ID_USUARIO = u.ID_USUARIO
      JOIN Servicios s ON m.ID_SERVICIO = s.ID_SERVICIO
      ORDER BY u.Primer_Apellido, u.Primer_Nombre
    `);

    res.json({
      success: true,
      data: medicos,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Error al obtener médicos" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/usuario/actual", async (req, res) => {
  try {
    // Obtener el token del header
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ 
        success: false, 
        message: "No se proporcionó token de autenticación" 
      });
    }

    // Verificar el token
    const decoded = jwt.verify(token, 'secreto');
    
    // Obtener datos del usuario
    const [usuario] = await pool.query(`
      SELECT 
        u.ID_USUARIO,
        u.Primer_Nombre,
        u.Segundo_Nombre,
        u.Primer_Apellido,
        u.Segundo_Apellido,
        u.Num_Documento,
        u.Correo_Electronico,
        u.Telefono,
        p.ID_PACIENTE
      FROM Usuarios u
      LEFT JOIN Pacientes p ON u.ID_USUARIO = p.ID_USUARIO
      WHERE u.ID_USUARIO = ?
    `, [decoded.id]);

    if (usuario.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: "Usuario no encontrado" 
      });
    }

    const userData = usuario[0];
    
    res.json({
      success: true,
      data: {
        id: userData.ID_USUARIO,
        primerNombre: userData.Primer_Nombre,
        segundoNombre: userData.Segundo_Nombre,
        primerApellido: userData.Primer_Apellido,
        segundoApellido: userData.Segundo_Apellido,
        documento: userData.Num_Documento,
        correo: userData.Correo_Electronico,
        telefono: userData.Telefono,
        idPaciente: userData.ID_PACIENTE
      }
    });

  } catch (error) {
    console.error("Error en /api/usuario/actual:", error);
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        success: false, 
        message: "Token inválido" 
      });
    }
    res.status(500).json({ 
      success: false, 
      message: "Error al obtener datos del usuario",
      error: error.message 
    });
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

    // Generar disponibilidad
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

function generarDisponibilidad(citasExistentes) {
  const diasLaborales = [1, 2, 3, 4, 5]; // Lunes a viernes
  const horarios = [];

  // Convertir citas existentes a formato comparable
  const citasOcupadas = citasExistentes.map(c => {
    const fecha = new Date(c.Fecha_Hora);
    return new Date(
      fecha.getFullYear(),
      fecha.getMonth(),
      fecha.getDate(),
      fecha.getHours(),
      0, 0, 0
    ).getTime();
  });

  // Generar disponibilidad para los próximos 14 días
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0); // Normalizar a medianoche

  for (let i = 0; i < 14; i++) {
    const fecha = new Date(hoy);
    fecha.setDate(hoy.getDate() + i);

    // Verificar que el día sea laborable (lunes a viernes)
    if (diasLaborales.includes(fecha.getDay())) {
      console.log(`Generando disponibilidad para ${fecha.toISOString().split('T')[0]} (día ${fecha.getDay()})`);
      
      // Horario de mañana (7:00 - 11:00)
      for (let h = 7; h < 12; h++) {
        const slot = new Date(fecha);
        slot.setHours(h, 0, 0, 0);

        if (slot > new Date()) {
          const slotTime = slot.getTime();
          if (!citasOcupadas.includes(slotTime)) {
            horarios.push({
              fecha: fecha.toISOString().split('T')[0],
              hora: `${h.toString().padStart(2, '0')}:00`,
              disponible: true
            });
          }
        }
      }

      // Horario de tarde (14:00 - 17:00)
      for (let h = 14; h < 18; h++) {
        const slot = new Date(fecha);
        slot.setHours(h, 0, 0, 0);

        if (slot > new Date()) {
          const slotTime = slot.getTime();
          if (!citasOcupadas.includes(slotTime)) {
            horarios.push({
              fecha: fecha.toISOString().split('T')[0],
              hora: `${h.toString().padStart(2, '0')}:00`,
              disponible: true
            });
          }
        }
      }
    }
  }

  console.log(`Total horarios generados: ${horarios.length}`);
  return horarios;
}

// Crear nueva cita
app.post("/api/citas", async (req, res) => {
  let connection;
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ 
        success: false, 
        message: "No autorizado" 
      });
    }

    const decoded = jwt.verify(token, 'secreto');
    
    const [usuario] = await pool.query(
      `SELECT u.ID_USUARIO, p.ID_PACIENTE 
       FROM Usuarios u
       LEFT JOIN Pacientes p ON u.ID_USUARIO = p.ID_USUARIO
       WHERE u.ID_USUARIO = ?`,
      [decoded.id]
    );

    if (usuario.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: "Usuario no encontrado" 
      });
    }

    if (!usuario[0].ID_PACIENTE) {
      return res.status(400).json({
        success: false,
        message: "El usuario no está registrado como paciente"
      });
    }

    const { 
      servicioId, 
      doctorId, 
      fecha, 
      hora 
    } = req.body;

    // Validar datos
    if (!servicioId || !doctorId || !fecha || !hora) {
      return res.status(400).json({
        success: false,
        message: "Faltan datos obligatorios"
      });
    }

    let [h, m] = hora.split(':');
    h = h.padStart(2, '0');
    m = (m || '00').padStart(2, '0');
    const horaFormateada = `${h}:${m}`;
    const fechaSolo = fecha.split(' ')[0];
    const fechaHoraStr = `${fechaSolo} ${horaFormateada}:00`;

    connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      const [citaExistente] = await connection.query(
        `SELECT ID_CITA FROM Citas 
         WHERE ID_MEDICO = ? 
         AND Fecha_Hora = ?
         AND ID_ESTADO IN (1, 2)
         LIMIT 1 FOR UPDATE`,
        [doctorId, fechaHoraStr]
      );

      if (citaExistente.length > 0) {
        await connection.rollback();
        return res.status(400).json({ 
          success: false, 
          message: "El horario seleccionado ya está reservado",
          code: "TIME_SLOT_TAKEN"
        });
      }

      // Insertar cita con ID_ASISTENCIA por defecto (1 = Asiste)
      const [nuevaCita] = await connection.query(
        `INSERT INTO Citas (
          ID_ESTADO, ID_PACIENTE, ID_MEDICO, ID_ASISTENCIA, Fecha_Hora
        ) VALUES (?, ?, ?, ?, ?)`,
        [2, usuario[0].ID_PACIENTE, doctorId, 1, fechaHoraStr]
      );

      // Crear registro en Historial_Consultas
      await connection.query(
        `INSERT INTO Historial_Consultas (
          ID_PACIENTE, ID_MEDICO, ID_CITA, Diagnostico
        ) VALUES (?, ?, ?, ?)`,
        [usuario[0].ID_PACIENTE, doctorId, nuevaCita.insertId, "Cita programada - Pendiente de atención"]
      );

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

      const [pacienteData] = await connection.query(
        `SELECT Primer_Nombre, Primer_Apellido 
         FROM Usuarios 
         WHERE ID_USUARIO = ?`,
        [decoded.id]
      );

      await connection.commit();

      return res.json({ 
        success: true, 
        message: "Cita reservada exitosamente",
        data: {
          citaId: nuevaCita.insertId,
          idPaciente: usuario[0].ID_PACIENTE,
          fecha: fecha,
          hora: horaFormateada,
          paciente: `${pacienteData[0].Primer_Nombre} ${pacienteData[0].Primer_Apellido}`,
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
    return res.status(error.name === 'JsonWebTokenError' ? 401 : 500).json({ 
      success: false, 
      message: error.name === 'JsonWebTokenError' ? "Token inválido" : "Error al procesar la reserva",
      error: error.message
    });
  } finally {
    if (connection) connection.release();
  }
});
// Obtener paciente por número de documento
app.get("/api/pacientes/documento/:documento", async (req, res) => {
  try {
    const { documento } = req.params;
    
    // Validar formato del documento (eliminar espacios, guiones)
    const documentoLimpio = documento.toString().replace(/\D/g, '');
    
    const [paciente] = await pool.query(`
      SELECT 
        p.ID_PACIENTE, 
        p.ID_USUARIO,
        u.Primer_Nombre,
        u.Primer_Apellido,
        u.Num_Documento
      FROM Pacientes p
      JOIN Usuarios u ON p.ID_USUARIO = u.ID_USUARIO
      WHERE REPLACE(u.Num_Documento, '-', '') = ?
      LIMIT 1
    `, [documentoLimpio]);

    if (paciente.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: "Paciente no encontrado. Verifique el documento o complete su registro.",
        code: "PATIENT_NOT_FOUND"
      });
    }

    res.json({ 
      success: true,
      data: {
        idPaciente: paciente[0].ID_PACIENTE,
        idUsuario: paciente[0].ID_USUARIO,
        documento: paciente[0].Num_Documento,
        nombreCompleto: `${paciente[0].Primer_Nombre} ${paciente[0].Primer_Apellido}`
      }
    });
  } catch (error) {
    console.error("Error en /api/pacientes/documento:", error);
    res.status(500).json({ 
      success: false, 
      message: "Error al buscar paciente",
      error: error.message,
      code: "SERVER_ERROR"
    });
  }
});

// Modificar el endpoint para no incluir Observacion o usar un valor por defecto
app.get("/historial/:idUsuario", async (req, res) => {
  const { idUsuario } = req.params;
  try {
    const [rows] = await pool.query(`
      SELECT 
        c.ID_CITA,
        c.ID_MEDICO,
        CONCAT(u_m.Primer_Nombre, ' ', u_m.Primer_Apellido) AS Nombre_Medico,
        c.ID_PACIENTE,
        CONCAT(u_p.Primer_Nombre, ' ', u_p.Primer_Apellido) AS Nombre_Paciente,
        c.Fecha_Hora,
        h.Diagnostico,
        NULL AS Observacion  -- Valor por defecto si la columna no existe
      FROM Historial_Consultas h
      JOIN Citas c ON h.ID_CITA = c.ID_CITA
      JOIN Medicos m ON c.ID_MEDICO = m.ID_MEDICO
      JOIN Usuarios u_m ON m.ID_USUARIO = u_m.ID_USUARIO
      JOIN Pacientes p ON h.ID_PACIENTE = p.ID_PACIENTE
      JOIN Usuarios u_p ON p.ID_USUARIO = u_p.ID_USUARIO
      WHERE p.ID_USUARIO = ?
      ORDER BY c.Fecha_Hora DESC
    `, [idUsuario]);

    return res.json(rows);
  } catch (err) {
    console.error("Error en GET /historial/:idUsuario:", err);
    return res.status(500).json({ 
      success: false, 
      message: "Error al obtener el historial",
      error: err.message
    });
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

// Ruta para subir resultados (para administradores)
app.post("/api/resultados", async (req, res) => {
  let connection;
  try {
    const { ID_PACIENTE, ID_CITA, Descripcion, Documento_Examen } = req.body;

    // Validaciones básicas
    if (!ID_PACIENTE || !Descripcion || !Documento_Examen) {
      return res.status(400).json({ 
        success: false, 
        message: "Faltan campos obligatorios" 
      });
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();

    // Insertar el resultado
    const [result] = await connection.query(
      `INSERT INTO resultados 
      (ID_PACIENTE, ID_CITA, Fecha_Registro, Descripcion, Documento_Examen) 
      VALUES (?, ?, CURDATE(), ?, ?)`,
      [ID_PACIENTE, ID_CITA || null, Descripcion, Documento_Examen]
    );

    // Obtener correo y nombre del paciente
    const [pacientes] = await connection.query(
      `SELECT u.Correo_Electronico AS correo, 
              CONCAT(u.Primer_Nombre, ' ', u.Primer_Apellido) AS nombre
       FROM Pacientes p
       JOIN Usuarios u ON p.ID_USUARIO = u.ID_USUARIO
       WHERE p.ID_PACIENTE = ?`,
      [ID_PACIENTE]
    );

    if (pacientes.length === 0) {
      throw new Error("Paciente no encontrado");
    }

    const paciente = pacientes[0];

    // Enviar correo de notificación
    const mailOptions = {
      from: 'scanmed21@gmail.com',
      to: paciente.correo,
      subject: 'Resultado de Examen Disponible',
      text: `Hola ${paciente.nombre},\n\nTu resultado de examen ya está disponible.\nDescripción: ${Descripcion}\n\nPuedes consultarlo iniciando sesión en la plataforma.\n\nSaludos,\nEquipo Médico`
    };

    await transporter.sendMail(mailOptions);

    await connection.commit();

    res.status(201).json({
      success: true,
      message: "Resultado guardado y correo enviado",
      id: result.insertId
    });

  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Error en /api/resultados:", error);
    res.status(500).json({ 
      success: false, 
      message: "Error al guardar el resultado o enviar correo",
      error: error.message 
    });
  } finally {
    if (connection) connection.release();
  }
});
app.get('/api/pacientes/usuario/:idUsuario', async (req, res) => {
  try {
    const [paciente] = await pool.query(
      `SELECT ID_PACIENTE FROM pacientes WHERE ID_USUARIO = ?`,
      [req.params.idUsuario]
    );
    
    if (!paciente.length) return res.status(404).json({ error: 'Paciente no encontrado' });
    
    res.json(paciente[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener paciente' });
  }
});

// Ruta para obtener resultados por paciente
app.get("/api/resultados/:idPaciente", async (req, res) => {
  try {
    const { idPaciente } = req.params;

    // Obtener resultados del paciente
    const [resultados] = await pool.query(
      `SELECT r.*, c.Fecha_Hora as Fecha_Cita
       FROM resultados r
       LEFT JOIN citas c ON r.ID_CITA = c.ID_CITA
       WHERE r.ID_PACIENTE = ?
       ORDER BY r.Fecha_Registro DESC`,
      [idPaciente]
    );

    res.json({ 
      success: true, 
      count: resultados.length,

      data: resultados 
    });

  } catch (error) {
    console.error("Error en /api/resultados/:idPaciente:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message, 
      data: []

    });
  }
});
app.post("/api/pagos", async (req, res) => {
  let connection;
  try {
    console.log('Datos recibidos en /api/pagos:', req.body);
    const {
      pacienteId,
      servicioId,
      citaId,
      metodoPago,
      transaccionId,
      monto,
      detalles,
      estado = 'COMPLETADO'
    } = req.body;

    const requiredFields = ['pacienteId', 'servicioId', 'metodoPago', 'transaccionId', 'monto'];
    const missingFields = requiredFields.filter(field => !req.body[field]);
    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Faltan campos obligatorios: ${missingFields.join(', ')}`
      });
    }

    const validMethods = ['TARJETA', 'PAYPAL', 'BANCOLOMBIA', 'NEQUI'];
    if (!validMethods.includes(metodoPago.toUpperCase())) {
      return res.status(400).json({
        success: false,
        message: `Método de pago no válido. Valores permitidos: ${validMethods.join(', ')}`
      });
    }

    const validEstados = ['PENDIENTE', 'COMPLETADO', 'RECHAZADO', 'REEMBOLSADO'];
    if (!validEstados.includes(estado.toUpperCase())) {
      return res.status(400).json({
        success: false,
        message: `Estado no válido. Valores permitidos: ${validEstados.join(', ')}`
      });
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [paciente] = await connection.query(
      `SELECT ID_PACIENTE FROM Pacientes WHERE ID_PACIENTE = ?`,
      [pacienteId]
    );
    if (paciente.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Paciente no encontrado"
      });
    }

    const [servicio] = await connection.query(
      `SELECT ID_SERVICIO, Precio FROM Servicios WHERE ID_SERVICIO = ?`,
      [servicioId]
    );
    if (servicio.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Servicio no encontrado"
      });
    }

    if (citaId) {
      const [cita] = await connection.query(
        `SELECT ID_CITA FROM Citas WHERE ID_CITA = ? AND ID_PACIENTE = ?`,
        [citaId, pacienteId]
      );
      if (cita.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Cita no encontrada o no pertenece al paciente"
        });
      }
    }

    const [result] = await connection.query(
      `INSERT INTO Pago (
        ID_PACIENTE, ID_SERVICIO, ID_CITA, Estado, Metodo_Pago,
        Transaccion_ID, Monto, Detalles, Fecha_Pago
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        pacienteId,
        servicioId,
        citaId || null,
        estado.toUpperCase(),
        metodoPago.toUpperCase(),
        transaccionId,
        monto,
        detalles || `Pago realizado mediante ${metodoPago}`
      ]
    );

    if (citaId) {
      // Actualizar solo el estado de la cita, sin ID_PAGO
      await connection.query(
        `UPDATE Citas SET ID_ESTADO = 2 WHERE ID_CITA = ?`,
        [citaId]
      );
    }

    await connection.commit();

    return res.json({
      success: true,
      message: "Pago registrado exitosamente",
      data: {
        pagoId: result.insertId,
        transaccionId: transaccionId,
        fecha: new Date().toISOString()
      }
    });

  } catch (error) {
    if (connection) {
      console.error("Error en la transacción de pago:", {
        message: error.message,
        sqlMessage: error.sqlMessage,
        stack: error.stack
      });
      await connection.rollback();
    }
    return res.status(500).json({
      success: false,
      message: `Error al procesar el pago: ${error.message}`,
      sqlError: error.sqlMessage || 'N/A'
    });
  } finally {
    if (connection) connection.release();
  }
});
app.post("/api/facturas", async (req, res) => {
  let connection;
  try {
    const {
      pagoId,
      pacienteId,
      numeroFactura,
      total,
      servicioId,
      descripcion,
      cantidad
    } = req.body;

    // Validar datos
    const requiredFields = ['pagoId', 'pacienteId', 'numeroFactura', 'total', 'servicioId', 'descripcion', 'cantidad'];
    const missingFields = requiredFields.filter(field => !req.body[field]);
    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Faltan campos obligatorios: ${missingFields.join(', ')}`
      });
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();

    // Insertar factura
    const [facturaResult] = await connection.query(
      `INSERT INTO Factura (ID_PAGO, ID_PACIENTE, Fecha_Pago, Numero_Factura, Total, Estado)
       VALUES (?, ?, NOW(), ?, ?, 'PAGADA')`,
      [pagoId, pacienteId, numeroFactura, total]
    );

    // Insertar detalle de factura
    const [detalleResult] = await connection.query(
      `INSERT INTO Factura_Detalle (ID_FACTURA, ID_SERVICIO, Descripcion, Cantidad)
       VALUES (?, ?, ?, ?)`,
      [facturaResult.insertId, servicioId, descripcion, cantidad]
    );

    await connection.commit();

    return res.json({
      success: true,
      message: "Factura generada exitosamente",
      data: {
        facturaId: facturaResult.insertId,
        numeroFactura: numeroFactura
      }
    });

  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Error en /api/facturas:", error);
    return res.status(500).json({
      success: false,
      message: "Error al generar factura",
      error: error.message
    });
  } finally {
    if (connection) connection.release();
  }
});

// Obtener factura por ID_PAGO
app.get("/api/facturas/pago/:pagoId", async (req, res) => {
  try {
    const { pagoId } = req.params;

    const [factura] = await pool.query(`
      SELECT 
        f.ID_FACTURA,
        f.ID_PAGO,
        f.ID_PACIENTE,
        f.Fecha_Pago,
        f.Numero_Factura,
        f.Total,
        f.Estado,
        u.Primer_Nombre,
        u.Primer_Apellido,
        u.Num_Documento,
        u.Correo_Electronico,
        pg.Metodo_Pago,  -- Corregido: Cambiado de p.Metodo_Pago a pg.Metodo_Pago
        pg.Transaccion_ID,
        s.Nombre as Nombre_Servicio,
        (f.Total / 1.19) as Subtotal,
        (f.Total - (f.Total / 1.19)) as IVA
      FROM Factura f
      JOIN Pacientes p ON f.ID_PACIENTE = p.ID_PACIENTE
      JOIN Usuarios u ON p.ID_USUARIO = u.ID_USUARIO
      JOIN Pago pg ON f.ID_PAGO = pg.ID_PAGO
      JOIN Servicios s ON pg.ID_SERVICIO = s.ID_SERVICIO
      WHERE f.ID_PAGO = ?
    `, [pagoId]);

    if (factura.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Factura no encontrada"
      });
    }

    return res.json({
      success: true,
      data: factura[0]
    });

  } catch (error) {
    console.error("Error en /api/facturas/pago:", error);
    return res.status(500).json({
      success: false,
      message: "Error al obtener factura",
      error: error.message
    });
  }
});

// Obtener detalles de factura
app.get("/api/facturas/:facturaId/detalles", async (req, res) => {
  try {
    const { facturaId } = req.params;

    const [detalles] = await pool.query(`
      SELECT 
        fd.ID_FACTURADETALLE,
        fd.ID_FACTURA,
        fd.ID_SERVICIO,
        fd.Descripcion,
        fd.Cantidad,
        s.Precio as Precio_Unitario,
        (s.Precio * fd.Cantidad) as Subtotal
      FROM Factura_Detalle fd
      JOIN Servicios s ON fd.ID_SERVICIO = s.ID_SERVICIO
      WHERE fd.ID_FACTURA = ?
    `, [facturaId]);

    return res.json({
      success: true,
      data: detalles
    });

  } catch (error) {
    console.error("Error en /api/facturas/:facturaId/detalles:", error);
    return res.status(500).json({
      success: false,
      message: "Error al obtener detalles de factura",
      error: error.message
    });
  }
});
// Ruta para manejar la subida de archivos PDF
const multer = require('multer');

// Configuración mejorada de almacenamiento
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '..', 'file_storage'); // Sube un nivel y usa file_storage
    
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true }); // Crea directorio si no existe
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() !== '.pdf') {
      return cb(new Error('Solo se permiten archivos PDF'));
    }
    cb(null, true);
  }
});

// Ruta modificada
app.post('/api/upload-resultado', upload.single('documento'), async (req, res) => {
  try {
    if (!req.file) throw new Error('No se recibió archivo');
    
    const fileUrl = `${req.protocol}://${req.get('host')}/files/${req.file.filename}`;
    
    res.json({ 
      success: true, 
      filePath: fileUrl,
      message: 'Archivo subido correctamente'
    });
  } catch (error) {
    console.error('Error en upload:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Servir archivos estáticos desde la carpeta uploads
// En la ruta que sirve los archivos PDF
app.use('/files', express.static(path.join(__dirname, '..', 'file_storage'), {
  setHeaders: (res, path) => {
    res.setHeader('Content-Disposition', 'attachment');
  }
}));

// Obtener paciente por ID de usuario
app.get("/api/pagos/paciente/:idPaciente", async (req, res) => {
  try {
    const { idPaciente } = req.params;
    
    // Validar ID
    if (!idPaciente || isNaN(idPaciente)) {
      return res.status(400).json({ 
        success: false, 
        message: "ID de paciente no válido" 
      });
    }

    const [pagos] = await pool.query(`
      SELECT 
        p.ID_PAGO,
        p.Fecha_Pago,
        p.Metodo_Pago,
        p.Monto,
        p.Estado,
        p.Transaccion_ID,
        s.Nombre AS Servicio,
        c.Fecha_Hora AS Fecha_Cita
      FROM Pago p
      JOIN Servicios s ON p.ID_SERVICIO = s.ID_SERVICIO
      LEFT JOIN Citas c ON p.ID_CITA = c.ID_CITA
      WHERE p.ID_PACIENTE = ?
      ORDER BY p.Fecha_Pago DESC
    `, [idPaciente]);

    res.json({ 
      success: true, 
      data: pagos,
      count: pagos.length
    });

  } catch (error) {
    console.error("Error en /api/pagos/paciente/:idPaciente:", error);
    res.status(500).json({ 
      success: false, 
      message: "Error al obtener historial de pagos",
      error: error.message 
    });
  }
});

// Ruta actualizada para obtener resultados
app.get("/api/resultados/:idPaciente", async (req, res) => {
  try {
    const [resultados] = await pool.query(`
      SELECT 
        r.*, 
        c.Fecha_Hora as Fecha_Cita,
        s.Nombre as Nombre_Servicio
      FROM resultados r
      LEFT JOIN citas c ON r.ID_CITA = c.ID_CITA
      LEFT JOIN servicios s ON c.ID_SERVICIO = s.ID_SERVICIO
      WHERE r.ID_PACIENTE = ?
      ORDER BY r.Fecha_Registro DESC
    `, [req.params.idPaciente]);

    res.json(resultados);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener resultados' });
  }
});
// Ruta para reprogramar citas
app.put("/api/citas/:id/reprogramar", async (req, res) => {
  let connection;
  try {
    const { id } = req.params;
    const { nuevaFechaHora } = req.body;

    if (!id || isNaN(id)) {
      return res.status(400).json({ 
        success: false, 
        message: "ID de cita no válido" 
      });
    }

    if (!nuevaFechaHora || isNaN(new Date(nuevaFechaHora).getTime())) {
      return res.status(400).json({ 
        success: false, 
        message: "Fecha y hora no válidas" 
      });
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      // 1. Verificar que la cita existe y está programada o confirmada
      const [cita] = await connection.query(
        `SELECT c.ID_CITA, c.ID_MEDICO, c.Fecha_Hora, c.ID_ESTADO 
         FROM Citas c
         WHERE c.ID_CITA = ?`,
        [id]
      );

      if (cita.length === 0) {
        return res.status(404).json({ 
          success: false, 
          message: "Cita no encontrada" 
        });
      }

      if (cita[0].ID_ESTADO !== 1 && cita[0].ID_ESTADO !== 2) {
        return res.status(400).json({ 
          success: false, 
          message: "Solo se pueden reprogramar citas programadas o confirmadas" 
        });
      }

      // 2. Verificar que el médico no tenga otra cita en ese horario
      const [citaExistente] = await connection.query(
        `SELECT ID_CITA FROM Citas 
         WHERE ID_MEDICO = ? 
         AND Fecha_Hora = ?
         AND ID_ESTADO IN (1, 2)
         AND ID_CITA != ?
         LIMIT 1`,
        [cita[0].ID_MEDICO, nuevaFechaHora, id]
      );

      if (citaExistente.length > 0) {
        return res.status(400).json({ 
          success: false, 
          message: "El médico ya tiene una cita programada en ese horario" 
        });
      }

      // 3. Actualizar la fecha de la cita
      await connection.query(
        `UPDATE Citas SET Fecha_Hora = ? WHERE ID_CITA = ?`,
        [nuevaFechaHora, id]
      );

      // 4. Actualizar el historial
      await connection.query(
        `UPDATE Historial_Consultas 
         SET Diagnostico = 'Cita reprogramada - Pendiente de atención'
         WHERE ID_CITA = ?`,
        [id]
      );

      await connection.commit();

      res.json({ 
        success: true, 
        message: "Cita reprogramada exitosamente",
        nuevaFechaHora: nuevaFechaHora
      });

    } catch (error) {
      await connection.rollback();
      throw error;
    }
  } catch (error) {
    console.error("Error en PUT /api/citas/:id/reprogramar:", error);
    res.status(500).json({ 
      success: false, 
      message: "Error al reprogramar la cita",
      error: error.message 
    });
  } finally {
    if (connection) connection.release();
  }
  
});
// Ruta para cancelar citas
app.put("/api/citas/:id/cancelar", async (req, res) => {
  let connection;
  try {
    const { id } = req.params;
    
    if (!id || isNaN(id)) {
      return res.status(400).json({ 
        success: false, 
        message: "ID de cita no válido" 
      });
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      // 1. Verificar que la cita existe y está en estado programado
      const [cita] = await connection.query(
        `SELECT ID_ESTADO FROM Citas WHERE ID_CITA = ?`,
        [id]
      );

      if (cita.length === 0) {
        return res.status(404).json({ 
          success: false, 
          message: "Cita no encontrada" 
        });
      }

      if (cita[0].ID_ESTADO !== 1 && cita[0].ID_ESTADO !== 2) {
        return res.status(400).json({ 
          success: false, 
          message: "Solo se pueden cancelar citas programadas o confirmadas" 
        });
      }

      // 2. Actualizar estado de la cita a Cancelada (4)
      await connection.query(
        `UPDATE Citas SET ID_ESTADO = 4 WHERE ID_CITA = ?`,
        [id]
      );

      // 3. Actualizar el diagnóstico en Historial_Consultas
      await connection.query(
        `UPDATE Historial_Consultas SET Diagnostico = 'Cita cancelada' 
         WHERE ID_CITA = ?`,
        [id]
      );

      await connection.commit();

      res.json({ 
        success: true, 
        message: "Cita cancelada exitosamente" 
      });

    } catch (error) {
      await connection.rollback();
      throw error;
    }
  } catch (error) {
    console.error("Error en PUT /api/citas/:id/cancelar:", error);
    res.status(500).json({ 
      success: false, 
      message: "Error al cancelar la cita",
      error: error.message 
    });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/medicos", async (req, res) => {
  let connection;
  try {
    const { especialidad } = req.query;
    connection = await pool.getConnection();

    let query = `
      SELECT 
        m.ID_MEDICO,
        u.Primer_Nombre,
        u.Segundo_Nombre,
        u.Primer_Apellido,
        u.Segundo_Apellido,
        s.Nombre AS especialidad
      FROM Medicos m
      JOIN Usuarios u ON m.ID_USUARIO = u.ID_USUARIO
      JOIN Servicios s ON m.ID_SERVICIO = s.ID_SERVICIO
    `;

    const params = [];

    if (especialidad) {
      query += ` WHERE s.Nombre = ?`;
      params.push(especialidad);
    }

    query += ` ORDER BY u.Primer_Apellido, u.Primer_Nombre`;

    const [medicos] = await connection.query(query, params);

    const data = medicos.map(m => ({
      id: m.ID_MEDICO,
      nombre: `${m.Primer_Nombre} ${m.Segundo_Nombre || ""} ${m.Primer_Apellido} ${m.Segundo_Apellido}`.trim(),
      especialidad: m.especialidad,
      horarios: "No especificado"
    }));

    res.json({ success: true, data });
  } catch (err) {
    console.error("Error al obtener médicos:", err.message, err.stack);
    res.status(500).json({ success: false, message: "Error al obtener médicos", error: err.message });
  } finally {
    if (connection) connection.release();
  }
});
// Ruta para obtener todos los exámenes realizados
app.get("/api/examenes", async (req, res) => {
  try {
    const { paciente, tipoExamen, fechaInicio, fechaFin } = req.query;
    let query = `
      SELECT 
        r.ID_RESULTADO,
        r.Fecha_Registro,
        r.Descripcion,
        r.Documento_Examen,
        s.Nombre AS Tipo_Examen,
        CONCAT(u_p.Primer_Nombre, ' ', u_p.Primer_Apellido) AS Nombre_Paciente,
        CONCAT(u_m.Primer_Nombre, ' ', u_m.Primer_Apellido) AS Nombre_Medico,
        c.Fecha_Hora AS Fecha_Cita
      FROM Resultados r
      JOIN Citas c ON r.ID_CITA = c.ID_CITA
      JOIN Pacientes p ON r.ID_PACIENTE = p.ID_PACIENTE
      JOIN Usuarios u_p ON p.ID_USUARIO = u_p.ID_USUARIO
      JOIN Medicos m ON c.ID_MEDICO = m.ID_MEDICO
      JOIN Usuarios u_m ON m.ID_USUARIO = u_m.ID_USUARIO
      JOIN Servicios s ON m.ID_SERVICIO = s.ID_SERVICIO
      WHERE 1=1
    `;
    const params = [];

    if (paciente) {
      query += ` AND CONCAT(u_p.Primer_Nombre, ' ', u_p.Primer_Apellido) LIKE ?`;
      params.push(`%${paciente}%`);
    }
    if (tipoExamen) {
      query += ` AND s.Nombre LIKE ?`;
      params.push(`%${tipoExamen}%`);
    }
    if (fechaInicio) {
      query += ` AND r.Fecha_Registro >= ?`;
      params.push(fechaInicio);
    }
    if (fechaFin) {
      query += ` AND r.Fecha_Registro <= ?`;
      params.push(fechaFin);
    }

    query += ` ORDER BY r.Fecha_Registro DESC`;

    const [examenes] = await pool.query(query, params);

    res.json({
      success: true,
      data: examenes,
      count: examenes.length
    });
  } catch (error) {
    console.error("Error en /api/examenes:", error);
    res.status(500).json({
      success: false,
      message: "Error al obtener exámenes",
      error: error.message
    });
  }
});

// Ruta para obtener todas las facturas y estadísticas
app.get("/api/facturas", async (req, res) => {
  try {
    const { paciente, estado, fechaInicio, fechaFin, metodoPago, medico } = req.query;
    let query = `
      SELECT 
        f.ID_FACTURA,
        f.Fecha_Pago,
        f.Numero_Factura,
        f.Total,
        f.Estado,
        CONCAT(u.Primer_Nombre, ' ', u.Primer_Apellido) AS Nombre_Paciente,
        CONCAT(u_m.Primer_Nombre, ' ', u_m.Primer_Apellido) AS Nombre_Medico,
        p.Metodo_Pago,
        p.Transaccion_ID
      FROM Factura f
      JOIN Pago p ON f.ID_PAGO = p.ID_PAGO
      JOIN Pacientes pa ON f.ID_PACIENTE = pa.ID_PACIENTE
      JOIN Usuarios u ON pa.ID_USUARIO = u.ID_USUARIO
      JOIN Citas c ON p.ID_CITA = c.ID_CITA
      JOIN Medicos m ON c.ID_MEDICO = m.ID_MEDICO
      JOIN Usuarios u_m ON m.ID_USUARIO = u_m.ID_USUARIO
      WHERE 1=1
    `;
    const params = [];

    if (paciente) {
      query += ` AND CONCAT(u.Primer_Nombre, ' ', u.Primer_Apellido) LIKE ?`;
      params.push(`%${paciente}%`);
    }
    if (estado) {
      query += ` AND f.Estado = ?`;
      params.push(estado);
    }
    if (fechaInicio) {
      query += ` AND f.Fecha_Pago >= ?`;
      params.push(fechaInicio);
    }
    if (fechaFin) {
      query += ` AND f.Fecha_Pago <= ?`;
      params.push(fechaFin);
    }
    if (metodoPago) {
      query += ` AND p.Metodo_Pago = ?`;
      params.push(metodoPago);
    }
    if (medico) {
      query += ` AND CONCAT(u_m.Primer_Nombre, ' ', u_m.Primer_Apellido) LIKE ?`;
      params.push(`%${medico}%`);
    }

    query += ` ORDER BY f.Fecha_Pago DESC`;

    const [facturas] = await pool.query(query, params);

    // Estadísticas
    const [stats] = await pool.query(`
      SELECT 
        COUNT(*) AS Total_Facturas,
        SUM(Total) AS Ingresos_Totales,
        SUM(CASE WHEN Estado = 'PAGADA' THEN Total ELSE 0 END) AS Ingresos_Pagados,
        SUM(CASE WHEN Estado = 'EMITIDA' THEN Total ELSE 0 END) AS Ingresos_Pendientes,
        SUM(CASE WHEN Estado = 'ANULADA' THEN Total ELSE 0 END) AS Ingresos_Anulados
      FROM Factura
    `);

    res.json({
      success: true,
      data: facturas,
      count: facturas.length,
      statistics: stats[0]
    });
  } catch (error) {
    console.error("Error en /api/facturas:", error);
    res.status(500).json({
      success: false,
      message: "Error al obtener facturas",
      error: error.message
    });
  }
});
app.post("/api/generate-pdf", async (req, res) => {
  try {
    console.log("Procesando solicitud para generar PDF:", req.body);
    const { data, type } = req.body;

    if (!data || !Array.isArray(data) || data.length === 0 || !type) {
      return res.status(400).json({
        success: false,
        message: "Datos inválidos o tipo no especificado",
      });
    }

    // Initialize PDF document
    const doc = new PDFDocument({
      size: "A4",
      margin: 40,
      info: {
        Title: type === "facturas" ? "Sesiones de Facturación" : "Historial de Exámenes",
        Author: "ScanMed",
        CreationDate: new Date(),
      },
    });

    const buffers = [];
    doc.on("data", buffers.push.bind(buffers));
    doc.on("end", () => {
      console.log("PDF generado, enviando respuesta");
      const pdfData = Buffer.concat(buffers);
      // Save PDF to disk for debugging
      const debugPath = path.join(__dirname, "debug_output.pdf");
      fs.writeFileSync(debugPath, pdfData);
      console.log(`PDF guardado en ${debugPath} para depuración`);
      res.status(200);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=${
          type === "facturas" ? "Sesiones_Facturacion.pdf" : "Historial_Examenes.pdf"
        }`
      );
      res.send(pdfData);
    });

    // Helper function to add header
    const addHeader = () => {
      const logoPath = path.join(__dirname, "logo.png");
      if (fs.existsSync(logoPath)) {
        console.log("Logo encontrado, añadiendo al PDF");
        doc.image(logoPath, 40, 20, { width: 100 });
      } else {
        console.log("Logo no encontrado, usando texto ScanMed");
        doc
          .font("Helvetica-Bold")
          .fontSize(16)
          .fillColor("#003087")
          .text("ScanMed", 40, 30);
      }

      doc
        .font("Helvetica-Bold")
        .fontSize(20)
        .fillColor("#003087")
        .text(
          type === "facturas" ? "Sesiones de Facturación" : "Historial de Exámenes",
          0,
          30,
          { align: "center" }
        );

      doc
        .font("Helvetica")
        .fontSize(10)
        .fillColor("#333333")
        .text(`Generado el: ${new Date().toLocaleDateString()}`, 0, 60, {
          align: "center",
        });

      doc
        .moveTo(40, 80)
        .lineTo(550, 80)
        .strokeColor("#CCCCCC")
        .stroke();
    };

    // Helper function to add footer
    const addFooter = (pageNumber) => {
      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor("#666666")
        .text(
          `Página ${pageNumber} | ScanMed © ${new Date().getFullYear()}`,
          40,
          doc.page.height - 50,
          { align: "center" }
        );
    };

    // Add header to first page
    addHeader();
    let pageNumber = 1;
    addFooter(pageNumber);

    // Add test text to verify rendering
    doc
      .font("Helvetica")
      .fontSize(12)
      .fillColor("#000000")
      .opacity(1)
    console.log("Texto de prueba añadido en y=90");

    // Define table headers and data based on type
    let headers, rows;
    if (type === "facturas") {
      headers = [
        "ID",
        "Fecha",
        "Nº Factura",
        "Paciente",
        "Médico",
        "Total",
        "Estado",
        "Método Pago",
        "Transacción ID",
      ];
      rows = data.map((f, index) => {
        console.log(`Procesando factura ${index + 1}:`, f);
        const total = Number(f.Total);
        if (isNaN(total)) {
          console.warn(
            `Valor no numérico encontrado en Total para factura ${f.ID_FACTURA}: ${f.Total}`
          );
          return [
            f.ID_FACTURA.toString(),
            new Date(f.Fecha_Pago).toLocaleDateString(),
            f.Numero_Factura,
            f.Nombre_Paciente,
            f.Nombre_Medico,
            "$0.00",
            f.Estado,
            f.Metodo_Pago,
            f.Transaccion_ID,
          ];
        }
        return [
          f.ID_FACTURA.toString(),
          new Date(f.Fecha_Pago).toLocaleDateString(),
          f.Numero_Factura,
          f.Nombre_Paciente,
          f.Nombre_Medico,
          `$${total.toFixed(2)}`,
          f.Estado,
          f.Metodo_Pago,
          f.Transaccion_ID,
        ];
      });
    } else if (type === "examenes") {
      headers = ["ID", "Fecha", "Paciente", "Médico", "Tipo Examen", "Descripción"];
      rows = data.map((e, index) => {
        console.log(`Procesando examen ${index + 1}:`, e);
        return [
          e.ID_RESULTADO.toString(),
          new Date(e.Fecha_Registro).toLocaleDateString(),
          e.Nombre_Paciente,
          e.Nombre_Medico,
          e.Tipo_Examen,
          e.Descripcion,
        ];
      });
    } else {
      return res.status(400).json({
        success: false,
        message: "Tipo de reporte no soportado",
      });
    }

    console.log("Filas generadas:", rows);

    // Calculate dynamic column widths based on content
    const calculateColumnWidths = (headers, rows) => {
      const minWidth = 50;
      const maxWidth = 150;
      const totalWidth = 510; // Ajustado para A4 con márgenes
      const colWidths = headers.map((header, i) => {
        const maxContentLength = Math.max(
          header.length,
          ...rows.map((row) => (row[i] || "").toString().length)
        );
        return Math.min(Math.max(minWidth, maxContentLength * 8), maxWidth);
      });

      // Adjust widths to fit within totalWidth
      const totalCalculatedWidth = colWidths.reduce((sum, w) => sum + w, 0);
      if (totalCalculatedWidth > totalWidth) {
        const scaleFactor = totalWidth / totalCalculatedWidth;
        return colWidths.map((w) => Math.floor(w * scaleFactor));
      }
      return colWidths;
    };

    // Table configuration
    const colWidths = calculateColumnWidths(headers, rows);
    console.log("Anchos de columnas:", colWidths);
    const startX = 40;
    let y = 120; // Ajustado para dejar espacio al texto de prueba
    const rowHeight = 25;
    const headerHeight = 30;

    // Draw table headers with background
    doc
      .rect(40, y, colWidths.reduce((sum, w) => sum + w, 0), headerHeight)
      .fillColor("#E6F3FA")
      .fill();

    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .fillColor("#003087")
      .opacity(1);
    headers.forEach((header, i) => {
      doc.text(
        header,
        startX + colWidths.slice(0, i).reduce((sum, w) => sum + w, 0),
        y + 8,
        {
          width: colWidths[i],
          align: "left",
        }
      );
    });

    y += headerHeight;
    doc
      .moveTo(startX, y)
      .lineTo(startX + colWidths.reduce((sum, w) => sum + w, 0), y)
      .strokeColor("#CCCCCC")
      .stroke();

    // Draw table rows
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor("#000000") // Negro explícito
      .opacity(1); // Opacidad completa
    rows.forEach((row, rowIndex) => {
      console.log(`Dibujando fila ${rowIndex + 1} en y=${y}:`, row);

      // Check if we need a new page
      if (y + rowHeight > doc.page.height - 80) {
        console.log("Añadiendo nueva página en fila", rowIndex + 1);
        doc.addPage();
        y = 100;
        pageNumber++;
        addHeader();
        addFooter(pageNumber);

        // Redraw headers on new page
        doc
          .rect(40, y, colWidths.reduce((sum, w) => sum + w, 0), headerHeight)
          .fillColor("#E6F3FA")
          .fill();
        doc
          .font("Helvetica-Bold")
          .fontSize(10)
          .fillColor("#003087")
          .opacity(1);
        headers.forEach((header, i) => {
          doc.text(
            header,
            startX + colWidths.slice(0, i).reduce((sum, w) => sum + w, 0),
            y + 8,
            {
              width: colWidths[i],
              align: "left",
            }
          );
        });
        y += headerHeight;
        doc
          .moveTo(startX, y)
          .lineTo(startX + colWidths.reduce((sum, w) => sum + w, 0), y)
          .strokeColor("#CCCCCC")
          .stroke();
      }

      // Draw row background
      if (rowIndex % 2 === 0) {
        doc
          .rect(40, y, colWidths.reduce((sum, w) => sum + w, 0), rowHeight)
          .fillColor("#F9F9F9")
          .fill();
      }

      // Draw row cells
      doc
        .font("Helvetica")
        .fontSize(9)
        .fillColor("#000000")
        .opacity(1);
      row.forEach((cell, i) => {
        const text = cell != null ? cell.toString() : "";
        const xPos = startX + colWidths.slice(0, i).reduce((sum, w) => sum + w, 0);
        console.log(`Dibujando celda ${i} en x=${xPos}, y=${y + 5}: ${text}`);
        doc.text(text, xPos, y + 5, {
          width: colWidths[i],
          align: "left",
        });
      });

      y += rowHeight;
      doc
        .moveTo(startX, y)
        .lineTo(startX + colWidths.reduce((sum, w) => sum + w, 0), y)
        .strokeColor("#CCCCCC")
        .stroke();
    });

    // Draw table borders
    const tableWidth = colWidths.reduce((sum, w) => sum + w, 0);
    let currentX = startX;
    colWidths.forEach((width) => {
      doc
        .moveTo(currentX, 120)
        .lineTo(currentX, y)
        .strokeColor("#CCCCCC")
        .stroke();
      currentX += width;
    });
    doc
      .moveTo(startX, 120)
      .lineTo(startX, y)
      .stroke();
    doc
      .moveTo(startX + tableWidth, 120)
      .lineTo(startX + tableWidth, y)
      .stroke();

    // Finalize PDF
    console.log("Finalizando PDF");
    doc.end();
  } catch (error) {
    console.error("Error en /api/generate-pdf:", error);
    res.status(500).json({
      success: false,
      message: "Error al generar PDF",
      error: error.message,
    });
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