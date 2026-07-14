const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./db');
require('dotenv').config();

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'carwash-secret-key-12345';

// Configure body-parser limits for Base64 image uploads (license plate photos)
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ limit: '20mb', extended: true }));
app.use(cors());

// Serve static files from the 'public' folder
app.use(express.static('public'));

// Database Initialization
async function initializeDatabase() {
  try {
    // Create users table
    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'worker'))
      )
    `);

    // Create services table
    await db.query(`
      CREATE TABLE IF NOT EXISTS services (
        id SERIAL PRIMARY KEY,
        plate VARCHAR(20) NOT NULL,
        photo_url TEXT,
        service_type VARCHAR(100) NOT NULL,
        price DECIMAL(10, 2) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'delivered')),
        worker_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('Database tables verified/created successfully.');

    // Seed default users if users table is empty
    const usersCount = await db.query('SELECT COUNT(*) FROM users');
    if (parseInt(usersCount.rows[0].count) === 0) {
      console.log('Seeding default users...');
      const adminPasswordHash = bcrypt.hashSync('admin123', 10);
      const workerPasswordHash = bcrypt.hashSync('worker123', 10);

      await db.query(
        'INSERT INTO users (username, password, role) VALUES ($1, $2, $3)',
        ['admin', adminPasswordHash, 'admin']
      );
      await db.query(
        'INSERT INTO users (username, password, role) VALUES ($1, $2, $3)',
        ['worker', workerPasswordHash, 'worker']
      );
      console.log('Default users seeded: admin/admin123 and worker/worker123');
    }
  } catch (error) {
    console.error('Error during database initialization:', error);
  }
}

// Initialize tables when backend starts
initializeDatabase();

// JWT Authentication Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Token no proveído' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Token inválido o expirado' });
    }
    req.user = user;
    next();
  });
}

// Role authorization middleware
function requireRole(roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Acceso denegado. Permisos insuficientes.' });
    }
    next();
  };
}

