const { pool, initializeDatabase } = require('../config/db');
const { seed } = require('./seed');

async function resetDatabase() {
  console.log('⚠️  Starting database reset from scratch...');
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    console.log('🗑️  Dropping existing tables...');
    // Drop in order to respect foreign key constraints
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    await connection.query('DROP TABLE IF EXISTS user_containers');
    await connection.query('DROP TABLE IF EXISTS containers');
    await connection.query('DROP TABLE IF EXISTS users');
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');

    await connection.commit();
    console.log('✅ Tables dropped successfully');

    console.log('🏗️  Re-initializing database schema...');
    await initializeDatabase();

    console.log('🌱 Seeding default data...');
    await seed();

    console.log('🏁 Database reset complete!');
  } catch (err) {
    await connection.rollback();
    console.error('❌ Reset failed:', err.message);
    process.exit(1);
  } finally {
    connection.release();
    process.exit(0);
  }
}

resetDatabase();
