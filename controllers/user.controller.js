const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const dockerService = require('../services/docker.service');

exports.getAdminDashboard = async (req, res) => {
  try {
    const [users] = await pool.query('SELECT id, name, email, role, status, alert_email FROM users');
    // Fetch admin's own alert_email from DB (fresh, not just session)
    const [adminRow] = await pool.query('SELECT alert_email FROM users WHERE id = ?', [req.session.user.id]);
    const adminAlertEmail = adminRow[0]?.alert_email || '';
    res.render('admin', { users, adminAlertEmail });
  } catch (err) {
    console.error('Admin dashboard error:', err);
    res.status(500).send('Internal Server Error');
  }
};

exports.createUser = async (req, res) => {
  const { name, email, password, role } = req.body;

  try {
    const password_hash = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (name, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?)',
      [name, email, password_hash, role, 'active']
    );
    res.redirect('/admin');
  } catch (err) {
    console.error('Create user error:', err);
    res.status(500).send('Failed to create user');
  }
};

exports.getAssignContainers = async (req, res) => {
  const userId = req.params.id;

  try {
    const [userRows] = await pool.query('SELECT * FROM users WHERE id = ?', [userId]);
    const user = userRows[0];

    // Get all containers from Docker
    const containers = await dockerService.listContainers();

    // Sync containers with DB using Name as stable key
    for (const c of containers) {
      const name = c.Names[0].replace('/', '');
      await pool.query(
        'INSERT INTO containers (container_id, name, image, status) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE container_id = ?, status = ?',
        [c.Id, name, c.Image, c.Status, c.Id, c.Status]
      );
    }

    const [dbContainers] = await pool.query('SELECT * FROM containers');
    const [assigned] = await pool.query('SELECT container_id FROM user_containers WHERE user_id = ?', [userId]);
    
    const assignedIds = assigned.map(a => a.container_id);

    res.render('assign-containers', { user, containers: dbContainers, assignedIds });
  } catch (err) {
    console.error('Get assign containers error:', err);
    res.status(500).send('Internal Server Error');
  }
};

exports.updateUser = async (req, res) => {
  const { id } = req.params;
  const { name, email, role, status } = req.body;

  try {
    await pool.query(
      'UPDATE users SET name = ?, email = ?, role = ?, status = ? WHERE id = ?',
      [name, email, role, status, id]
    );
    res.redirect('/admin');
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).send('Failed to update user');
  }
};

exports.deleteUser = async (req, res) => {
  const { id } = req.params;

  try {
    // Cascading delete handles user_containers
    await pool.query('DELETE FROM users WHERE id = ?', [id]);
    res.redirect('/admin');
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).send('Failed to delete user');
  }
};

exports.resetPassword = async (req, res) => {
  const { id } = req.params;
  const { newPassword } = req.body;

  try {
    const password_hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash, id]);
    res.redirect('/admin');
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).send('Failed to reset password');
  }
};

exports.postAssignContainers = async (req, res) => {
  const userId = req.params.id;
  const { containerIds } = req.body; // Array of IDs

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    
    // Clear existing assignments
    await connection.query('DELETE FROM user_containers WHERE user_id = ?', [userId]);

    // Add new assignments
    if (containerIds) {
      const ids = Array.isArray(containerIds) ? containerIds : [containerIds];
      for (const cid of ids) {
        await connection.query('INSERT INTO user_containers (user_id, container_id) VALUES (?, ?)', [userId, cid]);
      }
    }

    await connection.commit();
    res.redirect('/admin');
  } catch (err) {
    await connection.rollback();
    console.error('Post assign containers error:', err);
    res.status(500).send('Failed to assign containers');
  } finally {
    connection.release();
  }
};

/**
 * Update the currently logged-in user's alert email (any role).
 * POST /profile/alert-email
 */
exports.updateAlertEmail = async (req, res) => {
  const userId = req.session.user.id;
  const { alert_email, slack_webhook, discord_webhook, custom_webhook } = req.body;

  try {
    await pool.query(
      'UPDATE users SET alert_email = ?, slack_webhook = ?, discord_webhook = ?, custom_webhook = ? WHERE id = ?', 
      [alert_email || null, slack_webhook || null, discord_webhook || null, custom_webhook || null, userId]
    );
    req.session.user.alert_email = alert_email || null;
    req.session.user.slack_webhook = slack_webhook || null;
    req.session.user.discord_webhook = discord_webhook || null;
    req.session.user.custom_webhook = custom_webhook || null;
    res.redirect(req.session.user.role === 'admin' ? '/admin' : '/');
  } catch (err) {
    console.error('Update notifications error:', err);
    res.status(500).send('Failed to update notifications');
  }
};

/**
 * Admin sets a specific user's alert email.
 * POST /admin/users/:id/alert-email
 */
exports.updateUserAlertEmail = async (req, res) => {
  const { id } = req.params;
  const { alert_email } = req.body;

  try {
    await pool.query('UPDATE users SET alert_email = ? WHERE id = ?', [alert_email || null, id]);
    res.redirect('/admin');
  } catch (err) {
    console.error('Update user alert email error:', err);
    res.status(500).send('Failed to update user alert email');
  }
};
