# 🚀 DockPulse (v1.1) - Premium Docker Monitoring & Log Streaming

**DockPulse** is a lightweight, high-performance monitoring dashboard for Docker containers. It provides real-time health metrics, live streaming logs via WebSockets, and a robust Role-Based Access Control (RBAC) system to manage container visibility across your team.

Designed for developers and DevOps engineers who need a sleek, centralized dashboard without the overhead of heavy monitoring suites.

## ✨ Key Features

- 🔴 **Real-Time Logs**: Stream container logs instantly using high-performance **Server-Sent Events (SSE)**.
- 🔍 **Live Log Search**: Real-time search and highlighting within the live log stream.
- ⚡ **Interactive Terminal**: Integrated web terminal (`xterm.js`) for direct `docker exec` access.
- 📊 **Live Metrics**: Monitor **CPU, Memory, and Host Disk** usage in real-time.
- 🔐 **RBAC System**: Multi-user support with Manager-controlled permissions for specific containers.
- 🔔 **Multi-Channel Alerts**: Support for **Slack, Discord, and Custom Webhooks** alongside Email.
- 📅 **Historical Logs**: Retrieve and filter logs by date/time directly from the UI.
- 🧹 **Intelligent Pruning**: Automatically removes stale/deleted containers from the dashboard.
- 💎 **Premium UI**: Modern dark-themed dashboard with glassmorphism and optimized navigation.
- 🐳 **Native Integration**: Seamlessly connects to your host via `/var/run/docker.sock`.

## 🛠️ Tech Stack

- **Backend**: Node.js, Express.js
- **Communication**: SSE (Logs), Socket.IO (Terminal)
- **Database**: MySQL 8.0
- **Docker API**: Dockerode
- **Frontend**: EJS, Bootstrap 5, xterm.js

## 🚀 Quick Start

### 1. Docker Compose (Recommended)
Create a `docker-compose.yml` file to spin up DockPulse and its database:

```yaml
services:
  dockpulse:
    image: ajitrai9878/dockpulse:latest
    container_name: dockpulse-app
    ports:
      - "3000:3000"
    environment:
      - DB_HOST=db
      - DB_PORT=3306
      - DB_USER=root
      - DB_PASSWORD=root
      - DB_NAME=docker_monitor
      - SESSION_SECRET=your-random-secret
      # Optional: Enable Email Alerts
      - SMTP_HOST=smtp.gmail.com
      - SMTP_PORT=587
      - SMTP_SECURE=false
      - SMTP_USER=you@gmail.com
      - SMTP_PASS=your-app-password
      - SMTP_FROM=DockPulse Alerts <noreply@yourdomain.com>
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    depends_on:
      db:
        condition: service_healthy

  db:
    image: mysql:8
    container_name: dockpulse-db
    environment:
      - MYSQL_ROOT_PASSWORD=root
      - MYSQL_DATABASE=docker_monitor
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      timeout: 5s
      retries: 5
```

Run: `docker-compose up -d`

### 2. Standalone Docker Run
If you already have a MySQL database running:

```bash
docker run -d \
  --name dockpulse \
  -p 3000:3000 \
  -e DB_HOST=<your-db-ip> \
  -e DB_PORT=3306 \
  -e DB_USER=root \
  -e DB_PASSWORD=<your-db-pass> \
  -e DB_NAME=docker_monitor \
  -e SESSION_SECRET=your-secret \
  -e SMTP_HOST=smtp.gmail.com \
  -e SMTP_PORT=587 \
  -e SMTP_SECURE=false \
  -e SMTP_USER=you@gmail.com \
  -e SMTP_PASS=your-app-password \
  -e SMTP_FROM="DockPulse Alerts <noreply@yourdomain.com>" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  ajitrai9878/dockpulse:latest
```

## 🔐 Default Credentials
DockPulse automatically seeds an admin account on the first run:

- **Email**: `admin@admin.com`
- **Password**: `admin123`

> [!IMPORTANT]
> Change the default password immediately after logging in via the Admin panel.

---

## 📧 Container Event Email Alerts

DockPulse monitors your Docker event stream in real-time and sends **email alerts** when containers are stopped, restarted, or deleted. Each alert includes:

- Container name, image, and event time
- **Root Cause Analysis (RCA)** — automatic diagnosis based on exit code and log patterns
- Last 50 log lines from the container

### SMTP Configuration

Set the following environment variables to enable email alerts:

| Variable | Description | Example |
|----------|-------------|---------|
| `SMTP_HOST` | SMTP server hostname | `smtp.gmail.com` |
| `SMTP_PORT` | SMTP port | `587` |
| `SMTP_SECURE` | Use TLS (`true`/`false`) | `false` |
| `SMTP_USER` | SMTP username / email | `you@gmail.com` |
| `SMTP_PASS` | SMTP password or App Password | `your-app-password` |
| `SMTP_FROM` | From display name & address | `DockPulse <alerts@you.com>` |

> [!TIP]
> For Gmail: Enable 2FA and create an **App Password** at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords). Use that App Password as `SMTP_PASS`.

### Who Receives Alerts?

- **Managers** — set alert email and Webhooks (Slack/Discord) in the Management panel → Notifications modal. Managers receive alerts for **all** containers.
- **Regular users** — set their alert email via the Dashboard bell icon. They receive alerts only for **containers assigned to them**.

---

## 🛡️ Security Note
Mounting `/var/run/docker.sock` gives this container significant privileges over your host. Only deploy DockPulse in trusted environments and use a reverse proxy (Nginx/Traefik) with SSL for production visibility.

---
**Developed by Ajit Rai**

