const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const expressLayouts = require('express-ejs-layouts');
const path = require('path');
const dotenv = require('dotenv');
const morgan = require('morgan');
const { initializeDatabase } = require('./config/db');
const { seed } = require('./scripts/seed');
const { startMonitor } = require('./services/dockerEventMonitor');
const { startMetricsMonitor } = require('./services/metricsMonitor');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Middleware
app.use(morgan('dev'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Session
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'supersecret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // Set to true if using HTTPS
});
app.use(sessionMiddleware);

// Share session with socket.io
io.use((socket, next) => {
  sessionMiddleware(socket.request, socket.request.res || {}, next);
});

// View Engine
app.use(expressLayouts);
app.set('view engine', 'ejs');
app.set('layout', 'layouts/main');
app.set('views', path.join(__dirname, 'views'));

// Pass user to all views
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

// Routes
const authRoutes = require('./routes/auth.routes');
const adminRoutes = require('./routes/admin.routes');
const containerRoutes = require('./routes/container.routes');

app.use('/auth', authRoutes);
app.use('/admin', adminRoutes);
app.use('/', containerRoutes);

// Sockets
require('./sockets/log.socket')(io);
require('./sockets/terminal.socket')(io);

// Database Initialization & Auto-Seeding
initializeDatabase()
  .then(() => seed())
  .then(() => {
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
    // Start monitors
    startMonitor();
    startMetricsMonitor();
  }).catch(err => {
    console.error('❌ Failed to initialize application:', err);
    process.exit(1);
  });


