# 🚀 DockPulse (v1.1) - Premium Docker Management & Monitoring

[![Docker Hub](https://img.shields.io/badge/Docker-Hub-blue?logo=docker&logoColor=white)](https://hub.docker.com/r/ajitrai9878/dockpulse)
[![Version](https://img.shields.io/badge/Version-1.1-success)](https://github.com/ajitrai9878/DockPulse/releases/tag/v1.1)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

**DockPulse** is a high-performance, premium Docker management dashboard. It transforms your container monitoring into an interactive experience with live log streaming, real-time metrics, actionable management tools (Start/Stop/Restart), and multi-channel notifications (Email, Slack, Discord).

Designed for DevOps engineers who need a sleek, centralized management suite with an enterprise-grade dark aesthetic.

---

## ✨ v1.1 New Features & Enhancements

- 🔍 **Live Log Search & Highlighting**: Instantly filter live log streams. Matches are highlighted in real-time, even as new logs arrive.
- 🔔 **Multi-Channel Notifications**: Configure alerts via **Email**, **Slack**, **Discord**, or **Custom Webhooks** from a consolidated management modal.
- ⚡ **Interactive Terminal**: Integrated web-based terminal (`xterm.js`) for direct `docker exec` access into running containers.
- 📊 **Enhanced Host Metrics**: High-precision monitoring of Physical Host CPU, RAM, and Disk usage (optimized for Windows/WSL2 and Linux).
- 🧹 **Intelligent Pruning**: Automatically detects and removes stale/deleted containers from the management lists to keep your workspace clean.
- 🛠️ **Actionable UI**: Management buttons (Start, Stop, Restart) integrated directly into the dashboard for authorized managers.
- 💎 **Premium Dark Mode**: A unified, modern dark-only theme with glassmorphism effects and optimized navigation.

---

## 🛠️ Tech Stack

- **Backend**: Node.js, Express.js
- **Streaming**: Server-Sent Events (SSE) for efficient, high-performance logs
- **Communication**: Socket.IO (Terminal)
- **Database**: MySQL 8.0
- **Frontend**: EJS, Bootstrap 5, xterm.js
- **Monitoring**: Dockerode (Docker Engine API)

---

## 🚀 Quick Start

### 1. Docker Compose (Recommended)

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
      # Optional: Enable Notifications
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

---

## 🔐 Default Credentials

DockPulse auto-seeds an administrative account on startup:

- **Email**: `admin@admin.com`
- **Password**: `admin123`

> [!IMPORTANT]
> Change the default password immediately via the **Management** panel.

---

## 📧 Multi-Channel Alerts & RCA

DockPulse monitors your Docker event stream in real-time and sends alerts (Email, Slack, Discord) when containers stop, die, or restart unexpectedly.

### Root Cause Analysis (RCA)
Every alert includes an automatic **RCA report** analyzing:
- Exit codes (e.g., OOM Kill, Segmentation Fault)
- Last 50 lines of logs prior to the failure
- Automated diagnostic suggestions

### Configuration
Set the `SMTP_*` environment variables for Email. Webhook URLs (Slack/Discord) can be configured directly in the **Management (Gear Icon) → Notifications** modal.

---

## 🛡️ Security Note
Mounting `/var/run/docker.sock` gives the container significant control over your host. Ensure you deploy DockPulse in a secure environment and use a reverse proxy with SSL for public access.

---
**Developed by Ajit Rai**
