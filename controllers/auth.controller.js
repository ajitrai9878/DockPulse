const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');

exports.getLogin = (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { error: null });
};

exports.postLogin = async (req, res) => {
  const { email, password } = req.body;

  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    const user = rows[0];

    if (user && await bcrypt.compare(password, user.password_hash)) {
      if (user.status !== 'active') {
        return res.render('login', { error: 'Your account is inactive. Please contact admin.' });
      }

      req.session.user = {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      };
      return res.redirect('/');
    }

    res.render('login', { error: 'Invalid email or password' });
  } catch (err) {
    console.error('Login error:', err);
    res.render('login', { error: 'An error occurred. Please try again.' });
  }
};

exports.logout = (req, res) => {
  req.session.destroy();
  res.redirect('/auth/login');
};
