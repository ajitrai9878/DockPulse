const bcrypt = require('bcryptjs');
const { pool, initializeDatabase } = require('../config/db');

async function seed() {
  try {
    await initializeDatabase();
    
    const adminName = 'Admin';
    const adminEmail = 'admin@admin.com';
    const adminPass = 'admin123';
    
    const password_hash = await bcrypt.hash(adminPass, 10);
    
    const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [adminEmail]);
    
    if (rows.length === 0) {
      await pool.query(
        'INSERT INTO users (name, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?)',
        [adminName, adminEmail, password_hash, 'admin', 'active']
      );
      console.log('--------------------------------------------------');
      console.log('✅ Admin user created successfully');
      console.log(`📧 Email: ${adminEmail}`);
      console.log(`🔑 Password: ${adminPass}`);
      console.log('--------------------------------------------------');
    } else {
      console.log('ℹ️ Admin user already exists');
    }
    
    return true;
  } catch (err) {
    console.error('❌ Seed error:', err);
    throw err;
  }
}

if (require.main === module) {
  seed()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { seed };