// --- AUTH ENDPOINTS ---

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
  }

  try {
    const result = await db.query('SELECT * FROM users WHERE username = $1', [username.toLowerCase().trim()]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }

    const user = result.rows[0];
    const isPasswordValid = bcrypt.compareSync(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }

    // Generate JWT
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/auth/me
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const result = await db.query('SELECT id, username, role FROM users WHERE id = $1', [req.user.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error('Error en me:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// --- SERVICES ENDPOINTS ---

// GET /api/services
app.get('/api/services', authenticateToken, async (req, res) => {
  try {
    let queryText = `
      SELECT s.*, u.username as worker_name 
      FROM services s
      LEFT JOIN users u ON s.worker_id = u.id
    `;
    const params = [];

    // If worker, only show their own services
    if (req.user.role === 'worker') {
      queryText += ' WHERE s.worker_id = $1';
      params.push(req.user.id);
    }

    queryText += ' ORDER BY s.created_at DESC';

    const result = await db.query(queryText, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener servicios:', error);
    res.status(500).json({ error: 'Error al obtener servicios' });
  }
});

// POST /api/services
app.post('/api/services', authenticateToken, async (req, res) => {
  const { plate, photo_url, service_type, price } = req.body;
  if (!plate || !service_type || price === undefined) {
    return res.status(400).json({ error: 'Placa, tipo de servicio y precio son requeridos' });
  }

  try {
    const result = await db.query(
      `INSERT INTO services (plate, photo_url, service_type, price, status, worker_id)
       VALUES ($1, $2, $3, $4, 'pending', $5)
       RETURNING *`,
      [plate.toUpperCase().trim(), photo_url, service_type, price, req.user.id]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error al registrar servicio:', error);
    res.status(500).json({ error: 'Error al registrar servicio' });
  }
});

// PUT /api/services/:id
app.put('/api/services/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { status, plate, service_type, price, worker_id } = req.body;

  try {
    // Check if service exists
    const checkResult = await db.query('SELECT * FROM services WHERE id = $1', [id]);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }

    const service = checkResult.rows[0];

    // If user is worker, they should only update status, and only of their own services
    if (req.user.role === 'worker' && service.worker_id !== req.user.id) {
      return res.status(403).json({ error: 'No autorizado para modificar este servicio' });
    }

    // Build update query dynamically
    const fields = [];
    const values = [];
    let valIndex = 1;

    if (status !== undefined) {
      fields.push(`status = $${valIndex++}`);
      values.push(status);
    }
    if (req.user.role === 'admin') {
      if (plate !== undefined) {
        fields.push(`plate = $${valIndex++}`);
        values.push(plate.toUpperCase().trim());
      }
      if (service_type !== undefined) {
        fields.push(`service_type = $${valIndex++}`);
        values.push(service_type);
      }
      if (price !== undefined) {
        fields.push(`price = $${valIndex++}`);
        values.push(price);
      }
      if (worker_id !== undefined) {
        fields.push(`worker_id = $${valIndex++}`);
        values.push(worker_id === null ? null : parseInt(worker_id));
      }
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No hay campos para actualizar' });
    }

    values.push(id);
    const updateQuery = `
      UPDATE services 
      SET ${fields.join(', ')} 
      WHERE id = $${valIndex} 
      RETURNING *
    `;

    const result = await db.query(updateQuery, values);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error al actualizar servicio:', error);
    res.status(500).json({ error: 'Error al actualizar servicio' });
  }
});

// DELETE /api/services/:id (Admin only)
app.delete('/api/services/:id', authenticateToken, requireRole(['admin']), async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query('DELETE FROM services WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }
    res.json({ message: 'Servicio eliminado correctamente', service: result.rows[0] });
  } catch (error) {
    console.error('Error al eliminar servicio:', error);
    res.status(500).json({ error: 'Error al eliminar servicio' });
  }
});

// --- ADMIN USERS ENDPOINTS ---

// GET /api/users (Admin only)
app.get('/api/users', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const result = await db.query('SELECT id, username, role FROM users ORDER BY username ASC');
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener usuarios:', error);
    res.status(500).json({ error: 'Error al obtener usuarios' });
  }
});

// POST /api/users (Admin only)
app.post('/api/users', authenticateToken, requireRole(['admin']), async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password || !role) {
    return res.status(400).json({ error: 'Nombre de usuario, contraseña y rol son requeridos' });
  }

  if (!['admin', 'worker'].includes(role)) {
    return res.status(400).json({ error: 'Rol inválido' });
  }

  try {
    const userExists = await db.query('SELECT * FROM users WHERE username = $1', [username.toLowerCase().trim()]);
    if (userExists.rows.length > 0) {
      return res.status(400).json({ error: 'El nombre de usuario ya está registrado' });
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    const result = await db.query(
      'INSERT INTO users (username, password, role) VALUES ($1, $2, $3) RETURNING id, username, role',
      [username.toLowerCase().trim(), passwordHash, role]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error al crear usuario:', error);
    res.status(500).json({ error: 'Error al crear usuario' });
  }
});

// --- REPORTS ENDPOINTS ---

// GET /api/reports/summary (Admin only)
app.get('/api/reports/summary', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    // 1. Total revenue today
    const revenueTodayRes = await db.query(
      "SELECT COALESCE(SUM(price), 0) as total FROM services WHERE created_at >= CURRENT_DATE"
    );
    const revenueToday = parseFloat(revenueTodayRes.rows[0].total);

    // 2. Total services today
    const servicesTodayRes = await db.query(
      "SELECT COUNT(*) as count FROM services WHERE created_at >= CURRENT_DATE"
    );
    const servicesToday = parseInt(servicesTodayRes.rows[0].count);

    // 3. Overall services count
    const totalServicesRes = await db.query("SELECT COUNT(*) as count FROM services");
    const totalServices = parseInt(totalServicesRes.rows[0].count);

    // 4. Overall revenue
    const totalRevenueRes = await db.query("SELECT COALESCE(SUM(price), 0) as total FROM services");
    const totalRevenue = parseFloat(totalRevenueRes.rows[0].total);

    // 5. Status distribution
    const statusDistRes = await db.query(
      "SELECT status, COUNT(*) as count FROM services GROUP BY status"
    );
    const statusDistribution = statusDistRes.rows;

    // 6. Worker performance (services and earnings per worker)
    const workerPerformanceRes = await db.query(`
      SELECT u.id, u.username, COUNT(s.id) as services_count, COALESCE(SUM(s.price), 0) as total_earnings
      FROM users u
      LEFT JOIN services s ON u.id = s.worker_id
      GROUP BY u.id, u.username
      ORDER BY total_earnings DESC
    `);
    const workerPerformance = workerPerformanceRes.rows;

    // 7. Revenue by service type
    const serviceTypeDistRes = await db.query(`
      SELECT service_type, COUNT(*) as count, COALESCE(SUM(price), 0) as total_revenue
      FROM services
      GROUP BY service_type
      ORDER BY total_revenue DESC
    `);
    const serviceTypeDistribution = serviceTypeDistRes.rows;

    res.json({
      revenueToday,
      servicesToday,
      totalServices,
      totalRevenue,
      statusDistribution,
      workerPerformance,
      serviceTypeDistribution
    });
  } catch (error) {
    console.error('Error al generar resumen de reportes:', error);
    res.status(500).json({ error: 'Error al generar reporte' });
  }
});

// Run server locally if run directly
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
