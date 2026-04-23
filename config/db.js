const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'root',
  database: process.env.DB_NAME || 'docker_monitor',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

async function initializeDatabase() {
  try {
    const connection = await pool.getConnection();
    console.log('Database connected successfully');

    // Create Users table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(150) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role ENUM('admin', 'user') DEFAULT 'user',
        status ENUM('active', 'inactive') DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create Containers table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS containers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        container_id VARCHAR(100),
        name VARCHAR(100) UNIQUE NOT NULL,
        image VARCHAR(100),
        status VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create User Containers mapping table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS user_containers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        container_id INT,
        assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (container_id) REFERENCES containers(id) ON DELETE CASCADE
      )
    `);

    // Create Container Events audit table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS container_events (
        id INT AUTO_INCREMENT PRIMARY KEY,
        container_name VARCHAR(100),
        container_id VARCHAR(100),
        event_type ENUM('start','stop','die','destroy','restart') NOT NULL,
        exit_code INT DEFAULT NULL,
        rca TEXT,
        logs_snapshot TEXT,
        occurred_at DATETIME NOT NULL,
        notified_count INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Migrations for existing tables
    try {
      await connection.query('ALTER TABLE users ADD COLUMN status ENUM("active", "inactive") DEFAULT "active" AFTER role');
      console.log('Added status column to users table');
    } catch (err) {
      // Column probably exists
    }

    try {
      await connection.query('ALTER TABLE users ADD COLUMN alert_email VARCHAR(150) DEFAULT NULL AFTER status');
      console.log('Added alert_email column to users table');
    } catch (err) {
      // Column probably exists
    }

    try {
      await connection.query('ALTER TABLE containers DROP INDEX container_id');
      await connection.query('ALTER TABLE containers MODIFY container_id VARCHAR(100)');
      await connection.query('ALTER TABLE containers ADD UNIQUE INDEX (name)');
      console.log('Updated containers table constraints');
    } catch (err) {
      // Constraints/columns might already be correctly set
    }

    // Ensure existing users are active (especially for first migration)
    await connection.query('UPDATE users SET status = "active" WHERE status IS NULL OR status = ""');

    connection.release();
    console.log('Database schema initialized and migrated');
  } catch (err) {
    console.error('Database initialization error:', err.message);
    // If it fails because DB doesn't exist, we might need to handle it 
    // but usually docker-compose handles DB creation.
  }
}

module.exports = {
  pool,
  initializeDatabase
};
