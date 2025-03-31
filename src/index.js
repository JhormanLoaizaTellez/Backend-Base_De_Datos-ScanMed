const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
require("dotenv").config();

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

    if (userExists.length > 0) {
      return res.status(400).json({
        success: false,
        message: "El correo o documento ya están registrados"
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

// Manejo de errores mejorado
app.use((req, res, next) => {
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